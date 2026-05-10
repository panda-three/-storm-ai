import { getTaskStatus, isApimartRateLimitError } from "@/lib/apimart"
import {
  failGenerationJobWithRefund,
  isTerminalGenerationJobStatus,
  lockGenerationJobForSync,
  updateActiveGenerationJob,
  updateGenerationJob,
  type GenerationJob,
  type GenerationJobStatus,
} from "@/lib/generation-jobs"
import { deleteGeneratedImageByPublicUrl, persistRemoteGeneratedImage, refundGenerationCredits } from "@/lib/server-supabase"

const baseRetryMs = 60 * 1000
const maxRetryMs = 30 * 60 * 1000

export interface SyncApimartGenerationJobResult {
  job: GenerationJob
  locked: boolean
  status: "skipped" | "synced" | "retryable_error"
}

export async function syncApimartGenerationJob(job: GenerationJob): Promise<SyncApimartGenerationJobResult> {
  if (job.provider !== "apimart" || !job.upstream_task_id || isTerminalGenerationJobStatus(job.status)) {
    return { job, locked: false, status: "skipped" }
  }

  const lockedJob = await lockGenerationJobForSync(job.id)
  if (!lockedJob) {
    return { job, locked: false, status: "skipped" }
  }

  if (!lockedJob.upstream_task_id) {
    return { job: lockedJob, locked: true, status: "skipped" }
  }

  try {
    const result = await getTaskStatus(lockedJob.upstream_task_id)
    const upstreamResultUrls = uniqueUrls(lockedJob.type === "image" ? result.imageUrls : result.videoUrl ? [result.videoUrl] : [])
    const expectedResultCount = lockedJob.type === "image" ? lockedJob.expected_result_count : 1
    const limitedUpstreamResultUrls = upstreamResultUrls.slice(0, expectedResultCount)
    const resultUrls =
      result.status === "completed" &&
      lockedJob.type === "image" &&
      limitedUpstreamResultUrls.length > 0 &&
      !result.mode.includes("mock")
        ? await persistRemoteImageResults(limitedUpstreamResultUrls, lockedJob.user_id)
        : limitedUpstreamResultUrls
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
    const storedResultUrls = resultUrls
    let nextJob: GenerationJob

    try {
      if (status === "failed" && lockedJob.status !== "failed") {
        nextJob = await failGenerationJobWithRefund({
          jobId: lockedJob.id,
          reason: taskError || `AI 生成失败退款 · ${lockedJob.model}`,
        })
        return { job: nextJob, locked: true, status: "synced" }
      }
    } catch (error) {
      if (result.status === "completed" && lockedJob.type === "image" && !result.mode.includes("mock")) {
        await Promise.all(resultUrls.map((url) => deleteGeneratedImageByPublicUrl(url)))
      }
      throw error
    }

    try {
      const now = new Date().toISOString()
      const updatedJob = await updateActiveGenerationJob(lockedJob.id, {
        check_attempts: 0,
        completed_at: isTerminalGenerationJobStatus(status) ? lockedJob.completed_at ?? now : lockedJob.completed_at,
        last_checked_at: now,
        last_sync_error: null,
        next_check_at: isTerminalGenerationJobStatus(status) ? now : getNextCheckAt(0),
        result_urls: storedResultUrls.length > 0 ? storedResultUrls : lockedJob.result_urls,
        status,
        sync_locked_until: null,
        task_error: taskError || null,
      })

      if (!updatedJob) {
        if (result.status === "completed" && lockedJob.type === "image" && !result.mode.includes("mock")) {
          await Promise.all(resultUrls.map((url) => deleteGeneratedImageByPublicUrl(url)))
        }
        return { job: lockedJob, locked: true, status: "skipped" }
      }

      nextJob = updatedJob

      if (status === "partial_completed" && lockedJob.status !== "partial_completed") {
        await refundJobCredits({
          amount: calculatePartialRefundAmount(lockedJob.amount, resultUrls.length, expectedResultCount),
          job: lockedJob,
          reason: `AI 生图部分失败退款 · ${lockedJob.model} · ${expectedResultCount - resultUrls.length}/${expectedResultCount} 张`,
          reference: buildPartialRefundReference(lockedJob.reference, resultUrls.length, expectedResultCount),
        })
      }
    } catch (error) {
      if (result.status === "completed" && lockedJob.type === "image" && !result.mode.includes("mock")) {
        await Promise.all(resultUrls.map((url) => deleteGeneratedImageByPublicUrl(url)))
      }
      throw error
    }

    return { job: nextJob, locked: true, status: "synced" }
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

async function persistRemoteImageResults(urls: string[], userId: string) {
  const savedUrls: string[] = []

  try {
    for (const url of urls) {
      savedUrls.push(
        await persistRemoteGeneratedImage({
          sourceUrl: url,
          userId,
        })
      )
    }
  } catch (error) {
    await Promise.all(savedUrls.map((url) => deleteGeneratedImageByPublicUrl(url)))
    throw error
  }

  return savedUrls
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
