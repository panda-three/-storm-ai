import { NextResponse } from "next/server"
import {
  createGenerationJobWithBilling,
  failGenerationJobWithRefund,
  getGenerationJobExpiresAt,
  updateGenerationJob,
  updateActiveGenerationJob,
  type GenerationJobStatus,
} from "@/lib/generation-jobs"
import { createImageGeneration, normalizeImageResolution, uploadApimartImage } from "@/lib/apimart"
import {
  createMengfactoryImage,
  type MengfactoryGeneratedImage,
} from "@/lib/mengfactory"
import {
  calculatePricingCredits,
  type ModelPricing,
} from "@/lib/supabase"
import {
  getSupabaseServerClient,
  describeServerError,
  deleteGeneratedImageByPublicUrl,
  refundGenerationCredits,
  requireAuthenticatedUser,
  uploadGeneratedImage,
} from "@/lib/server-supabase"
import {
  gptImage2Supported4KRatios,
  isMengfactoryGeminiImageModel,
  isValidImageRatioForQuality,
} from "@/lib/model-options"
import {
  getReferenceImageBucket,
  getReferenceImagePathPrefix,
  maxReferenceImages,
  type StoredReferenceImage,
  validateReferenceImageMetadata,
} from "@/lib/reference-images"

interface PreparedReferenceImage {
  buffer: Buffer
  mimeType: string
  name: string
  path?: string
  bucket?: string
}

export async function POST(request: Request) {
  let billingReason = ""
  let clientRequestId = ""
  let jobId = ""
  let stage = "authenticate"
  let upstreamTaskId = ""
  let userId = ""
  let preparedReferenceImages: PreparedReferenceImage[] = []

  try {
    const auth = await requireAuthenticatedUser(request)
    userId = auth.userId
    stage = "parse_input"
    const contentType = request.headers.get("content-type") ?? ""
    const body = contentType.includes("multipart/form-data") ? await request.formData() : await request.json()
    const getValue = (key: string) => (body instanceof FormData ? body.get(key) : body[key])
    const prompt = String(getValue("prompt") ?? "").trim()

    if (!prompt) {
      return NextResponse.json({ ok: false, error: "请先输入生图提示词。" }, { status: 400 })
    }

    const model = String(getValue("model") ?? "Gemini Nano Banana Pro")
    const quality = String(getValue("quality") ?? "2K")
    const ratio = String(getValue("ratio") ?? "1:1")
    const imageCount = parseImageCount(getValue("imageCount"))
    clientRequestId = String(getValue("clientRequestId") ?? "").trim()
    const referenceFiles = body instanceof FormData ? body.getAll("referenceImages").filter(isImageFile) : []
    const storedReferenceImages = body instanceof FormData ? [] : parseStoredReferenceImages(getValue("referenceImages"))

    if (!isValidImageRatioForQuality(model, quality, ratio)) {
      return NextResponse.json(
        {
          ok: false,
          error: `GPT-Image-2 选择 4K 时仅支持这些图片比例：${gptImage2Supported4KRatios.join(" / ")}。`,
        },
        { status: 400 }
      )
    }

    stage = "validate_reference_images"
    validateReferenceFiles(referenceFiles)
    validateStoredReferenceImages(storedReferenceImages, userId)

    if (referenceFiles.length > 0 && storedReferenceImages.length > 0) {
      return NextResponse.json(
        { ok: false, error: "请不要同时提交参考图文件和参考图存储地址。" },
        { status: 400 }
      )
    }

    stage = "load_pricing"
    const pricing = await loadImagePricing({ model, quality })
    if (!pricing) {
      return NextResponse.json({ ok: false, error: "当前模型参数未配置价格，请联系管理员配置后再生成。" }, { status: 400 })
    }

    let billingAmount = calculatePricingCredits(pricing) * imageCount
    const billingReference = `generate_image_${Date.now()}_${crypto.randomUUID()}`
    billingReason = `AI 生图 · ${model} · ${quality} · ${imageCount} 张`
    stage = "load_membership"
    const membershipCoversQuality = await hasActiveImageMembership({
      quality,
      userId,
    })

    logGenerateImage("input", {
      contentType: body instanceof FormData ? "multipart/form-data" : "application/json",
      promptLength: prompt.length,
      model,
      quality,
      ratio,
      imageCount,
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

    const isFree = membershipCoversQuality
    if (isFree) {
      billingAmount = 0
      billingReason = `${billingReason} · 会员免费`
    }

    const isMengfactoryImage = isMengfactoryGeminiImageModel(model)
    const provider = isMengfactoryImage ? "mengfactory" : "apimart"
    stage = "prepare_reference_images"
    preparedReferenceImages = await prepareReferenceImages({
      referenceFiles,
      storedReferenceImages,
      userId,
    })
    const referenceBuffers = isMengfactoryGeminiImageModel(model)
      ? await prepareMengfactoryReferenceImages(preparedReferenceImages, () => {
          stage = "prepare_mengfactory_references"
        })
      : []
    const apimartReferenceImageUrls = isMengfactoryImage
      ? []
      : await uploadApimartReferenceImages(preparedReferenceImages, () => {
          stage = "upload_apimart_references"
        })

    stage = "create_generation_job_with_billing"
    const job = await createGenerationJobWithBilling({
      amount: billingAmount,
      clientRequestId,
      expectedResultCount: imageCount,
      isFree,
      model,
      prompt,
      provider,
      reason: billingReason,
      reference: billingReference,
      type: "image",
      userId,
    })
    jobId = job.id

    if (isMengfactoryImage) {
      stage = "submit_mengfactory_generation"
      const generatedImages: PromiseSettledResult<MengfactoryGeneratedImage>[] = await Promise.allSettled(
        Array.from({ length: imageCount }, () =>
          createMengfactoryImage({
            model,
            prompt,
            quality,
            ratio,
            referenceImages: referenceBuffers,
          })
        )
      )
      const successfulImages = generatedImages
        .filter((result): result is PromiseFulfilledResult<MengfactoryGeneratedImage> => result.status === "fulfilled")
        .map((result) => result.value)
      const imageUrls: string[] = []

      try {
        stage = "persist_mengfactory_results"
        for (const generated of successfulImages) {
          const uploaded = await uploadGeneratedImage({
            buffer: generated.buffer,
            contentType: generated.mimeType,
            userId,
          })
          imageUrls.push(uploaded.publicUrl)
        }

        if (imageUrls.length === 0) {
          throw new Error(buildAllSettledFailureMessage(generatedImages, "图片生成失败，未返回可用结果。"))
        }

        const status: GenerationJobStatus = imageUrls.length < imageCount ? "partial_completed" : "completed"
        const taskError =
          status === "partial_completed"
            ? buildPartialImageMessage({
                amount: billingAmount,
                expectedResultCount: imageCount,
                successCount: imageUrls.length,
                upstreamErrors: summarizeSettledErrors(generatedImages),
              })
            : null

        stage = "complete_mengfactory_job"
        const completedAt = new Date().toISOString()
        const nextJob = await updateActiveGenerationJob(job.id, {
          completed_at: completedAt,
          expires_at: getGenerationJobExpiresAt(completedAt),
          result_urls: imageUrls,
          status,
          storage_urls: imageUrls,
          task_error: taskError,
        })

        if (!nextJob) {
          await Promise.all(imageUrls.map((url) => deleteGeneratedImageByPublicUrl(url)))
          throw new Error("生成任务已结束，迟到结果已丢弃。")
        }

        if (status === "partial_completed") {
          const partialRefundAmount = calculatePartialRefundAmount(billingAmount, imageUrls.length, imageCount)
          await refundImageGenerationCredits({
            amount: partialRefundAmount,
            reason: `AI 生图部分失败退款 · ${model} · ${imageCount - imageUrls.length}/${imageCount} 张`,
            reference: buildPartialRefundReference(billingReference, imageUrls.length, imageCount),
            userId,
          })
        }

        return NextResponse.json({
          ok: true,
          mode: "mengfactory",
          taskId: job.id,
          status,
          type: "image",
          imageUrls,
          clientRequestId,
          progress: 100,
          taskError: taskError ?? "",
        })
      } catch (error) {
        await Promise.all(imageUrls.map((url) => deleteGeneratedImageByPublicUrl(url)))
        throw error
      }
    }

    const generationInput = {
      imageUrls: apimartReferenceImageUrls,
      model,
      prompt,
      imageCount,
      size: ratio,
      resolution: normalizeImageResolution(quality, model),
    }
    logGenerateImage("generation input", generationInput)

    stage = "submit_apimart_generation"
    const result = await createImageGeneration(generationInput)
    upstreamTaskId = result.taskId
    stage = "link_apimart_task"
    const nextJob = await updateActiveGenerationJob(job.id, {
      next_check_at: new Date(Date.now() + 5000).toISOString(),
      status: result.status === "submitted" ? "submitted" : "processing",
      upstream_task_id: result.taskId,
    })

    if (!nextJob) {
      throw new Error("生成任务已结束，不能提交上游任务。")
    }

    logGenerateImage("output", result)

    return NextResponse.json({
      ...result,
      clientRequestId,
      taskId: job.id,
      upstreamTaskId: result.taskId,
    })
  } catch (error) {
    const message = describeServerError(error, "生图任务提交失败。")
    const failureMessage = buildFailureMessage({ message, stage, upstreamTaskId })
    logGenerateImage("error", {
      cause: error instanceof Error && error.cause ? describeServerError(error.cause, "") : "",
      jobId,
      message: failureMessage,
      stage,
      upstreamTaskId,
      userId: maskId(userId),
    })

    if (jobId) {
      if (upstreamTaskId) {
        const recoveredJob = await recoverSubmittedApimartJob({
          clientRequestId,
          failureMessage,
          jobId,
          upstreamTaskId,
        }).catch(() => null)

        if (recoveredJob) {
          return NextResponse.json({
            ok: true,
            mode: "apimart",
            status: recoveredJob.status,
            taskId: recoveredJob.id,
            upstreamTaskId,
            type: "image",
            clientRequestId,
            taskError: failureMessage,
          })
        }
      }

      await failGenerationJobWithRefund({
        jobId,
        reason: `${billingReason || "AI 生图"}提交失败退款：${failureMessage}`,
      }).catch(() => undefined)
    }

    return NextResponse.json(
      {
        ok: false,
        error: failureMessage,
      },
      { status: message.includes("登录") ? 401 : 500 }
    )
  } finally {
    await cleanupStoredReferenceImages(preparedReferenceImages)
  }
}

function parseImageCount(value: FormDataEntryValue | unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? "1"), 10)

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
    throw new Error("生成张数只能选择 1 到 4 张。")
  }

  return parsed
}

function calculatePartialRefundAmount(amount: number, successCount: number, expectedResultCount: number) {
  if (amount <= 0 || expectedResultCount <= 0) return 0
  const failedCount = Math.max(0, expectedResultCount - successCount)
  return Math.floor((amount * failedCount) / expectedResultCount)
}

function buildPartialRefundReference(reference: string, successCount: number, expectedResultCount: number) {
  return `${reference}_partial_${successCount}_of_${expectedResultCount}`
}

function buildPartialImageMessage({
  amount,
  expectedResultCount,
  successCount,
  upstreamErrors = [],
}: {
  amount: number
  expectedResultCount: number
  successCount: number
  upstreamErrors?: string[]
}) {
  const failedCount = Math.max(0, expectedResultCount - successCount)
  const refundAmount = calculatePartialRefundAmount(amount, successCount, expectedResultCount)
  const refundText = refundAmount > 0 ? `已退还 ${refundAmount.toLocaleString()} 点。` : "本次未扣点，无需退款。"
  const errorText = upstreamErrors.length > 0 ? `失败原因：${upstreamErrors.join("；")}` : ""
  return [`已生成 ${successCount}/${expectedResultCount} 张，失败 ${failedCount} 张，${refundText}`, errorText]
    .filter(Boolean)
    .join(" ")
}

async function prepareMengfactoryReferenceImages(referenceImages: PreparedReferenceImage[], setStage: () => void) {
  if (referenceImages.length === 0) return []

  setStage()
  return referenceImages.map((image) => ({
    buffer: image.buffer,
    mimeType: image.mimeType,
  }))
}

async function uploadApimartReferenceImages(referenceImages: PreparedReferenceImage[], setStage: () => void) {
  if (referenceImages.length === 0) return []

  setStage()
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

  return validUrls
}

function buildAllSettledFailureMessage<T>(results: PromiseSettledResult<T>[], fallback: string) {
  const errors = summarizeSettledErrors(results)
  if (errors.length === 0) return fallback
  return `${fallback} ${errors.join("；")}`
}

function summarizeSettledErrors<T>(results: PromiseSettledResult<T>[]) {
  return Array.from(
    new Set(
      results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => describeServerError(result.reason, "上游生成失败。"))
        .filter(Boolean)
    )
  ).slice(0, 3)
}

function buildFailureMessage({
  message,
  stage,
  upstreamTaskId,
}: {
  message: string
  stage: string
  upstreamTaskId: string
}) {
  const taskText = upstreamTaskId ? `上游任务：${upstreamTaskId}` : "上游任务：无"
  return `阶段：${stage}；${taskText}；原因：${message}`
}

async function recoverSubmittedApimartJob({
  clientRequestId,
  failureMessage,
  jobId,
  upstreamTaskId,
}: {
  clientRequestId: string
  failureMessage: string
  jobId: string
  upstreamTaskId: string
}) {
  logGenerateImage("recover submitted apimart job", {
    clientRequestId,
    failureMessage,
    jobId,
    upstreamTaskId,
  })

  return updateGenerationJob(jobId, {
    last_sync_error: failureMessage,
    next_check_at: new Date(Date.now() + 5000).toISOString(),
    status: "processing",
    upstream_task_id: upstreamTaskId,
  })
}

async function refundImageGenerationCredits({
  amount,
  reason,
  reference,
  userId,
}: {
  amount: number
  reason: string
  reference: string
  userId: string
}) {
  if (amount <= 0) return

  await refundGenerationCredits({
    amount,
    reason,
    reference,
    userId,
  })
}

async function loadImagePricing({ model, quality }: { model: string; quality: string }) {
  const { data, error } = await getSupabaseServerClient()
    .from("model_pricing")
    .select("id, model, type, quality, duration_seconds, aspect_ratio, cost_cny, markup, enabled")
    .eq("enabled", true)
    .eq("type", "image")
    .eq("model", model)
    .eq("quality", quality)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)

  if (error) {
    throw new Error(describeServerError(error, "读取图片模型价格失败。"), { cause: error })
  }
  return (data?.[0] ?? null) as ModelPricing | null
}

async function hasActiveImageMembership({ quality, userId }: { quality: string; userId: string }) {
  const { data, error } = await getSupabaseServerClient()
    .from("user_accounts")
    .select("membership_tier, membership_expires_at, membership_free_image_qualities")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取会员权益失败。"), { cause: error })
  }

  const expiresAt = typeof data?.membership_expires_at === "string" ? data.membership_expires_at : ""
  const qualities = Array.isArray(data?.membership_free_image_qualities) ? data.membership_free_image_qualities : []

  return Boolean(
    data?.membership_tier &&
      expiresAt &&
      new Date(expiresAt).getTime() > Date.now() &&
      qualities.includes(quality)
  )
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
}): Promise<PreparedReferenceImage[]> {
  if (referenceFiles.length > 0) {
    return Promise.all(
      referenceFiles.map(async (image) => ({
        buffer: Buffer.from(await image.arrayBuffer()),
        mimeType: image.type,
        name: image.name,
      }))
    )
  }

  if (storedReferenceImages.length === 0) return []

  validateStoredReferenceImages(storedReferenceImages, userId)
  const supabase = getSupabaseServerClient()

  return Promise.all(
    storedReferenceImages.map(async (image) => {
      const { data, error } = await supabase.storage.from(image.bucket).download(image.path)

      if (error) {
        throw new Error(describeServerError(error, "读取参考图失败。"), { cause: error })
      }

      const buffer = Buffer.from(await data.arrayBuffer())
      validateReferenceImageMetadata({ size: buffer.byteLength, type: image.type })

      return {
        bucket: image.bucket,
        buffer,
        mimeType: image.type,
        name: image.name,
        path: image.path,
      }
    })
  )
}

async function cleanupStoredReferenceImages(referenceImages: PreparedReferenceImage[]) {
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
        console.warn("[Supabase Storage] reference image cleanup failed", {
          bucket,
          error: describeServerError(error, "清理参考图失败。"),
          paths,
        })
      }
    })
  )
}

function isImageFile(value: FormDataEntryValue): value is File {
  return typeof value !== "string" && value.size > 0
}

function toFileLog(file: File) {
  return {
    type: file.type,
    size: file.size,
  }
}

function logGenerateImage(label: string, value: unknown) {
  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[Generate Image] ${label}`, value)
}

function maskId(value: string) {
  if (!value) return ""
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}
