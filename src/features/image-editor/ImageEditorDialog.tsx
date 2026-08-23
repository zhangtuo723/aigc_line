import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Excalidraw, convertToExcalidrawElements, exportToBlob } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type {
  BinaryFileData,
  BinaryFiles,
  DataURL,
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, FileId } from '@excalidraw/excalidraw/element/types'
import type { BoardState } from '../../shared/ipc.types'

export interface ImageEditorSource {
  nodeId: string
  title: string
  url: string
}

interface ImageEditorDialogProps {
  title: string
  sources: ImageEditorSource[]
  boardState?: BoardState
  onChange: (state: BoardState) => void
  onPreview: (result: { pngData: ArrayBuffer; width: number; height: number }) => Promise<void>
  onClose: () => void
  onExport: (result: { pngData: ArrayBuffer; width: number; height: number }) => Promise<void>
}

const blobToDataUrl = (blob: Blob) => new Promise<DataURL>((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error ?? new Error('图片数据读取失败'))
  reader.onload = () => resolve(reader.result as DataURL)
  reader.readAsDataURL(blob)
})

const SOURCE_ELEMENT_PREFIX = 'image-editor-element-'
const SOURCE_FILE_PREFIX = 'image-editor-source-'
const AUTO_SAVE_DELAY_MS = 600

const serializeBoardState = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  connectedFileIds: ReadonlySet<string>,
): BoardState => ({
  version: 1,
  elements: elements.filter((element) => (
    !element.isDeleted && (element.type !== 'image' || (!!element.fileId && connectedFileIds.has(element.fileId)))
  )),
  appState: {
    viewBackgroundColor: appState.viewBackgroundColor,
    currentItemStrokeColor: appState.currentItemStrokeColor,
    currentItemBackgroundColor: appState.currentItemBackgroundColor,
    currentItemFillStyle: appState.currentItemFillStyle,
    currentItemStrokeWidth: appState.currentItemStrokeWidth,
    currentItemStrokeStyle: appState.currentItemStrokeStyle,
    currentItemRoughness: appState.currentItemRoughness,
    currentItemOpacity: appState.currentItemOpacity,
    currentItemFontFamily: appState.currentItemFontFamily,
    currentItemFontSize: appState.currentItemFontSize,
    currentItemTextAlign: appState.currentItemTextAlign,
    currentItemStartArrowhead: appState.currentItemStartArrowhead,
    currentItemEndArrowhead: appState.currentItemEndArrowhead,
    gridSize: appState.gridSize,
    gridStep: appState.gridStep,
    gridModeEnabled: appState.gridModeEnabled,
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: appState.zoom,
  },
})

export function ImageEditorDialog({ title, sources, boardState, onChange, onPreview, onClose, onExport }: ImageEditorDialogProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const boardRootRef = useRef<HTMLElement | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingStateRef = useRef<BoardState | null>(null)
  const [ready, setReady] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [closing, setClosing] = useState(false)
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
      const sourceElements = convertToExcalidrawElements(loaded.map(({ element }) => element), { regenerateIds: false })
      const sourceElementsById = new Map(sourceElements.map((element) => [element.id, element]))
      const restoredIds = new Set<string>()
      const restoredElements: ExcalidrawElement[] = []
      if (boardState?.version === 1 && Array.isArray(boardState.elements)) {
        for (const candidate of boardState.elements) {
          if (!candidate || typeof candidate !== 'object' || typeof (candidate as { id?: unknown }).id !== 'string') continue
          const element = candidate as ExcalidrawElement
          if (element.id.startsWith(SOURCE_ELEMENT_PREFIX)) {
            const currentSource = sourceElementsById.get(element.id)
            if (!currentSource || currentSource.type !== 'image' || element.type !== 'image') continue
            restoredIds.add(element.id)
            restoredElements.push({ ...element, fileId: currentSource.fileId, status: 'saved', isDeleted: false })
            continue
          }
          // Images inserted directly into Excalidraw are intentionally not persisted as data URLs.
          if (element.type === 'image') continue
          restoredIds.add(element.id)
          restoredElements.push(element)
        }
      }
      const elements = [
        ...restoredElements,
        ...sourceElements.filter((element) => !restoredIds.has(element.id)),
      ]
      setReady(true)
      return {
        elements,
        files,
        appState: {
          theme: 'dark',
          viewBackgroundColor: '#111318',
          currentItemStrokeColor: '#ff3b30',
          currentItemBackgroundColor: 'transparent',
          ...(boardState?.version === 1 ? boardState.appState : {}),
        } as ExcalidrawInitialDataState['appState'],
        scrollToContent: !boardState,
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      throw reason
    }
  }, [boardState, sources])

  const flushPendingState = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const pending = pendingStateRef.current
    if (!pending) return
    pendingStateRef.current = null
    onChange(pending)
  }, [onChange])

  const scheduleSave = useCallback((elements: readonly ExcalidrawElement[], appState: AppState) => {
    const connectedFileIds = new Set(sources.map((source) => `${SOURCE_FILE_PREFIX}${source.nodeId}`))
    pendingStateRef.current = serializeBoardState(elements, appState, connectedFileIds)
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(flushPendingState, AUTO_SAVE_DELAY_MS)
  }, [flushPendingState, sources])

  const captureCenterPreview = async () => {
    const sourceCanvas = boardRootRef.current?.querySelector<HTMLCanvasElement>('canvas.excalidraw__canvas.static')
    if (!sourceCanvas) throw new Error('暂时无法读取画板预览，请稍后重试')
    const rect = sourceCanvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1 || sourceCanvas.width < 1 || sourceCanvas.height < 1) {
      throw new Error('画板预览尺寸无效')
    }
    const targetRatio = 16 / 9
    const cropWidthCss = Math.min(rect.width, rect.height * targetRatio)
    const cropHeightCss = cropWidthCss / targetRatio
    const cropXCss = (rect.width - cropWidthCss) / 2
    const cropYCss = (rect.height - cropHeightCss) / 2
    const scaleX = sourceCanvas.width / rect.width
    const scaleY = sourceCanvas.height / rect.height
    const output = document.createElement('canvas')
    output.width = 1280
    output.height = 720
    const context = output.getContext('2d')
    if (!context) throw new Error('无法创建画板预览画布')
    context.fillStyle = apiRef.current?.getAppState().viewBackgroundColor ?? '#111318'
    context.fillRect(0, 0, output.width, output.height)
    context.drawImage(
      sourceCanvas,
      cropXCss * scaleX,
      cropYCss * scaleY,
      cropWidthCss * scaleX,
      cropHeightCss * scaleY,
      0,
      0,
      output.width,
      output.height,
    )
    const blob = await new Promise<Blob>((resolve, reject) => {
      output.toBlob((value) => value ? resolve(value) : reject(new Error('画板预览 PNG 编码失败')), 'image/png')
    })
    return { pngData: await blob.arrayBuffer(), width: output.width, height: output.height }
  }

  const closeBoard = async () => {
    if (closing) return
    flushPendingState()
    setClosing(true)
    setError('')
    try {
      await onPreview(await captureCenterPreview())
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setClosing(false)
    }
  }

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
  }, [])

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
    <div data-canvas-node-editor-dialog data-image-editor-dialog className="app-no-drag fixed inset-x-0 bottom-0 top-10 z-[220] flex flex-col bg-[#090a0e] text-white">
      <header className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-white/10 bg-[#121318] px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d4af37]/15 text-[#e8c766]">✎</div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="truncate text-[10px] text-white/35">{sources.length > 0 ? `Excalidraw 自由画板 · 已载入 ${sources.length} 张连接素材` : 'Excalidraw 自由画板 · 无连接素材'}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {notice && <span className="max-w-[34rem] truncate text-[10px] text-emerald-300" title={notice}>{notice}</span>}
          {error && <span className="max-w-[34rem] truncate text-[10px] text-rose-300" title={error}>{error}</span>}
          <button disabled={closing} onClick={() => void closeBoard()} className="rounded-lg px-3 py-2 text-[11px] text-white/55 hover:bg-white/[0.06] hover:text-white disabled:opacity-45">{closing ? '正在保存预览…' : '关闭并返回画布'}</button>
        </div>
      </header>

      <main
        ref={boardRootRef}
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
          onChange={scheduleSave}
          theme="dark"
          langCode="zh-CN"
          autoFocus
          handleKeyboardGlobally
          UIOptions={{
            tools: {
              image: false,
            },
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
        <span>直接绘制，或编辑连接图片；框选或 Shift 多选后右键即可导出，可重复输出多个结果。</span>
        <span>{exporting ? '正在写入外部画布…' : '图片、图形、箭头、文字和自由画笔均可参与导出'}</span>
      </footer>
    </div>,
    document.body,
  )
}
