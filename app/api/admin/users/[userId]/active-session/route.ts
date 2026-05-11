import { NextResponse } from "next/server"
import { describeServerError, getSupabaseServerClient, requireAdminUser } from "@/lib/server-supabase"

export async function DELETE(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const admin = await requireAdminUser(request)
    const { userId } = await params

    if (!userId) {
      return NextResponse.json({ ok: false, error: "缺少用户 ID。" }, { status: 400 })
    }

    if (userId === admin.userId) {
      return NextResponse.json({ ok: false, error: "不能解除当前管理员自己的登录占用。" }, { status: 400 })
    }

    const { data, error } = await getSupabaseServerClient()
      .from("user_active_sessions")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: admin.userId,
        revoked_reason: "admin_revoked",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .is("revoked_at", null)
      .select("user_id")
      .maybeSingle()

    if (error) throw error

    return NextResponse.json({ ok: true, revoked: Boolean(data) })
  } catch (error) {
    const message = describeServerError(error, "解除登录占用失败。")
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("登录") ? 401 : message.includes("管理员") ? 403 : 500 }
    )
  }
}
