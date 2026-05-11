import { isIP } from "node:net"
import { lookup } from "node:dns/promises"
import https from "node:https"
import net from "node:net"
import tls from "node:tls"
import { Readable, type Duplex } from "node:stream"

const APIMART_PROXY_URL = getApimartProxyUrl()

const privateIpv4Ranges = [
  { base: ipv4ToNumber("10.0.0.0"), mask: 8 },
  { base: ipv4ToNumber("100.64.0.0"), mask: 10 },
  { base: ipv4ToNumber("127.0.0.0"), mask: 8 },
  { base: ipv4ToNumber("169.254.0.0"), mask: 16 },
  { base: ipv4ToNumber("172.16.0.0"), mask: 12 },
  { base: ipv4ToNumber("192.0.0.0"), mask: 24 },
  { base: ipv4ToNumber("192.0.2.0"), mask: 24 },
  { base: ipv4ToNumber("192.168.0.0"), mask: 16 },
  { base: ipv4ToNumber("198.18.0.0"), mask: 15 },
  { base: ipv4ToNumber("198.51.100.0"), mask: 24 },
  { base: ipv4ToNumber("203.0.113.0"), mask: 24 },
  { base: ipv4ToNumber("224.0.0.0"), mask: 4 },
  { base: ipv4ToNumber("240.0.0.0"), mask: 4 },
]

const blockedHostnames = new Set(["localhost", "localhost.localdomain"])

export async function fetchSafeRemoteResource(input: string | URL, init: RequestInit = {}, options: { allowHttp?: boolean } = {}) {
  let url = parseSafeRemoteUrl(String(input), options)
  const maxRedirects = 5

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertSafeResolvedHost(url)

    const response = APIMART_PROXY_URL
      ? await fetchWithHttpsProxy(url, init)
      : await fetch(url, {
          ...init,
          redirect: "manual",
        })

    if (!isRedirectStatus(response.status)) {
      return response
    }

    const location = response.headers.get("location")
    await response.body?.cancel().catch(() => undefined)

    if (!location) {
      throw new Error("远程地址重定向无效。")
    }

    url = parseSafeRemoteUrl(new URL(location, url).toString(), options)
  }

  throw new Error("远程地址重定向次数过多。")
}

export function parseSafeRemoteUrl(value: string, { allowHttp = false } = {}) {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new Error("远程地址无效。")
  }

  if (url.username || url.password) {
    throw new Error("远程地址不能包含用户名或密码。")
  }

  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error("远程地址协议无效。")
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error("远程地址主机不可访问。")
  }

  return url
}

function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")

  if (!normalized || blockedHostnames.has(normalized) || normalized.endsWith(".localhost")) {
    return true
  }

  const ipType = isIP(normalized)
  if (ipType === 4) return isBlockedIpv4(normalized)
  if (ipType === 6) return isBlockedIpv6(normalized)

  return false
}

async function assertSafeResolvedHost(url: URL) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "")

  if (isIP(hostname)) {
    return
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(hostname, {
      all: true,
      verbatim: true,
    })
  } catch {
    throw new Error("远程地址主机不可解析。")
  }

  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedHostname(address))) {
    throw new Error("远程地址解析到不可访问地址。")
  }
}

function isRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function isBlockedIpv4(ip: string) {
  const value = ipv4ToNumber(ip)
  return privateIpv4Ranges.some(({ base, mask }) => {
    const shift = 32 - mask
    return (value >>> shift) === (base >>> shift)
  })
}

function isBlockedIpv6(ip: string) {
  const normalized = ip.toLowerCase()

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  )
}

function ipv4ToNumber(ip: string) {
  return ip.split(".").reduce((value, part) => (value << 8) + Number.parseInt(part, 10), 0) >>> 0
}

function fetchWithHttpsProxy(url: URL, init: RequestInit = {}) {
  const method = init.method ?? "GET"

  if (init.body) {
    throw new Error("代理下载暂不支持带请求体的远程请求。")
  }

  return new Promise<Response>((resolve, reject) => {
    const request = https.request(
      {
        method,
        hostname: url.hostname,
        port: Number(url.port || 443),
        path: `${url.pathname}${url.search}`,
        headers: normalizeRequestHeaders(init.headers),
        agent: new ConnectProxyAgent(APIMART_PROXY_URL),
      },
      (response) => {
        const headers = new Headers()

        Object.entries(response.headers).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            value.forEach((item) => headers.append(key, item))
          } else if (value !== undefined) {
            headers.set(key, String(value))
          }
        })

        resolve(
          new Response(method.toUpperCase() === "HEAD" ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>), {
            headers,
            status: response.statusCode ?? 200,
            statusText: response.statusMessage,
          })
        )
      }
    )

    const abort = () => {
      request.destroy(new Error("远程请求已取消。"))
    }

    if (init.signal?.aborted) {
      abort()
      return
    }

    init.signal?.addEventListener("abort", abort, { once: true })
    request.on("error", reject)
    request.setTimeout(30000, () => {
      request.destroy(new Error("远程请求超时。"))
    })
    request.end()
  })
}

function normalizeRequestHeaders(headers: HeadersInit | undefined) {
  const normalized: Record<string, string> = {}

  new Headers(headers).forEach((value, key) => {
    normalized[key] = value
  })

  return normalized
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
