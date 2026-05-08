import { createClient, type SupabaseClient } from "@supabase/supabase-js"

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

  return data.publicUrl
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
