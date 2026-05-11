"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Film,
  ImageIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react"
import { AuthPanel } from "@/components/auth-panel"
import { regenerationDraftStorageKey, type RegenerationDraft } from "@/components/chat-area"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getErrorMessage, useAccountSession } from "@/hooks/use-account-session"
import { formatLedgerDateTime } from "@/lib/date-time"
import type { GenerationJob } from "@/lib/generation-jobs"
import type { ProjectStatus, ProjectType } from "@/lib/project-history"
import { cn } from "@/lib/utils"

type TaskStatusValue = "submitted" | "processing" | "completed" | "failed" | "partial_completed"

interface TaskStatusResponse {
  ok: boolean
  mode?: "apimart" | "mengfactory" | "mock" | "yunwu"
  taskId?: string
  status?: TaskStatusValue
  progress?: number
  imageUrls?: string[]
  videoUrl?: string
  error?: string
  orphaned?: boolean
  retryable?: boolean
  taskError?: string
  raw?: Partial<GenerationJob>
}

const terminalStatuses: TaskStatusValue[] = ["completed", "failed", "partial_completed"]
const firstPollDelayMs = 2000
const pollIntervalMs = 15000

function isTerminalStatus(status: TaskStatusValue | undefined) {
  return Boolean(status && terminalStatuses.includes(status))
}

function getProjectType(task: TaskStatusResponse | null): ProjectType {
  return task?.raw?.type === "video" || task?.videoUrl ? "视频" : "生图"
}

function getProjectStatus(task: TaskStatusResponse | null): ProjectStatus {
  if (task?.status === "completed") return "已完成"
  if (task?.status === "partial_completed") return "部分完成"
  if (task?.status === "failed" || task?.taskError || task?.error) return "失败"
  return "生成中"
}

function getStatusLabel(task: TaskStatusResponse | null) {
  return getProjectStatus(task)
}

function getStatusClassName(status: ProjectStatus) {
  if (status === "已完成") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "部分完成") return "border-amber-200 bg-amber-50 text-amber-700"
  if (status === "失败") return "border-rose-200 bg-rose-50 text-rose-700"
  return "border-orange-200 bg-orange-50 text-orange-700"
}

function getAssetExtension(url: string, fallback: string) {
  try {
    const pathname = new URL(url, window.location.href).pathname
    const extension = pathname.split(".").pop()?.toLowerCase()
    return extension && extension.length <= 5 ? extension : fallback
  } catch {
    return fallback
  }
}

function downloadAsset(url: string, filename: string) {
  const downloadUrl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
  const link = document.createElement("a")
  link.href = downloadUrl
  link.download = filename
  link.rel = "noreferrer"
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function downloadVideoDirect(url: string, filename: string) {
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noreferrer"
  link.target = "_blank"
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function openAsset(url: string) {
  window.open(url, "_blank", "noopener,noreferrer")
}

function writeRegenerationDraft(draft: RegenerationDraft) {
  window.sessionStorage.setItem(regenerationDraftStorageKey, JSON.stringify(draft))
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand("copy")
  textarea.remove()
}

function ResultImage({
  alt,
  className,
  src,
}: {
  alt: string
  className: string
  src: string
}) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div className={cn("flex items-center justify-center bg-slate-100 text-slate-400", className)}>
        <div className="grid justify-items-center gap-2 text-sm">
          <ImageIcon className="h-8 w-8" />
          图片地址不可访问
        </div>
      </div>
    )
  }

  return <img alt={alt} className={className} onError={() => setFailed(true)} src={src} />
}

export default function TaskResultPage() {
  const params = useParams<{ taskId: string }>()
  const router = useRouter()
  const taskId = decodeURIComponent(params.taskId)
  const { accountStatus, authReady, user } = useAccountSession()
  const [task, setTask] = useState<TaskStatusResponse | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [displayProgress, setDisplayProgress] = useState(13)
  const projectType = getProjectType(task)
  const status = getStatusLabel(task)

  const loadTask = useCallback(async () => {
    const accessToken = await getCurrentAccessToken()
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
    const payload = (await response.json().catch(() => ({}))) as TaskStatusResponse

    if (!response.ok || !payload.ok) {
      throw new Error(payload.taskError || payload.error || "任务状态查询失败。")
    }

    setTask(payload)
    setError("")
    return payload
  }, [taskId])

  useEffect(() => {
    if (!authReady || !user || accountStatus === "error") return

    let active = true
    let timer: number | undefined

    const run = (delayMs: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(async () => {
        try {
          const nextTask = await loadTask()
          if (active && !isTerminalStatus(nextTask.status)) {
            run(pollIntervalMs)
          }
        } catch (loadError) {
          if (active) setError(getErrorMessage(loadError, "任务状态查询失败。"))
        } finally {
          if (active) setLoading(false)
        }
      }, delayMs)
    }

    run(firstPollDelayMs)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [accountStatus, authReady, loadTask, user])

  useEffect(() => {
    if (status !== "生成中") {
      setDisplayProgress(status === "已完成" ? 100 : 0)
      return
    }

    const initial = Math.max(task?.progress ?? 13, 13)
    setDisplayProgress(initial)

    const timer = window.setInterval(() => {
      setDisplayProgress((current) => {
        const next = current + Math.max(1, Math.round(Math.random() * 3))
        return Math.min(next, 92)
      })
    }, 1200)

    return () => window.clearInterval(timer)
  }, [status, task?.progress])

  const prompt = task?.raw?.prompt ?? ""
  const model = task?.raw?.model ?? "未记录模型"
  const quality = task?.raw?.quality ?? undefined
  const aspectRatio = task?.raw?.aspect_ratio ?? undefined
  const duration = task?.raw?.duration_seconds ? `${task.raw.duration_seconds} 秒` : undefined
  const createdAt = task?.raw?.created_at ? formatLedgerDateTime(task.raw.created_at) : "刚刚"
  const expectedImageCount = Math.max(
    Number(task?.raw?.expected_result_count ?? 0) || 0,
    Number(task?.raw?.result_urls?.length ?? 0) || 0,
    1
  )
  const imageUrls = useMemo(() => {
    if (projectType !== "生图") return []
    return (task?.imageUrls ?? task?.raw?.result_urls ?? []).filter((url): url is string => Boolean(url))
  }, [projectType, task])
  const videoUrl = projectType === "视频" ? task?.videoUrl || task?.raw?.result_urls?.[0] || "" : ""
  const primaryUrl = projectType === "视频" ? videoUrl : imageUrls[0] ?? ""
  const canUseResult = Boolean(primaryUrl)
  const progress = status === "生成中" ? displayProgress : task?.progress ?? (isTerminalStatus(task?.status) ? 100 : 0)
  const galleryImageCount = Math.max(expectedImageCount, imageUrls.length || 0)

  const handleDownload = () => {
    if (!primaryUrl) return

    const fallback = projectType === "视频" ? "mp4" : "png"
    const extension = getAssetExtension(primaryUrl, fallback)
    const filename = `${projectType === "视频" ? "video" : "image"}-${taskId}.${extension}`

    if (projectType === "视频") {
      downloadVideoDirect(primaryUrl, filename)
      return
    }

    downloadAsset(primaryUrl, filename)
  }

  const handleCopyPrompt = async () => {
    if (!prompt) return
    await copyText(prompt)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const handleRegenerate = () => {
    writeRegenerationDraft({
      type: projectType === "视频" ? "video" : "image",
      prompt,
      model: task?.raw?.model,
      quality,
      ratio: projectType === "生图" ? aspectRatio : undefined,
      imageCount: projectType === "生图" ? galleryImageCount : undefined,
      duration,
      aspectRatio: projectType === "视频" ? aspectRatio : undefined,
    })
    router.push(`/?section=${projectType === "视频" ? "video" : "image"}`)
  }

  if (!authReady) {
    return <ResultShell>正在加载账户...</ResultShell>
  }

  if (!user) {
    return <AuthPanel onAuthed={() => undefined} variant="landing" />
  }

  if (accountStatus === "error") {
    return <ResultShell>账户加载失败，请返回创作台重试。</ResultShell>
  }

  return (
    <main className="min-h-screen bg-[#f5f6f8] text-slate-950">
      <div className="mx-auto max-w-[1760px] px-4 py-4 sm:px-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Button
              className="mb-3 rounded-2xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950"
              onClick={() => router.push("/")}
              variant="outline"
            >
              <ArrowLeft className="h-4 w-4" />
              返回创作台
            </Button>
            <h1 className="text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl">今天</h1>
            <div className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-slate-900 sm:text-lg">
              <span className="max-w-[64rem] truncate">{prompt || (loading ? "正在读取任务..." : "未记录提示词")}</span>
              <span className="text-slate-400">{projectType}</span>
              <span className="text-slate-400">|</span>
              <span className="text-slate-500">{createdAt}</span>
              <span className="text-slate-400">|</span>
              <span className="text-slate-500">{model}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            <Button aria-label="搜索" className="h-10 w-10 rounded-xl" size="icon" variant="ghost">
              <Search className="h-5 w-5" />
            </Button>
            <div className="hidden h-5 w-px bg-slate-200 sm:block" />
            <Button className="rounded-xl text-slate-700" variant="ghost">
              <Clock className="h-4 w-4" />
              时间
            </Button>
            <div className="hidden h-5 w-px bg-slate-200 sm:block" />
            <Button className="rounded-xl text-slate-700" variant="ghost">
              <SlidersHorizontal className="h-4 w-4" />
              生成类型
            </Button>
          </div>
        </header>

        <section className="mt-7 grid gap-6">
          {projectType === "视频" ? (
            <VideoResultCard
              error={error}
              loading={loading}
              progress={progress}
              status={status}
              videoUrl={videoUrl}
            />
          ) : (
          <ImageGenerationBoard
            error={error}
            imageUrls={imageUrls}
            progress={progress}
            prompt={prompt}
            status={status}
            totalSlots={galleryImageCount}
            />
          )}

          <div className="flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)] lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={cn("rounded-full", getStatusClassName(status))} variant="outline">
                  {status === "生成中" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  {status}
                </Badge>
                <span className="text-sm text-slate-500">任务 ID：{taskId}</span>
              </div>
              <div className="max-w-4xl text-sm leading-6 text-slate-700 sm:text-base">
                {prompt || "等待生成结果。"}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>{projectType}</span>
                <span>{createdAt}</span>
                <span>{model}</span>
                <span>{progress}%</span>
              </div>
              {task?.taskError && <p className="text-sm text-rose-600">{task.taskError}</p>}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button className="rounded-2xl bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-950" disabled={!canUseResult} onClick={() => primaryUrl && openAsset(primaryUrl)} variant="outline">
                <ExternalLink className="h-4 w-4" />
                查看结果
              </Button>
              <Button className="rounded-2xl bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-950" disabled={!canUseResult} onClick={handleDownload} variant="outline">
                <Download className="h-4 w-4" />
                下载
              </Button>
              <Button className="rounded-2xl bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-950" disabled={!prompt} onClick={handleCopyPrompt} variant="outline">
                <Copy className="h-4 w-4" />
                {copied ? "已复制" : "复制提示词"}
              </Button>
              <Button className="rounded-2xl bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-950" onClick={handleRegenerate} variant="outline">
                <RotateCcw className="h-4 w-4" />
                再次生成
              </Button>
              <Button className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" onClick={() => loadTask().catch((refreshError) => setError(getErrorMessage(refreshError, "刷新任务失败。")))}>
                <RefreshCw className="h-4 w-4" />
                刷新
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function ResultShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f6f8] px-4 text-sm text-slate-500">
      {children}
    </div>
  )
}

function ImageGenerationBoard({
  error,
  imageUrls,
  progress,
  prompt,
  status,
  totalSlots,
}: {
  error: string
  imageUrls: string[]
  progress: number
  prompt: string
  status: ProjectStatus
  totalSlots: number
}) {
  const columns = Math.max(totalSlots, imageUrls.length, 1)
  const isWaiting = status === "生成中"
  const frames = Array.from({ length: columns }, (_, index) => imageUrls[index] ?? "")
  const frameHeightClass =
    columns >= 4 ? "h-[56vh]" : columns === 3 ? "h-[58vh]" : "h-[60vh]"

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <Badge className={cn("rounded-full", getStatusClassName(status))} variant="outline">
            {isWaiting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            {progress}%造梦中
          </Badge>
          <span className="text-sm text-slate-500">{error || "结果生成中，稍后会显示在这里。"}</span>
        </div>
        <div className="hidden text-xs text-slate-400 sm:block">按张数自动分列</div>
      </div>
      <div className="bg-white p-2 sm:p-3">
        <div
          className="grid gap-2 sm:gap-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
        {frames.map((url, index) => (
          <button
            aria-label={`查看结果图 ${index + 1}`}
            className={cn(
              "group relative min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-left shadow-sm transition hover:shadow-md",
              index === 0 && "sm:ml-0"
            )}
            key={`${url || "placeholder"}-${index}`}
            onClick={() => url && openAsset(url)}
            type="button"
          >
            {url ? (
              <div className={cn("flex items-center justify-center bg-slate-50", frameHeightClass)}>
                <ResultImage
                  alt={`${prompt || "生成图片"} ${index + 1}`}
                  className="h-full w-full object-contain"
                  src={url}
                />
              </div>
            ) : (
              <GenerationPlaceholder index={index} progress={progress} heightClassName={frameHeightClass} />
            )}
            <div className="absolute left-3 top-3 rounded-full bg-black/15 px-3 py-1 text-xs font-medium text-slate-900 backdrop-blur-sm">
              {status === "生成中" ? `${progress}%造梦中` : `第 ${index + 1} 张`}
            </div>
          </button>
        ))}
        </div>
      </div>
    </div>
  )
}

function VideoResultCard({
  error,
  loading,
  progress,
  status,
  videoUrl,
}: {
  error: string
  loading: boolean
  progress: number
  status: ProjectStatus
  videoUrl: string
}) {
  const isWaiting = status === "生成中"

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
        <Badge className={cn("rounded-full", getStatusClassName(status))} variant="outline">
          {isWaiting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          {progress}%造梦中
        </Badge>
        <span className="text-sm text-slate-500">{error || (loading ? "正在读取视频任务" : "视频结果")}</span>
      </div>
      {videoUrl ? (
        <video className="max-h-[72vh] w-full bg-black" controls src={videoUrl} />
      ) : (
        <div className="flex min-h-[56vh] items-center justify-center bg-slate-950 px-4 text-center text-slate-300">
          <div className="grid justify-items-center gap-3">
            <Film className="h-10 w-10" />
            <div className="text-sm font-medium text-white">
              {status === "失败" ? "任务生成失败" : "结果生成中"}
            </div>
            <div className="text-sm">{error || "结果完成后会自动显示在这里。"}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function GenerationPlaceholder({
  index,
  progress,
  heightClassName,
}: {
  index: number
  progress: number
  heightClassName: string
}) {
  const hues = [
    "from-slate-200 via-blue-100 to-sky-200",
    "from-slate-100 via-cyan-100 to-blue-200",
    "from-blue-100 via-sky-100 to-cyan-200",
    "from-slate-100 via-blue-50 to-sky-200",
  ]

  return (
    <div className={cn("relative flex flex-col bg-gradient-to-br", heightClassName, hues[index % hues.length])}>
      <div className="flex-1 bg-[radial-gradient(circle_at_25%_25%,rgba(255,255,255,0.55),transparent_28%),radial-gradient(circle_at_70%_45%,rgba(255,255,255,0.35),transparent_35%)]" />
      <div className="border-t border-white/60 bg-white/35 px-4 py-3 text-sm text-slate-700 backdrop-blur-sm">
        等待第 {index + 1} 张生成
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-white/5" />
      <div className="absolute bottom-4 right-4 rounded-full bg-black/15 px-3 py-1 text-xs font-medium text-slate-900 backdrop-blur-sm">
        {Math.max(progress - index * 2, 0)}%
      </div>
    </div>
  )
}

async function getCurrentAccessToken() {
  const { getSupabaseClient } = await import("@/lib/supabase")
  const supabase = getSupabaseClient()
  if (!supabase) {
    throw new Error("Supabase 未配置。")
  }

  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  const token = data.session?.access_token
  if (!token) {
    throw new Error("请先登录后再查看任务。")
  }

  return token
}
