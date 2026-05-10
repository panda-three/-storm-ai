"use client"

import { useAdmin } from "@/components/admin/admin-provider"

export function UsersPanel() {
  const { adminAccounts } = useAdmin()

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold">用户余额概览</h2>
      <div className="mt-4 grid gap-3">
        {adminAccounts.length === 0 ? (
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">暂无用户账户。</div>
        ) : (
          adminAccounts.map((item) => (
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
  )
}
