import { NextResponse } from "next/server"
import { createGenerationJob, updateGenerationJob } from "@/lib/generation-jobs"
import { createImageGeneration, normalizeImageResolution, uploadApimartImage } from "@/lib/apimart"
import { createMengfactoryImage } from "@/lib/mengfactory"
import {
  calculatePricingCredits,
  type ModelPricing,
} from "@/lib/supabase"
import {
  getSupabaseServerClient,
  describeServerError,
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

    billingAmount = calculatePricingCredits(pricing)
    billingReference = `generate_image_${Date.now()}_${crypto.randomUUID()}`
    billingReason = `AI 生图 · ${model} · ${quality}`

    logGenerateImage("input", {
      contentType: body instanceof FormData ? "multipart/form-data" : "application/json",
      prompt,
      model,
      quality,
      ratio,
      referenceImages: referenceImages.map(toFileLog),
      userId,
    })

    await spendGenerationCredits({
      amount: billingAmount,
      reason: billingReason,
      reference: billingReference,
      userId,
    })
    billed = true

    const job = await createGenerationJob({
      amount: billingAmount,
      model,
      prompt,
      provider: isMengfactoryGeminiImageModel(model) ? "mengfactory" : "apimart",
      reference: billingReference,
      type: "image",
      userId,
    })
    jobId = job.id

    if (isMengfactoryGeminiImageModel(model)) {
      const referenceBuffers = await Promise.all(
        referenceImages.map(async (image) => ({
          buffer: Buffer.from(await image.arrayBuffer()),
          mimeType: image.type,
        }))
      )
      const generated = await createMengfactoryImage({
        model,
        prompt,
        quality,
        ratio,
        referenceImages: referenceBuffers,
      })
      const imageUrl = await uploadGeneratedImage({
        buffer: generated.buffer,
        contentType: generated.mimeType,
        userId,
      })

      await updateGenerationJob(job.id, {
        result_urls: [imageUrl],
        status: "completed",
      })

      return NextResponse.json({
        ok: true,
        mode: "mengfactory",
        taskId: job.id,
        status: "completed",
        type: "image",
        imageUrls: [imageUrl],
        progress: 100,
      })
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
      raw: error,
      userId,
    })

    if (jobId) {
      await updateGenerationJob(jobId, {
        status: "failed",
        task_error: message,
      }).catch(() => undefined)
    }

    if (billed && userId && billingReference && billingAmount > 0) {
      await refundGenerationCredits({
        amount: billingAmount,
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

async function loadImagePricing({ model, quality }: { model: string; quality: string }) {
  const { data, error } = await getSupabaseServerClient()
    .from("model_pricing")
    .select("id, model, type, quality, duration_seconds, aspect_ratio, cost_cny, markup, enabled")
    .eq("enabled", true)
    .eq("type", "image")
    .eq("model", model)
    .eq("quality", quality)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取图片模型价格失败。"), { cause: error })
  }
  return data as ModelPricing | null
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
    name: file.name,
    type: file.type,
    size: file.size,
  }
}

function logGenerateImage(label: string, value: unknown) {
  console.log(`[Generate Image] ${label}`, value)
}
