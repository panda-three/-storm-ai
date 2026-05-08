import { NextResponse } from "next/server"

const fallbackFilename = "download"

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

  return new Response(response.body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeRFC5987ValueChars(filename)}`,
      "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
    },
    status: 200,
  })
}

function sanitizeFilename(filename: string) {
  const normalized = filename.replace(/[\\/:*?"<>|\r\n]+/g, "-").trim()

  return normalized || fallbackFilename
}

function encodeRFC5987ValueChars(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}
