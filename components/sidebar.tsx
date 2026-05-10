"use client"

import type { WorkspaceSection } from "@/lib/workspace-section"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Coins,
  History,
  ImageIcon,
  LogOut,
  MessageCircle,
  RefreshCcw,
  Sparkles,
} from "lucide-react"

interface SidebarProps {
  activeSection: WorkspaceSection
  email: string
  open: boolean
  onSectionChange: (section: WorkspaceSection) => void
  onRefreshAccount: () => void
  onSignOut: () => void
  onToggle: () => void
  variant?: "dark" | "light"
}

const navItems: Array<{
  id: WorkspaceSection
  label: string
  description: string
  icon: typeof ImageIcon
  match: WorkspaceSection[]
}> = [
  {
    id: "image",
    label: "创作台",
    description: "提示词、比例、清晰度",
    icon: ImageIcon,
    match: ["image", "video"],
  },
  {
    id: "history",
    label: "历史项目",
    description: "查看生成记录",
    icon: History,
    match: ["history"],
  },
  {
    id: "credits",
    label: "点数充值",
    description: "微信购买兑换码",
    icon: Coins,
    match: ["credits"],
  },
]

export function Sidebar({
  activeSection,
  email,
  open,
  onSectionChange,
  onRefreshAccount,
  onSignOut,
  onToggle,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "relative z-20 flex shrink-0 flex-col border-r border-slate-200 bg-white text-slate-950 shadow-[1px_0_0_rgba(15,23,42,0.02)] transition-[width,opacity] duration-200",
        open ? "w-[76px]" : "w-0 overflow-hidden opacity-0"
      )}
    >
      <div className="flex h-[92px] items-center justify-center">
        <button
          aria-label="收起侧边栏"
          className="grid h-11 w-11 cursor-pointer place-items-center rounded-[14px] bg-slate-950 text-white shadow-[0_10px_22px_rgba(15,23,42,0.18)] transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          onClick={onToggle}
          title="季风创绘"
          type="button"
        >
          <Sparkles className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex flex-1 flex-col items-center gap-5 px-2 pt-3">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = item.match.includes(activeSection)

          return (
            <button
              key={item.id}
              className={cn(
                "group flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-2xl px-1 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                active
                  ? "bg-cyan-50 text-slate-950"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
              )}
              onClick={() => onSectionChange(item.id)}
              title={item.description}
              type="button"
            >
              <span
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-xl transition-colors",
                  active ? "bg-slate-950 text-white" : "bg-white text-slate-900 group-hover:bg-slate-100"
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-[12px] font-medium leading-none">{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="grid justify-items-center gap-3 border-t border-slate-100 px-2 py-4">
        <div className="grid justify-items-center gap-1 rounded-2xl border border-cyan-100 bg-cyan-50 px-2 py-2 text-cyan-600">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold">会员</span>
        </div>
        <Button
          aria-label={`当前账户：${email}`}
          className="h-9 w-9 rounded-full border-slate-200 bg-white text-cyan-600 hover:bg-slate-50"
          title={email}
          variant="outline"
          size="icon"
        >
          <MessageCircle className="h-4 w-4" />
        </Button>
        <Button
          aria-label="刷新权限"
          className="h-9 w-9 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-950"
          onClick={onRefreshAccount}
          title="刷新权限"
          variant="ghost"
          size="icon"
        >
          <RefreshCcw className="h-4 w-4" />
        </Button>
        <Button
          aria-label="退出登录"
          className="h-9 w-9 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-950"
          onClick={onSignOut}
          title="退出登录"
          variant="ghost"
          size="icon"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  )
}
