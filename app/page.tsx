"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AuthPanel } from "@/components/auth-panel"
import { ChatArea } from "@/components/chat-area"
import { Sidebar } from "@/components/sidebar"
import { useAccountSession, getErrorMessage } from "@/hooks/use-account-session"
import type { WorkspaceSection } from "@/lib/workspace-section"
import {
  createDeletedProjectItem,
  isDeletedProjectItem,
  normalizeProjectItem,
  type ProjectItem,
} from "@/lib/project-history"
import {
  type CreditPackage,
  type CustomerServiceSettings,
  type ModelPricing,
  loadCreditPackages,
  loadCustomerServiceSettings,
  loadModelPricing,
} from "@/lib/supabase"

function visibleProjects(projects: ProjectItem[]) {
  return projects.filter((project) => !isDeletedProjectItem(project))
}

function isSameProject(a: ProjectItem, b: ProjectItem) {
  return a.id === b.id || Boolean(a.taskId && a.taskId === b.taskId)
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] text-sm text-slate-500">
          正在加载账户...
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  )
}

function HomeContent() {
  const searchParams = useSearchParams()
  const {
    account,
    accountStatus,
    authReady,
    refreshAccount,
    setAccount,
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
  const [modelPricing, setModelPricing] = useState<ModelPricing[]>([])
  const [billingReady, setBillingReady] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("image")
  const accountUserId = account?.userId ?? ""

  useEffect(() => {
    const section = searchParams.get("section")
    if (section === "image" || section === "video" || section === "history" || section === "credits") {
      setActiveSection(section)
    }
  }, [searchParams])

  const refreshBillingConfig = useCallback(async () => {
    if (!userId || accountStatus !== "ready" || accountUserId !== userId) {
      setBillingReady(false)
      return
    }

    try {
      setSyncError("")
      setBillingReady(false)
      const [settings, packages, pricing] = await Promise.all([
        loadCustomerServiceSettings(),
        loadCreditPackages({ includeDisabled: false }),
        loadModelPricing({ includeDisabled: false }),
      ])
      setCustomerService(settings)
      setCreditPackages(packages)
      setModelPricing(pricing)
      setBillingReady(true)
    } catch (error) {
      setSyncError(getErrorMessage(error, "加载充值配置失败。"))
      setBillingReady(true)
    }
  }, [accountStatus, accountUserId, setSyncError, userId])

  useEffect(() => {
    refreshBillingConfig()
  }, [refreshBillingConfig])

  const addProject = useCallback((project: ProjectItem) => {
    setAccount((current) => {
      if (!current) return current
      if (current.projects.some((item) => isDeletedProjectItem(item) && isSameProject(item, project))) return current

      return {
        ...current,
        projects: [normalizeProjectItem(project), ...current.projects.filter((item) => !isSameProject(item, project))],
      }
    })
  }, [setAccount])

  const updateProject = useCallback((project: ProjectItem) => {
    setAccount((current) => {
      if (!current) return current
      if (current.projects.some((item) => isDeletedProjectItem(item) && isSameProject(item, project))) return current

      return {
        ...current,
        projects: current.projects.some((item) => isSameProject(item, project))
          ? current.projects.map((item) => (isSameProject(item, project) ? normalizeProjectItem({ ...item, ...project }) : item))
          : [normalizeProjectItem(project), ...current.projects],
      }
    })
  }, [setAccount])

  const deleteProject = useCallback((id: string) => {
    setAccount((current) => {
      if (!current) return current
      const project = current.projects.find((item) => item.id === id)
      if (!project) return current

      return {
        ...current,
        projects: [createDeletedProjectItem(project), ...current.projects.filter((item) => item.id !== id)],
      }
    })
  }, [setAccount])

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] text-sm text-slate-500">
        正在加载账户...
      </div>
    )
  }

  if (!user) {
    return <AuthPanel onAuthed={() => undefined} variant="landing" />
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
    <div className="flex h-screen bg-[#f7f8fa] text-slate-950">
      <Sidebar
        activeSection={activeSection}
        email={user.email ?? "未设置邮箱"}
        open={sidebarOpen}
        onRefreshAccount={refreshAccount}
        onSectionChange={setActiveSection}
        onSignOut={signOut}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        variant="light"
      />
      {syncError && (
        <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm">
          {syncError}
        </div>
      )}
      <ChatArea
        activeSection={activeSection}
        billingReady={billingReady}
        creditBalance={account.creditBalance}
        creditPackages={creditPackages.filter((item) => item.enabled)}
        customerService={customerService}
        ledger={account.ledger}
        membershipExpiresAt={account.membershipExpiresAt}
        membershipFreeImageQualities={account.membershipFreeImageQualities}
        membershipTier={account.membershipTier}
        modelPricing={modelPricing.filter((item) => item.enabled)}
        onProjectAdd={addProject}
        onProjectDelete={deleteProject}
        onProjectUpdate={updateProject}
        onAccountRefresh={refreshAccount}
        projects={visibleProjects(account.projects)}
        redeemedCodes={account.redeemedCodes}
        sidebarOpen={sidebarOpen}
        onSectionChange={setActiveSection}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        userId={account.userId}
      />
    </div>
  )
}
