import { NextResponse } from "next/server"
import { createImageGeneration, normalizeImageResolution, uploadApimartImage } from "@/lib/apimart"

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
      return NextResponse.json({ ok: false, error: "请先输入生图提示词。" }, { status: 400 })
    }

    const model = String(getValue("model") ?? "Gemini Nano Banana Pro")
    const quality = String(getValue("quality") ?? "2K")
    const ratio = String(getValue("ratio") ?? "1:1")
    const referenceImages = body instanceof FormData ? body.getAll("referenceImages").filter(isImageFile) : []

    logGenerateImage("input", {
      contentType: body instanceof FormData ? "multipart/form-data" : "application/json",
      prompt,
      model,
      quality,
      ratio,
      referenceImages: referenceImages.map(toFileLog),
    })

    if (referenceImages.length > maxReferenceImages) {
      return NextResponse.json({ ok: false, error: `参考图最多上传 ${maxReferenceImages} 张。` }, { status: 400 })
    }

    for (const image of referenceImages) {
      if (!supportedReferenceImageTypes.includes(image.type)) {
        return NextResponse.json({ ok: false, error: "参考图仅支持 JPG、PNG、WebP 格式。" }, { status: 400 })
      }

      if (image.size > maxReferenceImageBytes) {
        return NextResponse.json({ ok: false, error: "单张参考图不能超过 10MB。" }, { status: 400 })
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
      size: ratio,
      resolution: normalizeImageResolution(quality, model),
    }
    logGenerateImage("generation input", generationInput)

    const result = await createImageGeneration(generationInput)

    logGenerateImage("output", result)

    return NextResponse.json(result)
  } catch (error) {
    logGenerateImage("error", {
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "生图任务提交失败。",
      },
      { status: 500 }
    )
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
