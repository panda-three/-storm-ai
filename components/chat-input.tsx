"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Paperclip, Mic, Send, Image, Wand2, Palette } from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatInputProps {
  onSend: (message: string) => void
}

const quickActions = [
  { icon: Image, label: "上传图片", color: "text-blue-400" },
  { icon: Wand2, label: "AI增强", color: "text-purple-400" },
  { icon: Palette, label: "风格转换", color: "text-pink-400" },
]

export function ChatInput({ onSend }: ChatInputProps) {
  const [message, setMessage] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [message])

  const handleSubmit = () => {
    if (message.trim()) {
      onSend(message)
      setMessage("")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="space-y-3">
      {/* Quick Actions */}
      <div className="flex items-center gap-2">
        {quickActions.map((action) => (
          <Button
            key={action.label}
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs border-border/50 bg-card hover:bg-accent"
          >
            <action.icon className={cn("h-3.5 w-3.5", action.color)} />
            {action.label}
          </Button>
        ))}
      </div>

      {/* Input Container */}
      <div className="relative flex items-end gap-2 rounded-2xl border border-border/50 bg-card p-2">
        {/* Attachment Button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Paperclip className="h-5 w-5" />
        </Button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述你的设计需求..."
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none py-2"
        />

        {/* Voice Input */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Mic className="h-5 w-5" />
        </Button>

        {/* Send Button */}
        <Button
          size="icon"
          className={cn(
            "h-9 w-9 shrink-0 rounded-xl transition-all",
            message.trim()
              ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
              : "bg-muted text-muted-foreground"
          )}
          disabled={!message.trim()}
          onClick={handleSubmit}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Footer hint */}
      <p className="text-center text-xs text-muted-foreground">
        按 Enter 发送，Shift + Enter 换行
      </p>
    </div>
  )
}
