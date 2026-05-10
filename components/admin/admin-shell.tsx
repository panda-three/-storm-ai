"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowLeft,
  BarChart3,
  Coins,
  Menu,
  QrCode,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Ticket,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const adminNavItems = [
  { href: "/admin", label: "总览", icon: BarChart3 },
  { href: "/admin/customer-service", label: "客服配置", icon: QrCode },
  { href: "/admin/packages", label: "套餐", icon: Coins },
  { href: "/admin/pricing", label: "模型价格", icon: Settings2 },
  { href: "/admin/redeem-codes", label: "兑换码", icon: Ticket },
  { href: "/admin/users", label: "用户", icon: Users },
  { href: "/admin/ledger", label: "流水", icon: ReceiptText },
]

function getPageTitle(pathname: string) {
  return adminNavItems.find((item) => item.href === pathname)?.label ?? "管理员后台"
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const title = getPageTitle(pathname)

  return (
    <div className="flex h-screen bg-[#f7f8fb] text-slate-950">
      <aside className="hidden w-[220px] shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-950 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-950">管理员后台</div>
            <div className="text-xs text-slate-500">配置与运营</div>
          </div>
        </div>
        <nav className="grid gap-1 p-3">
          {adminNavItems.map((item) => {
            const Icon = item.icon
            const active = pathname === item.href

            return (
              <Link
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                )}
                href={item.href}
                key={item.href}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              aria-label="管理员导航"
              className="h-8 w-8 text-slate-500 hover:text-slate-950 lg:hidden"
              size="icon"
              variant="ghost"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-950">{title}</h1>
              <p className="hidden truncate text-sm text-slate-500 sm:block">统一管理后台配置、套餐、兑换码和用户点数。</p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              返回工作台
            </Link>
          </Button>
        </header>

        <div className="border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
          <nav className="flex gap-2 overflow-x-auto">
            {adminNavItems.map((item) => {
              const Icon = item.icon
              const active = pathname === item.href

              return (
                <Link
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium",
                    active ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-600"
                  )}
                  href={item.href}
                  key={item.href}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
          <section className="mx-auto grid max-w-6xl gap-5">{children}</section>
        </div>
      </main>
    </div>
  )
}
