import type { ProjectItem } from "@/components/chat-area"

const STORAGE_KEY = "storm-ai-local-account-v1"

export interface CreditLedgerItem {
  amount: number
  code: string
  createdAt: string
  id: string
  type: "redeem"
}

export interface LocalAccountData {
  creditBalance: number
  ledger: CreditLedgerItem[]
  projects: ProjectItem[]
  redeemedCodes: string[]
  userId: string
}

export function createDefaultAccount(): LocalAccountData {
  return {
    creditBalance: 2680,
    ledger: [],
    projects: [],
    redeemedCodes: [],
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
