export const maxReferenceImages = 4
export const maxReferenceImageBytes = 10 * 1024 * 1024
export const supportedReferenceImageTypes = ["image/jpeg", "image/png", "image/webp"]

export interface StoredReferenceImage {
  bucket: string
  name: string
  path: string
  size: number
  type: string
}

export function getReferenceImageExtension(contentType: string) {
  if (contentType.includes("webp")) return "webp"
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg"
  return "png"
}

export function isSupportedReferenceImageType(contentType: string) {
  return supportedReferenceImageTypes.includes(contentType)
}

export function validateReferenceImageMetadata({
  size,
  type,
}: {
  size: number
  type: string
}) {
  if (!isSupportedReferenceImageType(type)) {
    throw new Error("参考图仅支持 JPG、PNG、WebP 格式。")
  }

  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("参考图文件无效。")
  }

  if (size > maxReferenceImageBytes) {
    throw new Error("单张参考图不能超过 10MB。")
  }
}

export function getReferenceImageBucket() {
  return process.env.SUPABASE_GENERATED_IMAGES_BUCKET ?? "generated-images"
}

export function getReferenceImagePathPrefix(userId: string) {
  return `users/${userId}/reference-images/`
}
