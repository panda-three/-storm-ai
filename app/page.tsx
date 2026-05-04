"use client"

import { useEffect, useState } from "react"
import { Sidebar } from "@/components/sidebar"
import { ChatArea, type ProjectItem } from "@/components/chat-area"
import {
  createDefaultAccount,
  loadLocalAccount,
  saveLocalAccount,
  type CreditLedgerItem,
  type LocalAccountData,
} from "@/lib/local-store"

export type WorkspaceSection = "image" | "video" | "history" | "credits"

export default function Home() {
  const [account, setAccount] = useState<LocalAccountData>(() => createDefaultAccount())
  const [hydrated, setHydrated] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("image")

  useEffect(() => {
    setAccount(loadLocalAccount())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated) {
      saveLocalAccount(account)
    }
  }, [account, hydrated])

  const setCreditBalance = (creditBalance: number) => {
    setAccount((current) => ({
      ...current,
      creditBalance,
    }))
  }

  const addProject = (project: ProjectItem) => {
    setAccount((current) => ({
      ...current,
      projects: [project, ...current.projects.filter((item) => item.id !== project.id)],
    }))
  }

  const updateProject = (project: ProjectItem) => {
    setAccount((current) => ({
      ...current,
      projects: current.projects.map((item) => (item.id === project.id ? { ...item, ...project } : item)),
    }))
  }

  const deleteProject = (id: string) => {
    setAccount((current) => ({
      ...current,
      projects: current.projects.filter((item) => item.id !== id),
    }))
  }

  const addLedgerItem = ({ amount, code }: { amount: number; code: string }) => {
    const ledgerItem: CreditLedgerItem = {
      amount,
      code,
      createdAt: new Date().toLocaleString("zh-CN"),
      id: `ledger_${Date.now()}`,
      type: "redeem",
    }

    setAccount((current) => ({
      ...current,
      ledger: [ledgerItem, ...current.ledger],
    }))
  }

  return (
    <div className="flex h-screen bg-[#f7f8fb] text-slate-950">
      <Sidebar
        activeSection={activeSection}
        creditBalance={account.creditBalance}
        open={sidebarOpen}
        onSectionChange={setActiveSection}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
      <ChatArea
        activeSection={activeSection}
        creditBalance={account.creditBalance}
        ledger={account.ledger}
        onLedgerAdd={addLedgerItem}
        onCreditBalanceChange={setCreditBalance}
        onProjectAdd={addProject}
        onProjectDelete={deleteProject}
        onProjectUpdate={updateProject}
        onRedeemedCodesChange={(redeemedCodes) => setAccount((current) => ({ ...current, redeemedCodes }))}
        projects={account.projects}
        redeemedCodes={account.redeemedCodes}
        sidebarOpen={sidebarOpen}
        onSectionChange={setActiveSection}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        userId={account.userId}
      />
    </div>
  )
}
