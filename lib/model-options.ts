export const gptImage2ModelName = "GPT-Image-2"
export const gptImage2ApiModelName = "gpt-image-2"
export const gptImage2Supported4KRatios = ["16:9", "9:16", "2:1", "1:2", "21:9", "9:21"]

export const imageModelOptions = ["Gemini Nano Banana Pro", gptImage2ModelName]

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
  [gptImage2ModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "2:1", "1:2", "21:9", "9:21"],
  },
}

export function isGptImage2Model(model: string) {
  return model === gptImage2ModelName || model === gptImage2ApiModelName
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

export const videoModelOptions = ["Gemini Veo 3.1 Fast", "Grok Imagine Video"]

export const videoModelSettings: Record<
  string,
  {
    aspectRatios: string[]
    durations: string[]
    qualities: string[]
  }
> = {
  "Gemini Veo 3.1 Fast": {
    aspectRatios: ["16:9", "9:16"],
    durations: ["8 秒"],
    qualities: ["720P", "1080P", "4K"],
  },
  "Grok Imagine Video": {
    aspectRatios: ["16:9", "9:16", "1:1", "3:2", "2:3"],
    durations: ["6 秒", "10 秒", "15 秒", "30 秒"],
    qualities: ["480P", "720P"],
  },
}
