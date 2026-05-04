"use client"

import { Button } from "@/components/ui/button"
import { Sparkles, Palette, Home, Building2, Trees, Lightbulb } from "lucide-react"

const suggestions = [
  {
    icon: Home,
    title: "客厅设计",
    description: "现代简约风格的客厅设计方案",
    color: "from-blue-500/20 to-cyan-500/20",
    iconColor: "text-blue-400",
  },
  {
    icon: Building2,
    title: "办公空间",
    description: "创意开放式办公环境设计",
    color: "from-purple-500/20 to-pink-500/20",
    iconColor: "text-purple-400",
  },
  {
    icon: Trees,
    title: "花园景观",
    description: "禅意日式庭院景观规划",
    color: "from-green-500/20 to-emerald-500/20",
    iconColor: "text-green-400",
  },
  {
    icon: Lightbulb,
    title: "灯光设计",
    description: "智能照明系统方案设计",
    color: "from-amber-500/20 to-orange-500/20",
    iconColor: "text-amber-400",
  },
]

export function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      {/* Logo and Title */}
      <div className="flex flex-col items-center gap-4 mb-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-purple-500/25">
          <Sparkles className="h-8 w-8 text-white" />
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground mb-2">风暴AI 工作空间</h1>
          <p className="text-muted-foreground text-lg">设计师必备的AI设计工具</p>
        </div>
      </div>

      {/* CTA Button */}
      <Button
        size="lg"
        className="mb-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 h-12 text-base rounded-xl shadow-lg shadow-purple-500/25"
      >
        <Sparkles className="h-5 w-5 mr-2" />
        立即开始
      </Button>

      {/* Suggestions Grid */}
      <div className="w-full max-w-2xl">
        <p className="text-sm text-muted-foreground mb-4 text-center">或者从这些建议开始</p>
        <div className="grid grid-cols-2 gap-3">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.title}
              className={`group flex items-start gap-3 rounded-xl p-4 text-left transition-all border border-border/50 hover:border-border bg-gradient-to-br ${suggestion.color} hover:scale-[1.02]`}
            >
              <div className={`rounded-lg p-2 bg-background/50 ${suggestion.iconColor}`}>
                <suggestion.icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-medium text-foreground text-sm">{suggestion.title}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{suggestion.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Features hint */}
      <div className="mt-12 flex items-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Palette className="h-4 w-4" />
          <span>多种设计风格</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4" />
          <span>AI智能生成</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Home className="h-4 w-4" />
          <span>室内外设计</span>
        </div>
      </div>
    </div>
  )
}
