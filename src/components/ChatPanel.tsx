import { useRef, useEffect } from 'react'
import type { ChatMessage as ChatMessageType } from '../shared/ipc.types'
import { ChatMessageItem } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { useAppStore } from '../stores/app.store'

export function ChatPanel() {
  const { messages, isAgentThinking, currentProject, sendChatMessage } = useAppStore()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = (content: string, attachments?: ChatMessageType['attachments']) => {
    if (!currentProject) return
    sendChatMessage(content, attachments)
  }

  return (
    <div className="flex h-full flex-col border-l border-white/[0.08] bg-[#0f0f16]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-3">
        <span className="text-[9px] text-[#d4af37]">✦</span>
        <h3 className="text-sm font-medium tracking-wider text-[#e8e6df]">对话记录</h3>
        <span className="ml-auto text-xs text-[#6d6a78]">{messages.length} 条消息</span>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-[#6d6a78]">
            <div className="relative">
              <div className="absolute inset-0 -m-4 rounded-full bg-[#d4af37]/10 blur-2xl" />
              <img src="/logo.svg" alt="" className="relative h-14 w-14 rounded-2xl opacity-90" />
            </div>
            <p className="mt-5 font-display text-sm tracking-[0.25em] text-[#e8c766]">AIGC CANVAS</p>
            <p className="mt-2 max-w-[220px] text-center text-xs leading-relaxed text-[#6d6a78]">
              我是你的 AIGC 创作助手，可以帮你生成分镜、编写脚本、分析文件等。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((message) => (
              <ChatMessageItem key={message.id} message={message} />
            ))}
            {isAgentThinking && (
              <div className="flex gap-2 py-2">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 text-[10px] font-medium text-[#e8c766]">
                  AI
                </div>
                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8a8794] [animation-delay:-0.3s]" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8a8794] [animation-delay:-0.15s]" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8a8794]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-white/[0.08]">
        <ChatInput onSend={handleSend} disabled={!currentProject || isAgentThinking} />
      </div>
    </div>
  )
}