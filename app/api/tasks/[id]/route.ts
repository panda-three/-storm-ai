import { NextResponse } from "next/server"
import { getTaskStatus } from "@/lib/apimart"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少任务 ID。" }, { status: 400 })
    }

    const result = await getTaskStatus(id)

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "任务状态查询失败。",
      },
      { status: 500 }
    )
  }
}
