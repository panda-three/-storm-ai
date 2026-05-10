import { NextResponse } from "next/server"
import { loadGenerationJobsForUser, recoverStaleGenerationJobsForUser } from "@/lib/generation-jobs"
import { generationJobToProjectItem } from "@/lib/project-history"
import { requireAuthenticatedUser } from "@/lib/server-supabase"

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request)
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
      { status: message.includes("登录") ? 401 : 500 }
    )
  }
}
