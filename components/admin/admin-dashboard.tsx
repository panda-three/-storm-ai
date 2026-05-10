"use client"

import Link from "next/link"
import { Coins, QrCode, Settings2, Ticket, Users, ReceiptText } from "lucide-react"
import { AdminMetricCard } from "@/components/admin/admin-form-controls"
import { useAdmin } from "@/components/admin/admin-provider"

const dashboardLinks = [
  { href: "/admin/customer-service", label: "客服配置", description: "微信号、二维码和充值说明", icon: QrCode },
  { href: "/admin/packages", label: "套餐管理", description: "点数包和会员包", icon: Coins },
  { href: "/admin/pricing", label: "模型价格", description: "图片/视频模型扣点", icon: Settings2 },
  { href: "/admin/redeem-codes", label: "兑换码", description: "生成和查看兑换码", icon: Ticket },
  { href: "/admin/users", label: "用户余额", description: "最近账户和余额", icon: Users },
  { href: "/admin/ledger", label: "点数流水", description: "充值、扣费和退款记录", icon: ReceiptText },
]

export function AdminDashboard() {
  const { adminAccounts, modelPricing, redeemCodes } = useAdmin()
  const totalUserCredits = adminAccounts.reduce((sum, item) => sum + item.credit_balance, 0)
  const usedRedeemCount = redeemCodes.filter((item) => item.status === "used").length
  const enabledPricingCount = modelPricing.filter((item) => item.enabled).length

  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        <AdminMetricCard label="用户账户" value={`${adminAccounts.length}`} />
        <AdminMetricCard label="用户点数余额合计" value={totalUserCredits.toLocaleString()} />
        <AdminMetricCard label="已使用兑换码" value={`${usedRedeemCount}/${redeemCodes.length}`} />
        <AdminMetricCard label="启用模型价格" value={`${enabledPricingCount}/${modelPricing.length}`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dashboardLinks.map((item) => {
          const Icon = item.icon

          return (
            <Link
              className="rounded-lg border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm"
              href={item.href}
              key={item.href}
            >
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-slate-950 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-slate-950">{item.label}</div>
                  <div className="mt-1 text-sm text-slate-500">{item.description}</div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </>
  )
}
