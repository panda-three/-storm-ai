import { NextResponse } from "next/server"
import { createVideoGeneration, normalizeVideoDuration, uploadApimartImage } from "@/lib/apimart"
import { videoModelSettings } from "@/lib/model-options"

const maxReferenceImages = 4
const maxReferenceImageBytes = 10 * 1024 * 1024
const supportedReferenceImageTypes = ["image/jpeg", "image/png", "image/webp"]

export async function POST(request: Request) {
  try {
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

    logGenerateVideo("input", {
      contentType: body instanceof FormData ? "multipart/form-data" : "application/json",
      prompt,
      model,
      duration,
      quality,
      aspectRatio,
      referenceImages: rawReferenceImages,
    })

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

    logGenerateVideo("output", result)

    return NextResponse.json(result)
  } catch (error) {
    logGenerateVideo("error", {
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "视频任务提交失败。",
      },
      { status: 500 }
    )
  }
}

async function uploadReferenceImages(formData: FormData) {
  const referenceImages = []
  const images = formData.getAll("referenceImages").filter(isImageFile).slice(0, maxReferenceImages)

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
  return formData.getAll("referenceImages").filter(isImageFile).slice(0, maxReferenceImages).map(toFileLog)
}

function isImageFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value) && typeof value !== "string" && value.size > 0
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
