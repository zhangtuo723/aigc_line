import { useRef, useEffect, useState } from 'react'
import type { ChatMessage as ChatMessageType } from '../shared/ipc.types'
import { ChatMessageItem } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { useAppStore } from '../stores/app.store'

export function ChatPanel() {
  const messages = useAppStore((state) => state.messages)
  const chatHistoryError = useAppStore((state) => state.chatHistoryError)
  const currentProject = useAppStore((state) => state.currentProject)
  const sendChatMessage = useAppStore((state) => state.sendChatMessage)
  const isAgentThinking = useAppStore((state) => (
    state.currentProject ? !!state.agentThinkingByProject[state.currentProject.id] : false
  ))
  const messagesViewportRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottomRef = useRef(true)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [isClearingContext, setIsClearingContext] = useState(false)
  const [clearError, setClearError] = useState('')
  const [sendError, setSendError] = useState('')
  const toolStepCount = messages.reduce((count, message) => count + (message.toolCall ? 1 : 0), 0)
  const dialogueCount = messages.length - toolStepCount

  useEffect(() => {
    const viewport = messagesViewportRef.current
    if (!viewport || !shouldStickToBottomRef.current) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    shouldStickToBottomRef.current = true
    setSendError('')
    const viewport = messagesViewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [currentProject?.id])

  const handleSend = (content: string, attachments?: ChatMessageType['attachments']) => {
    if (!currentProject) return
    if (/^\/clear(?:\s|$)/i.test(content.trim())) {
      setClearError('')
      setClearConfirmOpen(true)
      return
    }
    setSendError('')
    void sendChatMessage(content, attachments).catch((error) => {
      setSendError(error instanceof Error ? error.message : '消息发送失败，附件与节点引用已恢复')
    })
  }

  const handleClearContext = async () => {
    if (!currentProject || isAgentThinking || isClearingContext) return
    setIsClearingContext(true)
    setClearError('')
    try {
      const result = await window.electronAPI.clearAgentContext(currentProject.id)
      if (!result.success) {
        setClearError(result.error || '新建上下文失败')
        return
      }
      setClearConfirmOpen(false)
    } catch (error) {
      setClearError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsClearingContext(false)
    }
  }

  return (
    <div className="relative flex h-full flex-col border-l border-white/[0.08] bg-[#0f0f16]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-3">
        <span className="text-[9px] text-[#d4af37]">✦</span>
        <h3 className="text-sm font-medium tracking-wider text-[#e8e6df]">对话记录</h3>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] tabular-nums text-[#6d6a78]">
          <span>{dialogueCount} 条对话</span>
          {toolStepCount > 0 && (
            <>
              <span className="text-white/10">·</span>
              <span>{toolStepCount} 个步骤</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setClearError('')
            setClearConfirmOpen(true)
          }}
          disabled={!currentProject || isAgentThinking || isClearingContext}
          className="ml-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-[#8a8794] transition hover:border-[#d4af37]/40 hover:bg-[#d4af37]/[0.08] hover:text-[#e8c766] disabled:cursor-not-allowed disabled:opacity-40"
          title={isAgentThinking ? '请等待当前回合结束' : '清空 Claude 上下文，但保留聊天历史和画布'}
        >
          新建上下文
        </button>
      </div>

      {/* Messages area */}
      <div
        ref={messagesViewportRef}
        onScroll={(event) => {
          const element = event.currentTarget
          shouldStickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        }}
        className="flex-1 overflow-y-auto p-3"
      >
        {chatHistoryError ? (
          <div className="m-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {chatHistoryError}
          </div>
        ) : messages.length === 0 ? (
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
          <div className="space-y-0.5">
            {messages.map((message) => (
              <ChatMessageItem key={message.id} message={message} />
            ))}
            {isAgentThinking && (
              <div className="flex gap-2 py-2">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 text-[10px] font-medium text-[#e8c766]">
                  AI
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8a8794] [animation-delay:-0.3s]" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8a8794] [animation-delay:-0.15s]" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8a8794]" />
                  </div>
                  <button
                    onClick={() => currentProject && void window.electronAPI.interruptAgent(currentProject.id)}
                    className="ml-1 rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-[#8a8794] transition hover:border-rose-400/40 hover:text-rose-300"
                    title="打断当前回合（已排队的消息仍会执行）"
                  >
                    停止
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-white/[0.08]">
        {sendError && (
          <div className="mx-3 mt-2 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
            {sendError}
          </div>
        )}
        <ChatInput onSend={handleSend} disabled={!currentProject || isClearingContext} />
      </div>

      {clearConfirmOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 p-5 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-context-title"
            className="w-full max-w-sm rounded-2xl border border-[#d4af37]/30 bg-[#17161f] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/10 text-[#e8c766]">✦</div>
              <div>
                <h4 id="clear-context-title" className="text-sm font-medium text-[#e8e6df]">新建 Claude 上下文？</h4>
                <p className="mt-2 text-xs leading-5 text-[#8a8794]">
                  Claude 将无法访问分界线之前的对话。聊天历史和画布内容会继续保留，不会删除任何项目文件。
                </p>
              </div>
            </div>

            {clearError && (
              <div className="mt-4 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
                {clearError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClearConfirmOpen(false)}
                disabled={isClearingContext}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[#9b98a5] transition hover:bg-white/5 hover:text-[#e8e6df] disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleClearContext()}
                disabled={isClearingContext || isAgentThinking}
                className="rounded-lg border border-[#d4af37]/40 bg-[#d4af37]/15 px-3 py-1.5 text-xs text-[#e8c766] transition hover:bg-[#d4af37]/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isClearingContext ? '正在新建…' : '确认新建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
