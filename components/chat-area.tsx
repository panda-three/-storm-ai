"use client"

import { useState } from "react"
import type { WorkspaceSection } from "@/app/page"
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
  ImageIcon,
  Loader2,
  Menu,
  Play,
  QrCode,
  RotateCcw,
  Sparkles,
  Trash2,
  WalletCards,
} from "lucide-react"

interface ChatAreaProps {
  activeSection: WorkspaceSection
  creditBalance: number
  ledger: Array<{
    amount: number
    code: string
    createdAt: string
    id: string
  }>
  onCreditBalanceChange: (balance: number) => void
  onLedgerAdd: (item: { amount: number; code: string }) => void
  onProjectAdd: (item: ProjectItem) => void
  onProjectDelete: (id: string) => void
  onProjectUpdate: (item: ProjectItem) => void
  onRedeemedCodesChange: (codes: string[]) => void
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

const imageModelOptions = ["Gemini Nano Banana Pro", "GPT-Image-2"]
const imageModelSettings: Record<
  string,
  {
    qualities: string[]
    ratios: string[]
  }
> = {
  "Gemini Nano Banana Pro": {
    qualities: ["标清", "高清", "超清"],
    ratios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
  },
  "GPT-Image-2": {
    qualities: ["标清", "高清", "超清"],
    ratios: ["1:1", "2:3", "3:2"],
  },
}
const videoModelOptions = ["Gemini Veo 3.1 Fast", "Gemini Veo 3.1 Quality", "Grok Imagine Video"]

const videoModelSettings: Record<
  string,
  {
    aspectRatios: string[]
    durations: string[]
    qualities: string[]
  }
> = {
  "Gemini Veo 3.1 Fast": {
    aspectRatios: ["16:9", "9:16"],
    durations: ["8 秒"],
    qualities: ["720p", "1080p"],
  },
  "Gemini Veo 3.1 Quality": {
    aspectRatios: ["16:9", "9:16"],
    durations: ["8 秒"],
    qualities: ["720p", "1080p"],
  },
  "Grok Imagine Video": {
    aspectRatios: ["16:9", "9:16", "1:1", "3:2", "2:3"],
    durations: ["6 秒", "10 秒", "15 秒", "30 秒"],
    qualities: ["720p"],
  },
}

const mockRedeemCodes: Record<string, number> = {
  STORM100: 100,
  STORM500: 500,
  STORM1000: 1000,
}

async function pollTask({
  intervalMs = 2500,
  maxAttempts = 80,
  onUpdate,
  taskId,
}: {
  intervalMs?: number
  maxAttempts?: number
  onUpdate: (task: TaskStatusResponse) => void
  taskId: string
}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 1200 : intervalMs))

    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`)
    const task = (await response.json()) as TaskStatusResponse

    if (!response.ok || !task.ok) {
      throw new Error(task.error ?? "任务状态查询失败。")
    }

    onUpdate(task)

    if (task.status === "completed" || task.status === "failed") {
      return
    }
  }

  throw new Error("任务轮询超时，请稍后在历史项目中查看。")
}

type ProjectType = "生图" | "视频"
type ProjectStatus = "已完成" | "生成中" | "失败"

export interface ProjectItem {
  id: string
  title: string
  type: ProjectType
  status: ProjectStatus
  time: string
  model?: string
  palette?: string
  prompt?: string
  previewLabel?: string
  previewUrl?: string
  taskId?: string
  taskError?: string
}

interface ImageResult {
  id: string
  prompt: string
  model: string
  quality: string
  ratio: string
  createdAt: string
  imageUrl: string
  palette: string
  status: ProjectStatus
  taskId: string
  progress: number
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
  status?: "submitted" | "processing" | "completed" | "failed"
  progress?: number
  imageUrls?: string[]
  videoUrl?: string
  error?: string
  taskError?: string
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
    previewLabel: "高清 · 16:9",
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
    previewLabel: "10 秒 · 1080p",
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
    previewLabel: "超清 · 3:4",
    prompt: "国风侠客角色设定，长袍，水墨背景",
  },
]

export function ChatArea({
  activeSection,
  creditBalance,
  ledger,
  onLedgerAdd,
  onCreditBalanceChange,
  onProjectAdd,
  onProjectDelete,
  onProjectUpdate,
  onRedeemedCodesChange,
  projects,
  redeemedCodes,
  sidebarOpen,
  onSectionChange,
  onToggleSidebar,
  userId,
}: ChatAreaProps) {
  const meta = sectionMeta[activeSection]

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
      previewLabel: `${result.quality} · ${result.ratio}`,
      previewUrl: result.imageUrl,
      taskId: result.taskId,
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
              onImageGenerated={handleImageGenerated}
              onProjectUpdated={onProjectUpdate}
              onSectionChange={onSectionChange}
            />
          )}
          {activeSection === "video" && (
            <VideoWorkspace
              onProjectUpdated={onProjectUpdate}
              onSectionChange={onSectionChange}
              onVideoGenerated={handleVideoGenerated}
            />
          )}
          {activeSection === "history" && (
            <HistoryWorkspace
              items={[...projects, ...seedHistoryItems]}
              onDeleteProject={onProjectDelete}
            />
          )}
          {activeSection === "credits" && (
            <CreditsWorkspace
              creditBalance={creditBalance}
              ledger={ledger}
              onLedgerAdd={onLedgerAdd}
              onCreditBalanceChange={onCreditBalanceChange}
              onRedeemedCodesChange={onRedeemedCodesChange}
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
  onImageGenerated,
  onProjectUpdated,
  onSectionChange,
}: {
  onImageGenerated: (result: ImageResult) => void
  onProjectUpdated: (item: ProjectItem) => void
  onSectionChange: (section: WorkspaceSection) => void
}) {
  const [prompt, setPrompt] = useState("")
  const [model, setModel] = useState(imageModelOptions[0])
  const imageSettings = imageModelSettings[model]
  const [quality, setQuality] = useState(imageSettings.qualities[1])
  const [ratio, setRatio] = useState(imageSettings.ratios[0])
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ImageResult | null>(null)

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim()

    if (!trimmedPrompt) {
      setError("请先输入生图提示词。")
      setResult(null)
      return
    }

    setError("")
    setIsGenerating(true)
    setResult(null)

    try {
      const response = await fetch("/api/generate/image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          model,
          quality,
          ratio,
        }),
      })
      const data = await response.json()

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "生图任务提交失败。")
      }

      const generatedResult: ImageResult = {
        id: `image-${Date.now()}`,
        prompt: trimmedPrompt,
        model,
        quality,
        ratio,
        createdAt: "刚刚",
        imageUrl: "",
        palette: "from-indigo-500 via-sky-400 to-emerald-300",
        status: "生成中",
        taskId: data.taskId,
        progress: 0,
      }

      setResult(generatedResult)
      onImageGenerated(generatedResult)
      pollTask({
        taskId: data.taskId,
        onUpdate: (task) => {
          const imageUrls = task.imageUrls ?? []
          const status = task.status === "failed" ? "失败" : task.status === "completed" ? "已完成" : "生成中"
          const nextResult: ImageResult = {
            ...generatedResult,
            status,
            progress: task.progress ?? generatedResult.progress,
            imageUrl: imageUrls[0] ?? generatedResult.imageUrl,
          }

          setResult(nextResult)
          onProjectUpdated({
            id: nextResult.id,
            title: nextResult.prompt.slice(0, 22) || "未命名生图任务",
            type: "生图",
            status,
            time: nextResult.createdAt,
            model: nextResult.model,
            palette: nextResult.palette,
            prompt: nextResult.prompt,
            previewLabel: `${nextResult.quality} · ${nextResult.ratio}`,
            previewUrl: nextResult.imageUrl,
            taskId: nextResult.taskId,
            taskError: task.taskError,
          })
        },
      }).catch((error) => {
        setError(error instanceof Error ? error.message : "任务状态查询失败。")
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : "生图任务提交失败。")
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
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="mt-4 min-h-36 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            placeholder="描述你想生成的画面，例如：未来感 AI 工作室，玻璃墙面，柔和灯光，产品级渲染..."
          />
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
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
            <OptionGroup label="图片比例" onChange={setRatio} options={imageSettings.ratios} selected={ratio} />
          </div>
          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button
              className="bg-indigo-600 text-white hover:bg-indigo-700"
              disabled={isGenerating}
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

        <ImageResultPanel isGenerating={isGenerating} result={result} />
      </section>
      <QuickEntryGrid onSectionChange={onSectionChange} />
    </>
  )
}

function VideoWorkspace({
  onProjectUpdated,
  onVideoGenerated,
  onSectionChange,
}: {
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

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim()

    if (!trimmedPrompt) {
      setError("请先输入视频提示词。")
      setResult(null)
      return
    }

    setError("")
    setIsGenerating(true)
    setResult(null)

    try {
      const response = await fetch("/api/generate/video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          model,
          duration,
          quality,
          aspectRatio,
        }),
      })
      const data = await response.json()

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "视频任务提交失败。")
      }

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
        taskId: data.taskId,
        onUpdate: (task) => {
          const status = task.status === "failed" ? "失败" : task.status === "completed" ? "已完成" : "生成中"
          const nextResult: VideoResult = {
            ...generatedResult,
            status,
            progress: task.progress ?? generatedResult.progress,
            taskError: task.taskError,
            videoUrl: task.videoUrl ?? "",
          }

          setResult(nextResult)
          onProjectUpdated({
            id: nextResult.id,
            title: nextResult.prompt.slice(0, 22) || "未命名视频任务",
            type: "视频",
            status,
            time: nextResult.createdAt,
            model: nextResult.model,
            palette: nextResult.palette,
            prompt: nextResult.prompt,
            previewLabel: `${nextResult.duration} · ${nextResult.quality} · ${nextResult.aspectRatio}`,
            previewUrl: nextResult.videoUrl,
            taskId: nextResult.taskId,
            taskError: nextResult.taskError,
          })
        },
      }).catch((error) => {
        setError(error instanceof Error ? error.message : "任务状态查询失败。")
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : "视频任务提交失败。")
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
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="mt-4 min-h-36 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            placeholder="描述你想生成的视频，例如：科技产品在黑色展台缓慢旋转，镜头推进，背景有流动光线..."
          />
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
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button
              className="bg-indigo-600 text-white hover:bg-indigo-700"
              disabled={isGenerating}
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

        <VideoResultPanel isGenerating={isGenerating} result={result} />
      </section>
      <QuickEntryGrid onSectionChange={onSectionChange} />
    </>
  )
}

type HistoryFilter = "全部" | ProjectType

function HistoryWorkspace({
  items,
  onDeleteProject,
}: {
  items: ProjectItem[]
  onDeleteProject: (id: string) => void
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

      <HistoryDetailPanel item={selectedItem} onDelete={handleDelete} />
    </section>
  )
}

function ProjectPreviewThumb({ item }: { item: ProjectItem }) {
  return (
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-slate-100">
      {item.previewUrl && item.type === "生图" ? (
        <img alt={item.title} className="h-full w-full object-cover" src={item.previewUrl} />
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

function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge
      className={
        status === "已完成"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
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
}: {
  item: ProjectItem | null
  onDelete: (id: string) => void
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

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">项目详情</h2>
        <StatusBadge status={item.status} />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
        {item.previewUrl && item.type === "生图" ? (
          <img alt={item.title} className="aspect-square w-full object-cover" src={item.previewUrl} />
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
        <Button variant="outline">
          <Eye className="h-4 w-4" />
          查看结果
        </Button>
        <Button variant="outline">
          <Download className="h-4 w-4" />
          下载
        </Button>
        <Button variant="outline">
          <Copy className="h-4 w-4" />
          复制提示词
        </Button>
        <Button variant="outline">
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
  ledger,
  onLedgerAdd,
  onCreditBalanceChange,
  onRedeemedCodesChange,
  redeemedCodes,
  userId,
}: {
  creditBalance: number
  ledger: Array<{
    amount: number
    code: string
    createdAt: string
    id: string
  }>
  onLedgerAdd: (item: { amount: number; code: string }) => void
  onCreditBalanceChange: (balance: number) => void
  onRedeemedCodesChange: (codes: string[]) => void
  redeemedCodes: string[]
  userId: string
}) {
  const [redeemCode, setRedeemCode] = useState("")
  const [feedback, setFeedback] = useState<RedeemFeedback>(null)

  const handleRedeem = () => {
    const normalizedCode = redeemCode.trim().toUpperCase()

    if (!normalizedCode) {
      setFeedback({
        type: "error",
        message: "请输入兑换码。",
      })
      return
    }

    if (redeemedCodes.includes(normalizedCode)) {
      setFeedback({
        type: "error",
        message: "该兑换码已在当前会话中使用。",
      })
      return
    }

    const amount = mockRedeemCodes[normalizedCode]

    if (!amount) {
      setFeedback({
        type: "error",
        message: "兑换码无效，请检查后重试。",
      })
      return
    }

    onCreditBalanceChange(creditBalance + amount)
    onRedeemedCodesChange([normalizedCode, ...redeemedCodes])
    onLedgerAdd({
      amount,
      code: normalizedCode,
    })
    setRedeemCode("")
    setFeedback({
      type: "success",
      message: `兑换成功，已增加 ${amount.toLocaleString()} 点。`,
    })
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
            Mock 兑换
          </Badge>
        </div>

        <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-950">
            <WalletCards className="h-4 w-4" />
            当前余额
          </div>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-emerald-700">
            {creditBalance.toLocaleString()}
            <span className="ml-2 text-sm font-normal text-emerald-800">点</span>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 p-4">
          <div className="text-sm font-medium text-slate-700">本地账户</div>
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
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={handleRedeem}>
            立即兑换
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
          <div className="text-sm font-medium text-slate-700">测试兑换码</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(mockRedeemCodes).map(([code, amount]) => (
              <button
                className="cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs transition hover:border-emerald-200 hover:bg-emerald-50"
                key={code}
                onClick={() => {
                  setRedeemCode(code)
                  setFeedback(null)
                }}
                type="button"
              >
                <span className="font-medium text-slate-700">{code}</span>
                <span className="ml-2 text-slate-500">+{amount} 点</span>
              </button>
            ))}
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
                    <div className="text-xs text-slate-500">{item.createdAt}</div>
                  </div>
                  <div className="font-medium text-emerald-700">+{item.amount.toLocaleString()} 点</div>
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
          <div className="text-center">
            <QrCode className="mx-auto h-16 w-16 text-slate-400" />
            <p className="mt-3 text-sm font-medium text-slate-700">二维码图片占位</p>
            <p className="mt-1 text-xs text-slate-500">替换为正式客服微信二维码</p>
          </div>
        </div>
        <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          <div className="font-medium text-slate-800">购买流程</div>
          <div>1. 添加客服微信。</div>
          <div>2. 向客服购买 AI 点数兑换码。</div>
          <div>3. 回到本页输入兑换码并完成充值。</div>
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
  return (
    <div>
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option, index) => {
          const isSelected = selected ? selected === option : index === 0

          return (
            <button
              className={
                isSelected
                  ? "cursor-pointer rounded-md border border-indigo-600 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700"
                  : "cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              }
              key={option}
              onClick={() => onChange?.(option)}
              type="button"
            >
              {option}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ImageResultPanel({
  isGenerating,
  result,
}: {
  isGenerating: boolean
  result: ImageResult | null
}) {
  if (isGenerating || result?.status === "生成中") {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">结果预览</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[1, 2, 3, 4].map((item) => (
            <div className="aspect-square animate-pulse rounded-lg bg-slate-100" key={item} />
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
        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700" variant="outline">
          <CheckCircle2 className="h-3 w-3" />
          {result.status}
        </Badge>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {result.imageUrl ? (
          <img alt={result.prompt} className="aspect-square w-full object-cover" src={result.imageUrl} />
        ) : (
          <div className={`aspect-square bg-gradient-to-br ${result.palette}`} />
        )}
        <div className="flex items-center justify-between gap-2 p-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{result.prompt}</div>
            <div className="truncate text-xs text-slate-500">
              {result.quality} · {result.ratio}
            </div>
          </div>
          <Button aria-label="下载图片" className="h-8 w-8" size="icon" variant="ghost">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
        <div className="font-medium text-slate-700">生成参数</div>
        <div className="mt-1">
          {result.model} · {result.quality} · {result.ratio}
        </div>
        <div className="mt-1">任务 ID：{result.taskId}</div>
      </div>
    </div>
  )
}

function VideoResultPanel({
  isGenerating,
  result,
}: {
  isGenerating: boolean
  result: VideoResult | null
}) {
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
            {result.videoUrl ? (
              <Button
                aria-label="下载视频"
                asChild
                className="h-8 w-8 text-white hover:bg-white/10"
                size="icon"
                variant="ghost"
              >
                <a href={result.videoUrl} rel="noreferrer" target="_blank">
                  <Download className="h-4 w-4" />
                </a>
              </Button>
            ) : (
              <Button aria-label="下载视频" className="h-8 w-8 text-white hover:bg-white/10" size="icon" variant="ghost">
                <Download className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
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
