"use client"

import { useState } from "react"
import { Coins, Loader2, Save } from "lucide-react"
import { AdminInput, AdminNumberInput } from "@/components/admin/admin-form-controls"
import { emptyPackageForm, getPackageTypeLabel, toggleQuality } from "@/components/admin/admin-utils"
import { useAdmin } from "@/components/admin/admin-provider"
import { Button } from "@/components/ui/button"
import type { CreditPackage } from "@/lib/supabase"
import { saveCreditPackage } from "@/lib/supabase"

export function PackagesPanel() {
  const { creditPackages, refreshAdminConfig, saving, setCreditPackages, setFeedback, setSaving } = useAdmin()
  const [packageForm, setPackageForm] = useState<Omit<CreditPackage, "id"> & { id?: string }>(emptyPackageForm)

  const handleSavePackage = async () => {
    if (!packageForm.name.trim()) {
      setFeedback({ type: "error", message: "请输入套餐名称。" })
      return
    }

    if (packageForm.package_type === "credits" && packageForm.credits <= 0) {
      setFeedback({ type: "error", message: "点数套餐的到账点数必须大于 0。" })
      return
    }

    if (packageForm.package_type === "membership" && (!packageForm.membership_tier || !packageForm.membership_duration_days)) {
      setFeedback({ type: "error", message: "请选择会员等级和有效期。" })
      return
    }

    if (packageForm.package_type === "membership" && packageForm.membership_free_image_qualities.length === 0) {
      setFeedback({ type: "error", message: "请选择会员免费生图清晰度。" })
      return
    }

    if (packageForm.price_cny < 0) {
      setFeedback({ type: "error", message: "套餐金额必须有效。" })
      return
    }

    setSaving(true)
    setFeedback(null)

    try {
      await saveCreditPackage({
        ...packageForm,
        credits: packageForm.package_type === "membership" ? 0 : packageForm.credits,
        membership_duration_days: packageForm.package_type === "membership" ? packageForm.membership_duration_days : null,
        membership_free_image_qualities:
          packageForm.package_type === "membership" ? packageForm.membership_free_image_qualities : [],
        membership_tier: packageForm.package_type === "membership" ? packageForm.membership_tier : null,
        name: packageForm.name.trim(),
      })
      setPackageForm(emptyPackageForm)
      await refreshAdminConfig()
      setFeedback({ type: "success", message: "点数套餐已保存。" })
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "点数套餐保存失败。" })
    } finally {
      setSaving(false)
    }
  }

  const handleTogglePackage = async (pkg: CreditPackage) => {
    setSaving(true)
    setFeedback(null)

    try {
      await saveCreditPackage({
        ...pkg,
        enabled: !pkg.enabled,
      })
      setCreditPackages(creditPackages.map((item) => (item.id === pkg.id ? { ...item, enabled: !item.enabled } : item)))
      setFeedback({ type: "success", message: pkg.enabled ? "套餐已停用。" : "套餐已启用。" })
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "套餐状态更新失败。" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-emerald-600" />
          <h2 className="text-base font-semibold">点数套餐</h2>
        </div>
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm font-medium text-slate-700">套餐类型</span>
            <select
              className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              onChange={(event) => {
                const packageType = event.target.value as CreditPackage["package_type"]
                setPackageForm((current) => ({
                  ...current,
                  credits: packageType === "membership" ? 0 : Math.max(current.credits, 990),
                  membership_duration_days: packageType === "membership" ? current.membership_duration_days ?? 365 : null,
                  membership_free_image_qualities:
                    packageType === "membership"
                      ? current.membership_free_image_qualities.length > 0
                        ? current.membership_free_image_qualities
                        : ["1K", "2K"]
                      : [],
                  membership_tier: packageType === "membership" ? current.membership_tier ?? "vip" : null,
                  package_type: packageType,
                }))
              }}
              value={packageForm.package_type}
            >
              <option value="credits">点数包</option>
              <option value="membership">会员包</option>
            </select>
          </label>
          <AdminInput
            label="套餐名称"
            onChange={(value) => setPackageForm((current) => ({ ...current, name: value }))}
            placeholder="例如 标准包"
            value={packageForm.name}
          />
          <AdminNumberInput
            label="售价金额（元）"
            onChange={(value) => setPackageForm((current) => ({ ...current, price_cny: value }))}
            value={packageForm.price_cny}
          />
          {packageForm.package_type === "credits" ? (
            <AdminNumberInput
              label="到账点数"
              onChange={(value) => setPackageForm((current) => ({ ...current, credits: Math.round(value) }))}
              value={packageForm.credits}
            />
          ) : (
            <>
              <label className="grid gap-1">
                <span className="text-sm font-medium text-slate-700">会员等级</span>
                <select
                  className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                  onChange={(event) =>
                    setPackageForm((current) => ({
                      ...current,
                      membership_tier: event.target.value as CreditPackage["membership_tier"],
                      membership_free_image_qualities: event.target.value === "svip" ? ["1K", "2K", "4K"] : ["1K", "2K"],
                    }))
                  }
                  value={packageForm.membership_tier ?? "vip"}
                >
                  <option value="vip">VIP</option>
                  <option value="svip">SVIP</option>
                </select>
              </label>
              <AdminNumberInput
                label="有效期（天）"
                onChange={(value) => setPackageForm((current) => ({ ...current, membership_duration_days: Math.round(value) }))}
                value={packageForm.membership_duration_days ?? 365}
              />
              <div className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">免费生图清晰度</span>
                <div className="flex flex-wrap gap-2">
                  {["1K", "2K", "4K"].map((quality) => (
                    <button
                      className={
                        packageForm.membership_free_image_qualities.includes(quality)
                          ? "rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700"
                          : "rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600"
                      }
                      key={quality}
                      onClick={() =>
                        setPackageForm((current) => ({
                          ...current,
                          membership_free_image_qualities: toggleQuality(current.membership_free_image_qualities, quality),
                        }))
                      }
                      type="button"
                    >
                      {quality}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          <AdminNumberInput
            label="排序"
            onChange={(value) => setPackageForm((current) => ({ ...current, sort_order: Math.round(value) }))}
            value={packageForm.sort_order}
          />
        </div>
        <Button className="mt-4 bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving} onClick={handleSavePackage}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {packageForm.id ? "保存套餐" : "新增套餐"}
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">套餐列表</h2>
        <div className="mt-4 grid gap-3">
          {creditPackages.length === 0 ? (
            <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">暂无套餐。</div>
          ) : (
            creditPackages.map((item) => (
              <div className="rounded-lg border border-slate-200 p-4" key={item.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium text-slate-800">{item.name}</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {item.price_cny.toFixed(2)} 元 = {getPackageTypeLabel(item)}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">排序：{item.sort_order}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => setPackageForm(item)} size="sm" variant="outline">
                      编辑
                    </Button>
                    <Button onClick={() => handleTogglePackage(item)} size="sm" variant={item.enabled ? "outline" : "default"}>
                      {item.enabled ? "停用" : "启用"}
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
