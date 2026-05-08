import { getTaskStatus, isApimartRateLimitError } from "@/lib/apimart"
import {
  lockGenerationJobForSync,
  updateGenerationJob,
  type GenerationJob,
  type GenerationJobStatus,
} from "@/lib/generation-jobs"
import { refundGenerationCredits } from "@/lib/server-supabase"

const baseRetryMs = 60 * 1000
const maxRetryMs = 30 * 60 * 1000

export interface SyncApimartGenerationJobResult {
  job: GenerationJob
  locked: boolean
  status: "skipped" | "synced" | "retryable_error"
}

export async function syncApimartGenerationJob(job: GenerationJob): Promise<SyncApimartGenerationJobResult> {
  if (job.provider !== "apimart" || !job.upstream_task_id || isTerminalJobStatus(job.status)) {
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
    const resultUrls = lockedJob.type === "image" ? result.imageUrls : result.videoUrl ? [result.videoUrl] : []
    const missingResultError =
      result.status === "completed" && resultUrls.length === 0 ? "任务已完成，但接口没有返回结果地址。" : ""
    const taskError = result.taskError || missingResultError
    const status: GenerationJobStatus = taskError && result.status === "completed" ? "failed" : result.status
    const now = new Date().toISOString()
    const nextJob = await updateGenerationJob(lockedJob.id, {
      check_attempts: 0,
      completed_at: isTerminalJobStatus(status) ? lockedJob.completed_at ?? now : lockedJob.completed_at,
      last_checked_at: now,
      last_sync_error: null,
      next_check_at: isTerminalJobStatus(status) ? now : getNextCheckAt(0),
      result_urls: resultUrls.length > 0 ? resultUrls : lockedJob.result_urls,
      status,
      sync_locked_until: null,
      task_error: taskError || null,
    })

    if (status === "failed" && lockedJob.status !== "failed") {
      await refundGenerationCredits({
        amount: lockedJob.amount,
        reason: `AI 生成失败退款 · ${lockedJob.model}`,
        reference: lockedJob.reference,
        userId: lockedJob.user_id,
      }).catch((error) => {
        console.warn("[APIMart Sync] refund failed", {
          error: error instanceof Error ? error.message : String(error),
          jobId: lockedJob.id,
        })
      })
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
  if (isTerminalJobStatus(job.status) || job.provider !== "apimart" || !job.upstream_task_id) return false
  if (!job.next_check_at) return true
  return Date.parse(job.next_check_at) <= Date.now()
}

function isTerminalJobStatus(status: GenerationJobStatus) {
  return status === "completed" || status === "failed"
}

function getNextCheckAt(attempts: number) {
  const delay = Math.min(maxRetryMs, baseRetryMs * 2 ** Math.min(attempts, 5))
  return new Date(Date.now() + delay).toISOString()
}
