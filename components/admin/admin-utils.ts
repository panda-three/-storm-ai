import { adminVideoModelOptions, imageModelOptions, imageModelSettings, videoModelSettings } from "@/lib/model-options"
import type { AdminAccountSummary, CreditPackage, ModelPricing } from "@/lib/supabase"

export const emptyPackageForm = {
  credits: 990,
  enabled: true,
  id: "",
  membership_duration_days: null,
  membership_free_image_qualities: [] as string[],
  membership_tier: null,
  name: "",
  package_type: "credits" as const,
  price_cny: 9.9,
  sort_order: 10,
}

export function getLedgerTypeLabel(type: AdminAccountSummary["ledger"][number]["type"]) {
  if (type === "redeem") return "充值"
  if (type === "generate") return "生成扣费"
  return "退款"
}

export function parseDurationSeconds(duration: string) {
  const parsed = Number.parseInt(duration, 10)
  return Number.isFinite(parsed) ? parsed : 8
}

export function formatDurationOption(durationSeconds: number | null) {
  return `${durationSeconds ?? 8} 秒`
}

export function normalizeCurrency(value: number) {
  return Math.round(value * 100) / 100
}

export function getPackageTypeLabel(
  pkg: Pick<
    CreditPackage,
    "package_type" | "credits" | "membership_duration_days" | "membership_free_image_qualities" | "membership_tier"
  >
) {
  if (pkg.package_type === "membership") {
    const tier = pkg.membership_tier === "svip" ? "SVIP" : "VIP"
    return `${tier} · ${pkg.membership_duration_days ?? 365} 天 · ${pkg.membership_free_image_qualities.join("/") || "生图"} 免费`
  }

  return `${pkg.credits.toLocaleString()} 点`
}

export function toggleQuality(qualities: string[], quality: string) {
  return qualities.includes(quality) ? qualities.filter((item) => item !== quality) : [...qualities, quality]
}

export function getDefaultPricingForm(type: "image" | "video"): Omit<ModelPricing, "id"> & { id?: string } {
  if (type === "video") {
    const model = adminVideoModelOptions[0]
    const settings = videoModelSettings[model]

    return {
      aspect_ratio: null,
      cost_cny: 1,
      duration_seconds: parseDurationSeconds(settings.durations[0]),
      enabled: true,
      id: "",
      markup: 2,
      model,
      quality: settings.qualities[0],
      type,
    }
  }

  const model = imageModelOptions[0]
  const settings = imageModelSettings[model]

  return {
    aspect_ratio: null,
    cost_cny: 1,
    duration_seconds: null,
    enabled: true,
    id: "",
    markup: 2,
    model,
    quality: settings.qualities[1],
    type,
  }
}
