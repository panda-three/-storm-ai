"use client"

import { useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, LockKeyhole, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSupabaseClient } from "@/lib/supabase"

interface ForcedPasswordChangeProps {
  onChanged: () => Promise<void> | void
  onSignOut: () => Promise<void> | void
}

async function getAccessToken() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 未配置。")

  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  const token = data.session?.access_token
  if (!token) throw new Error("登录状态已失效，请重新登录。")

  return token
}

export function ForcedPasswordChange({ onChanged, onSignOut }: ForcedPasswordChangeProps) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (currentPassword.length < 6 || newPassword.length < 6) {
      setError("密码至少 6 位。")
      return
    }

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。")
      return
    }

    if (currentPassword === newPassword) {
      setError("新密码不能与临时密码相同。")
      return
    }

    setError("")
    setNotice("")
    setLoading(true)

    try {
      const token = await getAccessToken()
      const response = await fetch("/api/account/change-password", {
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "修改密码失败。")
      }

      setNotice("密码已更新。")
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      await onChanged()
    } catch (error) {
      setError(error instanceof Error ? error.message : "修改密码失败。")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 text-slate-950">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-slate-950 text-white">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold">请先修改临时密码</h1>
            <p className="mt-1 text-sm text-slate-500">客服已为你发放临时密码，修改后才能继续使用。</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="current-password">当前临时密码</Label>
            <Input
              autoComplete="current-password"
              id="current-password"
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              value={currentPassword}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-password">新密码</Label>
            <Input
              autoComplete="new-password"
              id="new-password"
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              value={newPassword}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">确认新密码</Label>
            <Input
              autoComplete="new-password"
              id="confirm-password"
              onChange={(event) => setConfirmPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSubmit()
              }}
              type="password"
              value={confirmPassword}
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-4 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {notice}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1 bg-slate-950 text-white hover:bg-slate-800" disabled={loading} onClick={handleSubmit}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            修改密码
          </Button>
          <Button disabled={loading} onClick={onSignOut} type="button" variant="outline">
            <LogOut className="h-4 w-4" />
            退出登录
          </Button>
        </div>
      </section>
    </main>
  )
}
