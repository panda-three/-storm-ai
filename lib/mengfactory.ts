import {
  getMengfactoryVeoVideoApiModel,
  isMengfactoryGeminiImageModel,
  isMengfactoryGptImage2Model,
  isMengfactoryVeoVideoModel,
  mengfactoryGeminiImageApiModelName,
  mengfactoryGptImage2ApiModelName,
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

export interface MengfactoryGptImageRequest {
  imageCount: number
  model: string
  prompt: string
  ratio: string
}

export interface MengfactoryGptGeneratedImage {
  buffer?: Buffer
  mimeType: string
  url?: string
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

export async function createMengfactoryGptImage(
  request: MengfactoryGptImageRequest
): Promise<MengfactoryGptGeneratedImage[]> {
  if (!isMengfactoryGptImage2Model(request.model)) {
    throw new Error("请选择有效的 MengFactory GPT 生图模型。")
  }

  const imageCount = normalizeMengfactoryGptImageCount(request.imageCount)
  const payload = {
    model: mengfactoryGptImage2ApiModelName,
    prompt: request.prompt,
    size: normalizeMengfactoryGptImageSize(request.ratio),
    n: imageCount,
  }

  logMengfactory("gpt image input", payload)

  const data = await mengfactoryJsonRequest("/v1/images/generations", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  const images = extractMengfactoryGptGeneratedImages(data).slice(0, imageCount)

  if (images.length === 0) {
    throw new Error("MengFactory 已返回结果，但没有找到生成图片。")
  }

  logMengfactory("gpt image output", {
    imageCount: images.length,
    urlCount: images.filter((image) => image.url).length,
    bufferCount: images.filter((image) => image.buffer).length,
  })
  return images
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

function extractMengfactoryGptGeneratedImages(value: unknown): MengfactoryGptGeneratedImage[] {
  const images: MengfactoryGptGeneratedImage[] = []
  const seen = new Set<string>()
  collectMengfactoryGptGeneratedImages(value, images, seen)
  return images
}

function collectMengfactoryGptGeneratedImages(
  value: unknown,
  images: MengfactoryGptGeneratedImage[],
  seen: Set<string>
) {
  if (!value) return

  if (typeof value === "string") {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      addGeneratedImage(images, seen, {
        mimeType: inferImageMimeType(value),
        url: value,
      })
      return
    }

    const decoded = decodeBase64Image(value)
    if (decoded) {
      addGeneratedImage(images, seen, decoded)
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectMengfactoryGptGeneratedImages(item, images, seen))
    return
  }

  if (typeof value !== "object") return

  const record = value as Record<string, unknown>
  for (const key of ["url", "image_url", "imageUrl"]) {
    const url = record[key]
    if (typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"))) {
      addGeneratedImage(images, seen, {
        mimeType: inferImageMimeType(url),
        url,
      })
    }
  }

  for (const key of ["b64_json", "b64Json", "base64", "image", "data"]) {
    const encoded = record[key]
    if (typeof encoded === "string") {
      const decoded = decodeBase64Image(encoded)
      if (decoded) {
        addGeneratedImage(images, seen, decoded)
      }
    }
  }

  Object.values(record).forEach((nested) => collectMengfactoryGptGeneratedImages(nested, images, seen))
}

function addGeneratedImage(
  images: MengfactoryGptGeneratedImage[],
  seen: Set<string>,
  image: MengfactoryGptGeneratedImage
) {
  const key = image.url ?? `${image.mimeType}:${image.buffer?.byteLength ?? 0}:${image.buffer?.subarray(0, 24).toString("base64") ?? ""}`
  if (seen.has(key)) return
  seen.add(key)
  images.push(image)
}

function decodeBase64Image(value: string): MengfactoryGptGeneratedImage | null {
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
  const mimeType = match?.[1]?.toLowerCase() ?? "image/png"
  const encoded = match?.[2] ?? value

  if (!looksLikeBase64(encoded)) return null

  try {
    const buffer = Buffer.from(encoded, "base64")
    if (buffer.byteLength === 0) return null
    return {
      buffer,
      mimeType,
    }
  } catch {
    return null
  }
}

function looksLikeBase64(value: string) {
  const normalized = value.trim()
  return normalized.length >= 64 && normalized.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
}

function inferImageMimeType(url: string) {
  const pathname = url.split("?")[0].toLowerCase()
  if (pathname.endsWith(".webp")) return "image/webp"
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg"
  if (pathname.endsWith(".gif")) return "image/gif"
  if (pathname.endsWith(".avif")) return "image/avif"
  return "image/png"
}

function normalizeMengfactoryGptImageCount(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 1
}

export function normalizeMengfactoryGptImageSize(ratio: string) {
  const value = ratio.trim().toLowerCase()
  if (value === "auto") return "auto"
  if (value === "1:1") return "1024x1024"

  const [width, height] = value.split(":").map(Number)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "auto"
  }

  return width >= height ? "1536x1024" : "1024x1536"
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
