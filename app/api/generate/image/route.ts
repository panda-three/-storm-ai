import { NextResponse } from "next/server"
import { createGenerationJob, updateGenerationJob, type GenerationJobStatus } from "@/lib/generation-jobs"
import { createImageGeneration, normalizeImageResolution, uploadApimartImage } from "@/lib/apimart"
import { createMengfactoryImage } from "@/lib/mengfactory"
import {
  calculatePricingCredits,
  type ModelPricing,
} from "@/lib/supabase"
import {
  getSupabaseServerClient,
  describeServerError,
  deleteGeneratedImageByPublicUrl,
  recordFreeGenerationUsage,
  refundGenerationCredits,
  requireAuthenticatedUser,
  spendGenerationCredits,
  uploadGeneratedImage,
} from "@/lib/server-supabase"
import {
  gptImage2Supported4KRatios,
  isMengfactoryGeminiImageModel,
  isValidImageRatioForQuality,
} from "@/lib/model-options"

const maxReferenceImages = 4
const maxReferenceImageBytes = 10 * 1024 * 1024
const supportedReferenceImageTypes = ["image/jpeg", "image/png", "image/webp"]

export async function POST(request: Request) {
  let billed = false
  let billingReference = ""
  let billingAmount = 0
  let billingReason = ""
  let jobId = ""
  let refundedAmount = 0
  let userId = ""

  try {
    const auth = await requireAuthenticatedUser(request)
    userId = auth.userId
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
    const referenceImages = body instanceof FormData ? body.getAll("referenceImages").filter(isImageFile) : []

    if (!isValidImageRatioForQuality(model, quality, ratio)) {
      return NextResponse.json(
        {
          ok: false,
          error: `GPT-Image-2 选择 4K 时仅支持这些图片比例：${gptImage2Supported4KRatios.join(" / ")}。`,
        },
        { status: 400 }
      )
    }

    validateReferenceImages(referenceImages)

    const pricing = await loadImagePricing({ model, quality })
    if (!pricing) {
      return NextResponse.json({ ok: false, error: "当前模型参数未配置价格，请联系管理员配置后再生成。" }, { status: 400 })
    }

    billingAmount = calculatePricingCredits(pricing) * imageCount
    billingReference = `generate_image_${Date.now()}_${crypto.randomUUID()}`
    billingReason = `AI 生图 · ${model} · ${quality} · ${imageCount} 张`
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
      referenceImages: referenceImages.map(toFileLog),
      userId: maskId(userId),
    })

    if (membershipCoversQuality) {
      billingAmount = 0
      billingReason = `${billingReason} · 会员免费`
    } else {
      await spendGenerationCredits({
        amount: billingAmount,
        reason: billingReason,
        reference: billingReference,
        userId,
      })
      billed = true
    }

    const job = await createGenerationJob({
      amount: billingAmount,
      expectedResultCount: imageCount,
      model,
      prompt,
      provider: isMengfactoryGeminiImageModel(model) ? "mengfactory" : "apimart",
      reference: billingReference,
      type: "image",
      userId,
    })
    jobId = job.id

    if (membershipCoversQuality) {
      await recordFreeGenerationUsage({
        reason: billingReason,
        reference: billingReference,
        userId,
      })
    }

    if (isMengfactoryGeminiImageModel(model)) {
      const referenceBuffers = await Promise.all(
        referenceImages.map(async (image) => ({
          buffer: Buffer.from(await image.arrayBuffer()),
          mimeType: image.type,
        }))
      )
      const generatedImages = await Promise.allSettled(
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
        .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createMengfactoryImage>>> => result.status === "fulfilled")
        .map((result) => result.value)
      const imageUrls: string[] = []

      try {
        for (const generated of successfulImages) {
          imageUrls.push(
            await uploadGeneratedImage({
              buffer: generated.buffer,
              contentType: generated.mimeType,
              userId,
            })
          )
        }

        if (imageUrls.length === 0) {
          throw new Error("图片生成失败，未返回可用结果。")
        }

        const status: GenerationJobStatus = imageUrls.length < imageCount ? "partial_completed" : "completed"
        const taskError =
          status === "partial_completed"
            ? buildPartialImageMessage({
                amount: billingAmount,
                expectedResultCount: imageCount,
                successCount: imageUrls.length,
              })
            : null

        if (status === "partial_completed") {
          const partialRefundAmount = calculatePartialRefundAmount(billingAmount, imageUrls.length, imageCount)
          await refundImageGenerationCredits({
            amount: partialRefundAmount,
            reason: `AI 生图部分失败退款 · ${model} · ${imageCount - imageUrls.length}/${imageCount} 张`,
            reference: buildPartialRefundReference(billingReference, imageUrls.length, imageCount),
            userId,
          })
          refundedAmount += partialRefundAmount
        }

        await updateGenerationJob(job.id, {
          completed_at: new Date().toISOString(),
          result_urls: imageUrls,
          status,
          task_error: taskError,
        })

        return NextResponse.json({
          ok: true,
          mode: "mengfactory",
          taskId: job.id,
          status,
          type: "image",
          imageUrls,
          progress: 100,
          taskError: taskError ?? "",
        })
      } catch (error) {
        await Promise.all(imageUrls.map((url) => deleteGeneratedImageByPublicUrl(url)))
        throw error
      }
    }

    const imageUrls = (
      await Promise.all(
        referenceImages.map(async (image) =>
          uploadApimartImage({
            buffer: Buffer.from(await image.arrayBuffer()),
            filename: image.name,
            mimeType: image.type,
          })
        )
      )
    ).filter(Boolean)
    const generationInput = {
      imageUrls,
      model,
      prompt,
      imageCount,
      size: ratio,
      resolution: normalizeImageResolution(quality, model),
    }
    logGenerateImage("generation input", generationInput)

    const result = await createImageGeneration(generationInput)
    await updateGenerationJob(job.id, {
      next_check_at: new Date(Date.now() + 5000).toISOString(),
      status: result.status === "submitted" ? "submitted" : "processing",
      upstream_task_id: result.taskId,
    })

    logGenerateImage("output", result)

    return NextResponse.json({
      ...result,
      taskId: job.id,
      upstreamTaskId: result.taskId,
    })
  } catch (error) {
    const message = describeServerError(error, "生图任务提交失败。")
    logGenerateImage("error", {
      cause: error instanceof Error && error.cause ? describeServerError(error.cause, "") : "",
      jobId,
      message,
      userId: maskId(userId),
    })

    if (jobId) {
      await updateGenerationJob(jobId, {
        status: "failed",
        task_error: message,
      }).catch(() => undefined)
    }

    const remainingRefundAmount = Math.max(0, billingAmount - refundedAmount)
    if (billed && userId && billingReference && remainingRefundAmount > 0) {
      await refundGenerationCredits({
        amount: remainingRefundAmount,
        reason: `${billingReason || "AI 生图"}提交失败退款`,
        reference: billingReference,
        userId,
      }).catch(() => undefined)
    }

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: message.includes("登录") ? 401 : 500 }
    )
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
}: {
  amount: number
  expectedResultCount: number
  successCount: number
}) {
  const failedCount = Math.max(0, expectedResultCount - successCount)
  const refundAmount = calculatePartialRefundAmount(amount, successCount, expectedResultCount)
  const refundText = refundAmount > 0 ? `已退还 ${refundAmount.toLocaleString()} 点。` : "本次未扣点，无需退款。"
  return `已生成 ${successCount}/${expectedResultCount} 张，失败 ${failedCount} 张，${refundText}`
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

function validateReferenceImages(referenceImages: File[]) {
  if (referenceImages.length > maxReferenceImages) {
    throw new Error(`参考图最多上传 ${maxReferenceImages} 张。`)
  }

  for (const image of referenceImages) {
    if (!supportedReferenceImageTypes.includes(image.type)) {
      throw new Error("参考图仅支持 JPG、PNG、WebP 格式。")
    }

    if (image.size > maxReferenceImageBytes) {
      throw new Error("单张参考图不能超过 10MB。")
    }
  }
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
