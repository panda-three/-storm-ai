"use client"

import { useMemo, useState } from "react"
import { Loader2, Ticket } from "lucide-react"
import { AdminInput } from "@/components/admin/admin-form-controls"
import { getPackageTypeLabel } from "@/components/admin/admin-utils"
import { useAdmin } from "@/components/admin/admin-provider"
import { Button } from "@/components/ui/button"
import type { RedeemCode } from "@/lib/supabase"
import { createRedeemCode } from "@/lib/supabase"

export function RedeemCodesPanel() {
  const { adminAccounts, creditPackages, redeemCodes, refreshAdminConfig, saving, setFeedback, setSaving } = useAdmin()
  const [redeemPackageId, setRedeemPackageId] = useState("")
  const [redeemCode, setRedeemCode] = useState("")
  const [redeemStatusFilter, setRedeemStatusFilter] = useState<"all" | RedeemCode["status"]>("all")
  const filteredRedeemCodes =
    redeemStatusFilter === "all" ? redeemCodes : redeemCodes.filter((item) => item.status === redeemStatusFilter)
  const accountNameById = useMemo(
    () =>
      new Map(
        adminAccounts.map((account) => [
          account.user_id,
          account.username?.trim() ? account.username : account.user_id,
        ])
      ),
    [adminAccounts]
  )

  const handleCreateRedeemCode = async () => {
    const selectedPackage = creditPackages.find((item) => item.id === redeemPackageId)
    const normalizedCode = redeemCode.trim().toUpperCase()

    if (!selectedPackage) {
      setFeedback({ type: "error", message: "请选择点数套餐。" })
      return
    }

    if (!normalizedCode) {
      setFeedback({ type: "error", message: "请输入兑换码。" })
      return
    }

    setSaving(true)
    setFeedback(null)

    try {
      await createRedeemCode(selectedPackage, normalizedCode)
      setRedeemCode("")
      await refreshAdminConfig()
      setFeedback({ type: "success", message: `兑换码 ${normalizedCode} 已生成。` })
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "兑换码生成失败。" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Ticket className="h-5 w-5 text-indigo-600" />
          <h2 className="text-base font-semibold">生成兑换码</h2>
        </div>
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm font-medium text-slate-700">选择套餐</span>
            <select
              className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              onChange={(event) => setRedeemPackageId(event.target.value)}
              value={redeemPackageId}
            >
              <option value="">请选择套餐</option>
              {creditPackages.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} / {item.price_cny.toFixed(2)} 元 / {getPackageTypeLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <AdminInput
            label="兑换码"
            onChange={setRedeemCode}
            placeholder="例如 STORM-TEST-001"
            value={redeemCode}
          />
        </div>
        <Button className="mt-4 bg-indigo-600 text-white hover:bg-indigo-700" disabled={saving} onClick={handleCreateRedeemCode}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
          生成兑换码
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold">最近兑换码</h2>
          <select
            className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            onChange={(event) => setRedeemStatusFilter(event.target.value as "all" | RedeemCode["status"])}
            value={redeemStatusFilter}
          >
            <option value="all">全部状态</option>
            <option value="unused">未使用</option>
            <option value="used">已使用</option>
            <option value="disabled">已禁用</option>
          </select>
        </div>
        <div className="mt-4 grid gap-3">
          {filteredRedeemCodes.length === 0 ? (
            <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">暂无兑换码。</div>
          ) : (
            filteredRedeemCodes.map((item) => (
              <div className="rounded-lg border border-slate-200 p-4" key={item.code}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium text-slate-800">{item.code}</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {item.price_cny.toFixed(2)} 元 = {getPackageTypeLabel(item)}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {item.used_by ? `使用人：${accountNameById.get(item.used_by) ?? item.used_by}` : "未使用"}
                      {item.used_at ? ` · ${new Date(item.used_at).toLocaleString("zh-CN")}` : ""}
                    </div>
                  </div>
                  <span
                    className={
                      item.status === "unused"
                        ? "rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
                        : item.status === "used"
                          ? "rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600"
                          : "rounded-md bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700"
                    }
                  >
                    {item.status === "unused" ? "未使用" : item.status === "used" ? "已使用" : "已禁用"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
