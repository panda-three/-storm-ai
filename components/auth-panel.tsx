"use client"

import { useState } from "react"
import { AlertCircle, Loader2, LogIn, Sparkles, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase"

interface AuthPanelProps {
  onAuthed: () => void
}

type AuthMode = "login" | "register"

export function AuthPanel({ onAuthed }: AuthPanelProps) {
  const [mode, setMode] = useState<AuthMode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [loading, setLoading] = useState(false)
  const configured = isSupabaseConfigured()

  const handleSubmit = async () => {
    const supabase = getSupabaseClient()
    const normalizedEmail = email.trim()

    if (!supabase) {
      setError("请先配置 Supabase 环境变量。")
      return
    }

    if (!normalizedEmail || password.length < 6) {
      setError("请输入邮箱，并确保密码至少 6 位。")
      return
    }

    setError("")
    setNotice("")
    setLoading(true)

    try {
      if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
        })

        if (error) throw error

        if (!data.session) {
          setNotice("注册成功，请按 Supabase 邮件设置完成邮箱验证后再登录。")
          return
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        })

        if (error) throw error
      }

      onAuthed()
    } catch (error) {
      setError(error instanceof Error ? error.message : "认证失败，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 py-8 text-slate-950">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">风暴 AI</h1>
            <p className="mt-1 text-sm text-slate-500">登录后同步历史项目和点数。</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
          <button
            className={mode === "login" ? "rounded-md bg-white px-3 py-2 text-sm font-medium shadow-sm" : "px-3 py-2 text-sm text-slate-500"}
            onClick={() => setMode("login")}
            type="button"
          >
            登录
          </button>
          <button
            className={mode === "register" ? "rounded-md bg-white px-3 py-2 text-sm font-medium shadow-sm" : "px-3 py-2 text-sm text-slate-500"}
            onClick={() => setMode("register")}
            type="button"
          >
            注册
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          <input
            autoComplete="email"
            className="h-11 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="邮箱"
            type="email"
            value={email}
          />
          <input
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className="h-11 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSubmit()
            }}
            placeholder="密码，至少 6 位"
            type="password"
            value={password}
          />
        </div>

        {!configured && (
          <div className="mt-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            缺少 Supabase 环境变量，请配置 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY。
          </div>
        )}
        {error && (
          <div className="mt-4 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <Button className="mt-5 w-full bg-indigo-600 text-white hover:bg-indigo-700" disabled={loading || !configured} onClick={handleSubmit}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          {mode === "login" ? "登录" : "注册"}
        </Button>
      </section>
    </main>
  )
}
