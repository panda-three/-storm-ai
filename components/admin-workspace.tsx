"use client"

import { useState } from "react"
import type { WorkspaceSection } from "@/app/page"
import { imageModelOptions, imageModelSettings, videoModelOptions, videoModelSettings } from "@/lib/model-options"
import type { AdminAccountSummary, CreditPackage, CustomerServiceSettings, ModelPricing, RedeemCode } from "@/lib/supabase"
import { calculatePricingCredits, createRedeemCode, saveCreditPackage, saveCustomerServiceSettings, saveModelPricing } from "@/lib/supabase"
import { AlertCircle, ArrowLeft, CheckCircle2, Coins, Loader2, Menu, QrCode, Save, ShieldCheck, SlidersHorizontal, Ticket } from "lucide-react"
import { Button } from "@/components/ui/button"

interface AdminWorkspaceProps {
  canAccessAdmin: boolean
  adminAccounts: AdminAccountSummary[]
  creditPackages: CreditPackage[]
  customerService: CustomerServiceSettings
  modelPricing: ModelPricing[]
  onModelPricingChange: (pricing: ModelPricing[]) => void
  onPackagesChange: (packages: CreditPackage[]) => void
  onRefresh: () => Promise<void>
  onRedeemCodesChange: (codes: RedeemCode[]) => void
  onSectionChange: (section: WorkspaceSection) => void
  onSettingsChange: (settings: CustomerServiceSettings) => void
  onToggleSidebar: () => void
  redeemCodes: RedeemCode[]
  sidebarOpen: boolean
}

type Feedback =
  | {
      message: string
      type: "success" | "error"
    }
  | null

const emptyPackageForm = {
  credits: 990,
  enabled: true,
  id: "",
  name: "",
  price_cny: 9.9,
  sort_order: 10,
}

function parseDurationSeconds(duration: string) {
  const parsed = Number.parseInt(duration, 10)
  return Number.isFinite(parsed) ? parsed : 8
}

function formatDurationOption(durationSeconds: number | null) {
  return `${durationSeconds ?? 8} 秒`
}

function normalizeCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function getDefaultPricingForm(type: "image" | "video"): Omit<ModelPricing, "id"> & { id?: string } {
  if (type === "video") {
    const model = videoModelOptions[0]
    const settings = videoModelSettings[model]

    return {
      aspect_ratio: settings.aspectRatios[0],
      cost_cny: 1,
      duration_seconds: parseDurationSeconds(settings.durations[0]),
      enabled: true,
      id: "",
      markup: 2,
      model,
      quality: settings.qualities[0],
      type,
    }
  }

  const model = imageModelOptions[0]
  const settings = imageModelSettings[model]

  return {
    aspect_ratio: null,
    cost_cny: 1,
    duration_seconds: null,
    enabled: true,
    id: "",
    markup: 2,
    model,
    quality: settings.qualities[1],
    type,
  }
}

export function AdminWorkspace({
  canAccessAdmin,
  adminAccounts,
  creditPackages,
  customerService,
  modelPricing,
  onModelPricingChange,
  onPackagesChange,
  onRefresh,
  onSectionChange,
  onSettingsChange,
  onToggleSidebar,
  redeemCodes,
  sidebarOpen,
}: AdminWorkspaceProps) {
  const [settingsForm, setSettingsForm] = useState(customerService)
  const [packageForm, setPackageForm] = useState<Omit<CreditPackage, "id"> & { id?: string }>(emptyPackageForm)
  const [pricingForm, setPricingForm] = useState<Omit<ModelPricing, "id"> & { id?: string }>(() => getDefaultPricingForm("image"))
  const [redeemPackageId, setRedeemPackageId] = useState("")
  const [redeemCode, setRedeemCode] = useState("")
  const [redeemStatusFilter, setRedeemStatusFilter] = useState<"all" | RedeemCode["status"]>("all")
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [saving, setSaving] = useState(false)
  const filteredRedeemCodes =
    redeemStatusFilter === "all" ? redeemCodes : redeemCodes.filter((item) => item.status === redeemStatusFilter)
  const recentLedger = adminAccounts
    .flatMap((account) =>
      account.ledger.slice(0, 5).map((item) => ({
        ...item,
        userId: account.user_id,
      }))
    )
    .slice(0, 12)
  const totalUserCredits = adminAccounts.reduce((sum, item) => sum + item.credit_balance, 0)
  const usedRedeemCount = redeemCodes.filter((item) => item.status === "used").length
  const enabledPricingCount = modelPricing.filter((item) => item.enabled).length
  const pricingModelOptions = pricingForm.type === "image" ? imageModelOptions : videoModelOptions
  const pricingImageSettings = pricingForm.type === "image" ? imageModelSettings[pricingForm.model] : null
  const pricingVideoSettings = pricingForm.type === "video" ? videoModelSettings[pricingForm.model] : null
  const pricingQualityOptions = pricingImageSettings?.qualities ?? pricingVideoSettings?.qualities ?? []
  const pricingDurationOptions = pricingVideoSettings?.durations ?? []
  const pricingAspectRatioOptions = pricingVideoSettings?.aspectRatios ?? []

  const handleSaveSettings = async () => {
    setSaving(true)
    setFeedback(null)

    try {
      await saveCustomerServiceSettings(settingsForm)
      onSettingsChange(settingsForm)
      setFeedback({ type: "success", message: "客服配置已保存。" })
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "客服配置保存失败。" })
    } finally {
      setSaving(false)
    }
  }

  const handleSavePackage = async () => {
    if (!packageForm.name.trim()) {
      setFeedback({ type: "error", message: "请输入套餐名称。" })
      return
    }

    if (packageForm.price_cny < 0 || packageForm.credits <= 0) {
      setFeedback({ type: "error", message: "套餐金额和点数必须有效。" })
      return
    }

    setSaving(true)
    setFeedback(null)

    try {
      await saveCreditPackage({
        ...packageForm,
        name: packageForm.name.trim(),
      })
      setPackageForm(emptyPackageForm)
      await onRefresh()
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
      onPackagesChange(creditPackages.map((item) => (item.id === pkg.id ? { ...item, enabled: !item.enabled } : item)))
      setFeedback({ type: "success", message: pkg.enabled ? "套餐已停用。" : "套餐已启用。" })
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "套餐状态更新失败。" })
    } finally {
      setSaving(false)
    }
  }

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
      await onRefresh()
      setFeedback({ type: "success", message: `兑换码 ${normalizedCode} 已生成。` })
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "兑换码生成失败。" })
    } finally {
      setSaving(false)
    }
  }

  const handleSavePricing = async () => {
    if (!pricingModelOptions.includes(pricingForm.model)) {
      setFeedback({ type: "error", message: "请选择有效模型。" })
      return
    }

    if (!pricingForm.quality || !pricingQualityOptions.includes(pricingForm.quality)) {
      setFeedback({ type: "error", message: "请选择有效清晰度。" })
      return
    }

    if (
      pricingForm.type === "video" &&
      (!pricingForm.duration_seconds ||
        !pricingDurationOptions.includes(formatDurationOption(pricingForm.duration_seconds)) ||
        !pricingForm.aspect_ratio ||
        !pricingAspectRatioOptions.includes(pricingForm.aspect_ratio))
    ) {
      setFeedback({ type: "error", message: "请选择有效视频时长和比例。" })
      return
    }

    if (pricingForm.cost_cny < 0 || pricingForm.markup <= 0) {
      setFeedback({ type: "error", message: "成本金额和利润倍率必须有效。" })
      return
    }

    setSaving(true)
    setFeedback(null)

    try {
      await saveModelPricing({
        ...pricingForm,
        cost_cny: normalizeCurrency(pricingForm.cost_cny),
        model: pricingForm.model,
        quality: pricingForm.quality,
      })
      await onRefresh()
      setFeedback({ type: "success", message: "模型价格已保存。" })
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "模型价格保存失败。" })
    } finally {
      setSaving(false)
    }
  }

  const handleTogglePricing = async (pricing: ModelPricing) => {
    setSaving(true)
    setFeedback(null)

    try {
      await saveModelPricing({
        ...pricing,
        enabled: !pricing.enabled,
      })
      onModelPricingChange(modelPricing.map((item) => (item.id === pricing.id ? { ...item, enabled: !item.enabled } : item)))
      setFeedback({ type: "success", message: pricing.enabled ? "模型价格已停用。" : "模型价格已启用。" })
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "模型价格状态更新失败。" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {!sidebarOpen && (
            <Button
              aria-label="展开侧边栏"
              className="h-8 w-8 text-slate-500 hover:text-slate-950"
              onClick={onToggleSidebar}
              size="icon"
              variant="ghost"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-slate-950">管理员后台</h1>
            <p className="hidden truncate text-sm text-slate-500 sm:block">管理客服配置和点数套餐。</p>
          </div>
        </div>
        <Button onClick={() => onSectionChange("image")} size="sm" variant="outline">
          <ArrowLeft className="h-4 w-4" />
          返回工作台
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
        {canAccessAdmin ? (
          <section className="mx-auto grid max-w-6xl gap-5">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-emerald-800">
                <ShieldCheck className="h-5 w-5" />
                <h2 className="text-base font-semibold">管理员权限已启用</h2>
              </div>
            </div>

            {feedback && (
              <div
                className={
                  feedback.type === "success"
                    ? "flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
                    : "flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
                }
              >
                {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {feedback.message}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-4">
              <AdminMetricCard label="用户账户" value={`${adminAccounts.length}`} />
              <AdminMetricCard label="用户点数余额合计" value={totalUserCredits.toLocaleString()} />
              <AdminMetricCard label="已使用兑换码" value={`${usedRedeemCount}/${redeemCodes.length}`} />
              <AdminMetricCard label="启用模型价格" value={`${enabledPricingCount}/${modelPricing.length}`} />
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-indigo-600" />
                  <h2 className="text-base font-semibold">客服配置</h2>
                </div>
                <div className="mt-4 grid gap-3">
                  <AdminInput
                    label="客服微信号"
                    onChange={(value) => setSettingsForm((current) => ({ ...current, wechatId: value }))}
                    placeholder="例如 storm-ai-service"
                    value={settingsForm.wechatId}
                  />
                  <AdminInput
                    label="二维码图片 URL"
                    onChange={(value) => setSettingsForm((current) => ({ ...current, qrCodeUrl: value }))}
                    placeholder="https://..."
                    value={settingsForm.qrCodeUrl}
                  />
                  <label className="grid gap-1">
                    <span className="text-sm font-medium text-slate-700">充值说明</span>
                    <textarea
                      className="min-h-24 resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                      onChange={(event) => setSettingsForm((current) => ({ ...current, description: event.target.value }))}
                      value={settingsForm.description}
                    />
                  </label>
                </div>
                <Button className="mt-4 bg-indigo-600 text-white hover:bg-indigo-700" disabled={saving} onClick={handleSaveSettings}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  保存客服配置
                </Button>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-indigo-600" />
                  <h2 className="text-base font-semibold">二维码预览</h2>
                </div>
                <div className="mt-4 flex aspect-square items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
                  {settingsForm.qrCodeUrl ? (
                    <img alt="客服二维码预览" className="h-full w-full rounded-lg object-cover" src={settingsForm.qrCodeUrl} />
                  ) : (
                    <div className="text-center text-sm text-slate-500">暂无二维码</div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-2">
                  <Coins className="h-5 w-5 text-emerald-600" />
                  <h2 className="text-base font-semibold">点数套餐</h2>
                </div>
                <div className="mt-4 grid gap-3">
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
                  <AdminNumberInput
                    label="到账点数"
                    onChange={(value) => setPackageForm((current) => ({ ...current, credits: Math.round(value) }))}
                    value={packageForm.credits}
                  />
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
                              {item.price_cny.toFixed(2)} 元 = {item.credits.toLocaleString()} 点
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

            <div className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-5 w-5 text-indigo-600" />
                  <h2 className="text-base font-semibold">模型价格配置</h2>
                </div>
                <div className="mt-4 grid gap-3">
                  <label className="grid gap-1">
                    <span className="text-sm font-medium text-slate-700">类型</span>
                    <select
                      className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                      onChange={(event) =>
                        setPricingForm(getDefaultPricingForm(event.target.value as "image" | "video"))
                      }
                      value={pricingForm.type}
                    >
                      <option value="image">图片</option>
                      <option value="video">视频</option>
                    </select>
                  </label>
                  <AdminSelect
                    label="模型名称"
                    onChange={(value) => {
                      if (pricingForm.type === "image") {
                        const settings = imageModelSettings[value]
                        setPricingForm((current) => ({
                          ...current,
                          aspect_ratio: null,
                          duration_seconds: null,
                          model: value,
                          quality: settings.qualities[1],
                        }))
                        return
                      }

                      const settings = videoModelSettings[value]
                      setPricingForm((current) => ({
                        ...current,
                        aspect_ratio: settings.aspectRatios[0],
                        duration_seconds: parseDurationSeconds(settings.durations[0]),
                        model: value,
                        quality: settings.qualities[0],
                      }))
                    }}
                    options={pricingModelOptions}
                    value={pricingForm.model}
                  />
                  <AdminSelect
                    label="清晰度"
                    onChange={(value) => setPricingForm((current) => ({ ...current, quality: value }))}
                    options={pricingQualityOptions}
                    value={pricingForm.quality ?? ""}
                  />
                  {pricingForm.type === "video" && (
                    <>
                      <AdminSelect
                        label="时长（秒）"
                        onChange={(value) =>
                          setPricingForm((current) => ({ ...current, duration_seconds: parseDurationSeconds(value) }))
                        }
                        options={pricingDurationOptions}
                        value={formatDurationOption(pricingForm.duration_seconds)}
                      />
                      <AdminSelect
                        label="比例"
                        onChange={(value) => setPricingForm((current) => ({ ...current, aspect_ratio: value }))}
                        options={pricingAspectRatioOptions}
                        value={pricingForm.aspect_ratio ?? ""}
                      />
                    </>
                  )}
                  <AdminNumberInput
                    label="实际成本（元）"
                    onBlur={() => setPricingForm((current) => ({ ...current, cost_cny: normalizeCurrency(current.cost_cny) }))}
                    onChange={(value) => setPricingForm((current) => ({ ...current, cost_cny: value }))}
                    step="0.01"
                    value={pricingForm.cost_cny}
                  />
                  <AdminNumberInput
                    label="利润倍率"
                    onChange={(value) => setPricingForm((current) => ({ ...current, markup: value }))}
                    value={pricingForm.markup}
                  />
                  <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                    预计扣点：{calculatePricingCredits(pricingForm).toLocaleString()} 点（约 {(calculatePricingCredits(pricingForm) / 100).toFixed(2)} 元）
                  </div>
                </div>
                <Button className="mt-4 bg-indigo-600 text-white hover:bg-indigo-700" disabled={saving} onClick={handleSavePricing}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  保存模型价格
                </Button>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <h2 className="text-base font-semibold">模型价格列表</h2>
                <div className="mt-4 grid gap-3">
                  {modelPricing.length === 0 ? (
                    <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">暂无模型价格。</div>
                  ) : (
                    modelPricing.map((item) => (
                      <div className="rounded-lg border border-slate-200 p-4" key={item.id}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="font-medium text-slate-800">
                              {item.type === "image" ? "图片" : "视频"} · {item.model}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
                              {item.quality}
                              {item.duration_seconds ? ` · ${item.duration_seconds}秒` : ""}
                              {item.aspect_ratio ? ` · ${item.aspect_ratio}` : ""}
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                              成本 {item.cost_cny.toFixed(2)} 元 · 倍率 {item.markup} · 扣 {calculatePricingCredits(item)} 点
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button onClick={() => setPricingForm(item)} size="sm" variant="outline">
                              编辑
                            </Button>
                            <Button onClick={() => handleTogglePricing(item)} size="sm" variant={item.enabled ? "outline" : "default"}>
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
                          {item.name} / {item.price_cny.toFixed(2)} 元 / {item.credits} 点
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
                              {item.price_cny.toFixed(2)} 元 = {item.credits.toLocaleString()} 点
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                              {item.used_by ? `使用人：${item.used_by}` : "未使用"}
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

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <h2 className="text-base font-semibold">用户余额概览</h2>
                <div className="mt-4 grid gap-3">
                  {adminAccounts.length === 0 ? (
                    <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">暂无用户账户。</div>
                  ) : (
                    adminAccounts.slice(0, 10).map((item) => (
                      <div className="rounded-lg border border-slate-200 p-4" key={item.user_id}>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-800">{item.username ?? item.user_id}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {item.role} · {item.user_id} · {new Date(item.updated_at).toLocaleString("zh-CN")}
                            </div>
                          </div>
                          <div className="font-semibold text-emerald-700">{item.credit_balance.toLocaleString()} 点</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <h2 className="text-base font-semibold">最近点数流水</h2>
                <div className="mt-4 grid gap-3">
                  {recentLedger.length === 0 ? (
                    <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">暂无流水。</div>
                  ) : (
                    recentLedger.map((item) => (
                      <div className="rounded-lg border border-slate-200 p-4" key={`${item.userId}-${item.id}`}>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-800">{item.code}</div>
                            <div className="mt-1 truncate text-xs text-slate-500">
                              {item.userId} · {item.createdAt} · {item.type}
                            </div>
                          </div>
                          <div className={item.amount >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
                            {item.amount >= 0 ? "+" : ""}
                            {item.amount.toLocaleString()} 点
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="mx-auto max-w-xl rounded-lg border border-rose-200 bg-white p-6">
            <div className="flex items-center gap-2 text-rose-700">
              <AlertCircle className="h-5 w-5" />
              <h2 className="text-base font-semibold">无管理员权限</h2>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              当前账号不是管理员。请在 Supabase 的 `user_accounts` 表中将你的账号 `role` 设置为 `admin` 后重新登录。
            </p>
            <Button className="mt-5" onClick={() => onSectionChange("image")}>
              返回工作台
            </Button>
          </section>
        )}
      </div>
    </main>
  )
}

function AdminInput({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string
  onChange: (value: string) => void
  placeholder?: string
  value: string
}) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  )
}

function AdminSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: string) => void
  options: string[]
  value: string
}) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select
        className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function AdminMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function AdminNumberInput({
  label,
  onBlur,
  onChange,
  step = "1",
  value,
}: {
  label: string
  onBlur?: () => void
  onChange: (value: number) => void
  step?: string
  value: number
}) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
        min="0"
        onBlur={onBlur}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="number"
        value={value}
      />
    </label>
  )
}
