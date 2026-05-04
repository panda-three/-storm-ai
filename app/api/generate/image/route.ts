import { NextResponse } from "next/server"
import { createImageGeneration, normalizeImageResolution } from "@/lib/apimart"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const prompt = String(body.prompt ?? "").trim()

    if (!prompt) {
      return NextResponse.json({ ok: false, error: "请先输入生图提示词。" }, { status: 400 })
    }

    const model = String(body.model ?? "Gemini Nano Banana Pro")

    const result = await createImageGeneration({
      model,
      prompt,
      size: String(body.ratio ?? "1:1"),
      resolution: normalizeImageResolution(String(body.quality ?? "高清"), model),
    })

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "生图任务提交失败。",
      },
      { status: 500 }
    )
  }
}
