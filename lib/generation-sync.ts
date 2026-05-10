import { syncApimartGenerationJob } from "@/lib/apimart-task-sync"
import { loadDueApimartGenerationJobs, recoverStaleGenerationJobs } from "@/lib/generation-jobs"

export async function syncGenerationJobs({ limit = 20 } = {}) {
  const jobs = await loadDueApimartGenerationJobs({ limit })
  const results = await Promise.allSettled(jobs.map((job) => syncApimartGenerationJob(job)))
  const apimart = results.reduce(
    (current, result) => {
      if (result.status === "rejected") {
        current.errors += 1
        return current
      }

      current[result.value.status] += 1
      return current
    },
    {
      checked: jobs.length,
      errors: 0,
      retryable_error: 0,
      skipped: 0,
      synced: 0,
    }
  )
  const stale = await recoverStaleGenerationJobs({ limit })

  return {
    apimart,
    ok: true,
    stale,
  }
}

export function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get("authorization") ?? ""
  const vercelCron = request.headers.get("x-vercel-cron")

  if (secret && authorization === `Bearer ${secret}`) return true
  return process.env.VERCEL === "1" && vercelCron === "1"
}

export function getGenerationSyncBatchSize() {
  const value = Number.parseInt(process.env.APIMART_SYNC_BATCH_SIZE ?? "", 10)
  if (!Number.isFinite(value) || value <= 0) return 20
  return Math.min(value, 100)
}
