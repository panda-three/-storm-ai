import {
  apimartVeo31FastVideoModelName,
  grokVideo3ModelName,
  mengfactoryGeminiImageApiModelName,
} from "@/lib/model-options"
import type { GenerationResponse, NormalizedTaskStatus } from "@/lib/apimart"

const YUNWU_BASE_URL = process.env.YUNWU_BASE_URL ?? "https://yunwu.ai"

export interface YunwuReferenceImage {
  buffer: Buffer
  mimeType: string
}

export interface YunwuGeminiImageRequest {
  model: string
  prompt: string
  quality: string
  ratio: string
  referenceImages: YunwuReferenceImage[]
}

export interface YunwuGeneratedImage {
  buffer: Buffer
  mimeType: string
}

export interface YunwuGptImageRequest {
  imageCount?: number
  imageUrls?: string[]
  model: string
  prompt: string
  ratio: string
}

export interface YunwuVideoRequest {
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

export async function createYunwuGeminiImage(request: YunwuGeminiImageRequest): Promise<YunwuGeneratedImage> {
  const apiKey = getYunwuApiKey()
  const parts: Array<Record<string, unknown>> = [
    { text: request.prompt },
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
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: normalizeGeminiAspectRatio(request.ratio),
        imageSize: normalizeGeminiImageSize(request.quality),
      },
    },
  }
  const url = new URL(`/v1beta/models/${mengfactoryGeminiImageApiModelName}:generateContent`, YUNWU_BASE_URL)
  url.searchParams.set("key", apiKey)

  logYunwu("gemini image input", {
    model: request.model,
    promptLength: request.prompt.length,
    quality: request.quality,
    ratio: request.ratio,
    referenceImageCount: request.referenceImages.length,
  })

  const data = await yunwuJsonRequest(url, {
    method: "POST",
    body: JSON.stringify(payload),
  })
  const image = extractFirstGeneratedImage(data)

  logYunwu("gemini image output", {
    byteLength: image.buffer.byteLength,
    mimeType: image.mimeType,
  })

  return image
}

export async function createYunwuGptImages(request: YunwuGptImageRequest) {
  const imageCount = normalizeImageCount(request.imageCount)
  const payload = {
    model: request.model,
    prompt: request.prompt,
    size: normalizeGptImageSize(request.ratio),
    n: imageCount,
    ...(request.imageUrls?.length ? { image: request.imageUrls } : {}),
  }

  logYunwu("gpt image input", {
    ...payload,
    image: request.imageUrls?.length ?? 0,
  })

  const data = await yunwuJsonRequest("/v1/images/generations", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  const imageUrls = extractMediaUrls(data, ["url", "image", "image_url", "image_urls", "data"], [
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "avif",
  ]).slice(0, imageCount)

  if (imageUrls.length === 0) {
    throw new Error("云雾 GPT 图片接口已返回，但没有找到生成图片地址。")
  }

  logYunwu("gpt image output", { imageUrls: imageUrls.length })
  return imageUrls
}

export async function createYunwuVideo(request: YunwuVideoRequest): Promise<GenerationResponse> {
  const apiModel = getYunwuVideoApiModel(request.model)
  const payload = {
    model: apiModel,
    prompt: request.prompt,
    aspect_ratio: request.aspectRatio,
    ...(apiModel === "veo3.1-fast"
      ? {
          enhance_prompt: true,
          enable_upsample: request.quality.trim().toUpperCase() !== "720P",
        }
      : {
          size: normalizeGrokVideoSize(request.quality),
        }),
    ...(request.imageUrls.length > 0 ? { images: request.imageUrls } : {}),
  }

  logYunwu("video create input", {
    ...payload,
    images: request.imageUrls.length,
  })

  const data = await yunwuJsonRequest("/v1/video/create", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  const taskId = findStringValue(data, ["id", "task_id", "taskId"])

  if (!taskId) {
    throw new Error("云雾视频接口未返回任务 ID。")
  }

  const result: GenerationResponse = {
    ok: true,
    mode: "yunwu",
    taskId,
    status: "submitted",
    type: "video",
  }

  logYunwu("video create output", result)
  return result
}

export async function getYunwuVideoTaskStatus(taskId: string): Promise<NormalizedTaskStatus> {
  const data = await yunwuJsonRequest(`/v1/video/query?id=${encodeURIComponent(taskId)}`, {
    method: "GET",
  })
  const statusText = findStringValue(data, ["status", "state", "task_status"])
  const status = normalizeYunwuStatus(statusText)
  const videoUrl =
    findStringValue(data, ["upsample_video_url", "video_url", "videoUrl"]) ||
    extractMediaUrls(data, ["video", "url", "output", "result"], ["mp4", "mov", "webm"])[0] ||
    ""
  const taskError = findStringValue(data, ["error", "message", "error_message", "reason", "fail_reason"])

  return {
    ok: true,
    mode: "yunwu",
    taskId,
    status,
    progress: status === "completed" || status === "failed" ? 100 : 0,
    imageUrls: [],
    videoUrl,
    taskError,
    raw: data,
  }
}

export function isYunwuRateLimitError(message: string) {
  const value = message.toLowerCase()
  return value.includes("request rate limit") || value.includes("rate limit") || value.includes("too many requests")
}

function getYunwuVideoApiModel(model: string) {
  if (model === apimartVeo31FastVideoModelName) return "veo3.1-fast"
  if (model === grokVideo3ModelName) return "grok-video-3"
  return model
}

function normalizeImageCount(value: number | undefined): number {
  if (value === undefined) return 1
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 1
}

function normalizeGeminiAspectRatio(ratio: string) {
  const value = ratio.trim()
  return value && value !== "默认" && value !== "auto" ? value : "1:1"
}

function normalizeGeminiImageSize(quality: string) {
  const value = quality.trim().toUpperCase()
  if (value === "4K") return "4K"
  if (value === "2K") return "2K"
  return "1K"
}

function normalizeGptImageSize(ratio: string) {
  const value = ratio.trim()
  if (!value || value === "auto" || value === "默认" || value === "1:1") return "1024x1024"
  const [width, height] = value.split(":").map((part) => Number.parseFloat(part))

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "1024x1024"
  }

  if (width > height) return "1536x1024"
  if (height > width) return "1024x1536"
  return "1024x1024"
}

function normalizeGrokVideoSize(quality: string) {
  return quality.trim().toUpperCase() === "480P" ? "480P" : "720P"
}

async function yunwuJsonRequest(pathOrUrl: string | URL, init: RequestInit) {
  const apiKey = getYunwuApiKey()
  const url = typeof pathOrUrl === "string" ? new URL(pathOrUrl, YUNWU_BASE_URL) : pathOrUrl
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(60000),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(describeYunwuError(response.status, data))
  }

  return data
}

function getYunwuApiKey() {
  const apiKey = process.env.YUNWU_API_KEY
  if (!apiKey) {
    throw new Error("缺少云雾 API Key，请配置 YUNWU_API_KEY。")
  }
  return apiKey
}

function extractFirstGeneratedImage(value: unknown): YunwuGeneratedImage {
  const inlineData = findInlineData(value)
  const data = typeof inlineData?.data === "string" ? inlineData.data : ""
  const mimeType =
    typeof inlineData?.mime_type === "string"
      ? inlineData.mime_type
      : typeof inlineData?.mimeType === "string"
        ? inlineData.mimeType
        : "image/png"

  if (!data) {
    throw new Error("云雾 Gemini 已返回结果，但没有找到生成图片数据。")
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

function normalizeYunwuStatus(status: string): NormalizedTaskStatus["status"] {
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

function describeYunwuError(status: number, data: unknown) {
  const message = findStringValue(data, ["message", "error", "details", "detail"])
  return message ? `云雾请求失败（${status}）：${message}` : `云雾请求失败（${status}）。`
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

function extractMediaUrls(value: unknown, preferredKeys: string[], extensions: string[]) {
  const keyedUrls = new Set<string>()
  collectKeyedUrls(value, keyedUrls, preferredKeys)

  const preferred = Array.from(keyedUrls).filter((url) => hasExtension(url, extensions))
  if (preferred.length > 0) return preferred

  const urls = new Set<string>()
  collectUrls(value, urls)
  return Array.from(urls).filter((url) => hasExtension(url, extensions))
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

function hasExtension(url: string, extensions: string[]) {
  const normalized = url.split("?")[0].toLowerCase()
  return extensions.some((extension) => normalized.endsWith(`.${extension}`))
}

function logYunwu(label: string, value: unknown) {
  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[Yunwu] ${label}`, value)
}
