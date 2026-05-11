import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { LocalAccountData, MembershipTier } from "@/lib/local-store"
import { isDeletedProjectItem } from "@/lib/project-history"

export type PackageType = "credits" | "membership"

export interface SupabaseAccountRow {
  credit_balance: number
  ledger: LocalAccountData["ledger"]
  membership_expires_at: string | null
  membership_free_image_qualities: string[] | null
  membership_tier: MembershipTier | null
  must_change_password: boolean
  projects: LocalAccountData["projects"]
  redeemed_codes: string[]
  role: "user" | "admin"
  temporary_password_set_at: string | null
  temporary_password_set_by: string | null
  user_id: string
  username: string | null
}

export interface CustomerServiceSettings {
  description: string
  qrCodeUrl: string
  wechatId: string
}

export interface CreditPackage {
  credits: number
  enabled: boolean
  id: string
  membership_duration_days: number | null
  membership_free_image_qualities: string[]
  membership_tier: MembershipTier | null
  name: string
  package_type: PackageType
  price_cny: number
  sort_order: number
}

export interface RedeemCode {
  code: string
  created_at: string
  credits: number
  membership_duration_days: number | null
  membership_free_image_qualities: string[]
  membership_tier: MembershipTier | null
  package_id: string | null
  package_type: PackageType
  price_cny: number
  status: "unused" | "used" | "disabled"
  used_at: string | null
  used_by: string | null
}

export interface ModelPricing {
  aspect_ratio: string | null
  cost_cny: number
  duration_seconds: number | null
  enabled: boolean
  id: string
  markup: number
  model: string
  quality: string | null
  type: "image" | "video"
}

export interface AdminAccountSummary {
  active_session_created_at: string | null
  active_session_device_label: string | null
  active_session_last_seen_at: string | null
  active_session_revoked_at: string | null
  active_session_revoked_reason: string | null
  credit_balance: number
  email: string | null
  email_confirmed_at: string | null
  ledger: LocalAccountData["ledger"]
  membership_expires_at: string | null
  membership_free_image_qualities: string[] | null
  membership_tier: MembershipTier | null
  must_change_password: boolean
  role: "user" | "admin"
  temporary_password_set_at: string | null
  temporary_password_set_by: string | null
  updated_at: string
  user_id: string
  username: string | null
}

export interface AdminAccountRow {
  credit_balance: number
  ledger: LocalAccountData["ledger"]
  membership_expires_at: string | null
  membership_free_image_qualities: string[] | null
  membership_tier: MembershipTier | null
  must_change_password: boolean
  role: "user" | "admin"
  temporary_password_set_at: string | null
  temporary_password_set_by: string | null
  updated_at: string
  user_id: string
  username: string | null
}

export interface RedeemResult {
  code: string
  credit_balance: number
  credits: number
  membership_expires_at?: string
  membership_free_image_qualities?: string[]
  membership_tier?: MembershipTier
}

const defaultCustomerServiceSettings: CustomerServiceSettings = {
  description: "联系客服购买兑换码后，在站内输入兑换码完成点数充值。",
  qrCodeUrl: "",
  wechatId: "",
}

let browserClient: SupabaseClient | null = null

export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) return null

  if (!browserClient) {
    browserClient = createClient(url, anonKey)
  }

  return browserClient
}

function getSupabaseAuthStorageKey() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return ""

  try {
    const projectRef = new URL(url).hostname.split(".")[0]
    return projectRef ? `sb-${projectRef}-auth-token` : ""
  } catch {
    return ""
  }
}

export async function clearSupabaseLocalSession(supabase = getSupabaseClient()) {
  if (!supabase) return

  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined)

  if (typeof window === "undefined") return

  const storageKey = getSupabaseAuthStorageKey()
  if (storageKey) {
    window.localStorage.removeItem(storageKey)
    window.sessionStorage.removeItem(storageKey)
  }
}

export function getSupabaseErrorMessage(error: unknown, fallback: string) {
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

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export function getDeviceLabel() {
  if (typeof navigator === "undefined") return "未知设备"

  const platform = navigator.platform || "未知系统"
  const browser = navigator.userAgent.includes("Edg/")
    ? "Edge"
    : navigator.userAgent.includes("Chrome/")
      ? "Chrome"
      : navigator.userAgent.includes("Safari/")
        ? "Safari"
        : navigator.userAgent.includes("Firefox/")
          ? "Firefox"
          : "浏览器"

  return `${browser} · ${platform}`.slice(0, 160)
}

export async function claimCurrentAuthSession() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 未配置。")

  const { error } = await supabase.rpc("claim_current_auth_session", {
    p_device_label: getDeviceLabel(),
  })

  if (error) throw error
}

export async function releaseCurrentAuthSession() {
  const supabase = getSupabaseClient()
  if (!supabase) return

  const { error } = await supabase.rpc("release_current_auth_session")
  if (error) throw error
}

export async function assertCurrentAuthSession() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 未配置。")

  const { error } = await supabase.rpc("assert_current_active_session")
  if (error) throw error
}

export async function revokeUserActiveSession(userId: string) {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 未配置。")

  const { error } = await supabase.rpc("admin_revoke_active_session", {
    p_reason: "admin_revoked",
    p_user_id: userId,
  })

  if (error) throw error
}

export async function loadSupabaseAccount(userId: string): Promise<SupabaseAccountRow | null> {
  const supabase = getSupabaseClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("user_accounts")
    .select("user_id, username, credit_balance, projects, ledger, redeemed_codes, role, membership_tier, membership_expires_at, membership_free_image_qualities, must_change_password, temporary_password_set_at, temporary_password_set_by")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) throw error

  return data as SupabaseAccountRow | null
}

export async function loadAdminAccounts(): Promise<AdminAccountSummary[]> {
  const supabase = getSupabaseClient()
  if (!supabase) return []

  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  const token = data.session?.access_token
  if (!token) return []

  const response = await fetch("/api/admin/users", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "加载用户列表失败。")
  }

  return (Array.isArray(payload.accounts) ? payload.accounts : []) as AdminAccountSummary[]
}

export async function saveSupabaseAccount(account: LocalAccountData) {
  const supabase = getSupabaseClient()
  if (!supabase) return

  const { error } = await supabase.rpc("save_user_projects", {
    p_projects: account.projects.filter((project) => isDeletedProjectItem(project) || !project.taskId),
  })

  if (error) throw error
}

export async function loadCustomerServiceSettings(): Promise<CustomerServiceSettings> {
  const supabase = getSupabaseClient()
  if (!supabase) return defaultCustomerServiceSettings

  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "customer_service")
    .maybeSingle()

  if (error) throw error

  return {
    ...defaultCustomerServiceSettings,
    ...((data?.value as Partial<CustomerServiceSettings> | null) ?? {}),
  }
}

export async function saveCustomerServiceSettings(settings: CustomerServiceSettings) {
  const supabase = getSupabaseClient()
  if (!supabase) return

  const { error } = await supabase.from("site_settings").upsert({
    key: "customer_service",
    value: settings,
    updated_at: new Date().toISOString(),
  })

  if (error) throw error
}

export async function loadCreditPackages({ includeDisabled = false } = {}): Promise<CreditPackage[]> {
  const supabase = getSupabaseClient()
  if (!supabase) return []

  let query = supabase
    .from("credit_packages")
    .select("id, name, price_cny, credits, enabled, sort_order, package_type, membership_tier, membership_duration_days, membership_free_image_qualities")
    .order("sort_order", { ascending: true })
    .order("price_cny", { ascending: true })

  if (!includeDisabled) {
    query = query.eq("enabled", true)
  }

  const { data, error } = await query

  if (error) throw error

  return (data ?? []) as CreditPackage[]
}

export async function saveCreditPackage(pkg: Omit<CreditPackage, "id"> & { id?: string }) {
  const supabase = getSupabaseClient()
  if (!supabase) return

  const { error } = await supabase.from("credit_packages").upsert({
    credits: pkg.credits,
    enabled: pkg.enabled,
    id: pkg.id || undefined,
    membership_duration_days: pkg.membership_duration_days,
    membership_free_image_qualities: pkg.membership_free_image_qualities,
    membership_tier: pkg.membership_tier,
    name: pkg.name,
    package_type: pkg.package_type,
    price_cny: pkg.price_cny,
    sort_order: pkg.sort_order,
    updated_at: new Date().toISOString(),
  })

  if (error) throw error
}

export async function loadRedeemCodes(): Promise<RedeemCode[]> {
  const supabase = getSupabaseClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("redeem_codes")
    .select("code, package_id, credits, price_cny, status, used_by, used_at, created_at, package_type, membership_tier, membership_duration_days, membership_free_image_qualities")
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) throw error

  return (data ?? []) as RedeemCode[]
}

export async function createRedeemCode(pkg: CreditPackage, code: string) {
  const supabase = getSupabaseClient()
  if (!supabase) return

  const normalizedCode = code.trim().toUpperCase()

  const { data: userData } = await supabase.auth.getUser()
  const { error } = await supabase.from("redeem_codes").insert({
    code: normalizedCode,
    credits: pkg.credits,
    created_by: userData.user?.id ?? null,
    membership_duration_days: pkg.membership_duration_days,
    membership_free_image_qualities: pkg.membership_free_image_qualities,
    membership_tier: pkg.membership_tier,
    package_id: pkg.id,
    package_type: pkg.package_type,
    price_cny: pkg.price_cny,
    status: "unused",
  })

  if (error) throw error
}

export async function redeemCreditCode(code: string): Promise<RedeemResult> {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 未配置。")

  const { data, error } = await supabase.rpc("redeem_credit_code", {
    p_code: code,
  })

  if (error) throw error

  return data as RedeemResult
}

export async function loadModelPricing({ includeDisabled = false } = {}): Promise<ModelPricing[]> {
  const supabase = getSupabaseClient()
  if (!supabase) return []

  let query = supabase
    .from("model_pricing")
    .select("id, model, type, quality, duration_seconds, aspect_ratio, cost_cny, markup, enabled")
    .order("type", { ascending: true })
    .order("model", { ascending: true })

  if (!includeDisabled) {
    query = query.eq("enabled", true)
  }

  const { data, error } = await query

  if (error) throw error

  return (data ?? []) as ModelPricing[]
}

export async function saveModelPricing(pricing: Omit<ModelPricing, "id"> & { id?: string }) {
  const supabase = getSupabaseClient()
  if (!supabase) return

  const { error } = await supabase.from("model_pricing").upsert({
    aspect_ratio: pricing.aspect_ratio || null,
    cost_cny: pricing.cost_cny,
    duration_seconds: pricing.duration_seconds,
    enabled: pricing.enabled,
    id: pricing.id || undefined,
    markup: pricing.markup,
    model: pricing.model,
    quality: pricing.quality || null,
    type: pricing.type,
    updated_at: new Date().toISOString(),
  })

  if (error) throw error
}

export function calculatePricingCredits(pricing: Pick<ModelPricing, "cost_cny" | "markup">) {
  return Math.ceil(pricing.cost_cny * pricing.markup * 100)
}
