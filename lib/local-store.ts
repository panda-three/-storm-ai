import type { ProjectItem } from "@/lib/project-history"

const STORAGE_KEY = "storm-ai-local-account-v1"

export interface CreditLedgerItem {
  amount: number
  code: string
  createdAt: string
  id: string
  type: "redeem" | "generate" | "refund"
}

export type MembershipTier = "vip" | "svip"

export interface LocalAccountData {
  creditBalance: number
  ledger: CreditLedgerItem[]
  membershipExpiresAt: string | null
  membershipFreeImageQualities: string[]
  membershipTier: MembershipTier | null
  mustChangePassword: boolean
  projects: ProjectItem[]
  redeemedCodes: string[]
  role: "user" | "admin"
  temporaryPasswordSetAt: string | null
  temporaryPasswordSetBy: string | null
  userId: string
}

export function createDefaultAccount(): LocalAccountData {
  return {
    creditBalance: 0,
    ledger: [],
    membershipExpiresAt: null,
    membershipFreeImageQualities: [],
    membershipTier: null,
    mustChangePassword: false,
    projects: [],
    redeemedCodes: [],
    role: "user",
    temporaryPasswordSetAt: null,
    temporaryPasswordSetBy: null,
    userId: `local_${Date.now().toString(36)}`,
  }
}

export function loadLocalAccount(): LocalAccountData {
  if (typeof window === "undefined") {
    return createDefaultAccount()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultAccount()

    return {
      ...createDefaultAccount(),
      ...(JSON.parse(raw) as Partial<LocalAccountData>),
    }
  } catch {
    return createDefaultAccount()
  }
}

export function saveLocalAccount(data: LocalAccountData) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}
