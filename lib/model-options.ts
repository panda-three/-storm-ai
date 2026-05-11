export const gptImage2ModelName = "GPT-Image-2"
export const gptImage2ApiModelName = "gpt-image-2"
export const gptImage2AllModelName = "gpt-image-2-all"
export const gptImage2OfficialApiModelName = "gpt-image-2-official"
export const gptImage2Supported4KRatios = ["16:9", "9:16", "2:1", "1:2", "21:9", "9:21"]
export const mengfactoryGeminiImageModelName = "Gemini 3.1 Flash Image Preview"
export const mengfactoryGeminiImageApiModelName = "gemini-3.1-flash-image-preview"
export const mengfactoryVeoVideoModelName = "VEO 3.1 FAST"
export const apimartVeo31FastVideoModelName = "veo_3_1-fast"
export const legacyApimartVeoVideoModelName = "Gemini Veo 3.1 Fast"
export const grokImagineVideoModelName = "Grok Imagine Video"
export const grokVideo3ModelName = "grok-video-3"

export const imageModelOptions = [
  mengfactoryGeminiImageModelName,
  mengfactoryGeminiImageApiModelName,
  gptImage2ModelName,
  gptImage2AllModelName,
]

export const imageModelSettings: Record<
  string,
  {
    qualities: string[]
    ratios: string[]
  }
> = {
  "Gemini Nano Banana Pro": {
    qualities: ["1K", "2K", "4K"],
    ratios: ["默认", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "5:4", "4:5", "21:9", "1:4", "4:1", "1:8", "8:1"],
  },
  [mengfactoryGeminiImageModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: ["默认", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "1:8", "4:1", "8:1"],
  },
  [mengfactoryGeminiImageApiModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: ["默认", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "1:8", "4:1", "8:1"],
  },
  [gptImage2ModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "2:1", "1:2", "21:9", "9:21"],
  },
  [gptImage2AllModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "2:1", "1:2", "21:9", "9:21"],
  },
}

export function isGptImage2Model(model: string) {
  return model === gptImage2ModelName || model === gptImage2ApiModelName || model === gptImage2AllModelName
}

export function isMengfactoryGeminiImageModel(model: string) {
  return model === mengfactoryGeminiImageModelName
}

export function isYunwuGeminiImageModel(model: string) {
  return model === mengfactoryGeminiImageApiModelName
}

export function isYunwuGptImageModel(model: string) {
  return model === gptImage2AllModelName
}

export function isYunwuImageModel(model: string) {
  return isYunwuGeminiImageModel(model) || isYunwuGptImageModel(model)
}

export function isGptImage2Restricted4K(quality: string, model: string) {
  return isGptImage2Model(model) && quality.trim().toUpperCase() === "4K"
}

export function getImageRatiosForSelection(model: string, quality: string) {
  return isGptImage2Restricted4K(quality, model) ? gptImage2Supported4KRatios : imageModelSettings[model].ratios
}

export function isValidImageRatioForQuality(model: string, quality: string, ratio: string) {
  return !isGptImage2Restricted4K(quality, model) || gptImage2Supported4KRatios.includes(ratio)
}

export const videoModelOptions = [
  mengfactoryVeoVideoModelName,
  apimartVeo31FastVideoModelName,
  grokImagineVideoModelName,
  grokVideo3ModelName,
]
export const adminVideoModelOptions = [
  mengfactoryVeoVideoModelName,
  apimartVeo31FastVideoModelName,
  legacyApimartVeoVideoModelName,
  grokImagineVideoModelName,
  grokVideo3ModelName,
]

export const videoModelSettings: Record<
  string,
  {
    aspectRatios: string[]
    durations: string[]
    qualities: string[]
  }
> = {
  [mengfactoryVeoVideoModelName]: {
    aspectRatios: ["16:9", "9:16"],
    durations: ["8 秒"],
    qualities: ["720P", "1080P", "4K"],
  },
  [legacyApimartVeoVideoModelName]: {
    aspectRatios: ["16:9", "9:16"],
    durations: ["8 秒"],
    qualities: ["720P", "1080P", "4K"],
  },
  [apimartVeo31FastVideoModelName]: {
    aspectRatios: ["16:9", "9:16"],
    durations: ["8 秒"],
    qualities: ["720P", "1080P", "4K"],
  },
  [grokImagineVideoModelName]: {
    aspectRatios: ["16:9", "9:16", "1:1", "3:2", "2:3"],
    durations: ["6 秒", "10 秒", "15 秒", "30 秒"],
    qualities: ["480P", "720P"],
  },
  [grokVideo3ModelName]: {
    aspectRatios: ["16:9", "9:16", "1:1", "3:2", "2:3"],
    durations: ["6 秒", "10 秒", "15 秒", "30 秒"],
    qualities: ["480P", "720P"],
  },
}

export function isMengfactoryVeoVideoModel(model: string) {
  return model === mengfactoryVeoVideoModelName
}

export function isYunwuVideoModel(model: string) {
  return model === apimartVeo31FastVideoModelName || model === grokVideo3ModelName
}

export function getMengfactoryVeoVideoApiModel(quality: string) {
  return quality.trim().toUpperCase() === "4K" ? "veo3.1-4k" : "veo3.1-fast"
}
