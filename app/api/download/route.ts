import { NextResponse } from "next/server"

const fallbackFilename = "download"
const maxImageDownloadBytes = 25 * 1024 * 1024
const allowedImageContentTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"])

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const assetUrl = requestUrl.searchParams.get("url")
  const filename = sanitizeFilename(requestUrl.searchParams.get("filename") ?? fallbackFilename)

  if (!assetUrl) {
    return NextResponse.json({ ok: false, error: "缺少下载地址。" }, { status: 400 })
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(assetUrl)
  } catch {
    return NextResponse.json({ ok: false, error: "下载地址无效。" }, { status: 400 })
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return NextResponse.json({ ok: false, error: "下载地址协议无效。" }, { status: 400 })
  }

  const response = await fetch(parsedUrl, { cache: "no-store" })

  if (!response.ok || !response.body) {
    return NextResponse.json({ ok: false, error: "下载资源获取失败。" }, { status: 502 })
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? ""
  if (!allowedImageContentTypes.has(contentType)) {
    await response.body.cancel().catch(() => undefined)
    return NextResponse.json({ ok: false, error: "站内下载仅支持图片资源，视频请使用直连下载。" }, { status: 415 })
  }

  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10)
  if (Number.isFinite(contentLength) && contentLength > maxImageDownloadBytes) {
    await response.body.cancel().catch(() => undefined)
    return NextResponse.json({ ok: false, error: "图片资源超过站内下载大小限制。" }, { status: 413 })
  }

  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeRFC5987ValueChars(filename)}`,
    "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
  })

  if (Number.isFinite(contentLength)) {
    headers.set("Content-Length", String(contentLength))
  }

  return new Response(limitResponseBody(response.body, maxImageDownloadBytes), {
    headers,
    status: 200,
  })
}

function limitResponseBody(body: ReadableStream<Uint8Array>, maxBytes: number) {
  let transferred = 0

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        transferred += chunk.byteLength

        if (transferred > maxBytes) {
          controller.error(new Error("图片资源超过站内下载大小限制。"))
          return
        }

        controller.enqueue(chunk)
      },
    })
  )
}

function sanitizeFilename(filename: string) {
  const normalized = filename.replace(/[\\/:*?"<>|\r\n]+/g, "-").trim()

  return normalized || fallbackFilename
}

function encodeRFC5987ValueChars(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}
