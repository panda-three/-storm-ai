import { NextResponse } from "next/server"
import { describeServerError, getSupabaseServerClient, requireAdminUser } from "@/lib/server-supabase"
import type { AdminAccountRow, AdminAccountSummary } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    await requireAdminUser(request)

    const supabase = getSupabaseServerClient()
    const [
      { data: accountRows, error: accountError },
      { data: activeSessionRows, error: activeSessionError },
      { data: authData, error: authError },
    ] = await Promise.all([
      supabase
        .from("user_accounts")
        .select("user_id, username, credit_balance, ledger, role, updated_at, membership_tier, membership_expires_at, membership_free_image_qualities, must_change_password, temporary_password_set_at, temporary_password_set_by")
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("user_active_sessions")
        .select("user_id, device_label, created_at, last_seen_at, revoked_at, revoked_reason"),
      supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      }),
    ])

    if (accountError) throw accountError
    if (activeSessionError) throw activeSessionError
    if (authError) throw authError

    const usersById = new Map((authData.users ?? []).map((user) => [user.id, user]))
    const activeSessionsByUserId = new Map((activeSessionRows ?? []).map((session) => [session.user_id, session]))
    const accounts = ((accountRows ?? []) as AdminAccountRow[]).map<AdminAccountSummary>((account) => {
      const user = usersById.get(account.user_id)
      const activeSession = activeSessionsByUserId.get(account.user_id)

      return {
        ...account,
        active_session_created_at: activeSession?.created_at ?? null,
        active_session_device_label: activeSession?.device_label ?? null,
        active_session_last_seen_at: activeSession?.last_seen_at ?? null,
        active_session_revoked_at: activeSession?.revoked_at ?? null,
        active_session_revoked_reason: activeSession?.revoked_reason ?? null,
        email: user?.email ?? null,
        email_confirmed_at: user?.email_confirmed_at ?? null,
      }
    })

    return NextResponse.json({ ok: true, accounts })
  } catch (error) {
    const message = describeServerError(error, "加载用户列表失败。")
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("登录") ? 401 : message.includes("管理员") ? 403 : 500 }
    )
  }
}
