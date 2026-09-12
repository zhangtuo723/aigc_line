import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../stores/app.store'
import { CanvasArea } from '../components/CanvasArea'
import { ChatPanel } from '../components/ChatPanel'

const MIN_CHAT_WIDTH = 320
const MAX_CHAT_WIDTH = 800
const DEFAULT_CHAT_WIDTH = 420

export function ProjectPage() {
  const currentProject = useAppStore((state) => state.currentProject)
  const closeProject = useAppStore((state) => state.closeProject)
  const [chatWidth, setChatWidth] = useState(() => {
    try { return Number(localStorage.getItem('canvas-chat-width')) || DEFAULT_CHAT_WIDTH } catch { return DEFAULT_CHAT_WIDTH }
  })
  const [chatHidden, setChatHidden] = useState(false)
  const [containerWidth, setContainerWidth] = useState(window.innerWidth)
  const [leaving, setLeaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null)
  const maxWidth = Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, containerWidth - 364))
  const visibleWidth = Math.min(maxWidth, Math.max(MIN_CHAT_WIDTH, chatWidth))
  const stopDrag = () => { dragState.current = null; document.body.style.cursor = ''; document.body.style.userSelect = '' }
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    if (containerRef.current) observer.observe(containerRef.current)
    window.addEventListener('blur', stopDrag)
    return () => { observer.disconnect(); window.removeEventListener('blur', stopDrag); stopDrag() }
  }, [])
  useEffect(() => { try { localStorage.setItem('canvas-chat-width', String(chatWidth)) } catch { /* Layout still works without storage. */ } }, [chatWidth])

  const leaveProject = async () => {
    setLeaving(true)
    setSaveError('')
    try { await closeProject() }
    catch (error) { setSaveError(error instanceof Error ? error.message : '保存失败，请重试') }
    finally { setLeaving(false) }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="relative flex items-center gap-4 border-b border-white/[0.08] bg-[#0d0d14] px-4 py-3">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/30 to-transparent" />
        <button
          onClick={() => void leaveProject()}
          disabled={leaving}
          title="保存并关闭项目，返回首页"
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
        {saveError && <span role="alert" className="truncate text-xs text-rose-300">{saveError}</span>}
        <button onClick={() => setChatHidden((value) => !value)} aria-expanded={!chatHidden} className="ml-auto shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">{chatHidden ? '展开聊天' : '收起聊天'}</button>
      </div>

      {/* Main content: Canvas + Chat */}
      <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: Canvas */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <CanvasArea />
        </div>

        {/* Drag divider */}
        {!chatHidden && <div
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            dragState.current = { startX: event.clientX, startWidth: visibleWidth }
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
          onPointerMove={(event) => {
            if (!dragState.current) return
            setChatWidth(Math.min(maxWidth, Math.max(MIN_CHAT_WIDTH, dragState.current.startWidth + dragState.current.startX - event.clientX)))
          }}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onLostPointerCapture={stopDrag}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const delta = event.key === 'ArrowLeft' ? 16 : -16
            setChatWidth(Math.min(maxWidth, Math.max(MIN_CHAT_WIDTH, visibleWidth + delta)))
          }}
          role="separator"
          aria-label="调整画布与聊天区域宽度"
          aria-orientation="vertical"
          aria-valuemin={MIN_CHAT_WIDTH}
          aria-valuemax={maxWidth}
          aria-valuenow={visibleWidth}
          tabIndex={0}
          className="group w-1 flex-shrink-0 cursor-col-resize bg-white/[0.08] transition-colors hover:bg-[#d4af37]/60 active:bg-[#d4af37]"
        />}

        {/* Right: Chat */}
        <div className={`flex-shrink-0 ${chatHidden ? 'hidden' : ''}`} style={{ width: visibleWidth }}>
          <ChatPanel />
        </div>
      </div>
    </div>
  )
}
