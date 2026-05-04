"use client"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Sparkles, User, Copy, RefreshCw, ThumbsUp, ThumbsDown } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Message {
  id: number
  role: "user" | "assistant"
  content: string
  images?: string[]
}

interface ChatMessageProps {
  message: Message
}

// Generate placeholder colors for design images
const imageColors = [
  "from-amber-800/40 to-orange-900/40",
  "from-stone-700/40 to-neutral-800/40",
  "from-slate-700/40 to-gray-800/40",
  "from-zinc-700/40 to-stone-800/40",
  "from-neutral-700/40 to-zinc-800/40",
]

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user"

  return (
    <div className={cn("flex gap-4", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <Avatar className={cn(
        "h-8 w-8 shrink-0",
        isUser ? "bg-gradient-to-br from-blue-500 to-purple-600" : "bg-gradient-to-br from-purple-600 to-pink-600"
      )}>
        <AvatarFallback className="bg-transparent text-white">
          {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className={cn("flex-1 space-y-3", isUser ? "text-right" : "text-left")}>
        <div
          className={cn(
            "inline-block rounded-2xl px-4 py-3 text-sm leading-relaxed",
            isUser
              ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white"
              : "bg-card border border-border/50 text-foreground"
          )}
        >
          {message.content}
        </div>

        {/* Generated Images Grid */}
        {message.images && message.images.length > 0 && (
          <div className={cn(
            "grid gap-2",
            message.images.length === 1 ? "grid-cols-1 max-w-md" : 
            message.images.length === 2 ? "grid-cols-2 max-w-lg" :
            "grid-cols-2 max-w-xl"
          )}>
            {message.images.map((image, index) => (
              <div
                key={index}
                className={cn(
                  "relative aspect-[4/3] rounded-xl overflow-hidden cursor-pointer group",
                  "bg-gradient-to-br",
                  imageColors[index % imageColors.length]
                )}
              >
                {/* Simulated interior design image placeholder */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center text-white/60">
                    <div className="w-12 h-12 mx-auto mb-2 rounded-lg bg-white/10 backdrop-blur-sm flex items-center justify-center">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <span className="text-xs">方案 {index + 1}</span>
                  </div>
                </div>
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <Button size="sm" variant="secondary" className="h-8 text-xs">
                    查看
                  </Button>
                  <Button size="sm" variant="secondary" className="h-8 text-xs">
                    编辑
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons for AI messages */}
        {!isUser && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <ThumbsUp className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <ThumbsDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
