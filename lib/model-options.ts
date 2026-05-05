export const imageModelOptions = ["Gemini Nano Banana Pro", "GPT-Image-2"]

export const imageModelSettings: Record<
  string,
  {
    qualities: string[]
    ratios: string[]
  }
> = {
  "Gemini Nano Banana Pro": {
    qualities: ["1K", "2K", "4K"],
    ratios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
  },
  "GPT-Image-2": {
    qualities: ["1K", "2K", "4K"],
    ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "2:1", "1:2", "21:9", "9:21"],
  },
}

export const videoModelOptions = ["Gemini Veo 3.1 Fast", "Gemini Veo 3.1 Quality", "Grok Imagine Video"]

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
    qualities: ["480P", "720P"],
  },
  "Gemini Veo 3.1 Quality": {
    aspectRatios: ["16:9", "9:16"],
    durations: ["8 秒"],
    qualities: ["480P", "720P"],
  },
  "Grok Imagine Video": {
    aspectRatios: ["16:9", "9:16", "1:1", "3:2", "2:3"],
    durations: ["6 秒", "10 秒", "15 秒", "30 秒"],
    qualities: ["480P", "720P"],
  },
}
