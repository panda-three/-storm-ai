import { getTaskStatus, isApimartRateLimitError } from "@/lib/apimart"
import {
  failGenerationJobWithRefund,
  getGenerationJobExpiresAt,
  isTerminalGenerationJobStatus,
  lockGenerationJobForSync,
  loadGenerationJobForUser,
  updateActiveGenerationJob,
  updateGenerationJob,
  type GenerationJob,
  type GenerationJobStatus,
} from "@/lib/generation-jobs"
import {
  deleteGeneratedImageByPublicUrl,
  getGeneratedStorageObjectPath,
  persistRemoteGeneratedImage,
  refundGenerationCredits,
} from "@/lib/server-supabase"

const baseRetryMs = 60 * 1000
const maxRetryMs = 30 * 60 * 1000
const interactiveMinCheckMs = 4 * 1000
const interactiveLockMs = 45 * 1000

export interface SyncApimartGenerationJobResult {
  job: GenerationJob
  locked: boolean
  status: "skipped" | "synced" | "retryable_error"
}

export async function syncApimartGenerationJob(
  job: GenerationJob,
  { mode = "scheduled" }: { mode?: "interactive" | "scheduled" } = {}
): Promise<SyncApimartGenerationJobResult> {
  if (job.provider !== "apimart" || !job.upstream_task_id || isTerminalGenerationJobStatus(job.status)) {
    return { job, locked: false, status: "skipped" }
  }

  if (mode === "interactive" && !shouldSyncJobInteractively(job)) {
    return { job, locked: false, status: "skipped" }
  }

  const lockedJob = await lockGenerationJobForSync(job.id, mode === "interactive" ? interactiveLockMs : undefined)
  if (!lockedJob) {
    const latestJob = await loadGenerationJobForUser({ taskId: job.id, userId: job.user_id })
    return { job: latestJob ?? job, locked: false, status: "skipped" }
  }

  if (!lockedJob.upstream_task_id) {
    return { job: lockedJob, locked: true, status: "skipped" }
  }

  try {
    const result = await getTaskStatus(lockedJob.upstream_task_id)
    const upstreamResultUrls = uniqueUrls(lockedJob.type === "image" ? result.imageUrls : result.videoUrl ? [result.videoUrl] : [])
    const expectedResultCount = lockedJob.type === "image" ? lockedJob.expected_result_count : 1
    const limitedUpstreamResultUrls = upstreamResultUrls.slice(0, expectedResultCount)
    const resultUrls = limitedUpstreamResultUrls
    const missingResultError =
      result.status === "completed" && resultUrls.length === 0 ? "任务已完成，但接口没有返回结果地址。" : ""
    const isPartialImageResult =
      result.status === "completed" && lockedJob.type === "image" && resultUrls.length > 0 && resultUrls.length < expectedResultCount
    const partialResultError = isPartialImageResult
      ? buildPartialImageMessage({
          amount: lockedJob.amount,
          expectedResultCount,
          successCount: resultUrls.length,
        })
      : ""
    const taskError = missingResultError || partialResultError || (result.status === "failed" ? result.taskError : "")
    const status: GenerationJobStatus =
      missingResultError && result.status === "completed"
        ? "failed"
        : isPartialImageResult
          ? "partial_completed"
          : result.status
    if (status === "failed" && lockedJob.status !== "failed") {
      const failedJob = await failGenerationJobWithRefund({
        jobId: lockedJob.id,
        reason: taskError || `AI 生成失败退款 · ${lockedJob.model}`,
      })
      return { job: failedJob, locked: true, status: "synced" }
    }

    const now = new Date().toISOString()
    const completedAt = isTerminalGenerationJobStatus(status) ? lockedJob.completed_at ?? now : lockedJob.completed_at
    const updatedJob = await updateActiveGenerationJob(lockedJob.id, {
      check_attempts: 0,
      completed_at: completedAt,
      expires_at:
        isTerminalGenerationJobStatus(status) && completedAt
          ? lockedJob.expires_at ?? getGenerationJobExpiresAt(completedAt)
          : lockedJob.expires_at,
      last_checked_at: now,
      last_sync_error: null,
      next_check_at: isTerminalGenerationJobStatus(status) ? now : getNextCheckAt(0),
      result_urls: resultUrls.length > 0 ? resultUrls : lockedJob.result_urls,
      status,
      storage_urls: lockedJob.storage_urls,
      sync_locked_until: null,
      task_error: taskError || null,
    })

    if (!updatedJob) {
      return { job: lockedJob, locked: true, status: "skipped" }
    }

    if (status === "partial_completed" && lockedJob.status !== "partial_completed") {
      await refundJobCredits({
        amount: calculatePartialRefundAmount(lockedJob.amount, resultUrls.length, expectedResultCount),
        job: lockedJob,
        reason: `AI 生图部分失败退款 · ${lockedJob.model} · ${expectedResultCount - resultUrls.length}/${expectedResultCount} 张`,
        reference: buildPartialRefundReference(lockedJob.reference, resultUrls.length, expectedResultCount),
      })
    }

    return { job: updatedJob, locked: true, status: "synced" }
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务状态查询失败。"
    const attempts = lockedJob.check_attempts + 1
    const now = new Date().toISOString()
    const nextJob = await updateGenerationJob(lockedJob.id, {
      check_attempts: attempts,
      last_checked_at: now,
      last_sync_error: message,
      next_check_at: getNextCheckAt(attempts),
      sync_locked_until: null,
    })

    if (!isApimartRateLimitError(message)) {
      console.warn("[APIMart Sync] task query failed", {
        error: message,
        jobId: lockedJob.id,
        upstreamTaskId: lockedJob.upstream_task_id,
      })
    }

    return { job: nextJob, locked: true, status: "retryable_error" }
  }
}

export function shouldSyncJobNow(job: GenerationJob) {
  if (isTerminalGenerationJobStatus(job.status) || job.provider !== "apimart" || !job.upstream_task_id) return false
  if (!job.next_check_at) return true
  return Date.parse(job.next_check_at) <= Date.now()
}

export function shouldSyncJobInteractively(job: GenerationJob) {
  if (isTerminalGenerationJobStatus(job.status) || job.provider !== "apimart" || !job.upstream_task_id) return false
  if (job.last_sync_error && job.next_check_at && Date.parse(job.next_check_at) > Date.now()) return false
  if (!job.last_checked_at) return true
  return Date.now() - Date.parse(job.last_checked_at) >= interactiveMinCheckMs
}

export async function mirrorApimartImageResults(job: GenerationJob): Promise<SyncApimartGenerationJobResult> {
  if (!shouldMirrorApimartImageResults(job)) {
    return { job, locked: false, status: "skipped" }
  }

  const mirroredUrls: string[] = []
  const nextResultUrls: string[] = []
  const errors: string[] = []

  for (const url of job.result_urls) {
    if (getGeneratedStorageObjectPath(url)) {
      nextResultUrls.push(url)
      continue
    }

    try {
      const savedUrl = await persistRemoteGeneratedImage({
        sourceUrl: url,
        userId: job.user_id,
      })
      mirroredUrls.push(savedUrl)
      nextResultUrls.push(savedUrl)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "生成图片转存失败。")
      nextResultUrls.push(url)
    }
  }

  if (mirroredUrls.length === 0 && errors.length === 0) {
    return { job, locked: false, status: "skipped" }
  }

  try {
    const updatedJob = await updateGenerationJob(job.id, {
      last_checked_at: new Date().toISOString(),
      last_sync_error: errors.length > 0 ? Array.from(new Set(errors)).join("；") : null,
      result_urls: nextResultUrls,
      storage_urls: Array.from(new Set([...(job.storage_urls ?? []), ...mirroredUrls])),
    })

    return { job: updatedJob, locked: false, status: mirroredUrls.length > 0 ? "synced" : "retryable_error" }
  } catch (error) {
    await Promise.all(mirroredUrls.map((url) => deleteGeneratedImageByPublicUrl(url)))
    throw error
  }
}

export function shouldMirrorApimartImageResults(job: GenerationJob) {
  return (
    job.provider === "apimart" &&
    job.type === "image" &&
    isTerminalGenerationJobStatus(job.status) &&
    job.status !== "failed" &&
    job.result_urls.some((url) => !getGeneratedStorageObjectPath(url))
  )
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls.filter((url) => typeof url === "string" && url.length > 0)))
}

function calculatePartialRefundAmount(amount: number, successCount: number, expectedResultCount: number) {
  if (amount <= 0 || expectedResultCount <= 0) return 0
  const failedCount = Math.max(0, expectedResultCount - successCount)
  return Math.floor((amount * failedCount) / expectedResultCount)
}

function buildPartialRefundReference(reference: string, successCount: number, expectedResultCount: number) {
  return `${reference}_partial_${successCount}_of_${expectedResultCount}`
}

function buildPartialImageMessage({
  amount,
  expectedResultCount,
  successCount,
}: {
  amount: number
  expectedResultCount: number
  successCount: number
}) {
  const failedCount = Math.max(0, expectedResultCount - successCount)
  const refundAmount = calculatePartialRefundAmount(amount, successCount, expectedResultCount)
  const refundText = refundAmount > 0 ? `已退还 ${refundAmount.toLocaleString()} 点。` : "本次未扣点，无需退款。"
  return `已生成 ${successCount}/${expectedResultCount} 张，失败 ${failedCount} 张，${refundText}`
}

async function refundJobCredits({
  amount,
  job,
  reason,
  reference,
}: {
  amount: number
  job: GenerationJob
  reason: string
  reference: string
}) {
  if (amount <= 0) return

  await refundGenerationCredits({
    amount,
    reason,
    reference,
    userId: job.user_id,
  }).catch((error) => {
    console.warn("[APIMart Sync] refund failed", {
      error: error instanceof Error ? error.message : String(error),
      jobId: job.id,
    })
    throw error
  })
}

function getNextCheckAt(attempts: number) {
  const delay = Math.min(maxRetryMs, baseRetryMs * 2 ** Math.min(attempts, 5))
  return new Date(Date.now() + delay).toISOString()
}
