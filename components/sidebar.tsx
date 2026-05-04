"use client"

import type { WorkspaceSection } from "@/app/page"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ChevronLeft,
  Coins,
  Film,
  History,
  ImageIcon,
  LogOut,
  RefreshCcw,
  Settings,
  MessageCircle,
  Sparkles,
} from "lucide-react"

interface SidebarProps {
  activeSection: WorkspaceSection
  canAccessAdmin: boolean
  creditBalance: number
  email: string
  open: boolean
  onSectionChange: (section: WorkspaceSection) => void
  onRefreshAccount: () => void
  onSignOut: () => void
  onToggle: () => void
}

const navItems: Array<{
  id: WorkspaceSection
  label: string
  description: string
  icon: typeof ImageIcon
}> = [
  {
    id: "image",
    label: "AI 生图",
    description: "提示词、比例、清晰度",
    icon: ImageIcon,
  },
  {
    id: "video",
    label: "AI 视频",
    description: "时长、清晰度、模型",
    icon: Film,
  },
  {
    id: "history",
    label: "历史项目",
    description: "查看生成记录",
    icon: History,
  },
  {
    id: "credits",
    label: "点数充值",
    description: "微信购买兑换码",
    icon: Coins,
  },
]

const adminNavItem: {
  id: WorkspaceSection
  label: string
  description: string
  icon: typeof ImageIcon
} = {
  id: "admin",
  label: "管理员后台",
  description: "套餐、兑换码、价格",
  icon: Settings,
}

export function Sidebar({
  activeSection,
  canAccessAdmin,
  creditBalance,
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
        "relative flex flex-col border-r border-slate-200 bg-white transition-all duration-300",
        open ? "w-72" : "w-0 overflow-hidden"
      )}
    >
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="font-semibold leading-none">风暴 AI</div>
            <div className="mt-1 text-xs text-slate-500">图像与视频生成工作台</div>
          </div>
        </div>
        <Button
          aria-label="收起侧边栏"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-500 hover:text-slate-950"
          onClick={onToggle}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      <div className="border-b border-slate-200 p-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-emerald-950">当前 AI 点数</span>
            <Badge className="border-emerald-200 bg-white text-emerald-700" variant="outline">
              可兑换
            </Badge>
          </div>
          <div className="mt-3 flex items-end gap-2">
            <span className="text-3xl font-semibold tracking-tight text-emerald-700">
              {creditBalance.toLocaleString()}
            </span>
            <span className="pb-1 text-sm text-emerald-800">点</span>
          </div>
          <Button
            className="mt-4 w-full bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => onSectionChange("credits")}
          >
            <Coins className="h-4 w-4" />
            兑换点数
          </Button>
        </div>
      </div>

      <nav className="flex-1 space-y-2 p-3">
        {[...navItems, ...(canAccessAdmin ? [adminNavItem] : [])].map((item) => {
          const Icon = item.icon
          const active = activeSection === item.id

          return (
            <button
              key={item.id}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors",
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              )}
              onClick={() => onSectionChange(item.id)}
              type="button"
            >
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md",
                  active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block truncate text-xs text-slate-500">{item.description}</span>
              </span>
            </button>
          )
        })}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-indigo-600">
            <MessageCircle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">当前账户</div>
            <div className="truncate text-xs text-slate-500">{email}</div>
          </div>
        </div>
        <Button className="mt-3 w-full" onClick={onSignOut} variant="outline">
          <LogOut className="h-4 w-4" />
          退出登录
        </Button>
        <Button className="mt-2 w-full" onClick={onRefreshAccount} variant="ghost">
          <RefreshCcw className="h-4 w-4" />
          刷新权限
        </Button>
      </div>
    </aside>
  )
}
