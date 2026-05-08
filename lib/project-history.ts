import { formatLedgerDateTime } from "@/lib/date-time"
import type { GenerationJob } from "@/lib/generation-jobs"

export type ProjectType = "生图" | "视频"
export type ProjectStatus = "已完成" | "生成中" | "失败"

export interface ProjectItem {
  id: string
  title: string
  type: ProjectType
  status: ProjectStatus
  time: string
  model?: string
  palette?: string
  prompt?: string
  previewLabel?: string
  previewUrl?: string
  taskId?: string
  taskError?: string
}

export function normalizeProjectItem(project: ProjectItem): ProjectItem {
  const rawStatus = String(project.status ?? "").trim().toLowerCase()
  let status: ProjectStatus

  if (["已完成", "completed", "complete", "success", "succeeded", "done", "finished"].includes(rawStatus)) {
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

  return {
    ...project,
    status,
  }
}

function normalizeGenerationJobStatus(status: GenerationJob["status"]): ProjectStatus {
  if (status === "completed") return "已完成"
  if (status === "failed") return "失败"
  return "生成中"
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
    model: job.model,
    palette: isImage ? "from-indigo-500 via-sky-400 to-emerald-300" : "from-slate-950 via-indigo-700 to-cyan-400",
    prompt: job.prompt,
    previewUrl: resultUrls[0] ?? "",
    taskId: job.id,
    taskError: job.task_error ?? "",
  })
}

export function mergeProjectHistories(serverProjects: ProjectItem[], localProjects: ProjectItem[]) {
  const merged: ProjectItem[] = []
  const indexesByKey = new Map<string, number>()

  const getKeys = (project: ProjectItem) => [project.taskId, project.id].filter(Boolean) as string[]

  const addProject = (project: ProjectItem, preferServerFields: boolean) => {
    const normalized = normalizeProjectItem(project)
    const existingIndex = getKeys(normalized)
      .map((key) => indexesByKey.get(key))
      .find((index): index is number => typeof index === "number")

    if (existingIndex === undefined) {
      const nextIndex = merged.length
      merged.push(normalized)
      getKeys(normalized).forEach((key) => indexesByKey.set(key, nextIndex))
      return
    }

    const existing = merged[existingIndex]
    merged[existingIndex] = preferServerFields
      ? normalizeProjectItem({
          ...normalized,
          id: existing.id,
          palette: existing.palette ?? normalized.palette,
          previewLabel: existing.previewLabel ?? normalized.previewLabel,
          title: existing.title || normalized.title,
        })
      : normalizeProjectItem({
          ...normalized,
          status: existing.status,
          id: normalized.id,
          palette: normalized.palette ?? existing.palette,
          previewLabel: normalized.previewLabel ?? existing.previewLabel,
          previewUrl: existing.previewUrl || normalized.previewUrl,
          taskError: existing.taskError || normalized.taskError,
        })
  }

  serverProjects.forEach((project) => addProject(project, true))
  localProjects.forEach((project) => addProject(project, false))

  return merged
}
