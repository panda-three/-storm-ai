"use client"

import { useState } from "react"
import {
  AlertCircle,
  ArrowRight,
  Check,
  Loader2,
  LockKeyhole,
  LogIn,
  Mail,
  Sparkles,
  User,
  UserPlus,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  claimCurrentAuthSession,
  clearSupabaseLocalSession,
  getSupabaseClient,
  getSupabaseErrorMessage,
  isSupabaseConfigured,
} from "@/lib/supabase"
import { cn } from "@/lib/utils"

interface AuthPanelProps {
  onAuthed: () => void
  variant?: "page" | "landing"
}

type AuthMode = "login" | "register"

const navItems = ["首页", "定价", "经验"]

const showcaseImages = [
  {
    alt: "现代客厅 AI 设计效果图",
    src: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=900&q=80",
  },
  {
    alt: "暖色餐厅 AI 设计效果图",
    src: "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=900&q=80",
  },
  {
    alt: "极简卧室 AI 设计效果图",
    src: "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=900&q=80",
  },
  {
    alt: "高级灰厨房 AI 设计效果图",
    src: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=900&q=80",
  },
]

function AuthField({
  autoComplete,
  icon: Icon,
  onChange,
  onKeyDown,
  placeholder,
  type,
  value,
}: {
  autoComplete: string
  icon: typeof Mail
  onChange: (value: string) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder: string
  type: string
  value: string
}) {
  return (
    <label className="group flex h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm transition focus-within:border-cyan-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-cyan-100">
      <Icon className="h-4 w-4 shrink-0 text-slate-400 transition group-focus-within:text-cyan-500" />
      <span className="sr-only">{placeholder}</span>
      <input
        autoComplete={autoComplete}
        className="h-full min-w-0 flex-1 bg-transparent text-slate-950 outline-none placeholder:text-slate-400"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  )
}

function AuthForm({
  configured,
  email,
  error,
  loading,
  mode,
  notice,
  onEmailChange,
  onModeChange,
  onPasswordChange,
  onSubmit,
  onUsernameChange,
  password,
  username,
}: {
  configured: boolean
  email: string
  error: string
  loading: boolean
  mode: AuthMode
  notice: string
  onEmailChange: (value: string) => void
  onModeChange: (mode: AuthMode) => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  onUsernameChange: (value: string) => void
  password: string
  username: string
}) {
  const isLogin = mode === "login"

  return (
    <div className="p-6 sm:p-8">
      <div className="flex items-center gap-3 lg:hidden">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-white">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-slate-950">季风AI设计室</h1>
          <p className="mt-0.5 text-xs text-slate-500">AI Interior Design Studio</p>
        </div>
      </div>

      <div className="mt-6 lg:mt-4">
        <div className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-600">
          {isLogin ? "欢迎回来" : "创建账户"}
        </div>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
          {isLogin ? "登录季风创绘" : "注册季风创绘"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {isLogin ? "登录后继续同步生成历史、点数余额和会员权益。" : "注册后即可保存生成历史，并管理点数与会员权益。"}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
        <button
          className={cn(
            "h-10 cursor-pointer rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
            isLogin
              ? "bg-white font-semibold text-slate-950 shadow-sm"
              : "font-medium text-slate-500 hover:text-slate-800"
          )}
          onClick={() => onModeChange("login")}
          type="button"
        >
          登录
        </button>
        <button
          className={cn(
            "h-10 cursor-pointer rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
            !isLogin
              ? "bg-white font-semibold text-slate-950 shadow-sm"
              : "font-medium text-slate-500 hover:text-slate-800"
          )}
          onClick={() => onModeChange("register")}
          type="button"
        >
          注册
        </button>
      </div>

      <div className="mt-5 grid gap-3">
        {!isLogin && (
          <AuthField
            autoComplete="username"
            icon={User}
            onChange={onUsernameChange}
            placeholder="用户名，3-24 位字母、数字或下划线"
            type="text"
            value={username}
          />
        )}
        <AuthField
          autoComplete="email"
          icon={Mail}
          onChange={onEmailChange}
          placeholder="邮箱"
          type="email"
          value={email}
        />
        <AuthField
          autoComplete={isLogin ? "current-password" : "new-password"}
          icon={LockKeyhole}
          onChange={onPasswordChange}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit()
          }}
          placeholder="密码，至少 6 位"
          type="password"
          value={password}
        />
      </div>

      {!configured && (
        <div className="mt-4 flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          缺少 Supabase 环境变量，请配置 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY。
        </div>
      )}
      {error && (
        <div className="mt-4 flex gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <Button
        className="mt-5 h-12 w-full rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
        disabled={loading || !configured}
        onClick={onSubmit}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isLogin ? (
          <LogIn className="h-4 w-4" />
        ) : (
          <UserPlus className="h-4 w-4" />
        )}
        {isLogin ? "登录" : "注册"}
      </Button>

      <p className="mt-4 text-center text-xs leading-5 text-slate-500">
        忘记密码请联系客服核验账号后获取临时密码。
      </p>
    </div>
  )
}

function AuthVisual() {
  return (
    <div className="relative hidden min-h-[610px] overflow-hidden bg-slate-950 text-white lg:block">
      <img
        alt="季风 AI 设计室室内空间展示"
        className="absolute inset-0 h-full w-full object-cover"
        src="https://images.unsplash.com/photo-1600210492493-0946911123ea?auto=format&fit=crop&w=1400&q=82"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.28)_0%,rgba(2,6,23,0.42)_44%,rgba(2,6,23,0.86)_100%)]" />
      <div className="relative flex h-full flex-col p-8">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-slate-950 shadow-[0_12px_28px_rgba(255,255,255,0.22)]">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">季风AI设计室</div>
            <div className="text-xs text-white/58">AI Interior Design Studio</div>
          </div>
        </div>

        <div className="mt-auto max-w-md">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/18 bg-white/12 px-3 py-1.5 text-xs font-medium text-white/88 backdrop-blur">
            <Check className="h-3.5 w-3.5" />
            专属设计创作入口
          </div>
          <h2 className="mt-5 text-4xl font-semibold tracking-tight">
            为室内外设计师打造的专属AI设计平台
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-6 text-white/68">
            从空间参考到创意方案，把图片与视频生成能力整合到更聚焦的设计工作流里。
          </p>
        </div>
      </div>
    </div>
  )
}

export function AuthPanel({ onAuthed, variant = "page" }: AuthPanelProps) {
  const [mode, setMode] = useState<AuthMode>("login")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [loading, setLoading] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const configured = isSupabaseConfigured()

  const handleSubmit = async () => {
    const supabase = getSupabaseClient()
    const normalizedUsername = username.trim()
    const normalizedEmail = email.trim()

    if (!supabase) {
      setError("请先配置 Supabase 环境变量。")
      return
    }

    if (!normalizedEmail || password.length < 6) {
      setError("请输入邮箱，并确保密码至少 6 位。")
      return
    }

    if (mode === "register" && !/^[a-zA-Z0-9_]{3,24}$/.test(normalizedUsername)) {
      setError("用户名需为 3-24 位字母、数字或下划线。")
      return
    }

    setError("")
    setNotice("")
    setLoading(true)

    try {
      if (mode === "register") {
        const { data: available, error: usernameError } = await supabase.rpc("is_username_available", {
          p_username: normalizedUsername,
        })

        if (usernameError) throw usernameError
        if (!available) {
          setError("该用户名已被使用，请换一个。")
          return
        }

        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              username: normalizedUsername,
            },
          },
        })

        if (error) throw error

        if (!data.session) {
          setNotice("注册成功，请按 Supabase 邮件设置完成邮箱验证后再登录。")
          return
        }

        await claimCurrentAuthSession()
      } else {
        await clearSupabaseLocalSession(supabase)

        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        })

        if (error) throw error

        try {
          await claimCurrentAuthSession()
        } catch (error) {
          await supabase.auth.signOut({ scope: "local" }).catch(() => undefined)
          throw error
        }
      }

      onAuthed()
    } catch (error) {
      setError(getSupabaseErrorMessage(error, "认证失败，请稍后重试。"))
    } finally {
      setLoading(false)
    }
  }

  const form = (
    <AuthForm
      configured={configured}
      email={email}
      error={error}
      loading={loading}
      mode={mode}
      notice={notice}
      onEmailChange={setEmail}
      onModeChange={setMode}
      onPasswordChange={setPassword}
      onSubmit={handleSubmit}
      onUsernameChange={setUsername}
      password={password}
      username={username}
    />
  )

  if (variant === "landing") {
    return (
      <main className="min-h-screen overflow-hidden bg-[#f7f4ee] text-slate-950">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(251,146,60,0.20),transparent_32rem),linear-gradient(180deg,rgba(255,255,255,0.72),rgba(247,244,238,0.92))]" />

        <header className="relative z-10 mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a className="flex items-center gap-3" href="#">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-white shadow-[0_14px_30px_rgba(15,23,42,0.18)]">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">季风创绘</span>
          </a>

          <nav className="hidden items-center gap-8 rounded-full border border-white/70 bg-white/55 px-6 py-3 text-sm font-medium text-slate-600 shadow-sm backdrop-blur-xl md:flex">
            {navItems.map((item) => (
              <a className="transition-colors hover:text-slate-950" href="#" key={item}>
                {item}
              </a>
            ))}
          </nav>

          <button
            className="h-11 cursor-pointer rounded-full border border-slate-200 bg-white/70 px-5 text-sm font-medium text-slate-700 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
            onClick={() => {
              setMode("login")
              setAuthOpen(true)
            }}
            type="button"
          >
            登录
          </button>
        </header>

        <section className="relative z-10 mx-auto flex min-h-[calc(100vh-80px)] w-full max-w-7xl flex-col px-4 pb-8 pt-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-sm font-medium tracking-[0.28em] text-slate-500">
              AI INTERIOR DESIGN STUDIO
            </p>
            <h1 className="mt-5 text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
              设计师必备的AI设计工具
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              用更少的操作完成空间灵感生成、方案探索和视觉表达，让创意从参考图快速进入可交付效果。
            </p>
            <button
              className="mt-8 inline-flex h-14 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#ff7a3d] px-8 text-base font-semibold text-white shadow-[0_18px_38px_rgba(255,122,61,0.34)] transition-colors hover:bg-[#f2692c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/80"
              onClick={() => {
                setMode("login")
                setAuthOpen(true)
              }}
              type="button"
            >
              立即开始
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-10 min-h-0 flex-1 rounded-[34px] border border-white/70 bg-white/68 p-3 shadow-[0_30px_90px_rgba(77,53,30,0.14)] backdrop-blur-xl sm:p-5 lg:mt-12">
            <div className="grid min-h-[420px] gap-4 lg:grid-cols-[minmax(0,1.15fr)_360px]">
              <div className="grid grid-cols-2 gap-4">
                {showcaseImages.map((image, index) => (
                  <figure
                    className={cn(
                      "group relative min-h-[180px] overflow-hidden rounded-[26px] bg-slate-200 shadow-sm",
                      index === 0 && "lg:row-span-2",
                      index === 0 ? "lg:min-h-[420px]" : "lg:min-h-0"
                    )}
                    key={image.alt}
                  >
                    <img
                      alt={image.alt}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      src={image.src}
                    />
                    <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/46 to-transparent" />
                  </figure>
                ))}
              </div>

              <aside className="flex min-h-[420px] flex-col rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">季风创绘助手</h2>
                    <p className="mt-1 text-xs text-slate-500">空间方案生成预览</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
                    在线
                  </span>
                </div>

                <div className="mt-5 grid gap-4">
                  <div className="max-w-[88%] rounded-[22px] rounded-tl-md bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-700">
                    上传户型或参考图后，我可以帮你生成图片方案或视频表达。
                  </div>
                  <div className="ml-auto max-w-[88%] rounded-[22px] rounded-tr-md bg-slate-950 px-4 py-3 text-sm leading-6 text-white">
                    生成一个现代极简客餐厅，浅木色、隐藏灯带、适合小户型。
                  </div>
                  <div className="max-w-[88%] rounded-[22px] rounded-tl-md bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-700">
                    已整理为“浅木现代、通透收纳、暖光氛围”的设计方向。
                  </div>
                </div>

                <div className="mt-auto rounded-[22px] border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <Sparkles className="h-4 w-4 text-orange-500" />
                    输入创意描述
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-10 flex-1 rounded-2xl bg-white px-4 py-2 text-sm text-slate-400">
                      描述空间、风格、材质...
                    </div>
                    <button
                      aria-label="打开登录弹窗"
                      className="grid h-10 w-10 cursor-pointer place-items-center rounded-2xl bg-[#ff7a3d] text-white transition-colors hover:bg-[#f2692c]"
                      onClick={() => setAuthOpen(true)}
                      type="button"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>

        {authOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-md">
            <section className="relative grid max-h-[calc(100vh-48px)] w-full max-w-5xl overflow-hidden rounded-[30px] border border-white/70 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.28)] lg:grid-cols-[minmax(0,1fr)_420px]">
              <button
                aria-label="关闭登录弹窗"
                className="absolute right-4 top-4 z-10 grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-white/60 bg-white/80 text-slate-600 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                onClick={() => setAuthOpen(false)}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
              <AuthVisual />
              <div className="overflow-y-auto">{form}</div>
            </section>
          </div>
        )}
      </main>
    )
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f5f6f8] px-4 py-8 text-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(6,182,212,0.16),transparent_28rem)]" />
      <section className="relative grid w-full max-w-5xl overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.10)] lg:grid-cols-[minmax(0,1fr)_420px]">
        <AuthVisual />
        {form}
      </section>
    </main>
  )
}
