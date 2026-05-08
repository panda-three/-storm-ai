import { NextResponse } from "next/server"
import { createGenerationJob, updateGenerationJob } from "@/lib/generation-jobs"
import { createVideoGeneration, normalizeVideoDuration, uploadApimartImage } from "@/lib/apimart"
import { calculatePricingCredits, type ModelPricing } from "@/lib/supabase"
import {
  getSupabaseServerClient,
  describeServerError,
  refundGenerationCredits,
  requireAuthenticatedUser,
  spendGenerationCredits,
} from "@/lib/server-supabase"
import { videoModelSettings } from "@/lib/model-options"

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
      return NextResponse.json({ ok: false, error: "请先输入视频提示词。" }, { status: 400 })
    }

    const model = String(getValue("model") ?? "Gemini Veo 3.1 Fast")
    const duration = String(getValue("duration") ?? "5 秒")
    const quality = String(getValue("quality") ?? "720P")
    const aspectRatio = String(getValue("aspectRatio") ?? "16:9")
    const rawReferenceImages = body instanceof FormData ? getReferenceImageLogs(body) : []
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

    const pricing = await loadVideoPricing({
      durationSeconds: normalizeVideoDuration(duration),
      model,
      quality,
    })
    if (!pricing) {
      return NextResponse.json({ ok: false, error: "当前模型参数未配置价格，请联系管理员配置后再生成。" }, { status: 400 })
    }

    billingAmount = calculatePricingCredits(pricing)
    billingReference = `generate_video_${Date.now()}_${crypto.randomUUID()}`
    billingReason = `AI 视频 · ${model} · ${duration} · ${quality} · ${aspectRatio}`

    logGenerateVideo("input", {
      contentType: body instanceof FormData ? "multipart/form-data" : "application/json",
      prompt,
      model,
      duration,
      quality,
      aspectRatio,
      referenceImages: rawReferenceImages,
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
      provider: "apimart",
      reference: billingReference,
      type: "video",
      userId,
    })
    jobId = job.id

    const referenceImages = body instanceof FormData ? await uploadReferenceImages(body) : []
    const generationInput = {
      referenceImages,
      model,
      prompt,
      duration: normalizeVideoDuration(duration),
      quality,
      aspectRatio,
    }
    logGenerateVideo("generation input", generationInput)

    const result = await createVideoGeneration(generationInput)
    await updateGenerationJob(job.id, {
      next_check_at: new Date(Date.now() + 5000).toISOString(),
      status: result.status === "submitted" ? "submitted" : "processing",
      upstream_task_id: result.taskId,
    })

    logGenerateVideo("output", result)

    return NextResponse.json({
      ...result,
      taskId: job.id,
      upstreamTaskId: result.taskId,
    })
  } catch (error) {
    const message = describeServerError(error, "视频任务提交失败。")
    logGenerateVideo("error", {
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
        reason: `${billingReason || "AI 视频"}提交失败退款`,
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
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取视频模型价格失败。"), { cause: error })
  }
  return data as ModelPricing | null
}

async function uploadReferenceImages(formData: FormData) {
  const referenceImages = []
  const images = formData.getAll("referenceImages").filter(isImageFile)

  if (images.length > maxReferenceImages) {
    throw new Error(`参考图最多上传 ${maxReferenceImages} 张。`)
  }

  for (const image of images) {
    if (!supportedReferenceImageTypes.includes(image.type)) {
      throw new Error("参考图仅支持 JPG、PNG、WebP 格式。")
    }

    if (image.size > maxReferenceImageBytes) {
      throw new Error("单张参考图不能超过 10MB。")
    }

    const url = await uploadApimartImage({
      buffer: Buffer.from(await image.arrayBuffer()),
      filename: image.name,
      mimeType: image.type,
    })

    if (url) {
      referenceImages.push({ url })
    }
  }

  return referenceImages
}

function getReferenceImageLogs(formData: FormData) {
  return formData.getAll("referenceImages").filter(isImageFile).map(toFileLog)
}

function isImageFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0
}

function toFileLog(file: File) {
  return {
    name: file.name,
    type: file.type,
    size: file.size,
  }
}

function logGenerateVideo(label: string, value: unknown) {
  console.log(`[Generate Video] ${label}`, value)
}
