"use client"

import { useEffect, useState } from "react"
import { Loader2, QrCode, Save } from "lucide-react"
import { AdminInput } from "@/components/admin/admin-form-controls"
import { useAdmin } from "@/components/admin/admin-provider"
import { Button } from "@/components/ui/button"
import { saveCustomerServiceSettings } from "@/lib/supabase"

export function CustomerServicePanel() {
  const { customerService, saving, setCustomerService, setFeedback, setSaving } = useAdmin()
  const [settingsForm, setSettingsForm] = useState(customerService)

  useEffect(() => {
    setSettingsForm(customerService)
  }, [customerService])

  const handleSaveSettings = async () => {
    setSaving(true)
    setFeedback(null)

    try {
      await saveCustomerServiceSettings(settingsForm)
      setCustomerService(settingsForm)
      setFeedback({ type: "success", message: "客服配置已保存。" })
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "客服配置保存失败。" })
    } finally {
      setSaving(false)
    }
  }

  return (
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
  )
}
