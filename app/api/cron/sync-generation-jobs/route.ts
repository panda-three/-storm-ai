import { NextResponse } from "next/server"
import { getGenerationSyncBatchSize, isAuthorizedCronRequest, syncGenerationJobs } from "@/lib/generation-sync"

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

    return NextResponse.json(await syncGenerationJobs({ limit: getGenerationSyncBatchSize() }))
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步生成任务失败。"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
