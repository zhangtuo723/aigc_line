import { useAppStore } from '../stores/app.store'
import { CanvasArea } from '../components/CanvasArea'
import { ChatPanel } from '../components/ChatPanel'

export function ProjectPage() {
  const { currentProject, setCurrentPage } = useAppStore()

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-3">
        <button
          onClick={() => setCurrentPage('home')}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回
        </button>
        <div className="h-4 w-px bg-slate-300" />
        <h2 className="text-sm font-semibold text-slate-800">
          {currentProject?.name ?? '未命名项目'}
        </h2>
      </div>

      {/* Main content: Canvas + Chat */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Canvas */}
        <div className="flex-1">
          <CanvasArea />
        </div>

        {/* Right: Chat */}
        <div className="w-96 flex-shrink-0">
          <ChatPanel />
        </div>
      </div>
    </div>
  )
}
