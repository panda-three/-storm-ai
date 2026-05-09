"use client"

import { type DragEvent, useEffect, useRef, useState } from "react"
import type { WorkspaceSection } from "@/app/page"
import type { MembershipTier } from "@/lib/local-store"
import type { ProjectItem, ProjectStatus, ProjectType } from "@/lib/project-history"
import type { CreditPackage, CustomerServiceSettings, ModelPricing } from "@/lib/supabase"
import { calculatePricingCredits, getSupabaseClient, redeemCreditCode } from "@/lib/supabase"
import { formatLedgerDateTime } from "@/lib/date-time"
import {
  getImageRatiosForSelection,
  imageModelOptions,
  imageModelSettings,
  videoModelOptions,
  videoModelSettings,
} from "@/lib/model-options"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Coins,
  Copy,
  Download,
  Eye,
  Film,
  History,
  ImagePlus,
  ImageIcon,
  Loader2,
  Menu,
  Play,
  QrCode,
  RotateCcw,
  Sparkles,
  Trash2,
  WalletCards,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

type ChatWorkspaceSection = Exclude<WorkspaceSection, "admin">

interface ChatAreaProps {
  activeSection: ChatWorkspaceSection
  billingReady: boolean
  creditBalance: number
  creditPackages: CreditPackage[]
  customerService: CustomerServiceSettings
  ledger: Array<{
    amount: number
    code: string
    createdAt: string
    id: string
  }>
  membershipExpiresAt: string | null
  membershipFreeImageQualities: string[]
  membershipTier: MembershipTier | null
  onProjectAdd: (item: ProjectItem) => void
  onProjectDelete: (id: string) => void
  onProjectUpdate: (item: ProjectItem) => void
  onAccountRefresh: () => Promise<void>
  modelPricing: ModelPricing[]
  projects: ProjectItem[]
  redeemedCodes: string[]
  sidebarOpen: boolean
  onSectionChange: (section: WorkspaceSection) => void
  onToggleSidebar: () => void
  userId: string
}

const sectionMeta: Record<
  ChatWorkspaceSection,
  {
    title: string
    description: string
  }
> = {
  image: {
    title: "AI 生图工作台",
    description: "输入创意描述，选择图片比例与清晰度后生成作品。",
  },
  video: {
    title: "AI 视频工作台",
    description: "规划视频提示词、时长和清晰度，生成短视频内容。",
  },
  history: {
    title: "历史项目",
    description: "统一查看生图和视频生成记录。",
  },
  credits: {
    title: "点数充值",
    description: "添加客服微信购买兑换码，并在站内兑换 AI 点数。",
  },
}

const maxReferenceImages = 4
const maxReferenceImageBytes = 10 * 1024 * 1024
const supportedReferenceImageTypes = ["image/jpeg", "image/png", "image/webp"]
const imageDefaultRatioOption = "默认"
const imageCountOptions = ["1", "2", "3", "4"]
const activeTaskPolls = new Set<string>()
const taskInitialPollDelayMs = 15000
const taskEarlyPollIntervalMs = 15000
const taskMiddlePollIntervalMs = 30000
const taskLatePollIntervalMs = 60000
const taskEarlyPollWindowMs = 2 * 60 * 1000
const taskMiddlePollWindowMs = 5 * 60 * 1000
const taskMaxPollDurationMs = 20 * 60 * 1000

interface ReferenceImage {
  file: File
  height: number
  id: string
  name: string
  previewUrl: string
  size: number
  width: number
}

function getAssetExtension(url: string, fallback: string) {
  const pathname = new URL(url, window.location.href).pathname
  const extension = pathname.split(".").pop()?.toLowerCase()

  return extension && extension.length <= 5 ? extension : fallback
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

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files")
}

function openAsset(url: string) {
  window.open(url, "_blank", "noopener,noreferrer")
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

async function getCurrentAccessToken() {
  const supabase = getSupabaseClient()
  if (!supabase) {
    throw new Error("Supabase 未配置。")
  }

  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  const token = data.session?.access_token
  if (!token) {
    throw new Error("请先登录后再生成。")
  }

  return token
}

function parseAspectRatio(ratio: string) {
  const [width, height] = ratio.split(":").map(Number)
  return width > 0 && height > 0 ? width / height : null
}

function resolveReferenceImageRatio(image: ReferenceImage | undefined, supportedRatios: string[]) {
  const ratios = supportedRatios.filter((item) => item !== imageDefaultRatioOption)

  if (!image || image.width <= 0 || image.height <= 0) {
    return ratios[0] ?? "1:1"
  }

  const sourceRatio = image.width / image.height
  return ratios.reduce((closest, current) => {
    const closestRatio = parseAspectRatio(closest) ?? 1
    const currentRatio = parseAspectRatio(current) ?? 1
    return Math.abs(Math.log(currentRatio / sourceRatio)) < Math.abs(Math.log(closestRatio / sourceRatio))
      ? current
      : closest
  }, ratios[0] ?? "1:1")
}

function getImageDimensions(src: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new window.Image()
    image.onload = () => {
      resolve({
        height: image.naturalHeight,
        width: image.naturalWidth,
      })
    }
    image.onerror = () => resolve({ height: 0, width: 0 })
    image.src = src
  })
}

function parseDurationSeconds(duration?: string) {
  if (!duration) return null
  const parsed = Number.parseInt(duration, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message

  if (typeof error === "object" && error !== null) {
    const details = ["error", "message", "details", "hint", "code"]
      .map((key) => {
        const value = (error as Record<string, unknown>)[key]
        return typeof value === "string" && value ? value : ""
      })
      .filter(Boolean)

    if (details.length > 0) return details.join(" ")
  }

  if (typeof error === "string" && error) return error

  return fallback
}

function getOptionLabel(option: string) {
  if (option === "Gemini 3.1 Flash Image Preview") return "Gemini3香蕉pro"
  if (option === "1") return "一张"
  if (option === "2") return "两张"
  if (option === "3") return "三张"
  if (option === "4") return "四张"

  return option === "auto" ? "默认" : option
}

function parseImageCount(value: string) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : 1
}

function findModelPricing(
  pricing: ModelPricing[],
  params: {
    aspectRatio?: string
    duration?: string
    model: string
    quality: string
    type: "image" | "video"
  }
) {
  const durationSeconds = parseDurationSeconds(params.duration)

  return pricing.find((item) => {
    if (!item.enabled || item.type !== params.type) return false
    if (item.model !== params.model) return false
    if ((item.quality ?? "") !== params.quality) return false
    if (params.type === "video" && item.duration_seconds !== durationSeconds) return false

    return true
  })
}

function isMembershipActive(membershipTier: MembershipTier | null, membershipExpiresAt: string | null) {
  return Boolean(membershipTier && membershipExpiresAt && new Date(membershipExpiresAt).getTime() > Date.now())
}

function getMembershipLabel(membershipTier: MembershipTier | null) {
  if (membershipTier === "svip") return "SVIP"
  if (membershipTier === "vip") return "VIP"
  return "VIP"
}

function formatMembershipExpiresAt(expiresAt: string | null) {
  if (!expiresAt) return ""
  return new Date(expiresAt).toLocaleString("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function PricingNotice({
  estimatedCredits,
  imageCount,
  membershipCoversQuality = false,
}: {
  estimatedCredits: number | null
  imageCount?: number
  membershipCoversQuality?: boolean
}) {
  const countLabel = imageCount && imageCount > 1 ? `，生成 ${imageCount} 张` : ""

  return (
    <div
      className={
        estimatedCredits === null
          ? "mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          : "mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
      }
    >
      {estimatedCredits === null
        ? "当前参数未配置价格，暂不能提交生成。"
        : membershipCoversQuality
          ? `预计消耗：0 点（会员权益免费${countLabel}）`
          : `预计消耗：${estimatedCredits.toLocaleString()} 点（约 ${(estimatedCredits / 100).toFixed(2)} 元${countLabel}）`}
    </div>
  )
}

function PricingLoadingNotice() {
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
      正在加载价格配置...
    </div>
  )
}

async function pollTask({
  accessToken,
  initialDelayMs = taskInitialPollDelayMs,
  onUpdate,
  taskId,
}: {
  accessToken: string
  initialDelayMs?: number
  onUpdate: (task: TaskStatusResponse) => void
  taskId: string
}) {
  if (activeTaskPolls.has(taskId)) return

  activeTaskPolls.add(taskId)

  try {
    const startedAt = Date.now()
    let nextDelay = initialDelayMs

    while (Date.now() - startedAt < taskMaxPollDurationMs) {
      await new Promise((resolve) => window.setTimeout(resolve, nextDelay))

      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
      const task = (await response.json()) as TaskStatusResponse

      if (!response.ok || !task.ok) {
        if (task.retryable || response.status === 429) {
          nextDelay = Math.min(120000, nextDelay * 2)
          continue
        }

        throw new Error(task.error ?? "任务状态查询失败。")
      }

      onUpdate(task)

      if (task.status === "completed" || task.status === "failed" || task.status === "partial_completed") {
        return
      }

      nextDelay = getTaskPollDelay(Date.now() - startedAt)
    }

    throw new TaskPollingTimeoutError()
  } finally {
    activeTaskPolls.delete(taskId)
  }
}

function getTaskPollDelay(elapsedMs: number) {
  if (elapsedMs < taskEarlyPollWindowMs) return taskEarlyPollIntervalMs
  if (elapsedMs < taskMiddlePollWindowMs) return taskMiddlePollIntervalMs
  return taskLatePollIntervalMs
}

interface ImageResult {
  id: string
  prompt: string
  model: string
  quality: string
  ratio: string
  createdAt: string
  imageCount: number
  imageUrl: string
  imageUrls: string[]
  palette: string
  status: ProjectStatus
  taskId: string
  progress: number
  taskError?: string
}

interface VideoResult {
  id: string
  prompt: string
  model: string
  aspectRatio: string
  duration: string
  quality: string
  createdAt: string
  sceneTitle: string
  palette: string
  status: ProjectStatus
  taskId: string
  progress: number
  taskError?: string
  videoUrl: string
}

interface TaskStatusResponse {
  ok: boolean
  status?: "submitted" | "processing" | "completed" | "failed" | "partial_completed"
  progress?: number
  imageUrls?: string[]
  videoUrl?: string
  error?: string
  orphaned?: boolean
  retryable?: boolean
  taskError?: string
}

class TaskPollingTimeoutError extends Error {
  constructor() {
    super("任务已转入后台继续生成，可稍后在历史项目中查看。")
    this.name = "TaskPollingTimeoutError"
  }
}

function isLegacyUpstreamTaskId(taskId: string | undefined) {
  return Boolean(taskId?.startsWith("task_"))
}

function getTaskStatusError(task: TaskStatusResponse) {
  return task.taskError || task.error || "任务状态查询失败。"
}

function isRateLimitTaskError(task: TaskStatusResponse) {
  const message = getTaskStatusError(task).toLowerCase()
  return message.includes("request rate limit") || message.includes("rate limit") || message.includes("too many requests")
}

function isOrphanedLegacyTaskMessage(message: string) {
  return message.includes("旧任务没有本地生成记录") || message.includes("已停止自动查询")
}

function resolveImageTaskProject(task: TaskStatusResponse, fallbackUrl = "") {
  const imageUrls = task.imageUrls ?? []
  const previewUrl = imageUrls[0] ?? fallbackUrl
  const status: ProjectStatus =
    task.status === "failed" || (task.status === "completed" && imageUrls.length === 0)
      ? "失败"
      : task.status === "partial_completed"
        ? "部分完成"
        : task.status === "completed"
        ? "已完成"
        : "生成中"
  const taskError =
    task.taskError || (task.status === "completed" && imageUrls.length === 0 ? "任务已完成，但接口没有返回图片地址。" : "")

  return {
    imageUrls,
    previewUrl,
    status,
    taskError,
  }
}

function resolveVideoTaskProject(task: TaskStatusResponse, fallbackUrl = "") {
  const previewUrl = task.videoUrl || fallbackUrl
  const status: ProjectStatus =
    task.status === "failed" || (task.status === "completed" && !task.videoUrl)
      ? "失败"
      : task.status === "completed"
        ? "已完成"
        : "生成中"
  const taskError =
    task.taskError || (task.status === "completed" && !task.videoUrl ? "任务已完成，但接口没有返回视频地址。" : "")

  return {
    previewUrl,
    status,
    taskError,
  }
}

const seedHistoryItems: ProjectItem[] = [
  {
    id: "seed-image-1",
    title: "赛博城市夜景海报",
    type: "生图",
    status: "已完成",
    time: "今天 11:20",
    model: "商业海报 V1",
    palette: "from-indigo-500 via-sky-400 to-emerald-300",
    previewLabel: "2K · 16:9",
    prompt: "赛博城市夜景，霓虹灯，未来商业海报",
  },
  {
    id: "seed-video-1",
    title: "产品宣传短视频",
    type: "视频",
    status: "生成中",
    time: "今天 10:48",
    model: "产品运镜 V1",
    palette: "from-slate-950 via-indigo-700 to-cyan-400",
    previewLabel: "10 秒 · 720P",
    prompt: "科技产品在黑色展台缓慢旋转，镜头推进",
  },
  {
    id: "seed-image-2",
    title: "国风角色设定",
    type: "生图",
    status: "已完成",
    time: "昨天 18:05",
    model: "国风插画 V1",
    palette: "from-amber-300 via-orange-400 to-rose-400",
    previewLabel: "4K · 3:4",
    prompt: "国风侠客角色设定，长袍，水墨背景",
  },
]

export function ChatArea({
  activeSection,
  billingReady,
  creditBalance,
  creditPackages,
  customerService,
  ledger,
  membershipExpiresAt,
  membershipFreeImageQualities,
  membershipTier,
  modelPricing,
  onProjectAdd,
  onProjectDelete,
  onProjectUpdate,
  onAccountRefresh,
  projects,
  redeemedCodes,
  sidebarOpen,
  onSectionChange,
  onToggleSidebar,
  userId,
}: ChatAreaProps) {
  const meta = sectionMeta[activeSection]

  useEffect(() => {
    const pendingProjects = projects.filter((project) => project.status === "生成中" && project.taskId)
    const projectsByTaskId = new Map<string, ProjectItem[]>()
    let active = true
    const timers: number[] = []

    pendingProjects.forEach((project) => {
      if (!project.taskId) return
      projectsByTaskId.set(project.taskId, [...(projectsByTaskId.get(project.taskId) ?? []), project])
    })

    projectsByTaskId.forEach((taskProjects, taskId) => {
      const project = taskProjects[0]
      let attempts = 0
      const stopTaskProjects = (taskError: string) => {
        taskProjects.forEach((item) => {
          onProjectUpdate({
            ...item,
            status: "失败",
            taskError,
          })
        })
      }

      if (isLegacyUpstreamTaskId(taskId)) {
        stopTaskProjects("旧任务没有本地生成记录，已停止自动查询。")
        return
      }

      if (activeTaskPolls.has(taskId)) {
        return
      }

      const reconcile = () => {
        attempts += 1
        getCurrentAccessToken()
          .then((accessToken) =>
            fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            })
          )
          .then(async (response) => {
            const task = (await response.json()) as TaskStatusResponse

            if (!response.ok || !task.ok) {
              if (active && (response.status === 410 || task.orphaned) && isLegacyUpstreamTaskId(taskId)) {
                stopTaskProjects(getTaskStatusError(task))
                return
              }

              throw new Error(getTaskStatusError(task))
            }

            if (!active) return

            if (isRateLimitTaskError(task)) {
              throw new Error(getTaskStatusError(task))
            }

            const resolved =
              project.type === "视频"
                ? resolveVideoTaskProject(task, project.previewUrl)
                : resolveImageTaskProject(task, project.previewUrl)

            if (resolved.status === "生成中") {
              if (attempts < 20) {
                timers.push(window.setTimeout(reconcile, 60000))
              }
              return
            }

            onProjectUpdate({
              ...project,
              status: resolved.status,
              imageUrls: "imageUrls" in resolved ? resolved.imageUrls : project.imageUrls,
              previewUrl: resolved.previewUrl,
              taskError: resolved.taskError,
            })
          })
          .catch((error) => {
            const message = getErrorMessage(error, "任务状态查询失败。")

            if (active && isLegacyUpstreamTaskId(taskId) && isOrphanedLegacyTaskMessage(message)) {
              stopTaskProjects(message)
              return
            }

            console.warn("[Task Reconcile] failed", {
              error: message,
              taskId,
            })

            if (active && attempts < 6 && !isLegacyUpstreamTaskId(taskId)) {
              timers.push(window.setTimeout(reconcile, Math.min(120000, 15000 * 2 ** Math.min(attempts, 3))))
            }
          })
      }

      timers.push(window.setTimeout(reconcile, 30000))
    })

    return () => {
      active = false
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [onProjectUpdate, projects])

  const handleImageGenerated = (result: ImageResult) => {
    onProjectAdd({
      id: result.id,
      title: result.prompt.slice(0, 22) || "未命名生图任务",
      type: "生图",
      status: result.status,
      time: result.createdAt,
      model: result.model,
      palette: result.palette,
      prompt: result.prompt,
      imageUrls: result.imageUrls,
      previewLabel: `${result.quality} · ${result.ratio} · ${result.imageCount} 张`,
      previewUrl: result.imageUrl,
      taskId: result.taskId,
      taskError: result.taskError,
    })
  }

  const handleVideoGenerated = (result: VideoResult) => {
    onProjectAdd({
      id: result.id,
      title: result.prompt.slice(0, 22) || "未命名视频任务",
      type: "视频",
      status: result.status,
      time: result.createdAt,
      model: result.model,
      palette: result.palette,
      prompt: result.prompt,
      previewLabel: `${result.duration} · ${result.quality} · ${result.aspectRatio}`,
      previewUrl: result.videoUrl,
      taskId: result.taskId,
    })
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {!sidebarOpen && (
            <Button
              aria-label="展开侧边栏"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-500 hover:text-slate-950"
              onClick={onToggleSidebar}
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-slate-950">{meta.title}</h1>
            <p className="hidden truncate text-sm text-slate-500 sm:block">{meta.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="hidden border-indigo-200 bg-indigo-50 text-indigo-700 sm:inline-flex" variant="outline">
            余额 {creditBalance.toLocaleString()} 点
          </Badge>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            size="sm"
            onClick={() => onSectionChange("credits")}
          >
            <Coins className="h-4 w-4" />
            充值
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-5">
          {activeSection === "image" && (
            <ImageWorkspace
              billingReady={billingReady}
              onImageGenerated={handleImageGenerated}
              creditBalance={creditBalance}
              membershipExpiresAt={membershipExpiresAt}
              membershipFreeImageQualities={membershipFreeImageQualities}
              membershipTier={membershipTier}
              modelPricing={modelPricing}
              onAccountRefresh={onAccountRefresh}
              onProjectUpdated={onProjectUpdate}
              onSectionChange={onSectionChange}
            />
          )}
          {activeSection === "video" && (
            <VideoWorkspace
              billingReady={billingReady}
              onProjectUpdated={onProjectUpdate}
              creditBalance={creditBalance}
              modelPricing={modelPricing}
              onAccountRefresh={onAccountRefresh}
              onSectionChange={onSectionChange}
              onVideoGenerated={handleVideoGenerated}
            />
          )}
          {activeSection === "history" && (
            <HistoryWorkspace
              items={[...projects, ...seedHistoryItems]}
              onDeleteProject={onProjectDelete}
              onSectionChange={onSectionChange}
            />
          )}
          {activeSection === "credits" && (
            <CreditsWorkspace
              creditBalance={creditBalance}
              creditPackages={creditPackages}
              customerService={customerService}
              ledger={ledger}
              membershipExpiresAt={membershipExpiresAt}
              membershipFreeImageQualities={membershipFreeImageQualities}
              membershipTier={membershipTier}
              onRedeemSuccess={onAccountRefresh}
              redeemedCodes={redeemedCodes}
              userId={userId}
            />
          )}
        </div>
      </div>
    </main>
  )
}

function ImageWorkspace({
  billingReady,
  creditBalance,
  membershipExpiresAt,
  membershipFreeImageQualities,
  membershipTier,
  modelPricing,
  onAccountRefresh,
  onImageGenerated,
  onProjectUpdated,
  onSectionChange,
}: {
  billingReady: boolean
  creditBalance: number
  membershipExpiresAt: string | null
  membershipFreeImageQualities: string[]
  membershipTier: MembershipTier | null
  modelPricing: ModelPricing[]
  onAccountRefresh: () => Promise<void>
  onImageGenerated: (result: ImageResult) => void
  onProjectUpdated: (item: ProjectItem) => void
  onSectionChange: (section: WorkspaceSection) => void
}) {
  const [prompt, setPrompt] = useState("")
  const [model, setModel] = useState(imageModelOptions[0])
  const imageSettings = imageModelSettings[model]
  const [quality, setQuality] = useState(imageSettings.qualities[1])
  const [ratio, setRatio] = useState(imageSettings.ratios[0])
  const [imageCount, setImageCount] = useState(imageCountOptions[0])
  const parsedImageCount = parseImageCount(imageCount)
  const ratioOptions = getImageRatiosForSelection(model, quality)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ImageResult | null>(null)
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [isReferenceDragActive, setIsReferenceDragActive] = useState(false)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const objectUrlsRef = useRef<Set<string>>(new Set())
  const currentPricing = findModelPricing(modelPricing, {
    model,
    quality,
    type: "image",
  })
  const membershipCoversQuality = isMembershipActive(membershipTier, membershipExpiresAt) && membershipFreeImageQualities.includes(quality)
  const estimatedCredits = currentPricing ? (membershipCoversQuality ? 0 : calculatePricingCredits(currentPricing) * parsedImageCount) : null

  const handlePromptChange = (value: string) => {
    setPrompt(value)
    if (error === "请先输入生图提示词。" && value.trim()) {
      setError("")
    }
  }

  useEffect(() => {
    const objectUrls = objectUrlsRef.current

    return () => {
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
      objectUrls.clear()
    }
  }, [])

  useEffect(() => {
    if (!ratioOptions.includes(ratio)) {
      setRatio(ratioOptions[0])
    }
  }, [ratio, ratioOptions])

  const handleReferenceImageChange = async (files: FileList | null) => {
    if (!files?.length) return

    const availableSlots = maxReferenceImages - referenceImages.length
    const selectedFiles = Array.from(files).slice(0, Math.max(availableSlots, 0))

    if (availableSlots <= 0) {
      setError(`参考图最多上传 ${maxReferenceImages} 张。`)
      if (referenceInputRef.current) referenceInputRef.current.value = ""
      return
    }

    const validImages: ReferenceImage[] = []
    let nextError = ""

    for (const file of selectedFiles) {
      if (!supportedReferenceImageTypes.includes(file.type)) {
        nextError = "参考图仅支持 JPG、PNG、WebP 格式。"
        continue
      }

      if (file.size > maxReferenceImageBytes) {
        nextError = "单张参考图不能超过 10MB。"
        continue
      }

      const previewUrl = URL.createObjectURL(file)
      objectUrlsRef.current.add(previewUrl)
      const dimensions = await getImageDimensions(previewUrl)
      validImages.push({
        file,
        height: dimensions.height,
        id: `${file.name}-${file.lastModified}-${previewUrl}`,
        name: file.name,
        previewUrl,
        size: file.size,
        width: dimensions.width,
      })
    }

    if (files.length > availableSlots) {
      nextError = `参考图最多上传 ${maxReferenceImages} 张，已保留前 ${availableSlots} 张。`
    }

    if (validImages.length > 0) {
      setReferenceImages((items) => [...items, ...validImages])
    }

    setError(nextError)
    if (referenceInputRef.current) referenceInputRef.current.value = ""
  }

  const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    if (!isGenerating) {
      setIsReferenceDragActive(true)
    }
  }

  const handleReferenceDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect =
      isGenerating || referenceImages.length >= maxReferenceImages ? "none" : "copy"
    if (!isGenerating) {
      setIsReferenceDragActive(true)
    }
  }

  const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsReferenceDragActive(false)
  }

  const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    setIsReferenceDragActive(false)

    if (isGenerating) return
    handleReferenceImageChange(event.dataTransfer.files)
  }

  const handleReferenceImageRemove = (id: string) => {
    setReferenceImages((items) => {
      const removed = items.find((item) => item.id === id)
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl)
        objectUrlsRef.current.delete(removed.previewUrl)
      }
      return items.filter((item) => item.id !== id)
    })
  }

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim()

    if (!trimmedPrompt) {
      setError("请先输入生图提示词。")
      setResult(null)
      window.requestAnimationFrame(() => promptRef.current?.focus())
      return
    }

    if (!billingReady) {
      setError("价格配置正在加载，请稍后再试。")
      return
    }

    if (!currentPricing) {
      setError("当前模型参数未配置价格，请联系管理员配置后再生成。")
      return
    }

    if (estimatedCredits === null || creditBalance < estimatedCredits) {
      setError("点数余额不足，请先充值。")
      return
    }

    setError("")
    setIsGenerating(true)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append("prompt", trimmedPrompt)
      formData.append("model", model)
      formData.append("quality", quality)
      formData.append("imageCount", String(parsedImageCount))
      const resolvedRatio =
        ratio === imageDefaultRatioOption ? resolveReferenceImageRatio(referenceImages[0], ratioOptions) : ratio

      formData.append("ratio", resolvedRatio)
      referenceImages.forEach((image) => {
        formData.append("referenceImages", image.file, image.name)
      })
      const accessToken = await getCurrentAccessToken()

      const response = await fetch("/api/generate/image", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        method: "POST",
        body: formData,
      }).catch((error) => {
        throw new Error(`生图接口请求失败：${getErrorMessage(error, "请检查本地服务或网络连接。")}`)
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data, "生图任务提交失败。"))
      }

      await onAccountRefresh()

      const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls.filter((url: unknown) => typeof url === "string") : []
      const isCompleted = (data.status === "completed" || data.status === "partial_completed") && imageUrls.length > 0
      const initialStatus: ProjectStatus =
        data.status === "partial_completed" && imageUrls.length > 0
          ? "部分完成"
          : data.status === "completed" && imageUrls.length > 0
            ? "已完成"
            : "生成中"
      const generatedResult: ImageResult = {
        id: `image-${Date.now()}`,
        prompt: trimmedPrompt,
        model,
        quality,
        ratio: resolvedRatio,
        createdAt: "刚刚",
        imageCount: parsedImageCount,
        imageUrl: imageUrls[0] ?? "",
        imageUrls,
        palette: "from-indigo-500 via-sky-400 to-emerald-300",
        status: initialStatus,
        taskId: data.taskId,
        progress: isCompleted ? 100 : 0,
        taskError: typeof data.taskError === "string" ? data.taskError : "",
      }

      setResult(generatedResult)
      onImageGenerated(generatedResult)

      if (isCompleted) {
        return
      }

      pollTask({
        accessToken,
        taskId: data.taskId,
        onUpdate: (task) => {
          const resolved = resolveImageTaskProject(task, generatedResult.imageUrl)
          const resolvedImageUrls =
            resolved.status === "失败"
              ? []
              : resolved.imageUrls.length > 0
                ? resolved.imageUrls
                : generatedResult.imageUrls
          const nextResult: ImageResult = {
            ...generatedResult,
            status: resolved.status,
            progress: task.progress ?? generatedResult.progress,
            imageUrl: resolved.previewUrl,
            imageUrls: resolvedImageUrls,
          }

          setResult(nextResult)
          onProjectUpdated({
            id: nextResult.id,
            title: nextResult.prompt.slice(0, 22) || "未命名生图任务",
            type: "生图",
            status: nextResult.status,
            time: nextResult.createdAt,
            model: nextResult.model,
            palette: nextResult.palette,
            prompt: nextResult.prompt,
            imageUrls: nextResult.imageUrls,
            previewLabel: `${nextResult.quality} · ${nextResult.ratio} · ${nextResult.imageCount} 张`,
            previewUrl: nextResult.imageUrl,
            taskId: nextResult.taskId,
            taskError: resolved.taskError,
          })

          if (resolved.status === "失败" || resolved.status === "已完成" || resolved.status === "部分完成") {
            onAccountRefresh().catch(() => undefined)
          }
        },
      }).catch((error) => {
        setError(
          error instanceof TaskPollingTimeoutError
            ? error.message
            : getErrorMessage(error, "任务状态查询失败。")
        )
      })
    } catch (error) {
      await onAccountRefresh().catch(() => undefined)
      setError(getErrorMessage(error, "生图任务提交失败。"))
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <>
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-indigo-600" />
              <h2 className="text-base font-semibold">生图任务</h2>
            </div>
            <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700" variant="outline">
              服务端提交
            </Badge>
          </div>
          <textarea
            ref={promptRef}
            value={prompt}
            aria-invalid={error === "请先输入生图提示词。"}
            onChange={(event) => handlePromptChange(event.target.value)}
            className={`mt-4 min-h-36 w-full resize-none rounded-lg border bg-slate-50 p-4 text-sm outline-none transition focus:bg-white focus:ring-2 ${
              error === "请先输入生图提示词。"
                ? "border-rose-300 focus:border-rose-300 focus:ring-rose-100"
                : "border-slate-200 focus:border-indigo-300 focus:ring-indigo-100"
            }`}
            placeholder="描述你想生成的画面，例如：未来感 AI 工作室，玻璃墙面，柔和灯光，产品级渲染..."
          />
          <div
            className={cn(
              "mt-4 rounded-lg border border-dashed p-3 transition",
              isReferenceDragActive
                ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100"
                : "border-slate-200 bg-slate-50"
            )}
            onDragEnter={handleReferenceDragEnter}
            onDragLeave={handleReferenceDragLeave}
            onDragOver={handleReferenceDragOver}
            onDrop={handleReferenceDrop}
          >
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={referenceInputRef}
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                multiple
                onChange={(event) => handleReferenceImageChange(event.target.files)}
                type="file"
              />
              <Button
                aria-label="添加参考图"
                className="h-12 w-12 rounded-lg border-slate-200 bg-white p-0 text-slate-600 hover:bg-slate-100"
                disabled={isGenerating || referenceImages.length >= maxReferenceImages}
                onClick={() => referenceInputRef.current?.click()}
                type="button"
                variant="outline"
              >
                <ImagePlus className="h-5 w-5" />
              </Button>
              {referenceImages.map((image, index) => (
                <div
                  className="group relative h-12 w-12 overflow-hidden rounded-lg border border-slate-200 bg-white"
                  key={image.id}
                >
                  <img alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" src={image.previewUrl} />
                  <button
                    aria-label={`移除参考图 ${index + 1}`}
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-slate-950/70 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                    disabled={isGenerating}
                    onClick={() => handleReferenceImageRemove(image.id)}
                    type="button"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <div className="min-w-48 text-xs text-slate-500">
                <div className="font-medium text-slate-700">参考图</div>
                <div>
                  已添加 {referenceImages.length}/{maxReferenceImages} 张 · 可点击或拖拽上传 · JPG/PNG/WebP · 单张 10MB 内
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-4">
            <OptionGroup
              label="生图模型"
              onChange={(value) => {
                const settings = imageModelSettings[value]
                setModel(value)
                setQuality(settings.qualities[1])
                setRatio(settings.ratios[0])
              }}
              options={imageModelOptions}
              selected={model}
            />
            <OptionGroup label="图片清晰度" onChange={setQuality} options={imageSettings.qualities} selected={quality} />
            <OptionGroup label="图片比例" onChange={setRatio} options={ratioOptions} selected={ratio} />
            <OptionGroup label="生成张数" onChange={setImageCount} options={imageCountOptions} selected={imageCount} />
          </div>
          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
          {billingReady ? (
            <PricingNotice
              estimatedCredits={estimatedCredits}
              imageCount={parsedImageCount}
              membershipCoversQuality={membershipCoversQuality}
            />
          ) : (
            <PricingLoadingNotice />
          )}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button
              className="bg-indigo-600 text-white hover:bg-indigo-700"
              disabled={isGenerating || !billingReady || !currentPricing}
              onClick={handleGenerate}
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isGenerating ? "生成中..." : "开始生图"}
            </Button>
            <Button variant="outline" onClick={() => onSectionChange("history")}>
              查看历史项目
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ImageResultPanel
          imageCount={parsedImageCount}
          isGenerating={isGenerating}
          onRegenerate={handleGenerate}
          result={result}
        />
      </section>
      <QuickEntryGrid onSectionChange={onSectionChange} />
    </>
  )
}

function VideoWorkspace({
  billingReady,
  creditBalance,
  modelPricing,
  onAccountRefresh,
  onProjectUpdated,
  onVideoGenerated,
  onSectionChange,
}: {
  billingReady: boolean
  creditBalance: number
  modelPricing: ModelPricing[]
  onAccountRefresh: () => Promise<void>
  onProjectUpdated: (item: ProjectItem) => void
  onVideoGenerated: (result: VideoResult) => void
  onSectionChange: (section: WorkspaceSection) => void
}) {
  const [prompt, setPrompt] = useState("")
  const [model, setModel] = useState(videoModelOptions[0])
  const modelSettings = videoModelSettings[model]
  const [duration, setDuration] = useState(modelSettings.durations[0])
  const [quality, setQuality] = useState(modelSettings.qualities[0])
  const [aspectRatio, setAspectRatio] = useState(modelSettings.aspectRatios[0])
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<VideoResult | null>(null)
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [isReferenceDragActive, setIsReferenceDragActive] = useState(false)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const videoObjectUrlsRef = useRef<Set<string>>(new Set())
  const currentPricing = findModelPricing(modelPricing, {
    aspectRatio,
    duration,
    model,
    quality,
    type: "video",
  })
  const estimatedCredits = currentPricing ? calculatePricingCredits(currentPricing) : null

  useEffect(() => {
    if (!modelSettings.durations.includes(duration)) {
      setDuration(modelSettings.durations[0])
    }
    if (!modelSettings.qualities.includes(quality)) {
      setQuality(modelSettings.qualities[0])
    }
    if (!modelSettings.aspectRatios.includes(aspectRatio)) {
      setAspectRatio(modelSettings.aspectRatios[0])
    }
  }, [aspectRatio, duration, modelSettings, quality])

  const handlePromptChange = (value: string) => {
    setPrompt(value)
    if (error === "请先输入视频提示词。" && value.trim()) {
      setError("")
    }
  }

  useEffect(() => {
    const objectUrls = videoObjectUrlsRef.current

    return () => {
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
      objectUrls.clear()
    }
  }, [])

  const handleReferenceImageChange = (files: FileList | null) => {
    if (!files?.length) return

    const availableSlots = maxReferenceImages - referenceImages.length
    const selectedFiles = Array.from(files).slice(0, Math.max(availableSlots, 0))

    if (availableSlots <= 0) {
      setError(`参考图最多上传 ${maxReferenceImages} 张。`)
      if (referenceInputRef.current) referenceInputRef.current.value = ""
      return
    }

    const validImages: ReferenceImage[] = []
    let nextError = ""

    for (const file of selectedFiles) {
      if (!supportedReferenceImageTypes.includes(file.type)) {
        nextError = "参考图仅支持 JPG、PNG、WebP 格式。"
        continue
      }

      if (file.size > maxReferenceImageBytes) {
        nextError = "单张参考图不能超过 10MB。"
        continue
      }

      const previewUrl = URL.createObjectURL(file)
      videoObjectUrlsRef.current.add(previewUrl)
      validImages.push({
        file,
        height: 0,
        id: `${file.name}-${file.lastModified}-${previewUrl}`,
        name: file.name,
        previewUrl,
        size: file.size,
        width: 0,
      })
    }

    if (files.length > availableSlots) {
      nextError = `参考图最多上传 ${maxReferenceImages} 张，已保留前 ${availableSlots} 张。`
    }

    if (validImages.length > 0) {
      setReferenceImages((items) => [...items, ...validImages])
    }

    setError(nextError)
    if (referenceInputRef.current) referenceInputRef.current.value = ""
  }

  const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    if (!isGenerating) {
      setIsReferenceDragActive(true)
    }
  }

  const handleReferenceDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect =
      isGenerating || referenceImages.length >= maxReferenceImages ? "none" : "copy"
    if (!isGenerating) {
      setIsReferenceDragActive(true)
    }
  }

  const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsReferenceDragActive(false)
  }

  const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    setIsReferenceDragActive(false)

    if (isGenerating) return
    handleReferenceImageChange(event.dataTransfer.files)
  }

  const handleReferenceImageRemove = (id: string) => {
    setReferenceImages((items) => {
      const removed = items.find((item) => item.id === id)
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl)
        videoObjectUrlsRef.current.delete(removed.previewUrl)
      }
      return items.filter((item) => item.id !== id)
    })
  }

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim()

    if (!trimmedPrompt) {
      setError("请先输入视频提示词。")
      setResult(null)
      window.requestAnimationFrame(() => promptRef.current?.focus())
      return
    }

    if (!billingReady) {
      setError("价格配置正在加载，请稍后再试。")
      return
    }

    if (!currentPricing) {
      setError("当前模型参数未配置价格，请联系管理员配置后再生成。")
      return
    }

    if (estimatedCredits === null || creditBalance < estimatedCredits) {
      setError("点数余额不足，请先充值。")
      return
    }

    setError("")
    setIsGenerating(true)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append("prompt", trimmedPrompt)
      formData.append("model", model)
      formData.append("duration", duration)
      formData.append("quality", quality)
      formData.append("aspectRatio", aspectRatio)
      referenceImages.forEach((image) => {
        formData.append("referenceImages", image.file, image.name)
      })
      const accessToken = await getCurrentAccessToken()

      const response = await fetch("/api/generate/video", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        method: "POST",
        body: formData,
      }).catch((error) => {
        throw new Error(`视频接口请求失败：${getErrorMessage(error, "请检查本地服务或网络连接。")}`)
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data, "视频任务提交失败。"))
      }

      await onAccountRefresh()

      const generatedResult: VideoResult = {
        id: `video-${Date.now()}`,
        prompt: trimmedPrompt,
        model,
        aspectRatio,
        duration,
        quality,
        createdAt: "刚刚",
        sceneTitle: trimmedPrompt.slice(0, 24) || "视频预览",
        palette: "from-slate-950 via-indigo-700 to-cyan-400",
        status: "生成中",
        taskId: data.taskId,
        progress: 0,
        taskError: "",
        videoUrl: "",
      }

      setResult(generatedResult)
      onVideoGenerated(generatedResult)
      pollTask({
        accessToken,
        taskId: data.taskId,
        onUpdate: (task) => {
          const resolved = resolveVideoTaskProject(task, generatedResult.videoUrl)
          const nextResult: VideoResult = {
            ...generatedResult,
            status: resolved.status,
            progress: task.progress ?? generatedResult.progress,
            taskError: resolved.taskError,
            videoUrl: resolved.previewUrl,
          }

          setResult(nextResult)
          onProjectUpdated({
            id: nextResult.id,
            title: nextResult.prompt.slice(0, 22) || "未命名视频任务",
            type: "视频",
            status: nextResult.status,
            time: nextResult.createdAt,
            model: nextResult.model,
            palette: nextResult.palette,
            prompt: nextResult.prompt,
            previewLabel: `${nextResult.duration} · ${nextResult.quality} · ${nextResult.aspectRatio}`,
            previewUrl: nextResult.videoUrl,
            taskId: nextResult.taskId,
            taskError: nextResult.taskError,
          })

          if (resolved.status === "失败" || resolved.status === "已完成") {
            onAccountRefresh().catch(() => undefined)
          }
        },
      }).catch((error) => {
        setError(
          error instanceof TaskPollingTimeoutError
            ? error.message
            : getErrorMessage(error, "任务状态查询失败。")
        )
      })
    } catch (error) {
      await onAccountRefresh().catch(() => undefined)
      setError(getErrorMessage(error, "视频任务提交失败。"))
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <>
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Film className="h-5 w-5 text-indigo-600" />
              <h2 className="text-base font-semibold">视频任务</h2>
            </div>
            <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700" variant="outline">
              服务端提交
            </Badge>
          </div>
          <textarea
            ref={promptRef}
            value={prompt}
            aria-invalid={error === "请先输入视频提示词。"}
            onChange={(event) => handlePromptChange(event.target.value)}
            className={`mt-4 min-h-36 w-full resize-none rounded-lg border bg-slate-50 p-4 text-sm outline-none transition focus:bg-white focus:ring-2 ${
              error === "请先输入视频提示词。"
                ? "border-rose-300 focus:border-rose-300 focus:ring-rose-100"
                : "border-slate-200 focus:border-indigo-300 focus:ring-indigo-100"
            }`}
            placeholder="描述你想生成的视频，例如：科技产品在黑色展台缓慢旋转，镜头推进，背景有流动光线..."
          />
          <div
            className={cn(
              "mt-4 rounded-lg border border-dashed p-3 transition",
              isReferenceDragActive
                ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100"
                : "border-slate-200 bg-slate-50"
            )}
            onDragEnter={handleReferenceDragEnter}
            onDragLeave={handleReferenceDragLeave}
            onDragOver={handleReferenceDragOver}
            onDrop={handleReferenceDrop}
          >
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={referenceInputRef}
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                multiple
                onChange={(event) => handleReferenceImageChange(event.target.files)}
                type="file"
              />
              <Button
                aria-label="添加参考图"
                className="h-16 w-16 rounded-lg border-dashed border-slate-300 bg-white p-0 text-slate-500 hover:border-indigo-300 hover:bg-indigo-50"
                disabled={isGenerating || referenceImages.length >= maxReferenceImages}
                onClick={() => referenceInputRef.current?.click()}
                type="button"
                variant="outline"
              >
                <ImagePlus className="h-6 w-6" />
              </Button>
              {referenceImages.map((image, index) => (
                <div
                  className="group relative h-16 w-16 overflow-hidden rounded-lg border border-slate-200 bg-white"
                  key={image.id}
                >
                  <img alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" src={image.previewUrl} />
                  <button
                    aria-label={`移除参考图 ${index + 1}`}
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-slate-950/70 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                    disabled={isGenerating}
                    onClick={() => handleReferenceImageRemove(image.id)}
                    type="button"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <div className="min-w-48 text-xs text-slate-500">
                <div className="font-medium text-slate-700">参考图</div>
                <div>
                  已添加 {referenceImages.length}/{maxReferenceImages} 张 · 可点击或拖拽上传 · JPG/PNG/WebP · 单张 10MB 内
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <OptionGroup
              label="视频模型"
              onChange={(value) => {
                const settings = videoModelSettings[value]
                setModel(value)
                setDuration(settings.durations[0])
                setQuality(settings.qualities[0])
                setAspectRatio(settings.aspectRatios[0])
              }}
              options={videoModelOptions}
              selected={model}
            />
            <OptionGroup label="视频时长" onChange={setDuration} options={modelSettings.durations} selected={duration} />
            <OptionGroup label="视频比例" onChange={setAspectRatio} options={modelSettings.aspectRatios} selected={aspectRatio} />
            <OptionGroup label="视频清晰度" onChange={setQuality} options={modelSettings.qualities} selected={quality} />
          </div>
          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
          {billingReady ? <PricingNotice estimatedCredits={estimatedCredits} /> : <PricingLoadingNotice />}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button
              className="bg-indigo-600 text-white hover:bg-indigo-700"
              disabled={isGenerating || !billingReady || !currentPricing}
              onClick={handleGenerate}
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isGenerating ? "生成中..." : "开始生成视频"}
            </Button>
            <Button variant="outline" onClick={() => onSectionChange("history")}>
              查看历史项目
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <VideoResultPanel isGenerating={isGenerating} onRegenerate={handleGenerate} result={result} />
      </section>
      <QuickEntryGrid onSectionChange={onSectionChange} />
    </>
  )
}

type HistoryFilter = "全部" | ProjectType

function HistoryWorkspace({
  items,
  onDeleteProject,
  onSectionChange,
}: {
  items: ProjectItem[]
  onDeleteProject: (id: string) => void
  onSectionChange: (section: WorkspaceSection) => void
}) {
  const [filter, setFilter] = useState<HistoryFilter>("全部")
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "")

  const filteredItems = filter === "全部" ? items : items.filter((item) => item.type === filter)
  const selectedItem = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null

  const handleDelete = (id: string) => {
    onDeleteProject(id)
    if (selectedId === id) {
      setSelectedId("")
    }
  }

  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-indigo-600" />
              <h2 className="text-base font-semibold">历史项目</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">统一查看本次会话中的生图和视频生成记录。</p>
          </div>
          <div className="flex gap-2">
            {(["全部", "生图", "视频"] as HistoryFilter[]).map((item) => (
              <Button
                key={item}
                onClick={() => {
                  setFilter(item)
                  setSelectedId("")
                }}
                size="sm"
                variant={filter === item ? "default" : "outline"}
              >
                {item}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {filteredItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <History className="mx-auto h-8 w-8 text-slate-400" />
              <div className="mt-3 text-sm font-medium text-slate-700">暂无历史项目</div>
              <div className="mt-1 text-xs text-slate-500">生成图片或视频后会出现在这里。</div>
            </div>
          ) : (
            filteredItems.map((item) => (
              <button
                className={
                  selectedItem?.id === item.id
                    ? "cursor-pointer rounded-lg border border-indigo-300 bg-indigo-50 p-4 text-left"
                    : "cursor-pointer rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-200 hover:bg-slate-50"
                }
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                type="button"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProjectPreviewThumb item={item} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.title}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {item.type} · {item.time}
                        {item.previewLabel ? ` · ${item.previewLabel}` : ""}
                      </div>
                      {item.model && <div className="mt-1 truncate text-xs text-slate-400">模型：{item.model}</div>}
                    </div>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <HistoryDetailPanel item={selectedItem} onDelete={handleDelete} onSectionChange={onSectionChange} />
    </section>
  )
}

function ProjectPreviewThumb({ item }: { item: ProjectItem }) {
  return (
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-slate-100">
      {item.previewUrl && item.type === "生图" ? (
        <ImageWithFallback
          alt={item.title}
          className="h-full w-full object-cover"
          fallbackClassName={`h-full w-full bg-gradient-to-br ${item.palette ?? "from-slate-100 to-slate-300"}`}
          fallbackIconClassName="h-5 w-5"
          src={item.previewUrl}
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${
            item.palette ?? "from-slate-100 to-slate-300"
          }`}
        >
          {item.type === "生图" ? (
            <ImageIcon className="h-5 w-5 text-white drop-shadow-sm" />
          ) : (
            <Film className="h-5 w-5 text-white drop-shadow-sm" />
          )}
        </div>
      )}
    </div>
  )
}

function ImageWithFallback({
  alt,
  className,
  fallbackClassName,
  fallbackIconClassName = "h-10 w-10",
  showMessage = false,
  src,
}: {
  alt: string
  className: string
  fallbackClassName: string
  fallbackIconClassName?: string
  showMessage?: boolean
  src: string
}) {
  const [hasError, setHasError] = useState(false)

  if (hasError) {
    return (
      <div className={cn("flex items-center justify-center", fallbackClassName)}>
        <div className="grid justify-items-center gap-2 px-4 text-center text-white/85">
          <ImageIcon className={cn("drop-shadow-sm", fallbackIconClassName)} />
          {showMessage && <div className="text-xs font-medium">图片地址不可访问</div>}
        </div>
      </div>
    )
  }

  return <img alt={alt} className={className} onError={() => setHasError(true)} src={src} />
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge
      className={
        status === "已完成"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : status === "部分完成"
            ? "border-amber-200 bg-amber-50 text-amber-700"
          : status === "生成中"
            ? "border-indigo-200 bg-indigo-50 text-indigo-700"
            : "border-rose-200 bg-rose-50 text-rose-700"
      }
      variant="outline"
    >
      {status}
    </Badge>
  )
}

function HistoryDetailPanel({
  item,
  onDelete,
  onSectionChange,
}: {
  item: ProjectItem | null
  onDelete: (id: string) => void
  onSectionChange: (section: WorkspaceSection) => void
}) {
  if (!item) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">项目详情</h2>
        <div className="mt-4 flex aspect-[4/3] items-center justify-center rounded-lg bg-slate-100 text-center text-sm text-slate-500">
          请选择一个历史项目
        </div>
      </div>
    )
  }

  const canUseResult = Boolean(item.previewUrl)
  const imageUrls = item.type === "生图" ? item.imageUrls?.filter(Boolean) ?? (item.previewUrl ? [item.previewUrl] : []) : []
  const prompt = item.prompt ?? ""
  const handleDownload = () => {
    if (!item.previewUrl) return

    const fallback = item.type === "视频" ? "mp4" : "png"
    const extension = getAssetExtension(item.previewUrl, fallback)
    const filename = `${item.type === "视频" ? "video" : "image"}-${item.id}.${extension}`

    if (item.type === "视频") {
      downloadVideoDirect(item.previewUrl, filename)
      return
    }

    downloadAsset(item.previewUrl, filename)
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">项目详情</h2>
        <StatusBadge status={item.status} />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
        {imageUrls.length > 0 && item.type === "生图" ? (
          <div className={imageUrls.length === 1 ? "grid gap-2" : "grid grid-cols-2 gap-2 bg-white p-2"}>
            {imageUrls.map((url, index) => (
              <button
                aria-label={`查看结果图 ${index + 1}`}
                className="overflow-hidden rounded-md bg-slate-100 text-left"
                key={`${url}-${index}`}
                onClick={() => openAsset(url)}
                type="button"
              >
                <ImageWithFallback
                  alt={`${item.title} ${index + 1}`}
                  className="aspect-square w-full object-cover"
                  fallbackClassName={`aspect-square bg-gradient-to-br ${item.palette ?? "from-slate-800 to-slate-500"}`}
                  src={url}
                  showMessage
                />
              </button>
            ))}
          </div>
        ) : item.previewUrl && item.type === "视频" ? (
          <video className="aspect-video w-full bg-black" controls src={item.previewUrl} />
        ) : (
          <div
            className={`relative flex ${item.type === "视频" ? "aspect-video" : "aspect-square"} items-center justify-center bg-gradient-to-br ${item.palette ?? "from-slate-800 to-slate-500"}`}
          >
            {item.type === "视频" ? (
              <button
                aria-label="播放历史视频预览"
                className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-white/90 text-indigo-700 transition hover:bg-white"
                type="button"
              >
                <Play className="ml-0.5 h-5 w-5 fill-current" />
              </button>
            ) : (
              <ImageIcon className="h-10 w-10 text-white drop-shadow-sm" />
            )}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="text-sm font-medium text-slate-700">{item.title}</div>
          <div className="mt-1 text-xs text-slate-500">
            {item.type} · {item.time}
            {item.previewLabel ? ` · ${item.previewLabel}` : ""}
          </div>
        </div>
        <DetailRow label="模型" value={item.model ?? "未记录"} />
        <DetailRow label="任务 ID" value={item.taskId ?? "示例项目无任务 ID"} />
        {item.taskError && <DetailRow label="失败原因" value={item.taskError} />}
        <DetailRow label="提示词" value={item.prompt ?? "未记录提示词"} />
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <Button disabled={!canUseResult} onClick={() => item.previewUrl && openAsset(item.previewUrl)} variant="outline">
          <Eye className="h-4 w-4" />
          查看结果
        </Button>
        <Button disabled={!canUseResult} onClick={handleDownload} variant="outline">
          <Download className="h-4 w-4" />
          下载
        </Button>
        <Button disabled={!prompt} onClick={() => copyText(prompt)} variant="outline">
          <Copy className="h-4 w-4" />
          复制提示词
        </Button>
        <Button onClick={() => onSectionChange(item.type === "视频" ? "video" : "image")} variant="outline">
          <RotateCcw className="h-4 w-4" />
          重新生成
        </Button>
        {item.id.startsWith("seed-") ? (
          <Button className="sm:col-span-2" disabled variant="outline">
            <Trash2 className="h-4 w-4" />
            示例项目不可删除
          </Button>
        ) : (
          <Button
            className="border-rose-200 text-rose-700 hover:bg-rose-50 sm:col-span-2"
            onClick={() => onDelete(item.id)}
            variant="outline"
          >
            <Trash2 className="h-4 w-4" />
            删除项目
          </Button>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm text-slate-700">{value}</div>
    </div>
  )
}

type RedeemFeedback =
  | {
      type: "success"
      message: string
    }
  | {
      type: "error"
      message: string
    }
  | null

function CreditsWorkspace({
  creditBalance,
  creditPackages,
  customerService,
  ledger,
  membershipExpiresAt,
  membershipFreeImageQualities,
  membershipTier,
  onRedeemSuccess,
  redeemedCodes,
  userId,
}: {
  creditBalance: number
  creditPackages: CreditPackage[]
  customerService: CustomerServiceSettings
  ledger: Array<{
    amount: number
    code: string
    createdAt: string
    id: string
  }>
  membershipExpiresAt: string | null
  membershipFreeImageQualities: string[]
  membershipTier: MembershipTier | null
  onRedeemSuccess: () => Promise<void>
  redeemedCodes: string[]
  userId: string
}) {
  const [redeemCode, setRedeemCode] = useState("")
  const [feedback, setFeedback] = useState<RedeemFeedback>(null)
  const [isRedeeming, setIsRedeeming] = useState(false)

  const handleRedeem = async () => {
    const normalizedCode = redeemCode.trim().toUpperCase()

    if (!normalizedCode) {
      setFeedback({
        type: "error",
        message: "请输入兑换码。",
      })
      return
    }

    setIsRedeeming(true)
    setFeedback(null)

    try {
      const result = await redeemCreditCode(normalizedCode)
      await onRedeemSuccess()
      setRedeemCode("")
      setFeedback({
        type: "success",
        message: result.membership_tier
          ? `${getMembershipLabel(result.membership_tier)} 兑换成功，到期时间 ${formatMembershipExpiresAt(result.membership_expires_at ?? null)}。`
          : `兑换成功，已增加 ${result.credits.toLocaleString()} 点。`,
      })
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "兑换失败，请稍后重试。",
      })
    } finally {
      setIsRedeeming(false)
    }
  }

  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-emerald-600" />
              <h2 className="text-base font-semibold">兑换 AI 点数</h2>
            </div>
            <p className="mt-2 text-sm text-slate-500">向客服购买兑换码后，在这里输入兑换码完成点数充值。</p>
          </div>
          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700" variant="outline">
            Supabase 兑换
          </Badge>
        </div>

        <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-950">
                <WalletCards className="h-4 w-4" />
                当前余额
              </div>
              <div className="mt-2 text-3xl font-semibold tracking-tight text-emerald-700">
                {creditBalance.toLocaleString()}
                <span className="ml-2 text-sm font-normal text-emerald-800">点</span>
              </div>
            </div>
            <div className="border-t border-emerald-200 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
              <div className="text-sm font-medium text-emerald-950">{getMembershipLabel(membershipTier)} 到期时间</div>
              <div className="mt-2 text-lg font-semibold text-emerald-700">
                {membershipExpiresAt ? formatMembershipExpiresAt(membershipExpiresAt) : "未开通"}
              </div>
              {membershipExpiresAt && !isMembershipActive(membershipTier, membershipExpiresAt) && (
                <div className="mt-1 text-xs text-rose-600">会员已过期</div>
              )}
              {isMembershipActive(membershipTier, membershipExpiresAt) && membershipFreeImageQualities.length > 0 && (
                <div className="mt-1 text-xs text-emerald-800">
                  生图免费：{membershipFreeImageQualities.join(" / ")}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 p-4">
          <div className="text-sm font-medium text-slate-700">Supabase 用户 ID</div>
          <div className="mt-1 break-all text-xs text-slate-500">{userId}</div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={redeemCode}
            onChange={(event) => {
              setRedeemCode(event.target.value)
              setFeedback(null)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleRedeem()
              }
            }}
            className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-100"
            placeholder="请输入兑换码"
          />
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={isRedeeming} onClick={handleRedeem}>
            {isRedeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isRedeeming ? "兑换中..." : "立即兑换"}
          </Button>
        </div>

        {feedback && (
          <div
            className={
              feedback.type === "success"
                ? "mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
                : "mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            }
          >
            {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {feedback.message}
          </div>
        )}

        <div className="mt-5 rounded-lg bg-slate-50 p-4">
          <div className="text-sm font-medium text-slate-700">点数套餐</div>
          <div className="mt-2 grid gap-2">
            {creditPackages.length === 0 ? (
              <div className="text-xs text-slate-500">暂无启用套餐，请联系管理员配置。</div>
            ) : (
              creditPackages.map((item) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                  key={item.id}
                >
                  <div>
                    <div className="font-medium text-slate-700">{item.name}</div>
                    <div className="text-xs text-slate-500">
                      {item.package_type === "membership"
                        ? `${item.price_cny.toFixed(2)} 元 / ${item.membership_duration_days ?? 365} 天`
                        : `${item.price_cny.toFixed(2)} 元`}
                    </div>
                  </div>
                  <div className="text-right font-semibold text-emerald-700">
                    {item.package_type === "membership"
                      ? `${getMembershipLabel(item.membership_tier)} · ${item.membership_free_image_qualities.join("/") || "生图"} 免费`
                      : `${item.credits.toLocaleString()} 点`}
                  </div>
                </div>
              ))
            )}
          </div>
          {redeemedCodes.length > 0 && (
            <div className="mt-3 text-xs text-slate-500">
              已使用：{redeemedCodes.join("、")}
            </div>
          )}
        </div>

        <div className="mt-5 rounded-lg border border-slate-200 p-4">
          <div className="text-sm font-medium text-slate-700">点数流水</div>
          <div className="mt-3 grid gap-2">
            {ledger.length === 0 ? (
              <div className="text-xs text-slate-500">暂无兑换记录。</div>
            ) : (
              ledger.slice(0, 5).map((item) => (
                <div className="flex items-center justify-between gap-3 text-sm" key={item.id}>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-700">{item.code}</div>
                    <div className="text-xs text-slate-500">{formatLedgerDateTime(item.createdAt)}</div>
                  </div>
                  <div className={item.amount >= 0 ? "font-medium text-emerald-700" : "font-medium text-rose-700"}>
                    {item.amount >= 0 ? "+" : ""}
                    {item.amount.toLocaleString()} 点
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-indigo-600" />
          <h2 className="text-base font-semibold">客服微信二维码</h2>
        </div>
        <div className="mt-5 flex aspect-square items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
          {customerService.qrCodeUrl ? (
            <img
              alt="客服微信二维码"
              className="h-full w-full rounded-lg object-cover"
              src={customerService.qrCodeUrl}
            />
          ) : (
            <div className="text-center">
              <QrCode className="mx-auto h-16 w-16 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-700">二维码图片占位</p>
              <p className="mt-1 text-xs text-slate-500">请在管理员后台配置二维码 URL</p>
            </div>
          )}
        </div>
        <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          <div className="font-medium text-slate-800">购买流程</div>
          <div>1. 添加客服微信{customerService.wechatId ? `：${customerService.wechatId}` : "。"}</div>
          <div>2. 向客服购买 AI 点数兑换码。</div>
          <div>3. 回到本页输入兑换码并完成充值。</div>
          {customerService.description && <div className="pt-2 text-xs text-slate-500">{customerService.description}</div>}
        </div>
      </div>
    </section>
  )
}

function OptionGroup({
  label,
  onChange,
  options,
  selected,
}: {
  label: string
  onChange?: (value: string) => void
  options: string[]
  selected?: string
}) {
  const isModelGroup = label.includes("模型")

  return (
    <div>
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <div className={isModelGroup ? "mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3" : "mt-2 flex flex-wrap gap-2"}>
        {options.map((option, index) => {
          const isSelected = selected ? selected === option : index === 0

          return (
            <button
              className={[
                "cursor-pointer border text-center text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40",
                isModelGroup
                  ? "grid min-h-14 w-full place-items-center rounded-xl px-3 py-2.5 font-medium leading-snug shadow-sm hover:-translate-y-0.5 hover:shadow-md"
                  : "rounded-md px-3 py-2",
                isSelected
                  ? isModelGroup
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700 shadow-indigo-100 ring-1 ring-indigo-500/15"
                    : "border-indigo-600 bg-indigo-50 font-medium text-indigo-700"
                  : isModelGroup
                    ? "border-slate-200 bg-white text-slate-600 shadow-slate-100 hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
              ].join(" ")}
              key={option}
              onClick={() => onChange?.(option)}
              type="button"
            >
              {getOptionLabel(option)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ImageResultPanel({
  imageCount,
  isGenerating,
  onRegenerate,
  result,
}: {
  imageCount: number
  isGenerating: boolean
  onRegenerate: () => void
  result: ImageResult | null
}) {
  const imageUrls = result?.imageUrls?.length ? result.imageUrls : result?.imageUrl ? [result.imageUrl] : []
  const badgeClassName =
    result?.status === "部分完成"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : result?.status === "失败"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700"
  const handleDownload = () => {
    if (!result?.imageUrl) return

    const extension = getAssetExtension(result.imageUrl, "png")
    downloadAsset(result.imageUrl, `image-${result.id}.${extension}`)
  }

  if (isGenerating || result?.status === "生成中") {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">结果预览</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: imageCount }, (_, index) => (
            <div className="aspect-square animate-pulse rounded-lg bg-slate-100" key={index} />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在生成图片结果{result ? ` · ${result.progress}%` : ""}
        </div>
        {result?.taskId && <div className="mt-2 text-xs text-slate-400">任务 ID：{result.taskId}</div>}
      </div>
    )
  }

  if (!result) {
    return <PreviewPanel title="结果预览" label="输入提示词后点击开始生图" />
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">结果预览</h2>
        <Badge className={badgeClassName} variant="outline">
          <CheckCircle2 className="h-3 w-3" />
          {result.status}
        </Badge>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {imageUrls.length > 0 ? (
          <div className={imageUrls.length === 1 ? "grid gap-2" : "grid grid-cols-2 gap-2 p-2"}>
            {imageUrls.map((url, index) => (
              <ImageWithFallback
                alt={`${result.prompt} ${index + 1}`}
                className="aspect-square w-full rounded-md object-cover"
                fallbackClassName={`aspect-square rounded-md bg-gradient-to-br ${result.palette}`}
                key={`${url}-${index}`}
                src={url}
                showMessage
              />
            ))}
          </div>
        ) : (
          <div className={`aspect-square bg-gradient-to-br ${result.palette}`} />
        )}
        <div className="p-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{result.prompt}</div>
            <div className="truncate text-xs text-slate-500">
              {result.quality} · {result.ratio} · {result.imageCount} 张
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Button disabled={!result.imageUrl} onClick={handleDownload} variant="outline">
          <Download className="h-4 w-4" />
          下载结果
        </Button>
        <Button disabled={isGenerating} onClick={onRegenerate} variant="outline">
          <RotateCcw className="h-4 w-4" />
          重新生成
        </Button>
      </div>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
        <div className="font-medium text-slate-700">生成参数</div>
        <div className="mt-1">
          {result.model} · {result.quality} · {result.ratio} · {result.imageCount} 张
        </div>
        <div className="mt-1">任务 ID：{result.taskId}</div>
        {result.taskError && <div className="mt-1 text-amber-700">生成说明：{result.taskError}</div>}
      </div>
    </div>
  )
}

function VideoResultPanel({
  isGenerating,
  onRegenerate,
  result,
}: {
  isGenerating: boolean
  onRegenerate: () => void
  result: VideoResult | null
}) {
  const handleDownload = () => {
    if (!result?.videoUrl) return

    const extension = getAssetExtension(result.videoUrl, "mp4")
    downloadVideoDirect(result.videoUrl, `video-${result.id}.${extension}`)
  }

  if (isGenerating || result?.status === "生成中") {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">视频预览</h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
          <div className="flex aspect-video animate-pulse items-center justify-center bg-slate-900">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
          <div className="space-y-2 p-3">
            <div className="h-2 rounded-full bg-slate-700" />
            <div className="h-2 w-2/3 rounded-full bg-slate-800" />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在生成视频任务{result ? ` · ${result.progress}%` : ""}
        </div>
        {result?.taskId && <div className="mt-2 text-xs text-slate-400">任务 ID：{result.taskId}</div>}
      </div>
    )
  }

  if (!result) {
    return <PreviewPanel title="视频预览" label="输入提示词后点击开始生成视频" />
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">视频预览</h2>
        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700" variant="outline">
          <CheckCircle2 className="h-3 w-3" />
          {result.status}
        </Badge>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
        {result.videoUrl ? (
          <video className="aspect-video w-full bg-black" controls src={result.videoUrl} />
        ) : (
          <div className={`relative flex aspect-video items-center justify-center bg-gradient-to-br ${result.palette}`}>
            <div className="absolute left-3 top-3 rounded-md bg-black/40 px-2 py-1 text-xs text-white">
              {result.quality}
            </div>
            <button
              aria-label="播放视频预览"
              className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-white/90 text-indigo-700 shadow-sm transition hover:bg-white"
              type="button"
            >
              <Play className="ml-0.5 h-6 w-6 fill-current" />
            </button>
          </div>
        )}
        <div className="p-3 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{result.sceneTitle}</div>
              <div className="mt-1 truncate text-xs text-slate-300">
                {result.duration} · {result.quality} · {result.aspectRatio}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Button disabled={!result.videoUrl} onClick={handleDownload} variant="outline">
          <Download className="h-4 w-4" />
          下载结果
        </Button>
        <Button disabled={isGenerating} onClick={onRegenerate} variant="outline">
          <RotateCcw className="h-4 w-4" />
          重新生成
        </Button>
      </div>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
        <div className="font-medium text-slate-700">生成参数</div>
        <div className="mt-1">
          {result.model} · {result.duration} · {result.quality} · {result.aspectRatio}
        </div>
        <div className="mt-1">任务 ID：{result.taskId}</div>
        {result.taskError && <div className="mt-1 text-rose-600">失败原因：{result.taskError}</div>}
      </div>
    </div>
  )
}

function PreviewPanel({ title, label }: { title: string; label: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4 flex aspect-[4/3] items-center justify-center rounded-lg bg-slate-100">
        <div className="text-center text-slate-500">
          <Sparkles className="mx-auto h-8 w-8" />
          <p className="mt-2 text-sm">{label}</p>
        </div>
      </div>
    </div>
  )
}

function QuickEntryGrid({
  onSectionChange,
}: {
  onSectionChange: (section: WorkspaceSection) => void
}) {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <QuickEntry
        description="查看所有图片和视频任务"
        icon={History}
        label="历史项目"
        onClick={() => onSectionChange("history")}
      />
      <QuickEntry
        description="添加微信购买兑换码"
        icon={Coins}
        label="点数充值"
        onClick={() => onSectionChange("credits")}
      />
      <QuickEntry
        description="预留模型和接口配置"
        icon={Sparkles}
        label="模型接入"
        onClick={() => onSectionChange("credits")}
      />
    </section>
  )
}

function QuickEntry({
  description,
  icon: Icon,
  label,
  onClick,
}: {
  description: string
  icon: typeof Sparkles
  label: string
  onClick: () => void
}) {
  return (
    <button
      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-200 hover:bg-indigo-50"
      onClick={onClick}
      type="button"
    >
      <Icon className="h-5 w-5 text-indigo-600" />
      <div className="mt-3 font-medium">{label}</div>
      <div className="mt-1 text-sm text-slate-500">{description}</div>
    </button>
  )
}
