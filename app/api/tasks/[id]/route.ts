import { NextResponse } from "next/server"
import {
  failGenerationJobWithRefund,
  loadGenerationJobForUser,
  updateActiveGenerationJob,
  normalizeJobTaskStatus,
  recoverStaleGenerationJob,
  isTerminalGenerationJobStatus,
  synchronousImageOrphanTimeoutMs,
  asyncImageTimeoutMs,
  asyncVideoTimeoutMs,
  type GenerationJob,
} from "@/lib/generation-jobs"
import { getTaskStatus } from "@/lib/apimart"
import { getMengfactoryVideoTaskStatus } from "@/lib/mengfactory"
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

    const recoveredJob = await recoverStaleGenerationJobIfDue(job)

    if (isTerminalGenerationJobStatus(recoveredJob.status)) {
      return NextResponse.json(normalizeJobTaskStatus(recoveredJob))
    }

    if (!recoveredJob.upstream_task_id) {
      return NextResponse.json(normalizeJobTaskStatus(recoveredJob))
    }

    if (recoveredJob.provider === "mengfactory") {
      const result = await getMengfactoryVideoTaskStatus(recoveredJob.upstream_task_id)
      const resultUrls = result.videoUrl ? [result.videoUrl] : []
      const taskError = result.taskError || (result.status === "completed" && resultUrls.length === 0 ? "任务已完成，但接口没有返回视频地址。" : "")
      const status = taskError && result.status === "completed" ? "failed" : result.status

      if (status === "failed") {
        const failedJob = await failGenerationJobWithRefund({
          jobId: recoveredJob.id,
          reason: taskError || `AI 生成失败退款 · ${recoveredJob.model}`,
        })
        return NextResponse.json(normalizeJobTaskStatus(failedJob))
      }

      const nextJob = await updateActiveGenerationJob(recoveredJob.id, {
        completed_at: status === "completed" ? recoveredJob.completed_at ?? new Date().toISOString() : recoveredJob.completed_at,
        last_checked_at: new Date().toISOString(),
        last_sync_error: null,
        next_check_at: status === "completed" ? new Date().toISOString() : recoveredJob.next_check_at,
        result_urls: resultUrls.length > 0 ? resultUrls : recoveredJob.result_urls,
        status,
        sync_locked_until: null,
        task_error: taskError || null,
      })

      return NextResponse.json(normalizeJobTaskStatus(nextJob ?? recoveredJob))
    }

    if (!shouldSyncJobNow(recoveredJob)) {
      return NextResponse.json(normalizeJobTaskStatus(recoveredJob))
    }

    const result = await syncApimartGenerationJob(recoveredJob)
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

async function recoverStaleGenerationJobIfDue(job: GenerationJob) {
  if (isTerminalGenerationJobStatus(job.status)) return job

  const ageMs = Date.now() - Date.parse(job.created_at)
  const isSynchronousImageOrphan =
    job.provider === "mengfactory" && job.type === "image" && !job.upstream_task_id && ageMs >= synchronousImageOrphanTimeoutMs
  const isAsyncImageTimeout = job.type === "image" && Boolean(job.upstream_task_id) && ageMs >= asyncImageTimeoutMs
  const isAsyncVideoTimeout = job.type === "video" && Boolean(job.upstream_task_id) && ageMs >= asyncVideoTimeoutMs

  if (!isSynchronousImageOrphan && !isAsyncImageTimeout && !isAsyncVideoTimeout) {
    return job
  }

  return recoverStaleGenerationJob(job)
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
