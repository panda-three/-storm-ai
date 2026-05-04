import { NextResponse } from "next/server"
import { createVideoGeneration, normalizeVideoDuration } from "@/lib/apimart"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const prompt = String(body.prompt ?? "").trim()

    if (!prompt) {
      return NextResponse.json({ ok: false, error: "请先输入视频提示词。" }, { status: 400 })
    }

    const result = await createVideoGeneration({
      model: String(body.model ?? "Gemini Veo 3.1 Fast"),
      prompt,
      duration: normalizeVideoDuration(String(body.duration ?? "5 秒")),
      quality: String(body.quality ?? "1080p"),
      aspectRatio: String(body.aspectRatio ?? "16:9"),
    })

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "视频任务提交失败。",
      },
      { status: 500 }
    )
  }
}
