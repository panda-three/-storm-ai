"use client"

import { AdminProvider } from "@/components/admin/admin-provider"
import { AdminShell } from "@/components/admin/admin-shell"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider>
      <AdminShell>{children}</AdminShell>
    </AdminProvider>
  )
}
