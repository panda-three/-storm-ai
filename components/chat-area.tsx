"use client"

import { type DragEvent, useEffect, useRef, useState } from "react"
import type { WorkspaceSection } from "@/lib/workspace-section"
import type { MembershipTier } from "@/lib/local-store"
import { generationRetentionNotice, type ProjectItem, type ProjectStatus, type ProjectType } from "@/lib/project-history"
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
import {
  maxReferenceImageBytes,
  maxReferenceImages,
  supportedReferenceImageTypes,
  type StoredReferenceImage,
} from "@/lib/reference-images"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertCircle,
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronDown,
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
  RectangleHorizontal,
  RotateCcw,
  Sparkles,
  Trash2,
  WalletCards,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatAreaProps {
  activeSection: WorkspaceSection
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
  WorkspaceSection,
  {
    title: string
    description: string
  }
> = {
  image: {
    title: "季风创绘工作台",
    description: "图片和视频生成合并输入。",
  },
  video: {
    title: "季风创绘工作台",
    description: "图片和视频生成合并输入。",
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

const imageDefaultRatioOption = "默认"
const imageCountOptions = ["1", "2", "3", "4"]
const imageCountDropdownOptions = [
  { label: "1 张", value: "1" },
  { label: "2 张", value: "2" },
  { label: "3 张", value: "3" },
  { label: "4 张", value: "4" },
]

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

async function uploadReferenceImagesForGeneration(referenceImages: ReferenceImage[], accessToken: string) {
  if (referenceImages.length === 0) return []

  const supabase = getSupabaseClient()
  if (!supabase) {
    throw new Error("Supabase 未配置。")
  }

  return Promise.all(
    referenceImages.map(async (image) => {
      const signResponse = await fetch("/api/uploads/reference-image", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: image.name,
          size: image.size,
          type: image.file.type,
        }),
      }).catch((error) => {
        throw new Error(`参考图上传准备失败：${getErrorMessage(error, "请检查网络连接。")}`)
      })
      const signData = await signResponse.json().catch(() => ({}))

      if (!signResponse.ok || !signData.ok) {
        throw new Error(getErrorMessage(signData, "参考图上传准备失败。"))
      }

      const bucket = typeof signData.bucket === "string" ? signData.bucket : ""
      const path = typeof signData.path === "string" ? signData.path : ""
      const token = typeof signData.token === "string" ? signData.token : ""

      if (!bucket || !path || !token) {
        throw new Error("参考图上传准备失败：服务端未返回有效上传凭证。")
      }

      const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, image.file, {
        contentType: image.file.type,
      })

      if (error) {
        throw new Error(`参考图上传失败：${error.message}`)
      }

      return {
        bucket,
        name: image.name,
        path,
        size: image.size,
        type: image.file.type,
      } satisfies StoredReferenceImage
    })
  )
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

function getNowLabel() {
  return new Date().toLocaleString("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  })
}

function getOptionLabel(option: string) {
  if (option === "Gemini 3.1 Flash Image Preview") return "Gemini3香蕉pro"
  if (option === "1") return "一张"
  if (option === "2") return "两张"
  if (option === "3") return "三张"
  if (option === "4") return "四张"

  return option === "auto" ? "默认" : option
}

function getPendingStageLabel(item: ProjectItem) {
  if (item.status === "失败") return "生成失败"
  if (item.status !== "生成中") return ""
  return item.stage || "智能创意中"
}

function parseImageCount(value: string) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : 1
}

type DropdownOption = {
  label: string
  value: string
}

function WorkspaceDropdown({
  className,
  icon: Icon,
  label,
  onChange,
  options,
  value,
}: {
  className?: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  onChange: (value: string) => void
  options: DropdownOption[]
  value: string
}) {
  const currentLabel = options.find((option) => option.value === value)?.label ?? label

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 shadow-[0_1px_0_rgba(15,23,42,0.03)] transition-colors hover:border-cyan-200 hover:bg-cyan-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          type="button"
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">{currentLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="z-50 min-w-[var(--radix-dropdown-menu-trigger-width)] rounded-2xl border border-slate-200 bg-white p-1 shadow-[0_20px_50px_rgba(15,23,42,0.14)]"
      >
        <DropdownMenuRadioGroup onValueChange={onChange} value={value}>
          {options.map((option) => (
            <DropdownMenuRadioItem
              className="cursor-pointer rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-950 data-[state=checked]:!bg-cyan-50 data-[state=checked]:!text-slate-950 data-[state=checked]:font-medium"
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

function ModeDropdown({
  mode,
  onChange,
}: {
  mode: "image" | "video"
  onChange: (mode: "image" | "video") => void
}) {
  const isImage = mode === "image"
  const Icon = isImage ? ImageIcon : Film

  return (
    <WorkspaceDropdown
      className="border-cyan-200 bg-cyan-50 text-cyan-700 hover:border-cyan-300 hover:bg-cyan-100/70"
      icon={Icon}
      label={isImage ? "图片生成" : "视频生成"}
      onChange={(value) => onChange(value as "image" | "video")}
      options={[
        { label: "图片生成", value: "image" },
        { label: "视频生成", value: "video" },
      ]}
      value={mode}
    />
  )
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

function ReferenceUploadCard({
  disabled,
  isActive,
  label,
  onClick,
}: {
  disabled?: boolean
  isActive?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        "group grid h-[116px] w-[68px] shrink-0 cursor-pointer place-items-center rounded-md border border-dashed bg-slate-50 text-slate-400 transition-colors hover:border-cyan-200 hover:bg-cyan-50/70 hover:text-cyan-600 disabled:cursor-not-allowed disabled:opacity-50 sm:h-[138px] sm:w-[76px] sm:-rotate-6",
        isActive ? "border-cyan-300 bg-cyan-50 text-cyan-600" : "border-slate-200"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="grid justify-items-center gap-2 text-center text-xs">
        <ImagePlus className="h-5 w-5" />
        <span className="hidden leading-tight sm:block">{label}</span>
      </span>
    </button>
  )
}

function UploadColumn({
  disabled,
  isActive,
  isGenerating,
  label,
  onClick,
  onRemove,
  referenceImages,
}: {
  disabled?: boolean
  isActive?: boolean
  isGenerating: boolean
  label: string
  onClick: () => void
  onRemove: (id: string) => void
  referenceImages: ReferenceImage[]
}) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <ReferenceUploadCard disabled={disabled} isActive={isActive} label={label} onClick={onClick} />
      {referenceImages.length > 0 && (
        <div className="grid max-h-28 gap-1 overflow-y-auto">
          {referenceImages.map((image, index) => (
            <div
              className="group relative h-10 w-10 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
              key={image.id}
            >
              <img alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" src={image.previewUrl} />
              <button
                aria-label={`移除参考图 ${index + 1}`}
                className="absolute right-0.5 top-0.5 grid h-4 w-4 cursor-pointer place-items-center rounded-full bg-slate-950/85 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                disabled={isGenerating}
                onClick={() => onRemove(image.id)}
                type="button"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="hidden max-w-24 text-center text-[11px] leading-4 text-slate-400 sm:block">
        {referenceImages.length}/{maxReferenceImages} 张
      </div>
    </div>
  )
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
          ? "mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          : "mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-700"
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
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
      正在加载价格配置...
    </div>
  )
}

function RetentionNotice() {
  return (
    <div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span>{generationRetentionNotice}</span>
    </div>
  )
}

interface ImageResult {
  clientRequestId?: string
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
  clientRequestId?: string
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
  retryAfterMs?: number
  taskError?: string
}

export function isLegacyUpstreamTaskId(taskId: string | undefined) {
  return Boolean(taskId?.startsWith("task_"))
}

function isOptimisticTaskId(taskId: string | undefined) {
  return Boolean(taskId?.startsWith("pending-"))
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

function getTaskRetryAfterMs(task: Pick<TaskStatusResponse, "retryAfterMs"> | null | undefined) {
  const retryAfterMs = Number(task?.retryAfterMs)
  if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return 0
  return Math.min(5 * 60 * 1000, Math.max(1000, retryAfterMs))
}

function getPendingTaskPollDelayMs(attempts: number, task?: TaskStatusResponse) {
  const retryAfterMs = getTaskRetryAfterMs(task)
  if (retryAfterMs > 0) return retryAfterMs

  if (attempts < 12) return 5000
  if (attempts < 28) return 15000
  return 30000
}

function getFailedTaskPollDelayMs(attempts: number, task?: TaskStatusResponse) {
  const retryAfterMs = getTaskRetryAfterMs(task)
  if (retryAfterMs > 0) return retryAfterMs

  return Math.min(5 * 60 * 1000, 15000 * 2 ** Math.min(attempts, 4))
}

function getMaxTaskPollAttempts(taskProjects: ProjectItem[]) {
  return taskProjects.some((item) => item.type === "视频") ? 160 : 72
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
    stage: status === "生成中" ? "智能创意中" : "",
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
    stage: status === "生成中" ? "智能创意中" : "",
    taskError,
  }
}

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
    const pendingProjects = projects.filter((project) => project.status === "生成中" && project.taskId && !isOptimisticTaskId(project.taskId))
    const projectsByTaskId = new Map<string, ProjectItem[]>()
    let active = true
    const timers: number[] = []

    pendingProjects.forEach((project) => {
      if (!project.taskId) return
      projectsByTaskId.set(project.taskId, [...(projectsByTaskId.get(project.taskId) ?? []), project])
    })

    projectsByTaskId.forEach((taskProjects, taskId) => {
      let attempts = 0
      const maxAttempts = getMaxTaskPollAttempts(taskProjects)
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
              taskProjects[0].type === "视频"
                ? resolveVideoTaskProject(task, taskProjects[0].previewUrl)
                : resolveImageTaskProject(task, taskProjects[0].previewUrl)

            if (resolved.status === "生成中") {
              if (attempts < maxAttempts) {
                timers.push(window.setTimeout(reconcile, getPendingTaskPollDelayMs(attempts, task)))
              }
              return
            }

            onProjectUpdate({
              ...taskProjects[0],
              status: resolved.status,
              imageUrls: "imageUrls" in resolved ? resolved.imageUrls : taskProjects[0].imageUrls,
              previewUrl: resolved.previewUrl,
              stage: resolved.stage,
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

            if (active && attempts < maxAttempts && !isLegacyUpstreamTaskId(taskId)) {
              timers.push(window.setTimeout(reconcile, getFailedTaskPollDelayMs(attempts)))
            }
          })
      }

      timers.push(window.setTimeout(reconcile, 5000))
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
      clientRequestId: result.clientRequestId,
      previewLabel: `${result.quality} · ${result.ratio} · ${result.imageCount} 张`,
      previewUrl: result.imageUrl,
      expectedCount: result.imageCount,
      ratio: result.ratio,
      stage: result.status === "生成中" ? "智能创意中" : "",
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
      expectedCount: 1,
      clientRequestId: result.clientRequestId,
      ratio: result.aspectRatio,
      stage: result.status === "生成中" ? "智能创意中" : "",
      taskId: result.taskId,
    })
  }

  return (
    <main className="relative z-10 flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 items-center justify-between px-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          {!sidebarOpen && (
            <Button
              aria-label="展开侧边栏"
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-2xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-950"
              onClick={onToggleSidebar}
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-slate-950 sm:text-base">{meta.title}</h1>
            <p className="hidden truncate text-sm text-slate-500 sm:block">{meta.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="hidden rounded-full border-cyan-200 bg-cyan-50 text-cyan-700 sm:inline-flex" variant="outline">
            余额 {creditBalance.toLocaleString()} 点
          </Badge>
          <Button
            className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
            size="sm"
            onClick={() => onSectionChange("credits")}
          >
            <Coins className="h-4 w-4" />
            充值
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-8">
        <div className="mx-auto grid max-w-[1460px] gap-5">
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
              onSectionChange={onSectionChange}
            />
          )}
          {activeSection === "video" && (
            <VideoWorkspace
              billingReady={billingReady}
              creditBalance={creditBalance}
              modelPricing={modelPricing}
              onAccountRefresh={onAccountRefresh}
              onSectionChange={onSectionChange}
              onVideoGenerated={handleVideoGenerated}
            />
          )}
          {activeSection === "history" && (
            <HistoryWorkspace
              items={projects}
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
  onSectionChange: (section: WorkspaceSection) => void
}) {
  const [prompt, setPrompt] = useState("")
  const [model, setModel] = useState(imageModelOptions[0])
  const imageSettings = imageModelSettings[model]
  const [quality, setQuality] = useState(imageSettings.qualities[1])
  const [ratio, setRatio] = useState(imageSettings.ratios[0])
  const [imageCount, setImageCount] = useState(imageCountOptions[2])
  const parsedImageCount = parseImageCount(imageCount)
  const ratioOptions = getImageRatiosForSelection(model, quality)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState("")
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
    event.dataTransfer.dropEffect = isGenerating || referenceImages.length >= maxReferenceImages ? "none" : "copy"
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
    const clientRequestId = crypto.randomUUID()
    const optimisticId = `pending-image-${Date.now()}`
    const resolvedRatio =
      ratio === imageDefaultRatioOption ? resolveReferenceImageRatio(referenceImages[0], ratioOptions) : ratio

    onImageGenerated({
      id: optimisticId,
      clientRequestId,
      prompt: trimmedPrompt,
      model,
      quality,
      ratio: resolvedRatio,
      createdAt: getNowLabel(),
      imageCount: parsedImageCount,
      imageUrl: "",
      imageUrls: [],
      palette: "from-cyan-100 via-sky-100 to-teal-100",
      status: "生成中",
      taskId: optimisticId,
      progress: 0,
      taskError: "",
    })
    onSectionChange("history")

    try {
      const accessToken = await getCurrentAccessToken()
      const storedReferenceImages = await uploadReferenceImagesForGeneration(referenceImages, accessToken)

      const response = await fetch("/api/generate/image", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        body: JSON.stringify({
          prompt: trimmedPrompt,
          model,
          quality,
          imageCount: parsedImageCount,
          clientRequestId,
          ratio: resolvedRatio,
          referenceImages: storedReferenceImages,
        }),
      }).catch((error) => {
        throw new Error(`生图接口请求失败：${getErrorMessage(error, "请检查本地服务或网络连接。")}`)
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data, "生图任务提交失败。"))
      }

      const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls.filter((url: unknown) => typeof url === "string") : []
      const isCompleted = (data.status === "completed" || data.status === "partial_completed") && imageUrls.length > 0
      const initialStatus: ProjectStatus =
        data.status === "partial_completed" && imageUrls.length > 0
          ? "部分完成"
          : data.status === "completed" && imageUrls.length > 0
            ? "已完成"
            : "生成中"
      const generatedResult: ImageResult = {
        id: typeof data.taskId === "string" && data.taskId ? data.taskId : optimisticId,
        clientRequestId: typeof data.clientRequestId === "string" ? data.clientRequestId : clientRequestId,
        prompt: trimmedPrompt,
        model,
        quality,
        ratio: resolvedRatio,
        createdAt: "刚刚",
        imageCount: parsedImageCount,
        imageUrl: imageUrls[0] ?? "",
        imageUrls,
        palette: "from-cyan-500 via-sky-400 to-indigo-300",
        status: initialStatus,
        taskId: data.taskId,
        progress: isCompleted ? 100 : 0,
        taskError: typeof data.taskError === "string" ? data.taskError : "",
      }

      onImageGenerated(generatedResult)
      onAccountRefresh().catch(() => undefined)
    } catch (error) {
      onImageGenerated({
        id: optimisticId,
        clientRequestId,
        prompt: trimmedPrompt,
        model,
        quality,
        ratio: resolvedRatio,
        createdAt: getNowLabel(),
        imageCount: parsedImageCount,
        imageUrl: "",
        imageUrls: [],
        palette: "from-rose-100 via-slate-100 to-amber-100",
        status: "失败",
        taskId: optimisticId,
        progress: 0,
        taskError: getErrorMessage(error, "生图任务提交失败。"),
      })
      setError(getErrorMessage(error, "生图任务提交失败。"))
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <>
      <section className="grid gap-5">
        <div className="mx-auto w-full max-w-[1120px]">
          <div className="mb-8 text-center">
            <h1 className="mt-12 text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
              开启你的 <span className="text-cyan-500">图片生成</span> 即刻造梦！
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-500">
              上传参考图，输入设计描述，选择当前项目已有参数后提交生成。
            </p>
          </div>

          <div
            className={cn(
              "mt-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] transition sm:p-6",
              isReferenceDragActive
                ? "border-cyan-300 ring-2 ring-cyan-200"
                : "border-slate-200"
            )}
            onDragEnter={handleReferenceDragEnter}
            onDragLeave={handleReferenceDragLeave}
            onDragOver={handleReferenceDragOver}
            onDrop={handleReferenceDrop}
          >
            <div className="flex min-h-[178px] gap-5">
              <input
                ref={referenceInputRef}
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                multiple
                onChange={(event) => handleReferenceImageChange(event.target.files)}
                type="file"
              />
              <UploadColumn
                disabled={isGenerating || referenceImages.length >= maxReferenceImages}
                isActive={isReferenceDragActive}
                label="添加参考图"
                onClick={() => referenceInputRef.current?.click()}
                referenceImages={referenceImages}
                onRemove={handleReferenceImageRemove}
                isGenerating={isGenerating}
              />

              <div className="flex min-w-0 flex-1 flex-col">
                <textarea
                  ref={promptRef}
                  value={prompt}
                  aria-invalid={error === "请先输入生图提示词。"}
                  onChange={(event) => handlePromptChange(event.target.value)}
                  className={cn(
                    "min-h-[116px] w-full resize-none bg-transparent text-xl leading-8 outline-none placeholder:text-slate-400 sm:text-[22px]",
                    error === "请先输入生图提示词。" ? "text-rose-700" : "text-slate-800"
                  )}
                  placeholder="描述你想生成的图片，例如：现代极简客餐厅，浅木色地板，隐藏灯带，适合小户型。"
                />

                <div className="mt-auto flex flex-col gap-3 border-t border-slate-100 pt-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <ModeDropdown mode="image" onChange={(nextMode) => onSectionChange(nextMode)} />
                    <WorkspaceDropdown
                      icon={Box}
                      label="生图模型"
                      onChange={(value) => {
                        const settings = imageModelSettings[value]
                        setModel(value)
                        setQuality(settings.qualities[1] ?? settings.qualities[0])
                        setRatio(settings.ratios[0])
                      }}
                      options={imageModelOptions.map((option) => ({
                        label: getOptionLabel(option),
                        value: option,
                      }))}
                      value={model}
                    />
                    <WorkspaceDropdown
                      icon={Sparkles}
                      label="图片清晰度"
                      onChange={setQuality}
                      options={imageSettings.qualities.map((option) => ({
                        label: option,
                        value: option,
                      }))}
                      value={quality}
                    />
                    <WorkspaceDropdown
                      icon={RectangleHorizontal}
                      label="图片比例"
                      onChange={setRatio}
                      options={ratioOptions.map((option) => ({
                        label: getOptionLabel(option),
                        value: option,
                      }))}
                      value={ratio}
                    />
                    <WorkspaceDropdown
                      icon={ImageIcon}
                      label="生成张数"
                      onChange={setImageCount}
                      options={imageCountDropdownOptions}
                      value={imageCount}
                    />
                  </div>

                  <button
                    aria-label={isGenerating ? "生成中" : "生成图片"}
                    className="inline-flex h-12 min-w-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
                    disabled={isGenerating || !billingReady || !currentPricing}
                    onClick={handleGenerate}
                    type="button"
                  >
                    {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
                    <span className="hidden sm:inline">{isGenerating ? "生成中..." : "生成图片"}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
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
          <RetentionNotice />
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button className="rounded-2xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950" variant="outline" onClick={() => onSectionChange("history")}>
              查看历史项目
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}

function VideoWorkspace({
  billingReady,
  creditBalance,
  modelPricing,
  onAccountRefresh,
  onVideoGenerated,
  onSectionChange,
}: {
  billingReady: boolean
  creditBalance: number
  modelPricing: ModelPricing[]
  onAccountRefresh: () => Promise<void>
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
    const clientRequestId = crypto.randomUUID()
    const optimisticId = `pending-video-${Date.now()}`

    onVideoGenerated({
      id: optimisticId,
      clientRequestId,
      prompt: trimmedPrompt,
      model,
      aspectRatio,
      duration,
      quality,
      createdAt: getNowLabel(),
      sceneTitle: trimmedPrompt.slice(0, 24) || "视频预览",
      palette: "from-slate-200 via-cyan-100 to-sky-100",
      status: "生成中",
      taskId: optimisticId,
      progress: 0,
      taskError: "",
      videoUrl: "",
    })
    onSectionChange("history")

    try {
      const accessToken = await getCurrentAccessToken()
      const storedReferenceImages = await uploadReferenceImagesForGeneration(referenceImages, accessToken)

      const response = await fetch("/api/generate/video", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        body: JSON.stringify({
          prompt: trimmedPrompt,
          model,
          duration,
          quality,
          aspectRatio,
          clientRequestId,
          referenceImages: storedReferenceImages,
        }),
      }).catch((error) => {
        throw new Error(`视频接口请求失败：${getErrorMessage(error, "请检查本地服务或网络连接。")}`)
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data, "视频任务提交失败。"))
      }

      const generatedResult: VideoResult = {
        id: typeof data.taskId === "string" && data.taskId ? data.taskId : optimisticId,
        clientRequestId: typeof data.clientRequestId === "string" ? data.clientRequestId : clientRequestId,
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

      onVideoGenerated(generatedResult)
      onAccountRefresh().catch(() => undefined)
    } catch (error) {
      onVideoGenerated({
        id: optimisticId,
        clientRequestId,
        prompt: trimmedPrompt,
        model,
        aspectRatio,
        duration,
        quality,
        createdAt: getNowLabel(),
        sceneTitle: trimmedPrompt.slice(0, 24) || "视频预览",
        palette: "from-rose-100 via-slate-100 to-amber-100",
        status: "失败",
        taskId: optimisticId,
        progress: 0,
        taskError: getErrorMessage(error, "视频任务提交失败。"),
        videoUrl: "",
      })
      setError(getErrorMessage(error, "视频任务提交失败。"))
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <>
      <section className="grid gap-5">
        <div className="mx-auto w-full max-w-[1120px]">
          <div className="mb-8 text-center">
            <h1 className="mt-12 text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
              开启你的 <span className="text-cyan-500">视频生成</span> 即刻造梦！
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-500">
              切换为视频生成后，保留模型、比例、时长和清晰度这些当前项目已有参数。
            </p>
          </div>

          <div
            className={cn(
              "mt-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] transition sm:p-6",
              isReferenceDragActive
                ? "border-cyan-300 ring-2 ring-cyan-200"
                : "border-slate-200"
            )}
            onDragEnter={handleReferenceDragEnter}
            onDragLeave={handleReferenceDragLeave}
            onDragOver={handleReferenceDragOver}
            onDrop={handleReferenceDrop}
          >
            <div className="flex min-h-[178px] gap-5">
              <input
                ref={referenceInputRef}
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                multiple
                onChange={(event) => handleReferenceImageChange(event.target.files)}
                type="file"
              />
              <UploadColumn
                disabled={isGenerating || referenceImages.length >= maxReferenceImages}
                isActive={isReferenceDragActive}
                label="添加参考图"
                onClick={() => referenceInputRef.current?.click()}
                referenceImages={referenceImages}
                onRemove={handleReferenceImageRemove}
                isGenerating={isGenerating}
              />

              <div className="flex min-w-0 flex-1 flex-col">
                <textarea
                  ref={promptRef}
                  value={prompt}
                  aria-invalid={error === "请先输入视频提示词。"}
                  onChange={(event) => handlePromptChange(event.target.value)}
                  className={cn(
                    "min-h-[116px] w-full resize-none bg-transparent text-xl leading-8 outline-none placeholder:text-slate-400 sm:text-[22px]",
                    error === "请先输入视频提示词。" ? "text-rose-700" : "text-slate-800"
                  )}
                  placeholder="描述你想生成的视频，例如：从客厅入口推进到餐厅，镜头平稳，展示灯光和材质。"
                />

                <div className="mt-auto flex flex-col gap-3 border-t border-slate-100 pt-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <ModeDropdown mode="video" onChange={(nextMode) => onSectionChange(nextMode)} />
                    <WorkspaceDropdown
                      icon={Box}
                      label="视频模型"
                      onChange={(value) => {
                        const settings = videoModelSettings[value]
                        setModel(value)
                        setDuration(settings.durations[0])
                        setQuality(settings.qualities[0])
                        setAspectRatio(settings.aspectRatios[0])
                      }}
                      options={videoModelOptions.map((option) => ({
                        label: getOptionLabel(option),
                        value: option,
                      }))}
                      value={model}
                    />
                    <WorkspaceDropdown
                      icon={Film}
                      label="视频时长"
                      onChange={setDuration}
                      options={modelSettings.durations.map((option) => ({
                        label: option,
                        value: option,
                      }))}
                      value={duration}
                    />
                    <WorkspaceDropdown
                      icon={RectangleHorizontal}
                      label="视频比例"
                      onChange={setAspectRatio}
                      options={modelSettings.aspectRatios.map((option) => ({
                        label: option,
                        value: option,
                      }))}
                      value={aspectRatio}
                    />
                    <WorkspaceDropdown
                      icon={Sparkles}
                      label="视频清晰度"
                      onChange={setQuality}
                      options={modelSettings.qualities.map((option) => ({
                        label: option,
                        value: option,
                      }))}
                      value={quality}
                    />
                  </div>

                  <button
                    aria-label={isGenerating ? "生成中" : "生成视频"}
                    className="inline-flex h-12 min-w-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
                    disabled={isGenerating || !billingReady || !currentPricing}
                    onClick={handleGenerate}
                    type="button"
                  >
                    {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
                    <span className="hidden sm:inline">{isGenerating ? "生成中..." : "生成视频"}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
          {billingReady ? <PricingNotice estimatedCredits={estimatedCredits} /> : <PricingLoadingNotice />}
          <RetentionNotice />
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button className="rounded-2xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950" variant="outline" onClick={() => onSectionChange("history")}>
              查看历史项目
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>
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
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_14px_38px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-cyan-600" />
              <h2 className="text-base font-semibold text-slate-950">历史项目</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">统一查看本次会话中的生图和视频生成记录。</p>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{generationRetentionNotice}</span>
            </div>
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
                className={
                  filter === item
                    ? "bg-slate-950 text-white hover:bg-slate-800"
                    : "bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                }
                variant={filter === item ? "default" : "outline"}
              >
                {item}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {filteredItems.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-slate-50 p-8 text-center">
              <History className="mx-auto h-8 w-8 text-slate-400" />
              <div className="mt-3 text-sm font-medium text-slate-600">暂无历史项目</div>
              <div className="mt-1 text-xs text-slate-500">生成图片或视频后会出现在这里。</div>
            </div>
          ) : (
            filteredItems.map((item) => (
              <button
                className={
                  selectedItem?.id === item.id
                    ? "cursor-pointer rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-left text-slate-950"
                    : "cursor-pointer rounded-lg border border-slate-200 bg-white p-4 text-left text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                }
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                type="button"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProjectPreviewThumb item={item} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-950">{item.title}</div>
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
  const isPending = item.status === "生成中" && !item.previewUrl

  return (
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
      {isPending ? (
        <div className="grid h-full w-full place-items-center bg-gradient-to-br from-sky-100 via-cyan-50 to-teal-100">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-600" />
        </div>
      ) : item.previewUrl && item.type === "生图" ? (
        <ImageWithFallback
          alt={item.title}
          className="h-full w-full object-cover"
        fallbackClassName={`h-full w-full bg-gradient-to-br ${item.palette ?? "from-slate-800 to-slate-600"}`}
          fallbackIconClassName="h-5 w-5"
          src={item.previewUrl}
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${
            item.palette ?? "from-slate-800 to-slate-600"
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

function PendingResultPreview({ item }: { item: ProjectItem }) {
  const stageLabel = getPendingStageLabel(item)
  const expectedCount = item.type === "生图" ? Math.max(1, Math.min(4, item.expectedCount ?? 1)) : 1
  const slots = Array.from({ length: expectedCount })

  if (item.type === "视频") {
    return (
      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-gradient-to-br from-sky-100 via-cyan-50 to-teal-100">
        <div className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.62)_45%,rgba(255,255,255,0)_70%)]" />
        <div className="relative grid justify-items-center gap-3 text-cyan-700">
          <Loader2 className="h-8 w-8 animate-spin" />
          <div className="rounded-full bg-white/70 px-3 py-1 text-sm font-medium shadow-sm">{stageLabel}</div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("grid gap-0.5 bg-white p-0.5", expectedCount === 1 ? "grid-cols-1" : expectedCount === 2 ? "grid-cols-2" : "grid-cols-2")}>
      {slots.map((_, index) => (
        <div
          className="relative aspect-square overflow-hidden bg-gradient-to-br from-sky-100 via-cyan-50 to-teal-100"
          key={index}
        >
          <div className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.58)_45%,rgba(255,255,255,0)_70%)]" />
          {index === 0 && (
            <div className="absolute left-3 top-3 rounded-full bg-white/75 px-3 py-1 text-sm font-medium text-cyan-700 shadow-sm">
              {stageLabel}
            </div>
          )}
        </div>
      ))}
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
          ? "border-cyan-200 bg-cyan-50 text-cyan-700"
          : status === "部分完成"
            ? "border-amber-200 bg-amber-50 text-amber-700"
          : status === "生成中"
            ? "border-cyan-200 bg-cyan-50 text-cyan-700"
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
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_14px_38px_rgba(15,23,42,0.06)]">
        <h2 className="text-base font-semibold text-slate-950">项目详情</h2>
        <div className="mt-4 flex aspect-[4/3] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-center text-sm text-slate-500">
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
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_14px_38px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">项目详情</h2>
        <StatusBadge status={item.status} />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {item.status === "生成中" && !item.previewUrl ? (
          <PendingResultPreview item={item} />
        ) : imageUrls.length > 0 && item.type === "生图" ? (
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
                className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-slate-950 text-white transition hover:bg-slate-800"
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
          <div className="text-sm font-medium text-slate-950">{item.title}</div>
          <div className="mt-1 text-xs text-slate-500">
            {item.type} · {item.time}
            {item.previewLabel ? ` · ${item.previewLabel}` : ""}
          </div>
        </div>
        <DetailRow label="模型" value={item.model ?? "未记录"} />
        {item.status === "生成中" && <DetailRow label="当前阶段" value={getPendingStageLabel(item)} />}
        <DetailRow label="任务 ID" value={item.taskId ?? "示例项目无任务 ID"} />
        {item.taskError && <DetailRow label="失败原因" value={item.taskError} />}
        <DetailRow label="提示词" value={item.prompt ?? "未记录提示词"} />
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <Button className="bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-950" disabled={!canUseResult} onClick={() => item.previewUrl && openAsset(item.previewUrl)} variant="outline">
          <Eye className="h-4 w-4" />
          查看结果
        </Button>
        <Button className="bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-950" disabled={!canUseResult} onClick={handleDownload} variant="outline">
          <Download className="h-4 w-4" />
          下载
        </Button>
        <Button className="bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-950" disabled={!prompt} onClick={() => copyText(prompt)} variant="outline">
          <Copy className="h-4 w-4" />
          复制提示词
        </Button>
        <Button className="bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-950" onClick={() => onSectionChange(item.type === "视频" ? "video" : "image")} variant="outline">
          <RotateCcw className="h-4 w-4" />
          重新生成
        </Button>
        {item.id.startsWith("seed-") ? (
          <Button className="bg-white text-slate-500 sm:col-span-2" disabled variant="outline">
            <Trash2 className="h-4 w-4" />
            示例项目不可删除
          </Button>
        ) : (
          <Button
            className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 sm:col-span-2"
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
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm text-slate-600">{value}</div>
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
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_14px_38px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-cyan-600" />
              <h2 className="text-base font-semibold text-slate-950">兑换 AI 点数</h2>
            </div>
            <p className="mt-2 text-sm text-slate-500">向客服购买兑换码后，在这里输入兑换码完成点数充值。</p>
          </div>
          <Badge className="border-cyan-200 bg-cyan-50 text-cyan-700" variant="outline">
            Supabase 兑换
          </Badge>
        </div>

        <div className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-cyan-800">
                <WalletCards className="h-4 w-4" />
                当前余额
              </div>
              <div className="mt-2 text-3xl font-semibold tracking-tight text-cyan-700">
                {creditBalance.toLocaleString()}
                <span className="ml-2 text-sm font-normal text-cyan-600">点</span>
              </div>
            </div>
            <div className="border-t border-cyan-200 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
              <div className="text-sm font-medium text-cyan-800">{getMembershipLabel(membershipTier)} 到期时间</div>
              <div className="mt-2 text-lg font-semibold text-cyan-700">
                {membershipExpiresAt ? formatMembershipExpiresAt(membershipExpiresAt) : "未开通"}
              </div>
              {membershipExpiresAt && !isMembershipActive(membershipTier, membershipExpiresAt) && (
                <div className="mt-1 text-xs text-rose-600">会员已过期</div>
              )}
              {isMembershipActive(membershipTier, membershipExpiresAt) && membershipFreeImageQualities.length > 0 && (
                <div className="mt-1 text-xs text-cyan-700">
                  生图免费：{membershipFreeImageQualities.join(" / ")}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-medium text-slate-600">Supabase 用户 ID</div>
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
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
            placeholder="请输入兑换码"
          />
          <Button className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={isRedeeming} onClick={handleRedeem}>
            {isRedeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isRedeeming ? "兑换中..." : "立即兑换"}
          </Button>
        </div>

        {feedback && (
          <div
            className={
              feedback.type === "success"
                ? "mt-4 flex items-center gap-2 rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-700"
                : "mt-4 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            }
          >
            {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {feedback.message}
          </div>
        )}

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-medium text-slate-600">点数套餐</div>
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
                  <div className="text-right font-semibold text-cyan-700">
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

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-medium text-slate-600">点数流水</div>
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
                  <div className={item.amount >= 0 ? "font-medium text-cyan-700" : "font-medium text-rose-600"}>
                    {item.amount >= 0 ? "+" : ""}
                    {item.amount.toLocaleString()} 点
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_14px_38px_rgba(15,23,42,0.06)]">
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-cyan-600" />
          <h2 className="text-base font-semibold text-slate-950">客服微信二维码</h2>
        </div>
        <div className="mt-5 flex aspect-square items-center justify-center rounded-lg border border-dashed bg-slate-50">
          {customerService.qrCodeUrl ? (
            <img
              alt="客服微信二维码"
              className="h-full w-full rounded-lg object-cover"
              src={customerService.qrCodeUrl}
            />
          ) : (
            <div className="text-center">
              <QrCode className="mx-auto h-16 w-16 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-600">二维码图片占位</p>
              <p className="mt-1 text-xs text-slate-500">请在管理员后台配置二维码 URL</p>
            </div>
          )}
        </div>
        <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-400">
          <div className="font-medium text-slate-700">购买流程</div>
          <div>1. 添加客服微信{customerService.wechatId ? `：${customerService.wechatId}` : "。"}</div>
          <div>2. 向客服购买 AI 点数兑换码。</div>
          <div>3. 回到本页输入兑换码并完成充值。</div>
          {customerService.description && <div className="pt-2 text-xs text-slate-500">{customerService.description}</div>}
        </div>
      </div>
    </section>
  )
}
