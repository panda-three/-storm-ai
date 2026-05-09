import { NextResponse } from "next/server"
import {
  loadGenerationJobForUser,
  updateGenerationJob,
  normalizeJobTaskStatus,
} from "@/lib/generation-jobs"
import { getTaskStatus } from "@/lib/apimart"
import { getMengfactoryVideoTaskStatus } from "@/lib/mengfactory"
import { shouldSyncJobNow, syncApimartGenerationJob } from "@/lib/apimart-task-sync"
import { refundGenerationCredits, requireAuthenticatedUser } from "@/lib/server-supabase"

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

    if (!job.upstream_task_id) {
      return NextResponse.json(normalizeJobTaskStatus(job))
    }

    if (job.provider === "mengfactory") {
      const result = await getMengfactoryVideoTaskStatus(job.upstream_task_id)
      const resultUrls = result.videoUrl ? [result.videoUrl] : []
      const taskError = result.taskError || (result.status === "completed" && resultUrls.length === 0 ? "任务已完成，但接口没有返回视频地址。" : "")
      const status = taskError && result.status === "completed" ? "failed" : result.status
      const nextJob = await updateGenerationJob(job.id, {
        completed_at: status === "completed" || status === "failed" ? job.completed_at ?? new Date().toISOString() : job.completed_at,
        last_checked_at: new Date().toISOString(),
        last_sync_error: null,
        next_check_at: status === "completed" || status === "failed" ? new Date().toISOString() : job.next_check_at,
        result_urls: resultUrls.length > 0 ? resultUrls : job.result_urls,
        status,
        sync_locked_until: null,
        task_error: taskError || null,
      })

      if (status === "failed" && job.status !== "failed") {
        await refundGenerationCredits({
          amount: job.amount,
          reason: `AI 生成失败退款 · ${job.model}`,
          reference: job.reference,
          userId: job.user_id,
        }).catch((error) => {
          console.warn("[MengFactory Sync] refund failed", {
            error: error instanceof Error ? error.message : String(error),
            jobId: job.id,
          })
        })
      }

      return NextResponse.json(normalizeJobTaskStatus(nextJob))
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
