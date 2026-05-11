import { NextResponse } from "next/server"
import {
  getReferenceImageBucket,
  getReferenceImageExtension,
  getReferenceImagePathPrefix,
  validateReferenceImageMetadata,
} from "@/lib/reference-images"
import { describeServerError, getSupabaseServerClient, requireAuthenticatedUser } from "@/lib/server-supabase"

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const body = await request.json().catch(() => ({}))
    const name = String(body.name ?? "reference-image").trim()
    const type = String(body.type ?? "").trim()
    const size = Number(body.size)

    validateReferenceImageMetadata({ size, type })

    const bucket = getReferenceImageBucket()
    const extension = getReferenceImageExtension(type)
    const path = `${getReferenceImagePathPrefix(auth.userId)}${Date.now()}-${crypto.randomUUID()}.${extension}`
    const { data, error } = await getSupabaseServerClient()
      .storage
      .from(bucket)
      .createSignedUploadUrl(path)

    if (error) {
      throw new Error(describeServerError(error, "创建参考图上传地址失败。"), { cause: error })
    }

    return NextResponse.json({
      ok: true,
      bucket,
      name,
      path,
      token: data.token,
    })
  } catch (error) {
    const message = describeServerError(error, "创建参考图上传地址失败。")

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: message.includes("登录") ? 401 : 400 }
    )
  }
}
