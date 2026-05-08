import { NextResponse } from "next/server"
import {
  loadGenerationJobForUser,
  normalizeJobTaskStatus,
} from "@/lib/generation-jobs"
import { getTaskStatus } from "@/lib/apimart"
import { shouldSyncJobNow, syncApimartGenerationJob } from "@/lib/apimart-task-sync"
import { requireAuthenticatedUser } from "@/lib/server-supabase"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const { id } = await params

    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少任务 ID。" }, { status: 400 })
    }

    const job = await loadGenerationJobForUser({ taskId: id, userId: auth.userId })
    if (!job) {
      if (id.startsWith("task_")) {
        return NextResponse.json(createOrphanedTaskStatus(id), { status: 410 })
      }

      if (id.startsWith("mock_")) {
        const legacyResult = await getTaskStatus(id)
        return NextResponse.json(legacyResult)
      }

      return NextResponse.json({ ok: false, error: "任务不存在或无权访问。" }, { status: 404 })
    }

    if (!job.upstream_task_id || job.provider === "mengfactory") {
      return NextResponse.json(normalizeJobTaskStatus(job))
    }

    if (!shouldSyncJobNow(job)) {
      return NextResponse.json(normalizeJobTaskStatus(job))
    }

    const result = await syncApimartGenerationJob(job)
    return NextResponse.json(normalizeJobTaskStatus(result.job))
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务状态查询失败。"
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: message.includes("登录") ? 401 : 500 }
    )
  }
}

function createOrphanedTaskStatus(taskId: string) {
  const message = "旧任务没有本地生成记录，已停止自动查询。"

  return {
    ok: false,
    mode: "apimart",
    taskId,
    status: "failed",
    progress: 0,
    imageUrls: [],
    videoUrl: "",
    orphaned: true,
    taskError: message,
    error: message,
    raw: {},
  }
}
