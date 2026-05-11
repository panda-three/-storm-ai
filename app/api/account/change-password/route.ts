import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { describeServerError, getServerErrorStatus, getSupabaseServerClient, requireAuthenticatedUser } from "@/lib/server-supabase"

async function verifyCurrentPassword(email: string, password: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error("缺少 Supabase 认证环境变量。")
  }

  const supabase = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error("当前临时密码不正确。")
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request, { allowPasswordChangeRequired: true })
    const body = await request.json().catch(() => ({}))
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : ""
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : ""

    if (currentPassword.length < 6 || newPassword.length < 6) {
      return NextResponse.json({ ok: false, error: "密码至少 6 位。" }, { status: 400 })
    }

    if (currentPassword === newPassword) {
      return NextResponse.json({ ok: false, error: "新密码不能与临时密码相同。" }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(auth.userId)
    if (userError) throw userError

    const email = userData.user?.email
    if (!email) {
      return NextResponse.json({ ok: false, error: "当前账号没有可用邮箱，无法验证临时密码。" }, { status: 400 })
    }

    const { data: account, error: accountError } = await supabase
      .from("user_accounts")
      .select("must_change_password")
      .eq("user_id", auth.userId)
      .maybeSingle()

    if (accountError) throw accountError
    if (!account?.must_change_password) {
      return NextResponse.json({ ok: false, error: "当前账号不需要强制改密。" }, { status: 400 })
    }

    await verifyCurrentPassword(email, currentPassword)

    const { error: updateUserError } = await supabase.auth.admin.updateUserById(auth.userId, {
      password: newPassword,
    })
    if (updateUserError) throw updateUserError

    const now = new Date().toISOString()
    const { error: accountUpdateError } = await supabase
      .from("user_accounts")
      .update({
        must_change_password: false,
        temporary_password_set_at: null,
        temporary_password_set_by: null,
        updated_at: now,
      })
      .eq("user_id", auth.userId)

    if (accountUpdateError) throw accountUpdateError

    const { error: eventError } = await supabase.from("account_security_events").insert({
      actor_user_id: auth.userId,
      event_type: "password_changed",
      metadata: {
        source: "forced_temporary_password_change",
      },
      user_id: auth.userId,
    })

    if (eventError) throw eventError

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = describeServerError(error, "修改密码失败。")
    return NextResponse.json({ ok: false, error: message }, { status: getServerErrorStatus(error, 400) })
  }
}
