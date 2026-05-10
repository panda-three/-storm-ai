"use client"

export function AdminInput({
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

export function AdminSelect({
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

export function AdminNumberInput({
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

export function AdminMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  )
}
