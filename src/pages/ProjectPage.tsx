import { useCallback, useRef, useState } from 'react'
import { useAppStore } from '../stores/app.store'
import { CanvasArea } from '../components/CanvasArea'
import { ChatPanel } from '../components/ChatPanel'

const MIN_CHAT_WIDTH = 320
const MAX_CHAT_WIDTH = 800
const DEFAULT_CHAT_WIDTH = 420

export function ProjectPage() {
  const currentProject = useAppStore((state) => state.currentProject)
  const setCurrentPage = useAppStore((state) => state.setCurrentPage)
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH)
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null)

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragState.current = { startX: e.clientX, startWidth: chatWidth }

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragState.current) return
      const delta = dragState.current.startX - ev.clientX
      const next = Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, dragState.current.startWidth + delta))
      setChatWidth(next)
    }
    const onMouseUp = () => {
      dragState.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [chatWidth])

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="relative flex items-center gap-4 border-b border-white/[0.08] bg-[#0d0d14] px-4 py-3">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/30 to-transparent" />
        <button
          onClick={() => setCurrentPage('home')}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-[#8a8794] transition hover:bg-white/5 hover:text-[#e8e6df]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回
        </button>
        <div className="h-4 w-px bg-white/10" />
        <span className="text-[9px] text-[#d4af37]">✦</span>
        <h2 className="text-sm font-medium tracking-wider text-[#e8e6df]">
          {currentProject?.name ?? '未命名项目'}
        </h2>
      </div>

      {/* Main content: Canvas + Chat */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Canvas */}
        <div className="flex-1 overflow-hidden">
          <CanvasArea />
        </div>

        {/* Drag divider */}
        <div
          onMouseDown={onDividerMouseDown}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const delta = event.key === 'ArrowLeft' ? 16 : -16
            setChatWidth((width) => Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, width + delta)))
          }}
          role="separator"
          aria-label="调整画布与聊天区域宽度"
          aria-orientation="vertical"
          aria-valuemin={MIN_CHAT_WIDTH}
          aria-valuemax={MAX_CHAT_WIDTH}
          aria-valuenow={chatWidth}
          tabIndex={0}
          className="group w-1 flex-shrink-0 cursor-col-resize bg-white/[0.08] transition-colors hover:bg-[#d4af37]/60 active:bg-[#d4af37]"
        />

        {/* Right: Chat */}
        <div className="flex-shrink-0" style={{ width: chatWidth }}>
          <ChatPanel />
        </div>
      </div>
    </div>
  )
}
