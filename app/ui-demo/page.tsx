"use client"

import { useState } from "react"
import {
  ArrowRight,
  Box,
  Check,
  ChevronDown,
  Coins,
  Film,
  Gem,
  History,
  ImageIcon,
  LockKeyhole,
  Mail,
  Menu,
  Plus,
  RectangleHorizontal,
  Sparkles,
  User,
  WandSparkles,
  X,
} from "lucide-react"
import {
  getImageRatiosForSelection,
  imageModelOptions,
  imageModelSettings,
  videoModelOptions,
  videoModelSettings,
} from "@/lib/model-options"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type AuthMode = "login" | "register"
type StudioMode = "image" | "video"

const navItems = ["首页", "定价", "经验"]

const studioNavItems = [
  { icon: WandSparkles, label: "创作台", mode: null },
  { icon: ImageIcon, label: "图片生成", mode: "image" },
  { icon: Film, label: "视频生成", mode: "video" },
  { icon: History, label: "历史项目", mode: null },
  { icon: Coins, label: "点数充值", mode: null },
] satisfies Array<{
  icon: typeof WandSparkles
  label: string
  mode: StudioMode | null
}>

const studioModeCopy = {
  image: {
    label: "图片生成",
    prompt: "描述你想生成的图片，例如：现代极简客餐厅，浅木色地板，隐藏灯带，适合小户型。",
    upload: "添加参考图",
  },
  video: {
    label: "视频生成",
    prompt: "描述你想生成的视频，例如：从客厅入口推进到餐厅，镜头平稳，展示灯光和材质。",
    upload: "添加参考图",
  },
} satisfies Record<StudioMode, { label: string; prompt: string; upload: string }>

const imageCountOptions = [
  { label: "1 张", value: "1" },
  { label: "2 张", value: "2" },
  { label: "3 张", value: "3" },
  { label: "4 张", value: "4" },
]

function DropdownField({
  icon: Icon,
  options,
  value,
  onChange,
  label,
}: {
  icon: typeof Box
  options: Array<{ label: string; value: string }>
  value: string
  onChange: (value: string) => void
  label: string
}) {
  const currentLabel = options.find((option) => option.value === value)?.label ?? label

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800" type="button">
          <Icon className="h-4 w-4" />
          <span className="truncate">{currentLabel}</span>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[220px] rounded-2xl border border-slate-200 bg-white p-1 shadow-lg">
        <DropdownMenuRadioGroup onValueChange={onChange} value={value}>
          {options.map((option) => (
            <DropdownMenuRadioItem
              className="rounded-xl px-3 py-2.5 text-sm data-[state=checked]:bg-orange-50 data-[state=checked]:text-orange-700"
              key={option.value}
              value={option.value}
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}

function Field({
  autoComplete,
  icon: Icon,
  placeholder,
  type,
}: {
  autoComplete: string
  icon: typeof Mail
  placeholder: string
  type: string
}) {
  return (
    <label className="group flex h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm transition focus-within:border-cyan-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-cyan-100">
      <Icon className="h-4 w-4 shrink-0 text-slate-400 transition group-focus-within:text-cyan-500" />
      <span className="sr-only">{placeholder}</span>
      <input
        autoComplete={autoComplete}
        className="h-full min-w-0 flex-1 bg-transparent text-slate-950 outline-none placeholder:text-slate-400"
        placeholder={placeholder}
        type={type}
      />
    </label>
  )
}

function AuthModal({
  mode,
  onClose,
  onAuthed,
  onModeChange,
}: {
  mode: AuthMode
  onClose: () => void
  onAuthed: () => void
  onModeChange: (mode: AuthMode) => void
}) {
  const isLogin = mode === "login"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-md">
      <section className="relative grid max-h-[calc(100vh-48px)] w-full max-w-5xl overflow-hidden rounded-[30px] border border-white/70 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.28)] lg:grid-cols-[minmax(0,1fr)_420px]">
        <button
          aria-label="关闭登录弹窗"
          className="absolute right-4 top-4 z-10 grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-white/60 bg-white/80 text-slate-600 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
          onClick={onClose}
          type="button"
        >
          <X className="h-5 w-5" />
        </button>

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

        <div className="overflow-y-auto p-6 sm:p-8">
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

          <form className="mt-5 grid gap-3">
            {!isLogin && (
              <Field
                autoComplete="username"
                icon={User}
                placeholder="用户名，3-24 位字母、数字或下划线"
                type="text"
              />
            )}
            <Field autoComplete="email" icon={Mail} placeholder="邮箱" type="email" />
            <Field
              autoComplete={isLogin ? "current-password" : "new-password"}
              icon={LockKeyhole}
              placeholder="密码，至少 6 位"
              type="password"
            />

            <button
              className="mt-2 inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
              onClick={onAuthed}
              type="button"
            >
              {isLogin ? "登录" : "注册"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <p className="mt-4 text-center text-xs leading-5 text-slate-500">
            使用即表示继续使用季风创绘的创作与点数服务。
          </p>
        </div>
      </section>
    </div>
  )
}

function UploadCard({ label }: { label: string }) {
  return (
    <button
      className="group grid h-[116px] w-[68px] shrink-0 cursor-pointer place-items-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-slate-400 transition-colors hover:border-orange-200 hover:bg-orange-50/70 hover:text-orange-500 sm:h-[138px] sm:w-[76px] sm:-rotate-6"
      type="button"
    >
      <span className="grid justify-items-center gap-2 text-center text-xs">
        <Plus className="h-5 w-5" />
        <span className="hidden leading-tight sm:block">{label}</span>
      </span>
    </button>
  )
}

function ModeDropdown({ mode, onChange }: { mode: StudioMode; onChange: () => void }) {
  const Icon = mode === "image" ? ImageIcon : Film

  return (
    <button
      className="group relative inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 px-4 text-sm font-semibold text-orange-600 transition-colors hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/60"
      onClick={onChange}
      type="button"
    >
      <Icon className="h-4 w-4" />
      {studioModeCopy[mode].label}
      <ChevronDown className="h-4 w-4" />
      <span className="pointer-events-none absolute left-0 top-12 z-10 hidden min-w-36 rounded-2xl border border-slate-200 bg-white p-1 text-left text-slate-700 shadow-[0_18px_50px_rgba(15,23,42,0.14)] group-hover:block">
        <span className="flex rounded-xl px-3 py-2 text-sm text-orange-600">
          {studioModeCopy[mode].label}
        </span>
        <span className="flex rounded-xl px-3 py-2 text-sm text-slate-500">
          {studioModeCopy[mode === "image" ? "video" : "image"].label}
        </span>
      </span>
    </button>
  )
}

function StudioDemo({ onBackHome }: { onBackHome: () => void }) {
  const [mode, setMode] = useState<StudioMode>("image")
  const [imageCount, setImageCount] = useState("3")
  const imageModel = imageModelOptions[0]
  const imageQuality =
    imageModelSettings[imageModel].qualities[1] ?? imageModelSettings[imageModel].qualities[0]
  const imageRatios = getImageRatiosForSelection(imageModel, imageQuality)
  const imageRatio = imageRatios.includes("9:16") ? "9:16" : imageRatios[0]
  const videoModel = videoModelOptions[0]
  const videoSettings = videoModelSettings[videoModel]
  const videoQuality = videoSettings.qualities[1] ?? videoSettings.qualities[0]
  const currentCopy = studioModeCopy[mode]

  return (
    <main className="min-h-screen bg-[#f5f6f8] text-slate-950">
      <div className="flex min-h-screen">
        <aside className="hidden w-48 shrink-0 border-r border-slate-200/80 bg-white/80 px-3 py-4 backdrop-blur-xl lg:block">
          <button className="flex h-11 cursor-pointer items-center gap-3 px-2" onClick={onBackHome} type="button">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-slate-950">季风创绘</div>
              <div className="text-xs text-slate-500">UI Demo</div>
            </div>
          </button>
          <button
            className="mt-5 flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            type="button"
          >
            <Sparkles className="h-5 w-5" />
            创作台
          </button>
          <nav className="mt-6 grid gap-2">
            {studioNavItems.map((item) => {
              const Icon = item.icon
              const active = item.mode ? item.mode === mode : item.label === "创作台"

              return (
                <button
                  className={cn(
                    "flex h-11 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/60",
                    active
                      ? "bg-orange-50 text-orange-600"
                      : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  )}
                  key={item.label}
                  onClick={() => {
                    if (item.mode) setMode(item.mode)
                  }}
                  title={item.label}
                  type="button"
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center justify-between px-4 sm:px-8">
            <div className="flex items-center gap-3">
              <button
                className="grid h-10 w-10 cursor-pointer place-items-center rounded-2xl border border-slate-200 bg-white text-slate-500 lg:hidden"
                type="button"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <div className="text-sm font-semibold text-slate-950">季风创绘工作台</div>
                <div className="text-xs text-slate-500">图片和视频生成合并输入 Demo</div>
              </div>
            </div>
            <button
              className="hidden h-10 cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 sm:inline-flex"
              type="button"
            >
              <Coins className="h-4 w-4 text-orange-500" />
              24,680 点
            </button>
          </header>

          <div className="flex flex-1 flex-col px-4 pb-6 pt-4 sm:px-8">
            <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center">
              <div className="mb-8 text-center">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">
                  <Gem className="h-3.5 w-3.5 text-orange-500" />
                  参考即梦的轻量创作输入体验
                </div>
                <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                  一句话开始生成图片或视频
                </h1>
                <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-slate-500">
                  登录后进入这套已确认的创作台 Demo：侧边栏可切换图片/视频，参数只保留当前项目已有能力。
                </p>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-4 shadow-[0_22px_70px_rgba(15,23,42,0.10)] sm:p-7">
                <div className="flex min-h-[190px] gap-5">
                  <UploadCard label={currentCopy.upload} />

                  <div className="flex min-w-0 flex-1 flex-col">
                    <textarea
                      aria-label="生成提示词"
                      className="min-h-[126px] w-full resize-none bg-transparent text-[22px] leading-9 text-slate-800 outline-none placeholder:text-slate-400 sm:text-2xl"
                      placeholder={currentCopy.prompt}
                    />

                    <div className="mt-auto flex flex-col gap-3 border-t border-slate-100 pt-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <ModeDropdown
                          mode={mode}
                          onChange={() => setMode(mode === "image" ? "video" : "image")}
                        />

                        {mode === "image" ? (
                          <>
                            <DropdownField
                              icon={Box}
                              label="生图模型"
                              onChange={() => undefined}
                              options={imageModelOptions.map((option) => ({ label: option, value: option }))}
                              value={imageModel}
                            />
                            <DropdownField
                              icon={Sparkles}
                              label="图片清晰度"
                              onChange={() => undefined}
                              options={imageModelSettings[imageModel].qualities.map((option) => ({ label: option, value: option }))}
                              value={imageQuality}
                            />
                            <DropdownField
                              icon={RectangleHorizontal}
                              label="图片比例"
                              onChange={() => undefined}
                              options={imageRatios.map((option) => ({ label: option, value: option }))}
                              value={imageRatio}
                            />
                            <DropdownField
                              icon={ImageIcon}
                              label="生成张数"
                              onChange={(value) => setImageCount(value)}
                              options={imageCountOptions}
                              value={imageCount}
                            />
                          </>
                        ) : (
                          <>
                            <DropdownField
                              icon={Box}
                              label="视频模型"
                              onChange={() => undefined}
                              options={videoModelOptions.map((option) => ({ label: option, value: option }))}
                              value={videoModel}
                            />
                            <DropdownField
                              icon={Film}
                              label="视频时长"
                              onChange={() => undefined}
                              options={videoSettings.durations.map((option) => ({ label: option, value: option }))}
                              value={videoSettings.durations[0]}
                            />
                            <DropdownField
                              icon={RectangleHorizontal}
                              label="视频比例"
                              onChange={() => undefined}
                              options={videoSettings.aspectRatios.map((option) => ({ label: option, value: option }))}
                              value={videoSettings.aspectRatios[0]}
                            />
                            <DropdownField
                              icon={Sparkles}
                              label="视频清晰度"
                              onChange={() => undefined}
                              options={videoSettings.qualities.map((option) => ({ label: option, value: option }))}
                              value={videoQuality}
                            />
                          </>
                        )}
                      </div>

                      <button
                        className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/60"
                        type="button"
                      >
                        生成{mode === "image" ? "图片" : "视频"}
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  )
}

export default function UiDemoPage() {
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>("login")
  const [authed, setAuthed] = useState(false)

  if (authed) {
    return <StudioDemo onBackHome={() => setAuthed(false)} />
  }

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

        <div className="flex items-center gap-3">
          <button
            className="hidden h-11 cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-4 text-sm font-medium text-slate-700 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 sm:inline-flex"
            type="button"
          >
            工作台
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            aria-label="打开菜单"
            className="grid h-11 w-11 cursor-pointer place-items-center rounded-full border border-slate-200 bg-white/70 text-slate-700 shadow-sm backdrop-blur transition-colors hover:bg-white md:hidden"
            type="button"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
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
              setAuthMode("login")
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
                    aria-label="发送生成请求"
                    className="grid h-10 w-10 cursor-pointer place-items-center rounded-2xl bg-[#ff7a3d] text-white transition-colors hover:bg-[#f2692c]"
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
        <AuthModal
          mode={authMode}
          onAuthed={() => {
            setAuthOpen(false)
            setAuthed(true)
          }}
          onClose={() => setAuthOpen(false)}
          onModeChange={setAuthMode}
        />
      )}
    </main>
  )
}
