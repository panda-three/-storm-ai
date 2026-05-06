const ledgerDateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Shanghai",
  year: "numeric",
})

export function parseLedgerDate(createdAt: string) {
  const trimmed = createdAt.trim()
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T")
  const timestamp = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`)

  return Number.isFinite(timestamp) ? new Date(timestamp) : null
}

export function getLedgerTimeValue(createdAt: string) {
  return parseLedgerDate(createdAt)?.getTime() ?? 0
}

export function formatLedgerDateTime(createdAt: string) {
  const date = parseLedgerDate(createdAt)
  if (!date) return createdAt

  return ledgerDateTimeFormat.format(date).replace(/\//g, "-")
}
