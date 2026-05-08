import { NextResponse } from "next/server"
import { syncApimartGenerationJob } from "@/lib/apimart-task-sync"
import { loadDueApimartGenerationJobs } from "@/lib/generation-jobs"

export async function POST(request: Request) {
  return syncTasks(request)
}

export async function GET(request: Request) {
  return syncTasks(request)
}

async function syncTasks(request: Request) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }

    const limit = getBatchSize()
    const jobs = await loadDueApimartGenerationJobs({ limit })
    const results = await Promise.allSettled(jobs.map((job) => syncApimartGenerationJob(job)))
    const summary = results.reduce(
      (current, result) => {
        if (result.status === "rejected") {
          current.errors += 1
          return current
        }

        current[result.value.status] += 1
        return current
      },
      {
        errors: 0,
        retryable_error: 0,
        skipped: 0,
        synced: 0,
      }
    )

    return NextResponse.json({
      ok: true,
      checked: jobs.length,
      ...summary,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步 APIMart 任务失败。"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get("authorization") ?? ""
  const vercelCron = request.headers.get("x-vercel-cron")

  if (secret && authorization === `Bearer ${secret}`) return true
  return process.env.VERCEL === "1" && vercelCron === "1"
}

function getBatchSize() {
  const value = Number.parseInt(process.env.APIMART_SYNC_BATCH_SIZE ?? "", 10)
  if (!Number.isFinite(value) || value <= 0) return 20
  return Math.min(value, 100)
}
