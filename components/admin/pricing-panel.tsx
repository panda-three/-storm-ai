"use client"

import { useState } from "react"
import { Loader2, Save, SlidersHorizontal } from "lucide-react"
import { AdminNumberInput, AdminSelect } from "@/components/admin/admin-form-controls"
import {
  formatDurationOption,
  getDefaultPricingForm,
  normalizeCurrency,
  parseDurationSeconds,
} from "@/components/admin/admin-utils"
import { useAdmin } from "@/components/admin/admin-provider"
import { Button } from "@/components/ui/button"
import { adminVideoModelOptions, imageModelOptions, imageModelSettings, videoModelSettings } from "@/lib/model-options"
import type { ModelPricing } from "@/lib/supabase"
import { calculatePricingCredits, saveModelPricing } from "@/lib/supabase"

export function PricingPanel() {
  const { modelPricing, refreshAdminConfig, saving, setFeedback, setModelPricing, setSaving } = useAdmin()
  const [pricingForm, setPricingForm] = useState<Omit<ModelPricing, "id"> & { id?: string }>(() => getDefaultPricingForm("image"))
  const pricingModelOptions = pricingForm.type === "image" ? imageModelOptions : adminVideoModelOptions
  const pricingImageSettings = pricingForm.type === "image" ? imageModelSettings[pricingForm.model] : null
  const pricingVideoSettings = pricingForm.type === "video" ? videoModelSettings[pricingForm.model] : null
  const pricingQualityOptions = pricingImageSettings?.qualities ?? pricingVideoSettings?.qualities ?? []
  const pricingDurationOptions = pricingVideoSettings?.durations ?? []

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
      (!pricingForm.duration_seconds || !pricingDurationOptions.includes(formatDurationOption(pricingForm.duration_seconds)))
    ) {
      setFeedback({ type: "error", message: "请选择有效视频时长。" })
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
        aspect_ratio: null,
        cost_cny: normalizeCurrency(pricingForm.cost_cny),
        model: pricingForm.model,
        quality: pricingForm.quality,
      })
      await refreshAdminConfig()
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
      setModelPricing(modelPricing.map((item) => (item.id === pricing.id ? { ...item, enabled: !item.enabled } : item)))
      setFeedback({ type: "success", message: pricing.enabled ? "模型价格已停用。" : "模型价格已启用。" })
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "模型价格状态更新失败。" })
    } finally {
      setSaving(false)
    }
  }

  return (
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
              onChange={(event) => setPricingForm(getDefaultPricingForm(event.target.value as "image" | "video"))}
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
                aspect_ratio: null,
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
            <AdminSelect
              label="时长（秒）"
              onChange={(value) => setPricingForm((current) => ({ ...current, duration_seconds: parseDurationSeconds(value) }))}
              options={pricingDurationOptions}
              value={formatDurationOption(pricingForm.duration_seconds)}
            />
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
  )
}
