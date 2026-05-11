"use client"

import { useState } from "react"
import { Copy, KeyRound, Loader2, LogOut, Monitor, ShieldAlert } from "lucide-react"
import { useAdmin } from "@/components/admin/admin-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getSupabaseClient, type AdminAccountSummary } from "@/lib/supabase"

async function getAccessToken() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 未配置。")

  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  const token = data.session?.access_token
  if (!token) throw new Error("登录状态已失效，请重新登录。")

  return token
}

export function UsersPanel() {
  const { adminAccounts, refreshAdminConfig, setFeedback } = useAdmin()
  const [selectedAccount, setSelectedAccount] = useState<AdminAccountSummary | null>(null)
  const [temporaryPassword, setTemporaryPassword] = useState("")
  const [loadingUserId, setLoadingUserId] = useState("")

  const handleRevokeActiveSession = async (account: AdminAccountSummary) => {
    setLoadingUserId(account.user_id)

    try {
      const token = await getAccessToken()
      const response = await fetch(`/api/admin/users/${encodeURIComponent(account.user_id)}/active-session`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        method: "DELETE",
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "解除登录占用失败。")
      }

      setFeedback({ message: "登录占用已解除。", type: "success" })
      await refreshAdminConfig()
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "解除登录占用失败。",
        type: "error",
      })
    } finally {
      setLoadingUserId("")
    }
  }

  const handleGenerateTemporaryPassword = async () => {
    if (!selectedAccount) return

    setLoadingUserId(selectedAccount.user_id)
    setTemporaryPassword("")

    try {
      const token = await getAccessToken()
      const response = await fetch(`/api/admin/users/${encodeURIComponent(selectedAccount.user_id)}/temporary-password`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        method: "POST",
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok || !payload.ok || typeof payload.temporaryPassword !== "string") {
        throw new Error(payload.error || "生成临时密码失败。")
      }

      setTemporaryPassword(payload.temporaryPassword)
      setFeedback({ message: "临时密码已生成，只会显示一次。", type: "success" })
      await refreshAdminConfig()
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "生成临时密码失败。",
        type: "error",
      })
    } finally {
      setLoadingUserId("")
    }
  }

  const handleDialogOpenChange = (open: boolean) => {
    if (open) return
    setSelectedAccount(null)
    setTemporaryPassword("")
  }

  const copyTemporaryPassword = async () => {
    if (!temporaryPassword) return
    await navigator.clipboard.writeText(temporaryPassword)
    setFeedback({ message: "临时密码已复制。", type: "success" })
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">用户余额概览</h2>
          <p className="mt-1 text-sm text-slate-500">邮箱未作为已验证身份，仅用于登录标识展示。</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        {adminAccounts.length === 0 ? (
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">暂无用户账户。</div>
        ) : (
          adminAccounts.map((item) => (
            <div className="rounded-lg border border-slate-200 p-4" key={item.user_id}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-medium text-slate-800">{item.username ?? item.user_id}</div>
                    <Badge className="bg-slate-100 text-slate-700" variant="secondary">
                      {item.role}
                    </Badge>
                    {item.must_change_password && (
                      <Badge className="border-amber-200 bg-amber-50 text-amber-700" variant="outline">
                        <ShieldAlert className="h-3 w-3" />
                        待改密
                      </Badge>
                    )}
                    {item.active_session_last_seen_at && !item.active_session_revoked_at && (
                      <Badge className="border-cyan-200 bg-cyan-50 text-cyan-700" variant="outline">
                        <Monitor className="h-3 w-3" />
                        已占用
                      </Badge>
                    )}
                    {item.active_session_revoked_at && (
                      <Badge className="border-slate-200 bg-slate-50 text-slate-500" variant="outline">
                        已解除
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {item.email ?? "未设置邮箱"} · {item.user_id}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    更新于 {new Date(item.updated_at).toLocaleString("zh-CN")}
                    {item.temporary_password_set_at
                      ? ` · 临时密码 ${new Date(item.temporary_password_set_at).toLocaleString("zh-CN")}`
                      : ""}
                  </div>
                  {item.active_session_last_seen_at && (
                    <div className="mt-1 text-xs text-slate-400">
                      登录设备 {item.active_session_device_label ?? "未知设备"} · 最近活跃{" "}
                      {new Date(item.active_session_last_seen_at).toLocaleString("zh-CN")}
                      {item.active_session_revoked_at
                        ? ` · 已解除 ${new Date(item.active_session_revoked_at).toLocaleString("zh-CN")}`
                        : ""}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="font-semibold text-emerald-700">{item.credit_balance.toLocaleString()} 点</div>
                  <Button
                    disabled={
                      item.role === "admin" ||
                      loadingUserId === item.user_id ||
                      !item.active_session_last_seen_at ||
                      Boolean(item.active_session_revoked_at)
                    }
                    onClick={() => handleRevokeActiveSession(item)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {loadingUserId === item.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                    解除登录占用
                  </Button>
                  <Button
                    disabled={item.role === "admin" || loadingUserId === item.user_id}
                    onClick={() => setSelectedAccount(item)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {loadingUserId === item.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    生成临时密码
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <Dialog open={Boolean(selectedAccount)} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>生成临时密码</DialogTitle>
            <DialogDescription>
              请先确认客服已核验账号归属。生成后客户必须用临时密码登录并修改新密码。
            </DialogDescription>
          </DialogHeader>

          {selectedAccount && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="font-medium text-slate-800">{selectedAccount.username ?? selectedAccount.user_id}</div>
              <div className="mt-1 text-slate-500">{selectedAccount.email ?? "未设置邮箱"}</div>
            </div>
          )}

          {temporaryPassword && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="text-xs font-medium text-amber-800">临时密码只显示一次</div>
              <div className="mt-2 break-all rounded-md bg-white px-3 py-2 font-mono text-sm text-slate-950">
                {temporaryPassword}
              </div>
              <Button className="mt-3" onClick={copyTemporaryPassword} size="sm" type="button" variant="outline">
                <Copy className="h-4 w-4" />
                复制
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button disabled={Boolean(loadingUserId)} onClick={() => handleDialogOpenChange(false)} type="button" variant="outline">
              关闭
            </Button>
            {!temporaryPassword && (
              <Button disabled={Boolean(loadingUserId)} onClick={handleGenerateTemporaryPassword} type="button">
                {loadingUserId ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                确认生成
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
