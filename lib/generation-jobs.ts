import { getSupabaseServerClient } from "@/lib/server-supabase"
import { describeServerError } from "@/lib/server-supabase"
import type { GenerationKind, NormalizedTaskStatus } from "@/lib/apimart"

export type GenerationJobStatus = "submitted" | "processing" | "completed" | "failed"

export interface GenerationJob {
  id: string
  amount: number
  check_attempts: number
  completed_at: string | null
  created_at: string
  last_checked_at: string | null
  last_sync_error: string | null
  model: string
  next_check_at: string | null
  prompt: string
  provider: string
  reference: string
  result_urls: string[]
  status: GenerationJobStatus
  sync_locked_until: string | null
  task_error: string | null
  type: GenerationKind
  upstream_task_id: string | null
  user_id: string
}

const generationJobSelect =
  "id, amount, check_attempts, completed_at, created_at, last_checked_at, last_sync_error, model, next_check_at, prompt, provider, reference, result_urls, status, sync_locked_until, task_error, type, upstream_task_id, user_id"
const legacyGenerationJobSelect =
  "id, amount, created_at, model, prompt, provider, reference, result_urls, status, task_error, type, upstream_task_id, user_id"

export async function createGenerationJob({
  amount,
  model,
  prompt,
  provider,
  reference,
  type,
  userId,
}: {
  amount: number
  model: string
  prompt: string
  provider: string
  reference: string
  type: GenerationKind
  userId: string
}) {
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .insert({
      amount,
      model,
      prompt,
      provider,
      reference,
      status: "submitted",
      type,
      user_id: userId,
    })
    .select(generationJobSelect)
    .single()

  if (error) {
    throw new Error(describeServerError(error, "创建生成任务失败。"), { cause: error })
  }
  return data as GenerationJob
}

export async function updateGenerationJob(
  id: string,
  values: Partial<
    Pick<
      GenerationJob,
      | "check_attempts"
      | "completed_at"
      | "last_checked_at"
      | "last_sync_error"
      | "next_check_at"
      | "result_urls"
      | "status"
      | "sync_locked_until"
      | "task_error"
      | "upstream_task_id"
    >
  >
) {
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(generationJobSelect)
    .single()

  if (error) {
    throw new Error(describeServerError(error, "更新生成任务失败。"), { cause: error })
  }
  return data as GenerationJob
}

export async function loadGenerationJobForUser({
  taskId,
  userId,
}: {
  taskId: string
  userId: string
}) {
  if (!isUuid(taskId)) {
    return loadGenerationJobByUpstreamTaskForUser({ taskId, userId })
  }

  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取生成任务失败。"), { cause: error })
  }
  return data as GenerationJob | null
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function loadGenerationJobByUpstreamTaskForUser({
  taskId,
  userId,
}: {
  taskId: string
  userId: string
}) {
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("upstream_task_id", taskId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取上游生成任务失败。"), { cause: error })
  }
  return data as GenerationJob | null
}

export async function loadGenerationJobsForUser({
  limit = 100,
  userId,
}: {
  limit?: number
  userId: string
}) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    if (isMissingSyncColumnError(error)) {
      const { data: legacyData, error: legacyError } = await supabase
        .from("generation_jobs")
        .select(legacyGenerationJobSelect)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit)

      if (!legacyError) {
        return (legacyData ?? []).map(withDefaultSyncFields) as GenerationJob[]
      }
    }

    throw new Error(describeServerError(error, "读取生成历史失败。"), { cause: error })
  }
  return (data ?? []) as GenerationJob[]
}

function withDefaultSyncFields(job: Partial<GenerationJob>): GenerationJob {
  return {
    check_attempts: 0,
    completed_at: null,
    last_checked_at: null,
    last_sync_error: null,
    next_check_at: null,
    sync_locked_until: null,
    ...job,
  } as GenerationJob
}

function isMissingSyncColumnError(error: unknown) {
  const message = describeServerError(error, "")
  return (
    message.includes("check_attempts") ||
    message.includes("completed_at") ||
    message.includes("last_checked_at") ||
    message.includes("last_sync_error") ||
    message.includes("next_check_at") ||
    message.includes("sync_locked_until")
  )
}

export async function loadDueApimartGenerationJobs({ limit = 20 } = {}) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("provider", "apimart")
    .in("status", ["submitted", "processing"])
    .not("upstream_task_id", "is", null)
    .lte("next_check_at", now)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .order("next_check_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(describeServerError(error, "读取待同步任务失败。"), { cause: error })
  }
  return (data ?? []) as GenerationJob[]
}

export async function lockGenerationJobForSync(id: string, lockMs = 2 * 60 * 1000) {
  const now = new Date().toISOString()
  const lockUntil = new Date(Date.now() + lockMs).toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .update({
      sync_locked_until: lockUntil,
      updated_at: now,
    })
    .eq("id", id)
    .in("status", ["submitted", "processing"])
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .select(generationJobSelect)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "锁定生成任务失败。"), { cause: error })
  }
  return data as GenerationJob | null
}

export function normalizeJobTaskStatus(job: GenerationJob): NormalizedTaskStatus {
  const isImage = job.type === "image"

  return {
    ok: true,
    mode: job.provider === "mock" ? "mock" : "apimart",
    taskId: job.id,
    status: job.status,
    progress: job.status === "completed" || job.status === "failed" ? 100 : 0,
    imageUrls: isImage ? job.result_urls : [],
    videoUrl: isImage ? "" : job.result_urls[0] ?? "",
    taskError: job.task_error ?? "",
    raw: job,
  }
}
