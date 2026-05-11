import { NextResponse } from "next/server"
import { syncApimartGenerationJob } from "@/lib/apimart-task-sync"
import { loadGenerationJobsForUser, loadInteractiveApimartGenerationJobsForUser, recoverStaleGenerationJobsForUser } from "@/lib/generation-jobs"
import { generationJobToProjectItem } from "@/lib/project-history"
import { getServerErrorStatus, requireAuthenticatedUser } from "@/lib/server-supabase"

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const jobsToSync = await loadInteractiveApimartGenerationJobsForUser({ userId: auth.userId })
    await Promise.allSettled(jobsToSync.map((job) => syncApimartGenerationJob(job, { mode: "interactive" })))
    await recoverStaleGenerationJobsForUser({ userId: auth.userId })
    const jobs = await loadGenerationJobsForUser({ userId: auth.userId })

    return NextResponse.json({
      ok: true,
      projects: jobs.map(generationJobToProjectItem),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取生成历史失败。"

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: getServerErrorStatus(error) }
    )
  }
}
