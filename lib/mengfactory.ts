import {
  getMengfactoryVeoVideoApiModel,
  isMengfactoryGeminiImageModel,
  isMengfactoryVeoVideoModel,
  mengfactoryGeminiImageApiModelName,
} from "@/lib/model-options"
import type { GenerationResponse, NormalizedTaskStatus } from "@/lib/apimart"

const MENGFACTORY_BASE_URL = process.env.MENGFACTORY_BASE_URL ?? "https://api.mengfactory.cn"

export interface MengfactoryReferenceImage {
  buffer: Buffer
  mimeType: string
}

export interface MengfactoryImageRequest {
  model: string
  prompt: string
  quality: string
  ratio: string
  referenceImages: MengfactoryReferenceImage[]
}

export interface MengfactoryGeneratedImage {
  buffer: Buffer
  mimeType: string
}

export interface MengfactoryVideoRequest {
  aspectRatio: string
  imageUrls: string[]
  model: string
  prompt: string
  quality: string
}

interface GeminiInlineData {
  data?: unknown
  mime_type?: unknown
  mimeType?: unknown
}

export function normalizeMengfactoryImageSize(quality: string) {
  const value = quality.trim().toUpperCase()
  if (value === "4K") return "4K"
  if (value === "2K") return "2K"
  if (value === "0.5K" || value === "512") return "512"
  return "1K"
}

export async function createMengfactoryImage(request: MengfactoryImageRequest): Promise<MengfactoryGeneratedImage> {
  if (!isMengfactoryGeminiImageModel(request.model)) {
    throw new Error("请选择有效的 MengFactory Gemini 生图模型。")
  }

  const apiKey = process.env.MENGFACTORY_API_KEY
  if (!apiKey) {
    throw new Error("缺少 MengFactory API Key，请配置 MENGFACTORY_API_KEY。")
  }

  const parts: Array<Record<string, unknown>> = [
    {
      text: request.prompt,
    },
    ...request.referenceImages.map((image) => ({
      inline_data: {
        mime_type: image.mimeType,
        data: image.buffer.toString("base64"),
      },
    })),
  ]
  const payload = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: request.ratio,
        imageSize: normalizeMengfactoryImageSize(request.quality),
      },
    },
  }
  const url = new URL(`/v1beta/models/${mengfactoryGeminiImageApiModelName}:generateContent`, MENGFACTORY_BASE_URL)
  url.searchParams.set("key", apiKey)

  logMengfactory("image input", {
    model: mengfactoryGeminiImageApiModelName,
    prompt: request.prompt,
    quality: request.quality,
    ratio: request.ratio,
    referenceImageCount: request.referenceImages.length,
  })

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(describeMengfactoryError(response.status, data))
  }

  const image = extractFirstGeneratedImage(data)
  logMengfactory("image output", {
    byteLength: image.buffer.byteLength,
    mimeType: image.mimeType,
  })
  return image
}

export async function createMengfactoryVideo(request: MengfactoryVideoRequest): Promise<GenerationResponse> {
  if (!isMengfactoryVeoVideoModel(request.model)) {
    throw new Error("请选择有效的 MengFactory VEO 视频模型。")
  }

  const apiKey = process.env.MENGFACTORY_API_KEY
  if (!apiKey) {
    throw new Error("缺少 MengFactory API Key，请配置 MENGFACTORY_API_KEY。")
  }

  const apiModel = getMengfactoryVeoVideoApiModel(request.quality)
  const payload = {
    model: apiModel,
    prompt: request.prompt,
    aspect_ratio: request.aspectRatio,
    enhance_prompt: true,
    enable_upsample: request.quality.trim().toUpperCase() !== "720P",
    ...(request.imageUrls.length > 0 ? { images: request.imageUrls } : {}),
  }

  logMengfactory("video create input", {
    ...payload,
    imageCount: request.imageUrls.length,
    images: request.imageUrls.length,
  })

  const data = await mengfactoryJsonRequest("/v1/video/create", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  const taskId = findStringValue(data, ["id", "task_id", "taskId"])

  if (!taskId) {
    throw new Error("MengFactory did not return a video task id")
  }

  const result: GenerationResponse = {
    ok: true,
    mode: "mengfactory",
    taskId,
    status: "submitted",
    type: "video",
  }

  logMengfactory("video create output", result)
  return result
}

export async function getMengfactoryVideoTaskStatus(taskId: string): Promise<NormalizedTaskStatus> {
  const apiKey = process.env.MENGFACTORY_API_KEY
  if (!apiKey) {
    return {
      ok: true,
      mode: "mock",
      taskId,
      status: "completed",
      progress: 100,
      imageUrls: [],
      videoUrl: "",
      taskError: "",
      raw: {},
    }
  }

  const path = `/v1/video/query?id=${encodeURIComponent(taskId)}`
  const data = await mengfactoryJsonRequest(path, { method: "GET" })
  const statusText = findStringValue(data, ["status", "state", "task_status"])
  const status = normalizeMengfactoryVideoStatus(statusText)
  const videoUrl = extractMediaUrls(data, ["video_url", "videoUrl", "video", "url", "output", "result"], [
    "mp4",
    "mov",
    "webm",
  ])[0] ?? ""
  const taskError = findStringValue(data, ["error", "message", "error_message", "reason", "fail_reason"])

  return {
    ok: true,
    mode: "mengfactory",
    taskId,
    status,
    progress: status === "completed" || status === "failed" ? 100 : 0,
    imageUrls: [],
    videoUrl,
    taskError,
    raw: data,
  }
}

async function mengfactoryJsonRequest(path: string, init: RequestInit) {
  const apiKey = process.env.MENGFACTORY_API_KEY
  if (!apiKey) {
    throw new Error("缺少 MengFactory API Key，请配置 MENGFACTORY_API_KEY。")
  }

  const url = new URL(path, MENGFACTORY_BASE_URL)
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(30000),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(describeMengfactoryError(response.status, data))
  }

  return data
}

function extractFirstGeneratedImage(value: unknown): MengfactoryGeneratedImage {
  const inlineData = findInlineData(value)
  const data = typeof inlineData?.data === "string" ? inlineData.data : ""
  const mimeType =
    typeof inlineData?.mime_type === "string"
      ? inlineData.mime_type
      : typeof inlineData?.mimeType === "string"
        ? inlineData.mimeType
        : "image/png"

  if (!data) {
    throw new Error("MengFactory 已返回结果，但没有找到生成图片数据。")
  }

  return {
    buffer: Buffer.from(data, "base64"),
    mimeType,
  }
}

function findInlineData(value: unknown): GeminiInlineData | null {
  if (!value || typeof value !== "object") return null

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findInlineData(item)
      if (found) return found
    }
    return null
  }

  const record = value as Record<string, unknown>
  const inlineData = record.inline_data ?? record.inlineData

  if (inlineData && typeof inlineData === "object") {
    const data = (inlineData as GeminiInlineData).data
    if (typeof data === "string" && data) {
      return inlineData as GeminiInlineData
    }
  }

  for (const nested of Object.values(record)) {
    const found = findInlineData(nested)
    if (found) return found
  }

  return null
}

function describeMengfactoryError(status: number, data: unknown) {
  const message = findStringValue(data, ["message", "error", "details", "detail"])
  return message ? `MengFactory 请求失败（${status}）：${message}` : `MengFactory 请求失败（${status}）。`
}

function findStringValue(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") return ""

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringValue(item, keys)
      if (found) return found
    }
    return ""
  }

  for (const [key, nested] of Object.entries(value)) {
    if (keys.includes(key) && typeof nested === "string") return nested
    const found = findStringValue(nested, keys)
    if (found) return found
  }

  return ""
}

function normalizeMengfactoryVideoStatus(status: string): NormalizedTaskStatus["status"] {
  const value = status.toLowerCase()

  if (["success", "succeeded", "completed", "complete", "done", "finish", "finished"].includes(value)) {
    return "completed"
  }

  if (["failed", "fail", "error", "cancelled", "canceled"].includes(value)) {
    return "failed"
  }

  if (["queued", "pending", "submitted", "created"].includes(value)) {
    return "submitted"
  }

  return "processing"
}

function extractMediaUrls(value: unknown, preferredKeys: string[], extensions: string[]) {
  const keyedUrls = new Set<string>()
  collectKeyedUrls(value, keyedUrls, preferredKeys)

  const preferred = Array.from(keyedUrls)
  if (preferred.length > 0) return preferred

  const urls = new Set<string>()
  collectUrls(value, urls)
  return Array.from(urls).filter((url) => {
    const normalized = url.split("?")[0].toLowerCase()
    return extensions.some((extension) => normalized.endsWith(`.${extension}`))
  })
}

function collectKeyedUrls(value: unknown, urls: Set<string>, preferredKeys: string[]) {
  if (!value || typeof value !== "object") return

  if (Array.isArray(value)) {
    value.forEach((item) => collectKeyedUrls(item, urls, preferredKeys))
    return
  }

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase()

    if (preferredKeys.includes(normalizedKey)) {
      collectUrls(nested, urls)
      continue
    }

    collectKeyedUrls(nested, urls, preferredKeys)
  }
}

function collectUrls(value: unknown, urls: Set<string>) {
  if (!value) return

  if (typeof value === "string") {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      urls.add(value)
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, urls))
    return
  }

  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectUrls(item, urls))
  }
}

function logMengfactory(label: string, value: unknown) {
  console.log(`[MengFactory] ${label}`, value)
}
