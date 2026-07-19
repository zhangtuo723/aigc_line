import { useRef, useEffect, useState, useCallback } from 'react'
import type { ChatMessage as ChatMessageType } from '../shared/ipc.types'
import { ChatMessageItem } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { useAppStore } from '../stores/app.store'

export function FloatingChat() {
  const { messages, isAgentThinking, currentProject, sendChatMessage } = useAppStore()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ isDragging: boolean; startX: number; startY: number; initialLeft: number; initialTop: number }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialLeft: 0,
    initialTop: 0,
  })

  const [position, setPosition] = useState({ left: 16, top: 16 })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const dragData = dragRef.current
    dragData.isDragging = true
    dragData.startX = e.clientX
    dragData.startY = e.clientY
    dragData.initialLeft = position.left
    dragData.initialTop = position.top
    e.preventDefault()
  }, [position])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const dragData = dragRef.current
      if (!dragData.isDragging) return

      const deltaX = e.clientX - dragData.startX
      const deltaY = e.clientY - dragData.startY

      setPosition({
        left: dragData.initialLeft + deltaX,
        top: dragData.initialTop + deltaY,
      })
    }

    const handleMouseUp = () => {
      dragRef.current.isDragging = false
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const handleSend = (content: string, attachments?: ChatMessageType['attachments']) => {
    if (!currentProject) return
    sendChatMessage(content, attachments)
  }

  return (
    <div
      className="absolute z-10 flex h-[calc(100%-40px)] w-96 flex-col rounded-2xl border border-slate-200/60 bg-white/80 shadow-lg backdrop-blur-md"
      style={{ left: position.left, top: position.top }}
    >
      {/* Draggable Header */}
      <div
        className="flex cursor-move items-center justify-between border-b border-slate-200/50 px-4 py-3 select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
          </svg>
          <h3 className="text-sm font-semibold text-slate-700">对话记录</h3>
        </div>
        <span className="text-xs text-slate-400">{messages.length} 条消息</span>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-400">
            <div className="mb-2 text-4xl">🎬</div>
            <p className="text-sm font-medium text-slate-500">AIGC Line Agent</p>
            <p className="mt-1 max-w-[200px] text-center text-xs text-slate-400">
              上传 SRT 字幕文件和 MP3 音频文件，我将为你自动生成手绘分镜视频。
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

      {/* Input area - integrated at bottom of chat panel */}
      <div className="border-t border-slate-200/50 bg-white/50 p-3">
        <ChatInput onSend={handleSend} disabled={!currentProject || isAgentThinking} />
      </div>
    </div>
  )
}
