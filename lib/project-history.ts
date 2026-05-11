import { formatLedgerDateTime } from "@/lib/date-time"
import type { GenerationJob } from "@/lib/generation-jobs"

export type ProjectType = "生图" | "视频"
export type ProjectStatus = "已完成" | "生成中" | "失败" | "部分完成"

export interface ProjectItem {
  id: string
  title: string
  type: ProjectType
  status: ProjectStatus
  time: string
  clientRequestId?: string
  deletedAt?: string
  expectedCount?: number
  model?: string
  palette?: string
  prompt?: string
  imageUrls?: string[]
  previewLabel?: string
  previewUrl?: string
  ratio?: string
  stage?: string
  taskId?: string
  taskError?: string
  upstreamTaskId?: string
}

export const generationRetentionNotice = "温馨提示：作品在服务器仅保留 1 天，请及时下载到本地保存。"

export function normalizeProjectItem(project: ProjectItem): ProjectItem {
  const rawStatus = String(project.status ?? "").trim().toLowerCase()
  let status: ProjectStatus

  if (["部分完成", "partial_completed", "partial completed", "partially_completed", "partial"].includes(rawStatus)) {
    status = "部分完成"
  } else if (["已完成", "completed", "complete", "success", "succeeded", "done", "finished"].includes(rawStatus)) {
    status = "已完成"
  } else if (["生成中", "submitted", "processing", "pending", "running"].includes(rawStatus)) {
    status = "生成中"
  } else if (["失败", "failed", "fail", "error"].includes(rawStatus)) {
    status = "失败"
  } else if (project.taskError) {
    status = "失败"
  } else if (project.previewUrl) {
    status = "已完成"
  } else {
    status = "生成中"
  }

  const imageUrls = normalizeImageUrls(project.imageUrls, project.previewUrl)

  return {
    ...project,
    expectedCount: normalizeExpectedCount(project.expectedCount, imageUrls.length),
    imageUrls,
    previewUrl: project.previewUrl || imageUrls[0] || "",
    status,
  }
}

export function isDeletedProjectItem(project: ProjectItem) {
  return Boolean(project.deletedAt)
}

function getProjectKeys(project: ProjectItem) {
  const keys = new Set<string>()
  ;[project.clientRequestId, project.taskId, project.upstreamTaskId, project.id].forEach((key) => {
    if (key) keys.add(key)
  })

  if (project.taskId) keys.add(`job-${project.taskId}`)
  if (project.id?.startsWith("job-")) keys.add(project.id.slice(4))

  return Array.from(keys)
}

export function createDeletedProjectItem(project: ProjectItem): ProjectItem {
  return normalizeProjectItem({
    id: project.id,
    title: project.title || "已删除项目",
    type: project.type,
    status: project.status,
    time: project.time,
    deletedAt: new Date().toISOString(),
    clientRequestId: project.clientRequestId,
    taskId: project.taskId,
    upstreamTaskId: project.upstreamTaskId,
  })
}

export function isServerBackedProjectItem(project: ProjectItem) {
  return Boolean(project.taskId && !project.id.startsWith("pending-") && !project.id.startsWith("seed-"))
}

function isTerminalProjectStatus(status: ProjectStatus) {
  return status === "已完成" || status === "部分完成" || status === "失败"
}

export function filterAccountCachedProjects(projects: ProjectItem[]) {
  return projects.map(normalizeProjectItem).filter((project) => {
    if (isDeletedProjectItem(project)) return true
    return !isServerBackedProjectItem(project)
  })
}

function isLegacyPendingProjectItem(project: ProjectItem) {
  return project.id.startsWith("pending-") && !project.clientRequestId
}

function getLegacyPendingMatchKey(project: ProjectItem) {
  return [
    project.type,
    project.model ?? "",
    project.prompt ?? project.title,
  ].join("\u001f")
}

function normalizeGenerationJobStatus(status: GenerationJob["status"]): ProjectStatus {
  if (status === "completed") return "已完成"
  if (status === "partial_completed") return "部分完成"
  if (status === "failed") return "失败"
  return "生成中"
}

function normalizeImageUrls(imageUrls: unknown, previewUrl?: string) {
  const urls = Array.isArray(imageUrls) ? imageUrls.filter((url): url is string => typeof url === "string" && url.length > 0) : []
  if (previewUrl && !urls.includes(previewUrl)) {
    return [previewUrl, ...urls]
  }
  return urls
}

function normalizeExpectedCount(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 4) return parsed
  return Math.max(1, Math.min(4, fallback || 1))
}

function mergeImageUrls(primary: ProjectItem, fallback: ProjectItem) {
  return Array.from(
    new Set([...(primary.imageUrls ?? []), ...(fallback.imageUrls ?? [])].filter((url): url is string => Boolean(url)))
  )
}

export function generationJobToProjectItem(job: GenerationJob): ProjectItem {
  const isImage = job.type === "image"
  const resultUrls = Array.isArray(job.result_urls) ? job.result_urls.filter((url) => typeof url === "string") : []

  return normalizeProjectItem({
    id: `job-${job.id}`,
    title: job.prompt.slice(0, 22) || (isImage ? "未命名生图任务" : "未命名视频任务"),
    type: isImage ? "生图" : "视频",
    status: normalizeGenerationJobStatus(job.status),
    time: formatLedgerDateTime(job.created_at),
    clientRequestId: job.client_request_id ?? undefined,
    model: job.model,
    palette: isImage ? "from-indigo-500 via-sky-400 to-emerald-300" : "from-slate-950 via-indigo-700 to-cyan-400",
    prompt: job.prompt,
    expectedCount: job.expected_result_count,
    imageUrls: isImage ? resultUrls : [],
    previewUrl: resultUrls[0] ?? "",
    taskId: job.id,
    taskError: job.task_error ?? "",
    upstreamTaskId: job.upstream_task_id ?? undefined,
  })
}

export function mergeProjectHistories(serverProjects: ProjectItem[], localProjects: ProjectItem[]) {
  const merged: ProjectItem[] = []
  const indexesByKey = new Map<string, number>()

  const addProject = (project: ProjectItem, preferServerFields: boolean) => {
    const normalized = normalizeProjectItem(project)
    const existingIndex = getProjectKeys(normalized)
      .map((key) => indexesByKey.get(key))
      .find((index): index is number => typeof index === "number")

    if (existingIndex === undefined) {
      const nextIndex = merged.length
      merged.push(normalized)
      getProjectKeys(normalized).forEach((key) => indexesByKey.set(key, nextIndex))
      return
    }

    const existing = merged[existingIndex]
    if (isDeletedProjectItem(existing) || isDeletedProjectItem(normalized)) {
      merged[existingIndex] = isDeletedProjectItem(normalized) ? normalized : existing
      getProjectKeys(merged[existingIndex]).forEach((key) => indexesByKey.set(key, existingIndex))
      return
    }

    merged[existingIndex] = preferServerFields
      ? normalizeProjectItem({
          ...normalized,
          id: existing.id.startsWith("pending-") ? normalized.id : existing.id,
          clientRequestId: normalized.clientRequestId || existing.clientRequestId,
          palette: existing.palette ?? normalized.palette,
          imageUrls: mergeImageUrls(normalized, existing),
          previewLabel: existing.previewLabel ?? normalized.previewLabel,
          previewUrl: normalized.previewUrl || existing.previewUrl,
          status: normalized.status,
          taskError: normalized.taskError,
          title: existing.title || normalized.title,
          upstreamTaskId: normalized.upstreamTaskId || existing.upstreamTaskId,
        })
      : normalizeProjectItem({
          ...normalized,
          status:
            isServerBackedProjectItem(existing) || isTerminalProjectStatus(existing.status)
              ? existing.status
              : normalized.status,
          id: normalized.id,
          clientRequestId: existing.clientRequestId || normalized.clientRequestId,
          palette: normalized.palette ?? existing.palette,
          imageUrls: isServerBackedProjectItem(existing) ? mergeImageUrls(existing, normalized) : mergeImageUrls(normalized, existing),
          previewLabel: normalized.previewLabel ?? existing.previewLabel,
          previewUrl: isServerBackedProjectItem(existing) ? existing.previewUrl || normalized.previewUrl : normalized.previewUrl || existing.previewUrl,
          taskError: isServerBackedProjectItem(existing) ? existing.taskError || normalized.taskError : normalized.taskError || existing.taskError,
          upstreamTaskId: existing.upstreamTaskId || normalized.upstreamTaskId,
        })
  }

  serverProjects.forEach((project) => addProject(project, true))
  localProjects.forEach((project) => addProject(project, false))

  return merged
}

export function mergeSyncedProjectHistories(serverProjects: ProjectItem[], localProjects: ProjectItem[]) {
  const serverTaskIds = new Set(serverProjects.map((project) => project.taskId).filter(Boolean))
  const serverClientRequestIds = new Set(serverProjects.map((project) => project.clientRequestId).filter(Boolean))
  const serverLegacyPendingMatchKeys = new Set(serverProjects.map(getLegacyPendingMatchKey))
  const visibleLocalProjects = localProjects.filter((project) => {
    if (isServerBackedProjectItem(project)) return serverTaskIds.has(project.taskId)
    if (project.id.startsWith("pending-") && project.clientRequestId && serverClientRequestIds.has(project.clientRequestId)) {
      return false
    }
    if (isLegacyPendingProjectItem(project) && serverLegacyPendingMatchKeys.has(getLegacyPendingMatchKey(project))) {
      return false
    }
    return true
  })

  return mergeProjectHistories(serverProjects, visibleLocalProjects)
}
