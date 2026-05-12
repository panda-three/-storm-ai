"use client"

import { useCallback, useEffect, useState } from "react"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import {
  createDefaultAccount,
  loadLocalAccount,
  saveLocalAccount,
  type LocalAccountData,
} from "@/lib/local-store"
import {
  filterAccountCachedProjects,
  mergeProjectHistories,
  mergeSyncedProjectHistories,
  normalizeProjectItem,
  type ProjectItem,
} from "@/lib/project-history"
import {
  getSupabaseClient,
  loadSupabaseAccount,
  saveSupabaseAccount,
} from "@/lib/supabase"

export type AccountStatus = "idle" | "loading" | "ready" | "error"

type AccountSessionData = LocalAccountData & {
  mustChangePassword?: boolean
  temporaryPasswordSetAt?: string | null
  temporaryPasswordSetBy?: string | null
}

type RemoteAccountSessionFields = {
  must_change_password?: boolean
  temporary_password_set_at?: string | null
  temporary_password_set_by?: string | null
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }
  return fallback
}

function isInvalidRefreshTokenError(error: unknown) {
  const message = getErrorMessage(error, "")
  return message.includes("Invalid Refresh Token") || message.includes("Refresh Token Not Found")
}

function isSessionInvalidError(error: unknown) {
  const message = getErrorMessage(error, "")
  return (
    isInvalidRefreshTokenError(error) ||
    message.includes("登录状态已失效") ||
    message.includes("请先登录") ||
    message.includes("其他设备登录") ||
    message.includes("解除登录占用") ||
    message.includes("重新登录")
  )
}

async function clearLocalSupabaseSession(supabase: SupabaseClient) {
  try {
    await supabase.auth.signOut({ scope: "local" })
  } catch {
    // Ignore cleanup failures; the next login will overwrite the local auth state.
  }

  if (typeof window === "undefined") return

  const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseHost) return

  try {
    const projectRef = new URL(supabaseHost).hostname.split(".")[0]
    if (!projectRef) return

    const storageKey = `sb-${projectRef}-auth-token`
    window.localStorage.removeItem(storageKey)
    window.sessionStorage.removeItem(storageKey)
  } catch {
    // Storage cleanup is best effort only.
  }
}

function createAccountFromRemote(userId: string, remoteAccount: Awaited<ReturnType<typeof loadSupabaseAccount>>): LocalAccountData {
  const remoteSessionFields = remoteAccount as (typeof remoteAccount & RemoteAccountSessionFields) | null
  const account: AccountSessionData = {
    creditBalance: remoteAccount?.credit_balance ?? 0,
    ledger: remoteAccount?.ledger ?? [],
    membershipExpiresAt: remoteAccount?.membership_expires_at ?? null,
    membershipFreeImageQualities: remoteAccount?.membership_free_image_qualities ?? [],
    membershipTier: remoteAccount?.membership_tier ?? null,
    mustChangePassword: remoteSessionFields?.must_change_password ?? false,
    projects: filterAccountCachedProjects(remoteAccount?.projects ?? []),
    redeemedCodes: remoteAccount?.redeemed_codes ?? [],
    role: remoteAccount?.role ?? "user",
    temporaryPasswordSetAt: remoteSessionFields?.temporary_password_set_at ?? null,
    temporaryPasswordSetBy: remoteSessionFields?.temporary_password_set_by ?? null,
    userId,
  }

  return account
}

async function loadServerHistoryProjects() {
  const supabase = getSupabaseClient()
  if (!supabase) return []

  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  const token = data.session?.access_token
  if (!token) return []

  const response = await fetch("/api/history", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || !payload.ok) {
    throw new Error(getErrorMessage(payload, "读取生成历史失败。"))
  }

  return Array.isArray(payload.projects)
    ? payload.projects.filter((item: unknown): item is ProjectItem => typeof item === "object" && item !== null).map(normalizeProjectItem)
    : []
}

export function useAccountSession() {
  const [account, setAccount] = useState<LocalAccountData | null>(() => loadLocalAccount())
  const [accountStatus, setAccountStatus] = useState<AccountStatus>("idle")
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [syncError, setSyncError] = useState("")
  const userId = user?.id ?? ""

  const clearSession = useCallback(async (message?: string) => {
    const supabase = getSupabaseClient()
    if (supabase) {
      await clearLocalSupabaseSession(supabase)
    }

    setUser(null)
    setAccount(createDefaultAccount())
    setAccountStatus("idle")
    setAuthReady(true)
    setSyncError(message ?? "")
  }, [])

  useEffect(() => {
    let active = true
    const supabase = getSupabaseClient()

    if (!supabase) {
      setAuthReady(true)
      return
    }

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return

      if (error) {
        if (isSessionInvalidError(error)) {
          await clearSession()
          return
        }

        setSyncError(getErrorMessage(error, "加载登录状态失败。"))
        setUser(null)
        setAuthReady(true)
        return
      }

      setUser(data.session?.user ?? null)
      setAuthReady(true)
    }).catch(async (error) => {
      if (!active) return

      if (isSessionInvalidError(error)) {
        await clearSession()
        return
      }

      setSyncError(getErrorMessage(error, "加载登录状态失败。"))
      setUser(null)
      setAuthReady(true)
    })

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") {
        setAuthReady(true)
        return
      }

      if (event === "SIGNED_OUT") {
        setUser(null)
        setAuthReady(true)
        return
      }

      setUser((current) => {
        const nextUser = session?.user ?? null

        if (current?.id === nextUser?.id) {
          return current
        }

        return nextUser
      })
      setAuthReady(true)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [clearSession])

  useEffect(() => {
    let active = true

    async function loadAccount() {
      if (!userId) {
        setAccountStatus("idle")
        setAccount(loadLocalAccount())
        return
      }

      try {
        setSyncError("")
        setAccountStatus("loading")
        setAccount(null)
        const remoteAccount = await loadSupabaseAccount(userId)
        if (!active) return

        let serverProjects: ProjectItem[] = []
        let historyError = ""
        try {
          serverProjects = await loadServerHistoryProjects()
        } catch (error) {
          if (!active) return

          const message = getErrorMessage(error, "读取生成历史失败。")
          if (isSessionInvalidError(error)) {
            clearSession(message)
            return
          }

          historyError = message
        }
        if (!active) return

        const cachedAccount = createAccountFromRemote(userId, remoteAccount)
        setAccount((current) => {
          const cachedProjects = mergeProjectHistories(cachedAccount.projects, current?.projects ?? [])
          return {
            ...cachedAccount,
            projects: mergeSyncedProjectHistories(serverProjects, cachedProjects),
          }
        })
        setAccountStatus("ready")
        if (historyError) setSyncError(historyError)
      } catch (error) {
        if (!active) return
        const message = getErrorMessage(error, "加载 Supabase 数据失败。")
        if (isSessionInvalidError(error)) {
          clearSession(message)
          return
        }

        setAccount(null)
        setAccountStatus("error")
        setSyncError(message)
      }
    }

    loadAccount()

    return () => {
      active = false
    }
  }, [clearSession, userId])

  useEffect(() => {
    if (!userId || !account || accountStatus !== "ready" || account.userId !== userId) return

    const timer = window.setTimeout(() => {
      saveSupabaseAccount(account).catch((error) => {
        setSyncError(getErrorMessage(error, "保存 Supabase 数据失败。"))
      })
    }, 400)

    return () => window.clearTimeout(timer)
  }, [account, accountStatus, userId])

  useEffect(() => {
    if (userId || !account) return
    saveLocalAccount(account)
  }, [account, userId])

  const refreshAccount = useCallback(async () => {
    if (!userId) return

    try {
      setSyncError("")
      const remoteAccount = await loadSupabaseAccount(userId)
      const refreshedAccount = createAccountFromRemote(userId, remoteAccount)

      let serverProjects: ProjectItem[] = []
      let historyError = ""
      try {
        serverProjects = await loadServerHistoryProjects()
      } catch (error) {
        const message = getErrorMessage(error, "读取生成历史失败。")
        if (isSessionInvalidError(error)) {
          clearSession(message)
          return
        }

        historyError = message
      }

      setAccount((current) => {
        const cachedProjects = mergeProjectHistories(refreshedAccount.projects, current?.projects ?? [])
        return {
          ...refreshedAccount,
          projects: mergeSyncedProjectHistories(serverProjects, cachedProjects),
        }
      })
      setAccountStatus("ready")
      if (historyError) setSyncError(historyError)
    } catch (error) {
      const message = getErrorMessage(error, "刷新 Supabase 数据失败。")
      if (isSessionInvalidError(error)) {
        clearSession(message)
        return
      }

      setAccount((current) => {
        if (!current) setAccountStatus("error")
        return current
      })
      setSyncError(message)
    }
  }, [clearSession, userId])

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient()
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error && isInvalidRefreshTokenError(error)) {
        await clearLocalSupabaseSession(supabase)
      } else if (error) {
        setSyncError(getErrorMessage(error, "退出登录失败。"))
      }
    }
    setUser(null)
    setAccount(createDefaultAccount())
    setAccountStatus("idle")
  }, [])

  return {
    account,
    accountStatus,
    authReady,
    refreshAccount,
    setAccount,
    setSyncError,
    signOut,
    syncError,
    user,
    userId,
  }
}
