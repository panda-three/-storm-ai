import { NextResponse } from "next/server"
import { describeServerError, getServerErrorStatus, getSupabaseServerClient, requireAdminUser } from "@/lib/server-supabase"

const passwordChars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"

function generateTemporaryPassword(length = 18) {
  const values = crypto.getRandomValues(new Uint32Array(length))
  return Array.from(values, (value) => passwordChars[value % passwordChars.length]).join("")
}

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const admin = await requireAdminUser(request)
    const { userId } = await params

    if (!userId) {
      return NextResponse.json({ ok: false, error: "缺少用户 ID。" }, { status: 400 })
    }

    if (userId === admin.userId) {
      return NextResponse.json({ ok: false, error: "不能为当前管理员账号生成临时密码。" }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()
    const { data: account, error: accountError } = await supabase
      .from("user_accounts")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle()

    if (accountError) throw accountError
    if (!account) {
      return NextResponse.json({ ok: false, error: "用户不存在。" }, { status: 404 })
    }

    if (account.role === "admin") {
      return NextResponse.json({ ok: false, error: "管理员账号请在 Supabase 控制台恢复。" }, { status: 400 })
    }

    const temporaryPassword = generateTemporaryPassword()
    const { error: updateUserError } = await supabase.auth.admin.updateUserById(userId, {
      password: temporaryPassword,
    })
    if (updateUserError) throw updateUserError

    const now = new Date().toISOString()
    const { error: accountUpdateError } = await supabase
      .from("user_accounts")
      .update({
        must_change_password: true,
        temporary_password_set_at: now,
        temporary_password_set_by: admin.userId,
        updated_at: now,
      })
      .eq("user_id", userId)

    if (accountUpdateError) throw accountUpdateError

    const { error: revokeSessionError } = await supabase
      .from("user_active_sessions")
      .update({
        revoked_at: now,
        revoked_by: admin.userId,
        revoked_reason: "temporary_password_set",
        updated_at: now,
      })
      .eq("user_id", userId)
      .is("revoked_at", null)

    if (revokeSessionError) throw revokeSessionError

    const { error: eventError } = await supabase.from("account_security_events").insert({
      actor_user_id: admin.userId,
      event_type: "temporary_password_set",
      metadata: {
        delivery: "manual_customer_service",
      },
      user_id: userId,
    })

    if (eventError) throw eventError

    return NextResponse.json({ ok: true, temporaryPassword })
  } catch (error) {
    const message = describeServerError(error, "生成临时密码失败。")
    return NextResponse.json(
      { ok: false, error: message },
      { status: getServerErrorStatus(error, message.includes("管理员") ? 403 : 500) }
    )
  }
}
