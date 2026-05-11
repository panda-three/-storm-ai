"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowLeft, CheckCircle2 } from "lucide-react"
import { AuthPanel } from "@/components/auth-panel"
import { ForcedPasswordChange } from "@/components/forced-password-change"
import { Button } from "@/components/ui/button"
import { useAccountSession, getErrorMessage } from "@/hooks/use-account-session"
import {
  type AdminAccountSummary,
  type CreditPackage,
  type CustomerServiceSettings,
  type ModelPricing,
  type RedeemCode,
  loadAdminAccounts,
  loadCreditPackages,
  loadCustomerServiceSettings,
  loadModelPricing,
  loadRedeemCodes,
} from "@/lib/supabase"

type Feedback =
  | {
      message: string
      type: "success" | "error"
    }
  | null

interface AdminContextValue {
  adminAccounts: AdminAccountSummary[]
  creditPackages: CreditPackage[]
  customerService: CustomerServiceSettings
  feedback: Feedback
  modelPricing: ModelPricing[]
  redeemCodes: RedeemCode[]
  refreshAdminConfig: () => Promise<void>
  saving: boolean
  setCreditPackages: (packages: CreditPackage[]) => void
  setCustomerService: (settings: CustomerServiceSettings) => void
  setFeedback: (feedback: Feedback) => void
  setModelPricing: (pricing: ModelPricing[]) => void
  setSaving: (saving: boolean) => void
}

const AdminContext = createContext<AdminContextValue | null>(null)

export function useAdmin() {
  const context = useContext(AdminContext)
  if (!context) {
    throw new Error("useAdmin must be used inside AdminProvider")
  }
  return context
}

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const {
    account,
    accountStatus,
    authReady,
    refreshAccount,
    setSyncError,
    signOut,
    syncError,
    user,
    userId,
  } = useAccountSession()
  const [customerService, setCustomerService] = useState<CustomerServiceSettings>({
    description: "联系客服购买兑换码后，在站内输入兑换码完成点数充值。",
    qrCodeUrl: "",
    wechatId: "",
  })
  const [creditPackages, setCreditPackages] = useState<CreditPackage[]>([])
  const [adminAccounts, setAdminAccounts] = useState<AdminAccountSummary[]>([])
  const [modelPricing, setModelPricing] = useState<ModelPricing[]>([])
  const [redeemCodes, setRedeemCodes] = useState<RedeemCode[]>([])
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [saving, setSaving] = useState(false)
  const isAdmin = account?.role === "admin"
  const accountUserId = account?.userId ?? ""

  const refreshAdminConfig = useCallback(async () => {
    if (!userId || accountStatus !== "ready" || accountUserId !== userId || !isAdmin) {
      setAdminAccounts([])
      setRedeemCodes([])
      return
    }

    try {
      setSyncError("")
      const [settings, packages, pricing, codes, accounts] = await Promise.all([
        loadCustomerServiceSettings(),
        loadCreditPackages({ includeDisabled: true }),
        loadModelPricing({ includeDisabled: true }),
        loadRedeemCodes(),
        loadAdminAccounts(),
      ])
      setCustomerService(settings)
      setCreditPackages(packages)
      setModelPricing(pricing)
      setRedeemCodes(codes)
      setAdminAccounts(accounts)
    } catch (error) {
      setSyncError(getErrorMessage(error, "加载管理员后台数据失败。"))
    }
  }, [accountStatus, accountUserId, isAdmin, setSyncError, userId])

  useEffect(() => {
    refreshAdminConfig()
  }, [refreshAdminConfig])

  const value = useMemo(
    () => ({
      adminAccounts,
      creditPackages,
      customerService,
      feedback,
      modelPricing,
      redeemCodes,
      refreshAdminConfig,
      saving,
      setCreditPackages,
      setCustomerService,
      setFeedback,
      setModelPricing,
      setSaving,
    }),
    [adminAccounts, creditPackages, customerService, feedback, modelPricing, redeemCodes, refreshAdminConfig, saving]
  )

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] text-sm text-slate-500">
        正在加载账户...
      </div>
    )
  }

  if (!user) {
    return <AuthPanel onAuthed={() => undefined} />
  }

  if (accountStatus === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 text-slate-950">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 text-center shadow-sm">
          <h1 className="text-base font-semibold">账户加载失败</h1>
          <p className="mt-2 text-sm text-slate-500">{syncError || "加载 Supabase 数据失败。"}</p>
          <Button className="mt-4 bg-indigo-600 text-white hover:bg-indigo-700" onClick={refreshAccount}>
            重试
          </Button>
        </div>
      </div>
    )
  }

  if (accountStatus !== "ready" || !account || account.userId !== user.id) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] text-sm text-slate-500">
        正在加载账户...
      </div>
    )
  }

  if (account.mustChangePassword) {
    return <ForcedPasswordChange onChanged={refreshAccount} onSignOut={signOut} />
  }

  if (!isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 text-slate-950">
        <section className="w-full max-w-xl rounded-lg border border-rose-200 bg-white p-6">
          <div className="flex items-center gap-2 text-rose-700">
            <AlertCircle className="h-5 w-5" />
            <h1 className="text-base font-semibold">无管理员权限</h1>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            当前账号不是管理员。请在 Supabase 的 user_accounts 表中将你的账号 role 设置为 admin 后重新登录。
          </p>
          <Button asChild className="mt-5">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              返回工作台
            </Link>
          </Button>
        </section>
      </main>
    )
  }

  return (
    <AdminContext.Provider value={value}>
      {syncError && (
        <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm">
          {syncError}
        </div>
      )}
      {feedback && (
        <div
          className={
            feedback.type === "success"
              ? "fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 shadow-sm"
              : "fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm"
          }
        >
          {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {feedback.message}
        </div>
      )}
      {children}
    </AdminContext.Provider>
  )
}
