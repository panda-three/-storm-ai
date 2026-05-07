"use client"

import { useCallback, useEffect, useState } from "react"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { AuthPanel } from "@/components/auth-panel"
import { Sidebar } from "@/components/sidebar"
import { ChatArea, normalizeProjectItem, type ProjectItem } from "@/components/chat-area"
import { AdminWorkspace } from "@/components/admin-workspace"
import {
  createDefaultAccount,
  loadLocalAccount,
  saveLocalAccount,
  type LocalAccountData,
} from "@/lib/local-store"
import {
  type CreditPackage,
  type CustomerServiceSettings,
  type AdminAccountSummary,
  type ModelPricing,
  type RedeemCode,
  getSupabaseClient,
  loadAdminAccounts,
  loadCreditPackages,
  loadCustomerServiceSettings,
  loadModelPricing,
  loadRedeemCodes,
  loadSupabaseAccount,
  saveSupabaseAccount,
} from "@/lib/supabase"

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }
  return fallback
}

function isInvalidRefreshTokenError(error: unknown) {
  const message = getErrorMessage(error, "")
  return message.includes("Invalid Refresh Token") || message.includes("Refresh Token Not Found")
}

async function clearLocalSupabaseSession(supabase: SupabaseClient) {
  try {
    await supabase.auth.signOut({ scope: "local" })
  } catch {
    // Ignore cleanup failures; the next login will overwrite the local auth state.
  }
}

export type WorkspaceSection = "image" | "video" | "history" | "credits" | "admin"

export default function Home() {
  const [account, setAccount] = useState<LocalAccountData>(() => loadLocalAccount())
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [syncError, setSyncError] = useState("")
  const [customerService, setCustomerService] = useState<CustomerServiceSettings>({
    description: "联系客服购买兑换码后，在站内输入兑换码完成点数充值。",
    qrCodeUrl: "",
    wechatId: "",
  })
  const [creditPackages, setCreditPackages] = useState<CreditPackage[]>([])
  const [adminAccounts, setAdminAccounts] = useState<AdminAccountSummary[]>([])
  const [modelPricing, setModelPricing] = useState<ModelPricing[]>([])
  const [billingReady, setBillingReady] = useState(false)
  const [redeemCodes, setRedeemCodes] = useState<RedeemCode[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("image")

  useEffect(() => {
    let active = true
    const supabase = getSupabaseClient()

    if (!supabase) {
      setAuthReady(true)
      return
    }

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return

      if (error) {
        if (isInvalidRefreshTokenError(error)) {
          await clearLocalSupabaseSession(supabase)
          if (!active) return

          setUser(null)
          setAuthReady(true)
          return
        }

        setSyncError(getErrorMessage(error, "加载登录状态失败。"))
        setUser(null)
        setAuthReady(true)
        return
      }

      setUser(data.session?.user ?? null)
      setAuthReady(true)
    }).catch(async (error) => {
      if (!active) return

      if (isInvalidRefreshTokenError(error)) {
        await clearLocalSupabaseSession(supabase)
        if (!active) return

        setUser(null)
        setAuthReady(true)
        return
      }

      setSyncError(getErrorMessage(error, "加载登录状态失败。"))
      setUser(null)
      setAuthReady(true)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAuthReady(true)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadAccount() {
      if (!user) return

      try {
        setSyncError("")
        const remoteAccount = await loadSupabaseAccount(user.id)
        if (!active) return

        setAccount({
          creditBalance: remoteAccount?.credit_balance ?? 0,
          ledger: remoteAccount?.ledger ?? [],
          projects: (remoteAccount?.projects ?? []).map(normalizeProjectItem),
          redeemedCodes: remoteAccount?.redeemed_codes ?? [],
          role: remoteAccount?.role ?? "user",
          userId: user.id,
        })
      } catch (error) {
        setSyncError(getErrorMessage(error, "加载 Supabase 数据失败。"))
      }
    }

    loadAccount()

    return () => {
      active = false
    }
  }, [user])

  const refreshAccount = async () => {
    if (!user) return

    try {
      setSyncError("")
      const remoteAccount = await loadSupabaseAccount(user.id)
      setAccount({
        creditBalance: remoteAccount?.credit_balance ?? 0,
        ledger: remoteAccount?.ledger ?? [],
        projects: (remoteAccount?.projects ?? []).map(normalizeProjectItem),
        redeemedCodes: remoteAccount?.redeemed_codes ?? [],
        role: remoteAccount?.role ?? "user",
        userId: user.id,
      })
    } catch (error) {
      setSyncError(getErrorMessage(error, "刷新 Supabase 数据失败。"))
    }
  }

  const refreshBillingConfig = useCallback(async () => {
    if (!user) {
      setBillingReady(false)
      return
    }

    try {
      setSyncError("")
      setBillingReady(false)
      const [settings, packages, pricing] = await Promise.all([
        loadCustomerServiceSettings(),
        loadCreditPackages({ includeDisabled: account.role === "admin" }),
        loadModelPricing({ includeDisabled: account.role === "admin" }),
      ])
      setCustomerService(settings)
      setCreditPackages(packages)
      setModelPricing(pricing)
      if (account.role === "admin") {
        const [codes, accounts] = await Promise.all([loadRedeemCodes(), loadAdminAccounts()])
        setRedeemCodes(codes)
        setAdminAccounts(accounts)
      }
      setBillingReady(true)
    } catch (error) {
      setSyncError(getErrorMessage(error, "加载充值配置失败。"))
      setBillingReady(true)
    }
  }, [account.role, user])

  useEffect(() => {
    refreshBillingConfig()
  }, [refreshBillingConfig])

  useEffect(() => {
    if (!user || account.userId !== user.id) return

    const timer = window.setTimeout(() => {
      saveSupabaseAccount(account).catch((error) => {
        setSyncError(getErrorMessage(error, "保存 Supabase 数据失败。"))
      })
    }, 400)

    return () => window.clearTimeout(timer)
  }, [account, user])

  useEffect(() => {
    if (user) return
    saveLocalAccount(account)
  }, [account, user])

  const addProject = useCallback((project: ProjectItem) => {
    setAccount((current) => ({
      ...current,
      projects: [normalizeProjectItem(project), ...current.projects.filter((item) => item.id !== project.id)],
    }))
  }, [])

  const updateProject = useCallback((project: ProjectItem) => {
    setAccount((current) => ({
      ...current,
      projects: current.projects.some((item) => item.id === project.id)
        ? current.projects.map((item) => (item.id === project.id ? normalizeProjectItem({ ...item, ...project }) : item))
        : [normalizeProjectItem(project), ...current.projects],
    }))
  }, [])

  const deleteProject = useCallback((id: string) => {
    setAccount((current) => ({
      ...current,
      projects: current.projects.filter((item) => item.id !== id),
    }))
  }, [])

  const handleSignOut = async () => {
    const supabase = getSupabaseClient()
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error && isInvalidRefreshTokenError(error)) {
        await clearLocalSupabaseSession(supabase)
      } else if (error) {
        setSyncError(getErrorMessage(error, "退出登录失败。"))
      }
    }
    setUser(null)
    setAccount(createDefaultAccount())
  }

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

  return (
    <div className="flex h-screen bg-[#f7f8fb] text-slate-950">
      <Sidebar
        activeSection={activeSection}
        canAccessAdmin={account.role === "admin"}
        creditBalance={account.creditBalance}
        email={user.email ?? "未设置邮箱"}
        open={sidebarOpen}
        onRefreshAccount={refreshAccount}
        onSectionChange={setActiveSection}
        onSignOut={handleSignOut}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
      {syncError && (
        <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm">
          {syncError}
        </div>
      )}
      {activeSection === "admin" ? (
        <AdminWorkspace
          canAccessAdmin={account.role === "admin"}
          adminAccounts={adminAccounts}
          creditPackages={creditPackages}
          customerService={customerService}
          modelPricing={modelPricing}
          onModelPricingChange={setModelPricing}
          onPackagesChange={setCreditPackages}
          onRefresh={refreshBillingConfig}
          onRedeemCodesChange={setRedeemCodes}
          onSectionChange={setActiveSection}
          onSettingsChange={setCustomerService}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          redeemCodes={redeemCodes}
          sidebarOpen={sidebarOpen}
        />
      ) : (
        <ChatArea
          activeSection={activeSection}
          billingReady={billingReady}
          creditBalance={account.creditBalance}
          creditPackages={creditPackages.filter((item) => item.enabled)}
          customerService={customerService}
          ledger={account.ledger}
          modelPricing={modelPricing.filter((item) => item.enabled)}
          onProjectAdd={addProject}
          onProjectDelete={deleteProject}
          onProjectUpdate={updateProject}
          onAccountRefresh={refreshAccount}
          projects={account.projects}
          redeemedCodes={account.redeemedCodes}
          sidebarOpen={sidebarOpen}
          onSectionChange={setActiveSection}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          userId={account.userId}
        />
      )}
    </div>
  )
}
