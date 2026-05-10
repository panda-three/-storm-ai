"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { getLedgerTypeLabel } from "@/components/admin/admin-utils"
import { useAdmin } from "@/components/admin/admin-provider"
import { formatLedgerDateTime, getLedgerTimeValue } from "@/lib/date-time"

const ledgerPageSize = 8

export function LedgerPanel() {
  const { adminAccounts } = useAdmin()
  const [ledgerPage, setLedgerPage] = useState(1)
  const allLedger = useMemo(
    () =>
      adminAccounts
        .flatMap((account) =>
          account.ledger.map((item) => ({
            ...item,
            username: account.username,
            userId: account.user_id,
          }))
        )
        .sort((a, b) => getLedgerTimeValue(b.createdAt) - getLedgerTimeValue(a.createdAt)),
    [adminAccounts]
  )
  const ledgerPageCount = Math.max(1, Math.ceil(allLedger.length / ledgerPageSize))
  const currentLedgerPage = Math.min(ledgerPage, ledgerPageCount)
  const visibleLedger = allLedger.slice((currentLedgerPage - 1) * ledgerPageSize, currentLedgerPage * ledgerPageSize)
  const ledgerStart = allLedger.length === 0 ? 0 : (currentLedgerPage - 1) * ledgerPageSize + 1
  const ledgerEnd = Math.min(currentLedgerPage * ledgerPageSize, allLedger.length)
  const ledgerPages = Array.from({ length: ledgerPageCount }, (_, index) => index + 1).filter(
    (page) => ledgerPageCount <= 5 || page === 1 || page === ledgerPageCount || Math.abs(page - currentLedgerPage) <= 1
  )
  const ledgerPageItems = ledgerPages.reduce<Array<number | "ellipsis">>((items, page) => {
    const previous = items[items.length - 1]
    if (typeof previous === "number" && page - previous > 1) {
      items.push("ellipsis")
    }
    items.push(page)
    return items
  }, [])

  useEffect(() => {
    if (ledgerPage > ledgerPageCount) {
      setLedgerPage(ledgerPageCount)
    }
  }, [ledgerPage, ledgerPageCount])

  useEffect(() => {
    setLedgerPage(1)
  }, [adminAccounts])

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold">最近点数流水</h2>
        {allLedger.length > 0 && (
          <div className="text-xs text-slate-500">
            第 {ledgerStart}-{ledgerEnd} 条，共 {allLedger.length} 条
          </div>
        )}
      </div>
      <div className="mt-4 grid gap-3">
        {visibleLedger.length === 0 ? (
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">暂无流水。</div>
        ) : (
          visibleLedger.map((item) => (
            <div className="rounded-lg border border-slate-200 p-4" key={`${item.userId}-${item.id}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{item.code}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {item.username ?? "未设置用户名"} · {item.userId}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-400">
                    {formatLedgerDateTime(item.createdAt)} · {getLedgerTypeLabel(item.type)}
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
      {ledgerPageCount > 1 && (
        <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            disabled={currentLedgerPage === 1}
            onClick={() => setLedgerPage((page) => Math.max(1, page - 1))}
            size="sm"
            variant="outline"
          >
            上一页
          </Button>
          <div className="flex flex-wrap justify-center gap-1">
            {ledgerPageItems.map((item, index) =>
              item === "ellipsis" ? (
                <span className="flex h-8 w-8 items-center justify-center text-sm text-slate-400" key={`ellipsis-${index}`}>
                  ...
                </span>
              ) : (
                <Button
                  className="h-8 w-8 p-0"
                  key={item}
                  onClick={() => setLedgerPage(item)}
                  size="sm"
                  variant={item === currentLedgerPage ? "default" : "ghost"}
                >
                  {item}
                </Button>
              )
            )}
          </div>
          <Button
            disabled={currentLedgerPage === ledgerPageCount}
            onClick={() => setLedgerPage((page) => Math.min(ledgerPageCount, page + 1))}
            size="sm"
            variant="outline"
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  )
}
