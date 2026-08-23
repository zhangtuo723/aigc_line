import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Excalidraw, convertToExcalidrawElements, exportToBlob } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type {
  BinaryFileData,
  BinaryFiles,
  DataURL,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types'
import type { FileId } from '@excalidraw/excalidraw/element/types'

export interface ImageEditorSource {
  nodeId: string
  title: string
  url: string
}

interface ImageEditorDialogProps {
  title: string
  sources: ImageEditorSource[]
  onClose: () => void
  onExport: (result: { pngData: ArrayBuffer; width: number; height: number }) => Promise<void>
}

const blobToDataUrl = (blob: Blob) => new Promise<DataURL>((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error ?? new Error('图片数据读取失败'))
  reader.onload = () => resolve(reader.result as DataURL)
  reader.readAsDataURL(blob)
})

export function ImageEditorDialog({ title, sources, onClose, onExport }: ImageEditorDialogProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [ready, setReady] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedCount: number } | null>(null)

  const loadInitialData = useCallback(async (): Promise<ExcalidrawInitialDataState> => {
    try {
      setError('')
      const loaded = await Promise.all(sources.map(async (source, index) => {
        const response = await fetch(source.url)
        if (!response.ok) throw new Error(`读取“${source.title}”失败：HTTP ${response.status}`)
        const blob = await response.blob()
        const bitmap = await createImageBitmap(blob)
        const originalWidth = bitmap.width
        const originalHeight = bitmap.height
        bitmap.close()
        const maxDisplaySize = 720
        const scale = Math.min(1, maxDisplaySize / Math.max(originalWidth, originalHeight))
        const width = Math.max(1, Math.round(originalWidth * scale))
        const height = Math.max(1, Math.round(originalHeight * scale))
        const fileId = `image-editor-source-${source.nodeId}` as FileId
        const file: BinaryFileData = {
          id: fileId,
          mimeType: (blob.type || 'image/png') as BinaryFileData['mimeType'],
          dataURL: await blobToDataUrl(blob),
          created: Date.now(),
          lastRetrieved: Date.now(),
        }
        return {
          file,
          element: {
            type: 'image' as const,
            id: `image-editor-element-${source.nodeId}`,
            x: (index % 3) * 780,
            y: Math.floor(index / 3) * 780,
            width,
            height,
            fileId,
            status: 'saved' as const,
            scale: [1, 1] as [number, number],
          },
        }
      }))
      const files = Object.fromEntries(loaded.map(({ file }) => [file.id, file])) as BinaryFiles
      const elements = convertToExcalidrawElements(loaded.map(({ element }) => element), { regenerateIds: false })
      setReady(true)
      return {
        elements,
        files,
        appState: {
          theme: 'dark',
          viewBackgroundColor: '#111318',
          currentItemStrokeColor: '#ff3b30',
          currentItemBackgroundColor: 'transparent',
        },
        scrollToContent: true,
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      throw reason
    }
  }, [sources])

  const exportSelection = async () => {
    const api = apiRef.current
    if (!api || exporting) return
    const selectedIds = api.getAppState().selectedElementIds
    const elements = api.getSceneElements().filter((element) => selectedIds[element.id])
    if (elements.length === 0) {
      setError('请先框选或按 Shift 多选要导出的图片、标注或文字')
      setContextMenu(null)
      return
    }
    setExporting(true)
    setError('')
    setNotice('')
    setContextMenu(null)
    try {
      const png = await exportToBlob({
        elements,
        appState: {
          ...api.getAppState(),
          exportBackground: true,
          exportWithDarkMode: false,
          viewBackgroundColor: '#ffffff',
        },
        files: api.getFiles(),
        mimeType: 'image/png',
        exportPadding: 0,
      })
      const bitmap = await createImageBitmap(png)
      const width = bitmap.width
      const height = bitmap.height
      bitmap.close()
      await onExport({ pngData: await png.arrayBuffer(), width, height })
      setNotice(`已导出 ${elements.length} 个素材，并在外部画布创建图片节点`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setExporting(false)
    }
  }

  return createPortal(
    <div className="app-no-drag fixed inset-x-0 bottom-0 top-10 z-[220] flex flex-col bg-[#090a0e] text-white">
      <header className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-white/10 bg-[#121318] px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d4af37]/15 text-[#e8c766]">✎</div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="truncate text-[10px] text-white/35">Excalidraw 素材编辑台 · 已载入 {sources.length} 张连接图片</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {notice && <span className="max-w-[34rem] truncate text-[10px] text-emerald-300" title={notice}>{notice}</span>}
          {error && <span className="max-w-[34rem] truncate text-[10px] text-rose-300" title={error}>{error}</span>}
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-[11px] text-white/55 hover:bg-white/[0.06] hover:text-white">关闭并返回画布</button>
        </div>
      </header>

      <main
        className="relative min-h-0 flex-1"
        onPointerDownCapture={(event) => {
          const target = event.target as HTMLElement
          if (event.button !== 2 && !target.closest('[data-image-editor-context-menu]')) setContextMenu(null)
        }}
        onContextMenuCapture={(event) => {
          event.preventDefault()
          event.stopPropagation()
          const selectedCount = Object.keys(apiRef.current?.getAppState().selectedElementIds ?? {}).length
          setContextMenu({ x: event.clientX, y: event.clientY, selectedCount })
        }}
      >
        <Excalidraw
          excalidrawAPI={(api) => { apiRef.current = api }}
          initialData={loadInitialData}
          theme="dark"
          langCode="zh-CN"
          autoFocus
          handleKeyboardGlobally
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: false,
              clearCanvas: false,
              toggleTheme: false,
              saveAsImage: false,
            },
          }}
        />
        {contextMenu && (
          <div
            data-image-editor-context-menu
            className="fixed z-[260] min-w-48 rounded-xl border border-white/12 bg-[#202127] p-1.5 shadow-[0_16px_45px_rgba(0,0,0,0.65)]"
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 220), top: Math.min(contextMenu.y, window.innerHeight - 100) }}
          >
            <button
              disabled={!ready || exporting || contextMenu.selectedCount === 0}
              onClick={() => void exportSelection()}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[11px] text-white/80 hover:bg-[#d4af37]/12 hover:text-[#f0d98c] disabled:opacity-35"
            >
              <span>{exporting ? '正在导出…' : '导出所选素材'}</span>
              <span className="ml-5 text-[9px] text-white/35">{contextMenu.selectedCount} 项</span>
            </button>
          </div>
        )}
      </main>
      <footer className="flex h-8 flex-shrink-0 items-center justify-between border-t border-white/10 bg-[#111217] px-4 text-[9px] text-white/30">
        <span>框选或 Shift 多选素材后右键，选择“导出所选素材”；可重复导出多个结果。</span>
        <span>{exporting ? '正在写入外部画布…' : '图片、图形、箭头、文字和自由画笔均可参与导出'}</span>
      </footer>
    </div>,
    document.body,
  )
}
