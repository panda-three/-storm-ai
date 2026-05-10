import { isIP } from "node:net"
import { lookup } from "node:dns/promises"

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

    const response = await fetch(url, {
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
