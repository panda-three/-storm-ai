import https from "node:https"
import net from "node:net"
import tls from "node:tls"
import type { Duplex } from "node:stream"

const APIMART_BASE_URL = process.env.APIMART_BASE_URL ?? "https://api.apimart.ai/v1"
const APIMART_PROXY_URL = getApimartProxyUrl()

export type GenerationKind = "image" | "video"

export interface GenerationResponse {
  ok: true
  mode: "apimart" | "mock"
  taskId: string
  status: string
  type: GenerationKind
}

export interface NormalizedTaskStatus {
  ok: true
  mode: "apimart" | "mock"
  taskId: string
  status: "submitted" | "processing" | "completed" | "failed"
  progress: number
  imageUrls: string[]
  videoUrl: string
  taskError: string
  raw: unknown
}

interface ApimartImageRequest {
  model: string
  prompt: string
  size: string
  resolution: string
}

interface ApimartVideoRequest {
  model: string
  prompt: string
  duration: number
  quality: string
  aspectRatio: string
}

interface ApimartTaskResponse {
  code?: number
  data?: unknown
  message?: string
  error?: string
}

export const imageModelMap: Record<string, string> = {
  "Gemini Nano Banana Pro": "gemini-3-pro-image-preview",
  "GPT-Image-2": "gpt-image-2-official",
}

export const videoModelMap: Record<string, string> = {
  "Gemini Veo 3.1 Fast": "veo3.1-fast",
  "Gemini Veo 3.1 Quality": "veo3.1-quality",
  "Grok Imagine Video": "grok-imagine-1.0-video-apimart",
}

export function normalizeImageResolution(quality: string, model: string) {
  const value = quality === "超清" ? "4K" : quality === "高清" ? "2K" : "1K"

  if (model === "GPT-Image-2" || model === "gpt-image-2-official") {
    return value.toLowerCase()
  }

  return value
}

export function normalizeVideoDuration(duration: string) {
  const parsed = Number.parseInt(duration, 10)
  return Number.isFinite(parsed) ? parsed : 6
}

export function normalizeTaskId(data: unknown) {
  if (!data || typeof data !== "object") return ""

  if (Array.isArray(data)) {
    const first = data[0]
    if (first && typeof first === "object" && "task_id" in first) {
      return String(first.task_id)
    }
    return ""
  }

  if ("task_id" in data) return String(data.task_id)
  if ("id" in data) return String(data.id)

  return ""
}

export async function createImageGeneration(request: ApimartImageRequest): Promise<GenerationResponse> {
  const model = imageModelMap[request.model] ?? request.model
  const apiKey = process.env.APIMART_API_KEY

  if (!apiKey) {
    return mockGenerationResponse("image", model)
  }

  const response = await apimartFetch("/images/generations", {
    model,
    prompt: request.prompt,
    size: request.size,
    n: 1,
    resolution: request.resolution,
  })

  return normalizeGenerationResponse(response, "image")
}

export async function createVideoGeneration(request: ApimartVideoRequest): Promise<GenerationResponse> {
  const model = videoModelMap[request.model] ?? request.model
  const apiKey = process.env.APIMART_API_KEY

  if (!apiKey) {
    return mockGenerationResponse("video", model)
  }

  const payload =
    model === "grok-imagine-1.0-video-apimart"
      ? {
          model,
          prompt: request.prompt,
          size: request.aspectRatio,
          duration: request.duration,
          quality: request.quality,
        }
      : {
          model,
          prompt: request.prompt,
          duration: 8,
          aspect_ratio: request.aspectRatio,
          resolution: request.quality,
        }

  const response = await apimartFetch("/videos/generations", payload)

  return normalizeGenerationResponse(response, "video")
}

export async function getTaskStatus(taskId: string): Promise<NormalizedTaskStatus> {
  if (!process.env.APIMART_API_KEY || taskId.startsWith("mock_")) {
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

  const response = await apimartGet(`/tasks/${encodeURIComponent(taskId)}?language=zh`)
  return normalizeTaskStatus(taskId, response)
}

async function apimartFetch(path: string, body: Record<string, unknown>) {
  try {
    const data = await apimartRequest(path, "POST", body)

    if (data.code && data.code !== 200) {
      throw new Error(data.message ?? data.error ?? `APIMart request failed with code ${data.code}`)
    }

    return data
  } catch (error) {
    throw new Error(describeApimartError(error), { cause: error })
  }
}

async function apimartGet(path: string) {
  try {
    const data = await apimartRequest(path, "GET")

    if (data.code && data.code !== 200) {
      throw new Error(data.message ?? data.error ?? `APIMart request failed with code ${data.code}`)
    }

    return data
  } catch (error) {
    throw new Error(describeApimartError(error), { cause: error })
  }
}

function apimartRequest(path: string, method: "GET" | "POST", body?: Record<string, unknown>) {
  const targetUrl = new URL(`${APIMART_BASE_URL}${path}`)
  const payload = body ? JSON.stringify(body) : undefined
  const headers: Record<string, string | number> = {
    Authorization: `Bearer ${process.env.APIMART_API_KEY}`,
  }

  if (payload) {
    headers["Content-Type"] = "application/json"
    headers["Content-Length"] = Buffer.byteLength(payload)
  }

  return new Promise<ApimartTaskResponse>((resolve, reject) => {
    const requestOptions: https.RequestOptions = {
      method,
      hostname: targetUrl.hostname,
      port: Number(targetUrl.port || 443),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers,
      agent: APIMART_PROXY_URL ? new ConnectProxyAgent(APIMART_PROXY_URL) : undefined,
    }

    const request = https.request(requestOptions, (response) => {
      let raw = ""

      response.setEncoding("utf8")
      response.on("data", (chunk) => {
        raw += chunk
      })
      response.on("end", () => {
        try {
          const parsed = raw ? (JSON.parse(raw) as ApimartTaskResponse) : {}

          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(parsed.message ?? parsed.error ?? `APIMart request failed with ${response.statusCode}`))
            return
          }

          resolve(parsed)
        } catch {
          reject(new Error(`APIMart returned non-JSON response: ${raw.slice(0, 120)}`))
        }
      })
    })

    request.on("error", reject)
    request.setTimeout(30000, () => {
      request.destroy(new Error("APIMart request timed out"))
    })

    if (payload) request.write(payload)
    request.end()
  })
}

function getApimartProxyUrl() {
  const proxyUrl = process.env.APIMART_PROXY_URL?.trim()

  if (!proxyUrl) return ""

  const isLocalProxy =
    proxyUrl.includes("127.0.0.1") ||
    proxyUrl.includes("localhost") ||
    proxyUrl.includes("[::1]")

  if (isLocalProxy && (process.env.VERCEL || process.env.NODE_ENV === "production")) {
    return ""
  }

  return proxyUrl
}

class ConnectProxyAgent extends https.Agent {
  private proxyUrl: URL

  constructor(proxyUrl: string) {
    super()
    this.proxyUrl = new URL(proxyUrl)
  }

  createConnection(
    options: https.RequestOptions,
    callback?: (error: Error | null, socket: Duplex) => void
  ) {
    const targetHost = String(options.host ?? options.hostname)
    const targetPort = Number(options.port ?? 443)
    const proxySocket = net.connect(Number(this.proxyUrl.port || 80), this.proxyUrl.hostname)

    proxySocket.once("connect", () => {
      proxySocket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`
      )
    })

    proxySocket.once("error", (error) => callback?.(error, proxySocket))
    proxySocket.once("data", (chunk) => {
      const response = chunk.toString("utf8")

      if (!response.includes("200")) {
        callback?.(new Error(`Proxy CONNECT failed: ${response.split("\r\n")[0]}`), proxySocket)
        proxySocket.destroy()
        return
      }

      const tlsSocket = tls.connect({
        socket: proxySocket,
        servername: targetHost,
      })

      tlsSocket.once("secureConnect", () => callback?.(null, tlsSocket))
      tlsSocket.once("error", (error) => callback?.(error, tlsSocket))
    })

    return undefined
  }
}

function describeApimartError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const cause = error instanceof Error && error.cause ? String(error.cause) : ""
  const proxyUrl =
    APIMART_PROXY_URL ??
    process.env.HTTPS_PROXY ??
    process.env.HTTP_PROXY ??
    process.env.https_proxy ??
    process.env.http_proxy ??
    process.env.ALL_PROXY ??
    process.env.all_proxy ??
    ""
  const details = [message, cause].filter(Boolean).join(" ")

  if (
    (details.includes("ECONNREFUSED") || details.includes("EPERM")) &&
    (details.includes("127.0.0.1:7890") || proxyUrl.includes("127.0.0.1:7890"))
  ) {
    return "无法连接 APIMart：当前服务端请求被代理到 127.0.0.1:7890，但该代理不可用。请确认代理客户端已启动，或把 .env.local 的 APIMART_PROXY_URL 改成你实际可用的代理地址。"
  }

  if (details.includes("ENOTFOUND") || details.includes("Could not resolve")) {
    return "无法连接 APIMart：服务端无法解析 api.apimart.ai，请检查 DNS 或网络代理。"
  }

  if (details.includes("ECONNREFUSED")) {
    return "无法连接 APIMart：网络连接被拒绝，请检查代理或防火墙设置。"
  }

  if (details.includes("fetch failed")) {
    return `无法连接 APIMart：服务端请求失败。${details}`
  }

  return details || message
}

function normalizeGenerationResponse(response: ApimartTaskResponse, type: GenerationKind): GenerationResponse {
  const taskId = normalizeTaskId(response.data)

  if (!taskId) {
    throw new Error("APIMart did not return a task id")
  }

  return {
    ok: true,
    mode: "apimart",
    taskId,
    status: "submitted",
    type,
  }
}

function normalizeTaskStatus(taskId: string, response: ApimartTaskResponse): NormalizedTaskStatus {
  const data = response.data
  const statusText = findStringValue(data, ["status", "state", "task_status"])
  const progress = findNumberValue(data, ["progress", "percentage"]) ?? (isCompletedStatus(statusText) ? 100 : 0)

  return {
    ok: true,
    mode: "apimart",
    taskId,
    status: normalizeStatus(statusText),
    progress,
    imageUrls: extractUrls(data, ["png", "jpg", "jpeg", "webp"]),
    videoUrl: extractUrls(data, ["mp4", "mov", "webm"])[0] ?? "",
    taskError: findStringValue(data, ["message", "error_message", "reason"]),
    raw: data,
  }
}

function normalizeStatus(status: string) {
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

function isCompletedStatus(status: string) {
  return normalizeStatus(status) === "completed"
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

function findNumberValue(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") return null

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNumberValue(item, keys)
      if (found !== null) return found
    }
    return null
  }

  for (const [key, nested] of Object.entries(value)) {
    if (keys.includes(key) && typeof nested === "number") return nested
    const found = findNumberValue(nested, keys)
    if (found !== null) return found
  }

  return null
}

function extractUrls(value: unknown, extensions: string[]): string[] {
  const urls = new Set<string>()

  collectUrls(value, urls)

  return Array.from(urls).filter((url) => {
    const normalized = url.split("?")[0].toLowerCase()
    return extensions.some((extension) => normalized.endsWith(`.${extension}`))
  })
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

function mockGenerationResponse(type: GenerationKind, model: string): GenerationResponse {
  return {
    ok: true,
    mode: "mock",
    taskId: `mock_${type}_${model}_${Date.now()}`,
    status: "submitted",
    type,
  }
}
