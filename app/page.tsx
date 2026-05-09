"use client"

import { useCallback, useEffect, useState } from "react"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { AuthPanel } from "@/components/auth-panel"
import { Sidebar } from "@/components/sidebar"
import { ChatArea } from "@/components/chat-area"
import { AdminWorkspace } from "@/components/admin-workspace"
import {
  createDefaultAccount,
  loadLocalAccount,
  saveLocalAccount,
  type LocalAccountData,
} from "@/lib/local-store"
import { mergeProjectHistories, normalizeProjectItem, type ProjectItem } from "@/lib/project-history"
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
type AccountStatus = "idle" | "loading" | "ready" | "error"

function createAccountFromRemote(userId: string, remoteAccount: Awaited<ReturnType<typeof loadSupabaseAccount>>): LocalAccountData {
  return {
    creditBalance: remoteAccount?.credit_balance ?? 0,
    ledger: remoteAccount?.ledger ?? [],
    projects: (remoteAccount?.projects ?? []).map(normalizeProjectItem),
    redeemedCodes: remoteAccount?.redeemed_codes ?? [],
    role: remoteAccount?.role ?? "user",
    userId,
  }
}

async function loadServerHistoryProjects() {
  const supabase = getSupabaseClient()
  if (!supabase) return []

  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  const token = data.session?.access_token
  if (!token) return []

  const response = await fetch("/api/history", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || !payload.ok) {
    throw new Error(getErrorMessage(payload, "读取生成历史失败。"))
  }

  return Array.isArray(payload.projects)
    ? payload.projects.filter((item: unknown): item is ProjectItem => typeof item === "object" && item !== null).map(normalizeProjectItem)
    : []
}

export default function Home() {
  const [account, setAccount] = useState<LocalAccountData | null>(() => loadLocalAccount())
  const [accountStatus, setAccountStatus] = useState<AccountStatus>("idle")
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
  const userId = user?.id ?? ""
  const accountUserId = account?.userId ?? ""
  const accountRole = account?.role ?? "user"

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

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") {
        setAuthReady(true)
        return
      }

      if (event === "SIGNED_OUT") {
        setUser(null)
        setAuthReady(true)
        return
      }

      setUser((current) => {
        const nextUser = session?.user ?? null

        if (current?.id === nextUser?.id) {
          return current
        }

        return nextUser
      })
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
      if (!userId) {
        setAccountStatus("idle")
        setAccount(loadLocalAccount())
        return
      }

      try {
        setSyncError("")
        setAccountStatus("loading")
        setAccount(null)
        const remoteAccount = await loadSupabaseAccount(userId)
        if (!active) return

        setAccount(createAccountFromRemote(userId, remoteAccount))
        setAccountStatus("ready")

        loadServerHistoryProjects()
          .then((serverProjects) => {
            if (!active) return
            setAccount((current) => {
              if (!current || current.userId !== userId) return current
              return {
                ...current,
                projects: mergeProjectHistories(serverProjects, current.projects),
              }
            })
          })
          .catch((error) => {
            if (!active) return
            setSyncError(getErrorMessage(error, "读取生成历史失败。"))
          })
      } catch (error) {
        if (!active) return
        setAccount(null)
        setAccountStatus("error")
        setSyncError(getErrorMessage(error, "加载 Supabase 数据失败。"))
      }
    }

    loadAccount()

    return () => {
      active = false
    }
  }, [userId])

  const refreshAccount = async () => {
    if (!userId) return

    try {
      setSyncError("")
      const remoteAccount = await loadSupabaseAccount(userId)
      const refreshedAccount = createAccountFromRemote(userId, remoteAccount)
      setAccount((current) => ({
        ...refreshedAccount,
        projects: mergeProjectHistories(current?.projects ?? [], refreshedAccount.projects),
      }))
      setAccountStatus("ready")

      loadServerHistoryProjects()
        .then((serverProjects) => {
          setAccount((current) => {
            if (!current || current.userId !== userId) return current
            return {
              ...current,
              projects: mergeProjectHistories(serverProjects, current.projects),
            }
          })
        })
        .catch((error) => {
          setSyncError(getErrorMessage(error, "读取生成历史失败。"))
        })
    } catch (error) {
      setAccount((current) => {
        if (!current) setAccountStatus("error")
        return current
      })
      setSyncError(getErrorMessage(error, "刷新 Supabase 数据失败。"))
    }
  }

  const refreshBillingConfig = useCallback(async () => {
    if (!userId || accountStatus !== "ready" || accountUserId !== userId) {
      setBillingReady(false)
      setAdminAccounts([])
      setRedeemCodes([])
      return
    }

    try {
      setSyncError("")
      setBillingReady(false)
      const includeDisabled = accountRole === "admin"
      const [settings, packages, pricing] = await Promise.all([
        loadCustomerServiceSettings(),
        loadCreditPackages({ includeDisabled }),
        loadModelPricing({ includeDisabled }),
      ])
      setCustomerService(settings)
      setCreditPackages(packages)
      setModelPricing(pricing)
      if (includeDisabled) {
        const [codes, accounts] = await Promise.all([loadRedeemCodes(), loadAdminAccounts()])
        setRedeemCodes(codes)
        setAdminAccounts(accounts)
      } else {
        setRedeemCodes([])
        setAdminAccounts([])
      }
      setBillingReady(true)
    } catch (error) {
      setSyncError(getErrorMessage(error, "加载充值配置失败。"))
      setBillingReady(true)
    }
  }, [accountRole, accountStatus, accountUserId, userId])

  useEffect(() => {
    refreshBillingConfig()
  }, [refreshBillingConfig])

  useEffect(() => {
    if (!userId || !account || accountStatus !== "ready" || account.userId !== userId) return

    const timer = window.setTimeout(() => {
      saveSupabaseAccount(account).catch((error) => {
        setSyncError(getErrorMessage(error, "保存 Supabase 数据失败。"))
      })
    }, 400)

    return () => window.clearTimeout(timer)
  }, [account, accountStatus, userId])

  useEffect(() => {
    if (userId || !account) return
    saveLocalAccount(account)
  }, [account, userId])

  useEffect(() => {
    if (!account || account.role === "admin" || activeSection !== "admin") return
    setActiveSection("image")
  }, [account, activeSection])

  const addProject = useCallback((project: ProjectItem) => {
    setAccount((current) => {
      if (!current) return current
      return {
        ...current,
        projects: [normalizeProjectItem(project), ...current.projects.filter((item) => item.id !== project.id)],
      }
    })
  }, [])

  const updateProject = useCallback((project: ProjectItem) => {
    setAccount((current) => {
      if (!current) return current
      return {
        ...current,
        projects: current.projects.some((item) => item.id === project.id)
          ? current.projects.map((item) => (item.id === project.id ? normalizeProjectItem({ ...item, ...project }) : item))
          : [normalizeProjectItem(project), ...current.projects],
      }
    })
  }, [])

  const deleteProject = useCallback((id: string) => {
    setAccount((current) => {
      if (!current) return current
      return {
        ...current,
        projects: current.projects.filter((item) => item.id !== id),
      }
    })
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
    setAccountStatus("idle")
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

  if (accountStatus === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 text-slate-950">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 text-center shadow-sm">
          <h1 className="text-base font-semibold">账户加载失败</h1>
          <p className="mt-2 text-sm text-slate-500">{syncError || "加载 Supabase 数据失败。"}</p>
          <button
            className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
            onClick={refreshAccount}
            type="button"
          >
            重试
          </button>
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
