import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaptureUpdateAction, Excalidraw, convertToExcalidrawElements, exportToBlob, getCommonBounds } from '@excalidraw/excalidraw'
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
import { registerEditFlusher } from '../../shared/pending-edits'
import { boardExportSize, loadBoardItems, mergeBoardSources } from './image-editor-model'

export interface ImageEditorSource {
  nodeId: string
  title: string
  url: string
}

interface ImageEditorDialogProps {
  title: string
  sources: ImageEditorSource[]
  boardState?: BoardState
  onChange: (state: BoardState) => Promise<void>
  onPreview: (result: { pngData: ArrayBuffer; width: number; height: number }) => Promise<void>
  onClose: () => void
  onExport: (result: { pngData: ArrayBuffer; width: number; height: number; sourceNodeIds: string[] }) => Promise<void>
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

async function readSource(source: ImageEditorSource, index: number, maxSide: number, signal?: AbortSignal) {
  const response = await fetch(source.url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  if (blob.size > 50 * 1024 * 1024) throw new Error('图片超过 50 MB，请先缩小素材')
  signal?.throwIfAborted()
  const bitmap = await createImageBitmap(blob)
  try {
    if (bitmap.width * bitmap.height > 64 * 1024 * 1024) throw new Error('图片超过 6400 万像素，请先缩小素材')
    const previewScale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    let imageBlob = blob
    if (previewScale < 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * previewScale))
      canvas.height = Math.max(1, Math.round(bitmap.height * previewScale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建图片预览')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      imageBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('图片预览编码失败')), 'image/png'))
      canvas.width = canvas.height = 1
    }
    signal?.throwIfAborted()
    const displayScale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height))
    const fileId = `${SOURCE_FILE_PREFIX}${source.nodeId}` as FileId
    return {
      url: source.url,
      file: { id: fileId, mimeType: imageBlob.type || 'image/png', dataURL: await blobToDataUrl(imageBlob), created: Date.now(), lastRetrieved: Date.now() } as BinaryFileData,
      element: { type: 'image' as const, id: `${SOURCE_ELEMENT_PREFIX}${source.nodeId}`, x: (index % 3) * 780, y: Math.floor(index / 3) * 780,
        width: Math.max(1, Math.round(bitmap.width * displayScale)), height: Math.max(1, Math.round(bitmap.height * displayScale)), fileId, status: 'saved' as const, scale: [1, 1] as [number, number] },
    }
  } finally { bitmap.close() }
}

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
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const readyRef = useRef(false)
  const aliveRef = useRef(true)
  const loadAbortRef = useRef<AbortController | null>(null)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const lastSavedStateKeyRef = useRef('')
  const sourceCacheRef = useRef(new Map<string, Awaited<ReturnType<typeof readSource>>>())
  const initialPromiseRef = useRef<Promise<ExcalidrawInitialDataState> | null>(null)
  const lastSyncKeyRef = useRef('')
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources
  const [sourceErrors, setSourceErrors] = useState<Array<{ nodeId: string; title: string; message: string }>>([])
  const [loadedCount, setLoadedCount] = useState(0)
  const [retry, setRetry] = useState(0)
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved')
  const [ready, setReady] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedCount: number } | null>(null)

  const sourceSignature = JSON.stringify(sources.map(({ nodeId, url }) => [nodeId, url]))
  const loadSources = async (items: ImageEditorSource[], signal: AbortSignal) => {
    const previewSide = Math.max(512, Math.min(2048, Math.floor(Math.sqrt(32 * 1024 * 1024 / Math.max(1, items.length)))))
    const results = await loadBoardItems(items, async (source, index) => {
      const cached = sourceCacheRef.current.get(source.nodeId)
      return cached?.url === source.url ? cached : readSource(source, index, previewSide, signal)
    }, signal)
    const loaded: Awaited<ReturnType<typeof readSource>>[] = []
    const failures: typeof sourceErrors = []
    const elements = results.map((result, index) => {
      const source = items[index]
      if (result.status === 'fulfilled') {
        sourceCacheRef.current.set(source.nodeId, result.value)
        loaded.push(result.value)
        return result.value.element
      }
      sourceCacheRef.current.delete(source.nodeId)
      failures.push({ nodeId: source.nodeId, title: source.title, message: result.reason instanceof Error ? result.reason.message : String(result.reason) })
      return { type: 'image' as const, id: `${SOURCE_ELEMENT_PREFIX}${source.nodeId}`, fileId: `${SOURCE_FILE_PREFIX}${source.nodeId}` as FileId,
        x: (index % 3) * 780, y: Math.floor(index / 3) * 780, width: 720, height: 480, status: 'error' as const, scale: [1, 1] as [number, number] }
    })
    for (const nodeId of sourceCacheRef.current.keys()) if (!items.some((source) => source.nodeId === nodeId)) sourceCacheRef.current.delete(nodeId)
    return { elements: convertToExcalidrawElements(elements, { regenerateIds: false }), files: Object.fromEntries(loaded.map(({ file }) => [file.id, file])) as BinaryFiles, failures, count: loaded.length }
  }

  const loadInitialData = useCallback((): Promise<ExcalidrawInitialDataState> => {
    if (initialPromiseRef.current) return initialPromiseRef.current
    const controller = new AbortController()
    loadAbortRef.current = controller
    initialPromiseRef.current = (async () => {
      const loaded = await loadSources(sources, controller.signal)
      const existing = boardState?.version === 1 && Array.isArray(boardState.elements)
        ? boardState.elements.filter((element): element is ExcalidrawElement => !!element && typeof element === 'object' && typeof (element as { id?: unknown }).id === 'string')
        : []
      lastSyncKeyRef.current = `${sourceSignature}:0`
      if (aliveRef.current) { setSourceErrors(loaded.failures); setLoadedCount(loaded.count); readyRef.current = true; setReady(true) }
      return {
        elements: mergeBoardSources(existing, loaded.elements), files: loaded.files,
        appState: { theme: 'dark', viewBackgroundColor: '#111318', currentItemStrokeColor: '#ff3b30', currentItemBackgroundColor: 'transparent', ...(boardState?.version === 1 ? boardState.appState : {}) } as ExcalidrawInitialDataState['appState'],
        scrollToContent: !boardState,
      }
    })()
    return initialPromiseRef.current
  }, [])

  useEffect(() => {
    const key = `${sourceSignature}:${retry}`
    if (!ready || key === lastSyncKeyRef.current) return
    const controller = new AbortController()
    loadAbortRef.current?.abort()
    loadAbortRef.current = controller
    void loadSources(sourcesRef.current, controller.signal).then((loaded) => {
      const api = apiRef.current
      if (controller.signal.aborted || !aliveRef.current || !api) return
      api.addFiles(Object.values(loaded.files))
      api.updateScene({ elements: mergeBoardSources(api.getSceneElements(), loaded.elements), captureUpdate: CaptureUpdateAction.NEVER })
      lastSyncKeyRef.current = key
      setSourceErrors(loaded.failures)
      setLoadedCount(loaded.count)
    }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)) })
    return () => controller.abort()
  }, [ready, sourceSignature, retry])

  const flushPendingState = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const operation = saveQueueRef.current.catch(() => undefined).then(async () => {
      while (pendingStateRef.current) {
        const pending = pendingStateRef.current
        const snapshot = structuredClone(pending)
        const key = JSON.stringify(snapshot)
        if (key === lastSavedStateKeyRef.current) { if (pendingStateRef.current === pending) pendingStateRef.current = null; continue }
        setSaveState('saving')
        try { await onChangeRef.current(snapshot) }
        catch (reason) { if (aliveRef.current) { setSaveState('error'); setError(reason instanceof Error ? reason.message : String(reason)) }; throw reason }
        lastSavedStateKeyRef.current = key
        if (pendingStateRef.current === pending) pendingStateRef.current = null
      }
      if (aliveRef.current) setSaveState('saved')
    })
    saveQueueRef.current = operation.catch(() => undefined)
    return operation
  }, [])

  const scheduleSave = useCallback((elements: readonly ExcalidrawElement[], appState: AppState) => {
    if (!readyRef.current || appState.isLoading || !aliveRef.current) return
    const connectedFileIds = new Set(sourcesRef.current.map((source) => `${SOURCE_FILE_PREFIX}${source.nodeId}`))
    pendingStateRef.current = serializeBoardState(elements, appState, connectedFileIds)
    setSaveState('pending')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => { void flushPendingState().catch(() => undefined) }, AUTO_SAVE_DELAY_MS)
  }, [flushPendingState, sourceSignature])

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
    if (closing || exporting || !ready) return
    setClosing(true)
    setError('')
    try {
      await flushPendingState()
      await onPreview(await captureCenterPreview())
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setClosing(false)
    }
  }

  useEffect(() => {
    aliveRef.current = true
    const unregister = registerEditFlusher(flushPendingState, 10)
    return () => {
      unregister()
      aliveRef.current = false
      // React StrictMode replays effects with the same pending initial-data
      // promise. Only abort once the component has really left the tree.
      queueMicrotask(() => { if (!aliveRef.current) loadAbortRef.current?.abort() })
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    }
  }, [flushPendingState])

  const exportSelection = async () => {
    const api = apiRef.current
    if (!api || exporting || closing || !readyRef.current) return
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
      const [x1, y1, x2, y2] = getCommonBounds(elements)
      const output = boardExportSize(x2 - x1, y2 - y1)
      const selectedFileIds = new Set(elements.flatMap((element) => element.type === 'image' && element.fileId ? [element.fileId] : []))
      const selectedSources = sourcesRef.current.filter((source) => selectedFileIds.has(`${SOURCE_FILE_PREFIX}${source.nodeId}` as FileId))
      const sourceVersions = selectedSources.map(({ nodeId, url }) => `${nodeId}:${url}`).join('|')
      const files: BinaryFiles = { ...api.getFiles() }
      const originals = await loadBoardItems(selectedSources, (source, index) => {
        const image = elements.find((element) => element.type === 'image' && element.fileId === `${SOURCE_FILE_PREFIX}${source.nodeId}`)
        const side = Math.min(8192, Math.max(1, Math.ceil(Math.max(image?.width ?? 720, image?.height ?? 480) * output.scale)))
        return readSource(source, index, side)
      })
      for (const result of originals) {
        if (result.status === 'rejected') throw new Error(`所选图片读取失败：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
        files[result.value.file.id] = result.value.file
      }
      if (!aliveRef.current || sourceVersions !== sourcesRef.current.filter((source) => selectedSources.some((item) => item.nodeId === source.nodeId)).map(({ nodeId, url }) => `${nodeId}:${url}`).join('|')) throw new Error('连接素材已变更，请重新选择后导出')
      const png = await exportToBlob({
        elements,
        appState: {
          ...api.getAppState(),
          exportBackground: true,
          exportWithDarkMode: false,
          viewBackgroundColor: '#ffffff',
        },
        files,
        mimeType: 'image/png',
        exportPadding: 0,
        getDimensions: () => ({ width: output.width, height: output.height, scale: output.scale }),
      })
      const bitmap = await createImageBitmap(png)
      const width = bitmap.width
      const height = bitmap.height
      bitmap.close()
      if (!aliveRef.current) return
      await onExport({ pngData: await png.arrayBuffer(), width, height, sourceNodeIds: selectedSources.map((source) => source.nodeId) })
      setNotice(`已导出 ${elements.length} 个素材 · ${width}×${height}${output.scale < 1 ? '（已按像素预算缩放）' : ''}`)
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
          <p className="truncate text-xs text-white/55">Excalidraw 自由画板 · {ready ? sources.length ? `已载入 ${loadedCount}/${sources.length} 张连接素材` : '无连接素材' : '正在恢复画板…'} · {saveState === 'saved' ? '已保存' : saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '保存失败' : '等待保存…'}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {notice && <span className="max-w-[34rem] truncate text-[12px] text-emerald-300" title={notice}>{notice}</span>}
          {error && <span className="max-w-[34rem] truncate text-[12px] text-rose-300" title={error}>{error}</span>}
          {saveState === 'error' && <button onClick={() => void flushPendingState().then(() => setError('')).catch(() => undefined)} className="rounded border border-rose-300/40 px-3 py-2 text-xs text-rose-200">重试保存</button>}
          <button disabled={closing || exporting || !ready} onClick={() => void closeBoard()} className="rounded-lg px-3 py-2 text-xs text-white/70 hover:bg-white/[0.06] hover:text-white disabled:opacity-45">{closing ? '正在保存预览…' : '关闭并返回画布'}</button>
        </div>
      </header>
      {sourceErrors.length > 0 && <div className="max-h-28 shrink-0 overflow-y-auto border-b border-amber-300/20 bg-amber-300/5 px-4 py-2 text-xs text-amber-100" role="status">
        {sourceErrors.map((failure) => <div key={failure.nodeId} className="flex items-center gap-3 py-1"><span className="min-w-0 flex-1 truncate" title={failure.message}>{failure.title}：未载入（保留原位置） · {failure.message}</span><button onClick={() => setRetry((value) => value + 1)} className="shrink-0 rounded border border-amber-200/30 px-2 py-1">重试</button></div>)}
      </div>}

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
          viewModeEnabled={closing || exporting}
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
              <span className="ml-5 text-[12px] text-white/55">{contextMenu.selectedCount} 项</span>
            </button>
          </div>
        )}
      </main>
      <footer className="flex h-8 flex-shrink-0 items-center justify-between border-t border-white/10 bg-[#111217] px-4 text-[12px] text-white/30">
        <span>直接绘制，或编辑连接图片；框选或 Shift 多选后右键即可导出，可重复输出多个结果。</span>
        <span>{exporting ? '正在写入外部画布…' : '图片、图形、箭头、文字和自由画笔均可参与导出'}</span>
      </footer>
    </div>,
    document.body,
  )
}
