import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { fetchSafeRemoteResource, parseSafeRemoteUrl } from "@/lib/safe-fetch-url"

export interface AuthenticatedRequestUser {
  token: string
  userId: string
}

let serviceClient: SupabaseClient | null = null
let userAuthClient: SupabaseClient | null = null

export function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error("缺少 Supabase 服务端环境变量：NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。")
  }

  if (!serviceClient) {
    serviceClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return serviceClient
}

function getSupabaseUserAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error("缺少 Supabase 认证环境变量：NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY。")
  }

  if (!userAuthClient) {
    userAuthClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return userAuthClient
}

export async function requireAuthenticatedUser(request: Request): Promise<AuthenticatedRequestUser> {
  const authorization = request.headers.get("authorization") ?? ""
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()

  if (!token) {
    throw new Error("请先登录后再生成。")
  }

  const supabase = getSupabaseUserAuthClient()
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    console.warn("[Supabase Auth] token verification failed", {
      message: error?.message,
      status: error?.status,
    })
    throw new Error("登录状态已失效，请重新登录。")
  }

  return {
    token,
    userId: data.user.id,
  }
}

export async function spendGenerationCredits({
  amount,
  reason,
  reference,
  userId,
}: {
  amount: number
  reason: string
  reference: string
  userId: string
}) {
  const { data, error } = await getSupabaseServerClient().rpc("spend_generation_credits", {
    p_amount: amount,
    p_reason: reason,
    p_reference: reference,
    p_user_id: userId,
  })

  if (error) {
    throw new Error(describeServerError(error, "扣点失败。"), { cause: error })
  }
  return data as { amount: number; credit_balance: number; reference: string }
}

export async function recordFreeGenerationUsage({
  reason,
  reference,
  userId,
}: {
  reason: string
  reference: string
  userId: string
}) {
  const { data, error } = await getSupabaseServerClient().rpc("record_free_generation_usage", {
    p_reason: reason,
    p_reference: reference,
    p_user_id: userId,
  })

  if (error) {
    throw new Error(describeServerError(error, "记录会员免费使用失败。"), { cause: error })
  }
  return data as { amount: number; credit_balance: number; reference: string }
}

export async function refundGenerationCredits({
  amount,
  reason,
  reference,
  userId,
}: {
  amount: number
  reason: string
  reference: string
  userId: string
}) {
  const { data, error } = await getSupabaseServerClient().rpc("refund_generation_credits", {
    p_amount: amount,
    p_reason: reason,
    p_reference: reference,
    p_user_id: userId,
  })

  if (error) {
    throw new Error(describeServerError(error, "退款失败。"), { cause: error })
  }
  return data as { amount: number; already_refunded?: boolean; credit_balance: number; reference: string }
}

export async function uploadGeneratedImage({
  buffer,
  contentType,
  userId,
}: {
  buffer: Buffer
  contentType: string
  userId: string
}) {
  const bucket = process.env.SUPABASE_GENERATED_IMAGES_BUCKET ?? "generated-images"
  const extension = contentType.includes("webp") ? "webp" : contentType.includes("jpeg") ? "jpg" : "png"
  const path = `users/${userId}/images/${Date.now()}-${crypto.randomUUID()}.${extension}`
  const supabase = getSupabaseServerClient()
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: false,
  })

  if (error) throw error

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  if (!data.publicUrl) {
    throw new Error("生成图片已上传，但未取得公开访问 URL。")
  }

  return {
    bucket,
    path,
    publicUrl: data.publicUrl,
  }
}

export function getGeneratedStorageObjectPath(publicUrl: string) {
  const bucket = process.env.SUPABASE_GENERATED_IMAGES_BUCKET ?? "generated-images"
  const marker = `/storage/v1/object/public/${bucket}/`
  const markerIndex = publicUrl.indexOf(marker)

  if (markerIndex === -1) return ""

  const path = decodeURIComponent(publicUrl.slice(markerIndex + marker.length).split("?")[0] ?? "")
  return path
}

export async function deleteGeneratedImageByPublicUrl(publicUrl: string) {
  const bucket = process.env.SUPABASE_GENERATED_IMAGES_BUCKET ?? "generated-images"
  const path = getGeneratedStorageObjectPath(publicUrl)
  if (!path) return

  const { error } = await getSupabaseServerClient().storage.from(bucket).remove([path])
  if (error) {
    console.warn("[Supabase Storage] generated image cleanup failed", {
      error: describeServerError(error, "清理生成图片失败。"),
      path,
    })
  }
}

const remoteImageMaxBytes = 25 * 1024 * 1024
const allowedRemoteImageContentTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"])

export async function persistRemoteGeneratedImage({
  sourceUrl,
  userId,
}: {
  sourceUrl: string
  userId: string
}) {
  let response: Response
  let parsedSourceUrl: URL

  try {
    parsedSourceUrl = parseSafeRemoteUrl(sourceUrl, { allowHttp: process.env.NODE_ENV !== "production" })
    response = await fetchSafeRemoteResource(
      parsedSourceUrl,
      {
        signal: AbortSignal.timeout(30000),
      },
      { allowHttp: process.env.NODE_ENV !== "production" }
    )
  } catch (error) {
    throw new Error(`生成图片地址不可访问：${describeServerError(error, "请求图片失败。")}`, { cause: error })
  }

  if (!response.ok) {
    throw new Error(`生成图片地址不可访问：HTTP ${response.status}。`)
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? ""
  if (!allowedRemoteImageContentTypes.has(contentType)) {
    throw new Error(`生成结果不是可用图片内容：${contentType || "未知类型"}。`)
  }

  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > remoteImageMaxBytes) {
    throw new Error("生成图片超过 25MB，无法保存到历史项目。")
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > remoteImageMaxBytes) {
    throw new Error("生成图片超过 25MB，无法保存到历史项目。")
  }

  const uploaded = await uploadGeneratedImage({
    buffer,
    contentType,
    userId,
  })
  return uploaded.publicUrl
}

export function describeServerError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message

  if (typeof error === "object" && error !== null) {
    const parts = ["message", "details", "hint", "code"]
      .map((key) => {
        const value = (error as Record<string, unknown>)[key]
        return typeof value === "string" && value ? value : ""
      })
      .filter(Boolean)

    if (parts.length > 0) return parts.join(" ")
  }

  if (typeof error === "string" && error) return error

  return fallback
}
