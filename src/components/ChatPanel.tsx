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
    <div className="flex h-full flex-col border-l border-slate-200 bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
        </svg>
        <h3 className="text-sm font-semibold text-slate-700">对话记录</h3>
        <span className="ml-auto text-xs text-slate-400">{messages.length} 条消息</span>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-400">
            <div className="mb-2 text-4xl">🤖</div>
            <p className="text-sm font-medium text-slate-500">AI 助手</p>
            <p className="mt-1 max-w-[200px] text-center text-xs text-slate-400">
              我是你的通用人工智能助手，可以帮你解答问题、编写代码、分析文件等。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((message) => (
              <ChatMessageItem key={message.id} message={message} />
            ))}
            {isAgentThinking && (
              <div className="flex gap-2 py-2">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-medium text-violet-700">
                  AI
                </div>
                <div className="rounded-lg bg-white px-3 py-1.5 shadow-sm">
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-slate-200 bg-white p-3">
        <ChatInput onSend={handleSend} disabled={!currentProject || isAgentThinking} />
      </div>
    </div>
  )
}
