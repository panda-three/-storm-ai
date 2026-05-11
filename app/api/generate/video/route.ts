import { NextResponse } from "next/server"
import {
  createGenerationJobWithBilling,
  failGenerationJobWithRefund,
  updateActiveGenerationJob,
} from "@/lib/generation-jobs"
import { createVideoGeneration, normalizeVideoDuration, uploadApimartImage } from "@/lib/apimart"
import { createMengfactoryVideo } from "@/lib/mengfactory"
import { calculatePricingCredits, type ModelPricing } from "@/lib/supabase"
import {
  getSupabaseServerClient,
  describeServerError,
  requireAuthenticatedUser,
  uploadGeneratedImage,
} from "@/lib/server-supabase"
import {
  isMengfactoryVeoVideoModel,
  legacyApimartVeoVideoModelName,
  videoModelSettings,
} from "@/lib/model-options"
import {
  getReferenceImageBucket,
  getReferenceImagePathPrefix,
  maxReferenceImages,
  type StoredReferenceImage,
  validateReferenceImageMetadata,
} from "@/lib/reference-images"

interface PreparedVideoReferenceImage {
  bucket?: string
  buffer: Buffer
  mimeType: string
  name: string
  path?: string
  publicUrl?: string
}

export async function POST(request: Request) {
  let billingReason = ""
  let clientRequestId = ""
  let jobId = ""
  let upstreamTaskId = ""
  let userId = ""
  let preparedReferenceImages: PreparedVideoReferenceImage[] = []
  let cleanupPreparedReferenceImages = true

  try {
    const auth = await requireAuthenticatedUser(request)
    userId = auth.userId
    const contentType = request.headers.get("content-type") ?? ""
    const body = contentType.includes("multipart/form-data") ? await request.formData() : await request.json()
    const getValue = (key: string) => (body instanceof FormData ? body.get(key) : body[key])
    const prompt = String(getValue("prompt") ?? "").trim()

    if (!prompt) {
      return NextResponse.json({ ok: false, error: "请先输入视频提示词。" }, { status: 400 })
    }

    const model = String(getValue("model") ?? legacyApimartVeoVideoModelName)
    const duration = String(getValue("duration") ?? "5 秒")
    const quality = String(getValue("quality") ?? "720P")
    const aspectRatio = String(getValue("aspectRatio") ?? "16:9")
    clientRequestId = String(getValue("clientRequestId") ?? "").trim()
    const referenceFiles = body instanceof FormData ? body.getAll("referenceImages").filter(isImageFile) : []
    const storedReferenceImages = body instanceof FormData ? [] : parseStoredReferenceImages(getValue("referenceImages"))
    const modelSettings = videoModelSettings[model]

    if (!modelSettings) {
      return NextResponse.json({ ok: false, error: "请选择有效视频模型。" }, { status: 400 })
    }

    if (!modelSettings.qualities.includes(quality)) {
      return NextResponse.json({ ok: false, error: "请选择当前模型支持的视频清晰度。" }, { status: 400 })
    }

    if (!modelSettings.aspectRatios.includes(aspectRatio)) {
      return NextResponse.json({ ok: false, error: "请选择当前模型支持的视频比例。" }, { status: 400 })
    }

    validateReferenceFiles(referenceFiles)
    validateStoredReferenceImages(storedReferenceImages, userId)

    if (referenceFiles.length > 0 && storedReferenceImages.length > 0) {
      return NextResponse.json(
        { ok: false, error: "请不要同时提交参考图文件和参考图存储地址。" },
        { status: 400 }
      )
    }

    const pricing = await loadVideoPricing({
      durationSeconds: normalizeVideoDuration(duration),
      model,
      quality,
    })
    if (!pricing) {
      return NextResponse.json({ ok: false, error: "当前模型参数未配置价格，请联系管理员配置后再生成。" }, { status: 400 })
    }

    const billingAmount = calculatePricingCredits(pricing)
    const billingReference = `generate_video_${Date.now()}_${crypto.randomUUID()}`
    billingReason = `AI 视频 · ${model} · ${duration} · ${quality} · ${aspectRatio}`

    logGenerateVideo("input", {
      contentType: body instanceof FormData ? "multipart/form-data" : "application/json",
      promptLength: prompt.length,
      model,
      duration,
      quality,
      aspectRatio,
      clientRequestId,
      referenceImages: [
        ...referenceFiles.map(toFileLog),
        ...storedReferenceImages.map((image) => ({
          path: image.path,
          size: image.size,
          type: image.type,
        })),
      ],
      userId: maskId(userId),
    })

    const job = await createGenerationJobWithBilling({
      amount: billingAmount,
      clientRequestId,
      model,
      prompt,
      provider: isMengfactoryVeoVideoModel(model) ? "mengfactory" : "apimart",
      quality,
      aspectRatio,
      durationSeconds: normalizeVideoDuration(duration),
      reason: billingReason,
      reference: billingReference,
      type: "video",
      userId,
    })
    jobId = job.id

    preparedReferenceImages = await prepareReferenceImages({
      referenceFiles,
      storedReferenceImages,
      userId,
    })

    if (isMengfactoryVeoVideoModel(model)) {
      const imageUrls = getPreparedReferencePublicUrls(preparedReferenceImages)
      const generationInput = {
        imageUrls,
        model,
        prompt,
        quality,
        aspectRatio,
      }
      logGenerateVideo("generation input", generationInput)

      const result = await createMengfactoryVideo(generationInput)
      upstreamTaskId = result.taskId
      cleanupPreparedReferenceImages = false
      const nextJob = await updateActiveGenerationJob(job.id, {
        next_check_at: new Date(Date.now() + 5000).toISOString(),
        status: result.status === "submitted" ? "submitted" : "processing",
        storage_urls: imageUrls,
        upstream_task_id: result.taskId,
      })

      if (!nextJob) {
        throw new Error("生成任务已结束，不能提交上游任务。")
      }

      logGenerateVideo("output", result)

      return NextResponse.json({
        ...result,
        clientRequestId,
        taskId: job.id,
        upstreamTaskId: result.taskId,
      })
    }

    const generationInput = {
      referenceImages: await uploadApimartReferenceImages(preparedReferenceImages),
      model,
      prompt,
      duration: normalizeVideoDuration(duration),
      quality,
      aspectRatio,
    }
    logGenerateVideo("generation input", generationInput)

    const result = await createVideoGeneration(generationInput)
    upstreamTaskId = result.taskId
    const nextJob = await updateActiveGenerationJob(job.id, {
      next_check_at: new Date(Date.now() + 5000).toISOString(),
      status: result.status === "submitted" ? "submitted" : "processing",
      upstream_task_id: result.taskId,
    })

    if (!nextJob) {
      throw new Error("生成任务已结束，不能提交上游任务。")
    }

    logGenerateVideo("output", result)

    return NextResponse.json({
      ...result,
      clientRequestId,
      taskId: job.id,
      upstreamTaskId: result.taskId,
    })
  } catch (error) {
    const message = describeServerError(error, "视频任务提交失败。")
    logGenerateVideo("error", {
      cause: error instanceof Error && error.cause ? describeServerError(error.cause, "") : "",
      jobId,
      message,
      userId: maskId(userId),
    })

    if (jobId) {
      if (upstreamTaskId) {
        const recoveredJob = await recoverSubmittedVideoJob({
          failureMessage: message,
          jobId,
          upstreamTaskId,
        }).catch(() => null)

        if (recoveredJob) {
          return NextResponse.json({
            ok: true,
            mode: recoveredJob.provider === "mengfactory" ? "mengfactory" : "apimart",
            status: recoveredJob.status,
            taskId: recoveredJob.id,
            upstreamTaskId,
            type: "video",
            clientRequestId,
            taskError: message,
          })
        }
      }

      await failGenerationJobWithRefund({
        jobId,
        reason: `${billingReason || "AI 视频"}提交失败退款：${message}`,
      }).catch(() => undefined)
    }

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: message.includes("登录") ? 401 : 500 }
    )
  } finally {
    if (cleanupPreparedReferenceImages) {
      await cleanupStoredReferenceImages(preparedReferenceImages)
    }
  }
}

async function recoverSubmittedVideoJob({
  failureMessage,
  jobId,
  upstreamTaskId,
}: {
  failureMessage: string
  jobId: string
  upstreamTaskId: string
}) {
  return updateActiveGenerationJob(jobId, {
    last_sync_error: failureMessage,
    next_check_at: new Date(Date.now() + 5000).toISOString(),
    status: "processing",
    upstream_task_id: upstreamTaskId,
  })
}

async function loadVideoPricing({
  durationSeconds,
  model,
  quality,
}: {
  durationSeconds: number
  model: string
  quality: string
}) {
  const { data, error } = await getSupabaseServerClient()
    .from("model_pricing")
    .select("id, model, type, quality, duration_seconds, aspect_ratio, cost_cny, markup, enabled")
    .eq("enabled", true)
    .eq("type", "video")
    .eq("model", model)
    .eq("quality", quality)
    .eq("duration_seconds", durationSeconds)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)

  if (error) {
    throw new Error(describeServerError(error, "读取视频模型价格失败。"), { cause: error })
  }
  return (data?.[0] ?? null) as ModelPricing | null
}

function parseStoredReferenceImages(value: unknown): StoredReferenceImage[] {
  if (!Array.isArray(value)) return []

  return value.map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {}

    return {
      bucket: String(record.bucket ?? ""),
      name: String(record.name ?? "reference-image"),
      path: String(record.path ?? ""),
      size: Number(record.size),
      type: String(record.type ?? ""),
    }
  })
}

function validateReferenceFiles(referenceImages: File[]) {
  if (referenceImages.length > maxReferenceImages) {
    throw new Error(`参考图最多上传 ${maxReferenceImages} 张。`)
  }

  for (const image of referenceImages) {
    validateReferenceImageMetadata({ size: image.size, type: image.type })
  }
}

function validateStoredReferenceImages(referenceImages: StoredReferenceImage[], userId: string) {
  if (referenceImages.length > maxReferenceImages) {
    throw new Error(`参考图最多上传 ${maxReferenceImages} 张。`)
  }

  const expectedBucket = getReferenceImageBucket()
  const expectedPrefix = getReferenceImagePathPrefix(userId)

  for (const image of referenceImages) {
    validateReferenceImageMetadata({ size: image.size, type: image.type })

    if (image.bucket !== expectedBucket) {
      throw new Error("参考图存储位置无效。")
    }

    if (!image.path || !image.path.startsWith(expectedPrefix) || image.path.includes("..")) {
      throw new Error("参考图路径无效。")
    }
  }
}

async function prepareReferenceImages({
  referenceFiles,
  storedReferenceImages,
  userId,
}: {
  referenceFiles: File[]
  storedReferenceImages: StoredReferenceImage[]
  userId: string
}): Promise<PreparedVideoReferenceImage[]> {
  if (referenceFiles.length > 0) {
    return Promise.all(
      referenceFiles.map(async (image) => {
        const buffer = Buffer.from(await image.arrayBuffer())
        const uploaded = await uploadGeneratedImage({
          buffer,
          contentType: image.type,
          userId,
        })

        return {
          bucket: uploaded.bucket,
          buffer,
          mimeType: image.type,
          name: image.name,
          path: uploaded.path,
          publicUrl: uploaded.publicUrl,
        }
      })
    )
  }

  if (storedReferenceImages.length === 0) return []

  const supabase = getSupabaseServerClient()

  return Promise.all(
    storedReferenceImages.map(async (image) => {
      const { data, error } = await supabase.storage.from(image.bucket).download(image.path)

      if (error) {
        throw new Error(describeServerError(error, "读取参考图失败。"), { cause: error })
      }

      const buffer = Buffer.from(await data.arrayBuffer())
      validateReferenceImageMetadata({ size: buffer.byteLength, type: image.type })
      const { data: publicData } = supabase.storage.from(image.bucket).getPublicUrl(image.path)

      return {
        bucket: image.bucket,
        buffer,
        mimeType: image.type,
        name: image.name,
        path: image.path,
        publicUrl: publicData.publicUrl,
      }
    })
  )
}

function getPreparedReferencePublicUrls(referenceImages: PreparedVideoReferenceImage[]) {
  const urls = referenceImages.map((image) => image.publicUrl).filter((url): url is string => Boolean(url))

  if (urls.length !== referenceImages.length) {
    throw new Error("参考图缺少公开访问地址。")
  }

  return urls
}

async function uploadApimartReferenceImages(referenceImages: PreparedVideoReferenceImage[]) {
  if (referenceImages.length === 0) return []

  const urls = await Promise.all(
    referenceImages.map(async (image) =>
      uploadApimartImage({
        buffer: image.buffer,
        filename: image.name,
        mimeType: image.mimeType,
      })
    )
  )

  const validUrls = urls.filter(Boolean)
  if (validUrls.length !== referenceImages.length) {
    throw new Error(`参考图上传到 APIMART 失败：${validUrls.length}/${referenceImages.length} 张返回了有效 URL。`)
  }

  return validUrls.map((url) => ({ url }))
}

async function cleanupStoredReferenceImages(referenceImages: PreparedVideoReferenceImage[]) {
  const storedImages = referenceImages.filter((image) => image.bucket && image.path)
  if (storedImages.length === 0) return

  const pathsByBucket = new Map<string, string[]>()
  storedImages.forEach((image) => {
    if (!image.bucket || !image.path) return
    pathsByBucket.set(image.bucket, [...(pathsByBucket.get(image.bucket) ?? []), image.path])
  })

  await Promise.all(
    Array.from(pathsByBucket.entries()).map(async ([bucket, paths]) => {
      const { error } = await getSupabaseServerClient().storage.from(bucket).remove(paths)
      if (error) {
        console.warn("[Generate Video] reference image cleanup failed", {
          bucket,
          error: describeServerError(error, "清理参考图失败。"),
          paths,
        })
      }
    })
  )
}

function isImageFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0
}

function toFileLog(file: File) {
  return {
    type: file.type,
    size: file.size,
  }
}

function logGenerateVideo(label: string, value: unknown) {
  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[Generate Video] ${label}`, value)
}

function maskId(value: string) {
  if (!value) return ""
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}
