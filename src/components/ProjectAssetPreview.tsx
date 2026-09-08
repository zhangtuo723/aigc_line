import { memo, useEffect, useRef, useState } from 'react'
import type { ProjectMediaKind } from '../shared/ipc.types'
import { AssetPreviewCache, AssetPreviewPool } from './project-asset-preview-cache'
import { waitForCanvasIdle } from './canvas-interaction'

// Keep detailed images from evicting the inexpensive posters used while
// navigating. Both budgets count UTF-16 data URL bytes, with a 32 MiB total cap.
const previews = new AssetPreviewCache(160, 16 * 1024 * 1024)
const detailedPreviews = new AssetPreviewCache(40, 16 * 1024 * 1024)
const decoders = new AssetPreviewPool(2)
type PreviewSize = 320 | 640 | 1280
type Preview = { mediaKey: string; maxEdge: PreviewSize; source?: string; failed?: boolean }
const previewCache = (maxEdge: PreviewSize) => maxEdge === 1280 ? detailedPreviews : previews
const previewKey = (mediaKey: string, maxEdge: PreviewSize) => `${maxEdge}:${mediaKey}`

function cachedPreview(mediaKey: string, maxEdge: PreviewSize, touch = false): Preview | null {
  // An existing size is a useful placeholder until the requested one is ready.
  const sizes: PreviewSize[] = [maxEdge, 640, 320, 1280]
  for (const size of new Set(sizes)) {
    const cache = previewCache(size)
    const key = previewKey(mediaKey, size)
    const source = touch ? cache.get(key) : cache.peek(key)
    if (source) return { mediaKey, maxEdge: size, source }
  }
  return null
}

/** Selection may request original detail, but it shares the two decoder slots. */
export function prepareCanvasOriginalImage(url: string, signal: AbortSignal): Promise<void> {
  return decoders.run(async () => {
    await waitForCanvasIdle(signal)
    await new Promise<void>((resolve, reject) => {
      const source = new Image()
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal.removeEventListener('abort', abort)
        source.removeEventListener('load', loaded)
        source.removeEventListener('error', failed)
        source.removeAttribute('src')
        if (error) reject(error)
        else resolve()
      }
      const abort = () => finish(new DOMException('Preview cancelled', 'AbortError'))
      const failed = () => finish(new Error('无法读取原图'))
      const loaded = () => {
        clearTimeout(timeout)
        void source.decode().then(() => waitForCanvasIdle(signal)).then(() => finish(), (error) => finish(error))
      }
      const timeout = setTimeout(failed, 15_000)
      if (signal.aborted) { abort(); return }
      signal.addEventListener('abort', abort, { once: true })
      source.addEventListener('load', loaded, { once: true })
      source.addEventListener('error', failed, { once: true })
      source.decoding = 'async'
      source.src = url
    })
  }, signal)
}

function createThumbnail(url: string, kind: 'image' | 'video', signal: AbortSignal, maxEdge: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Preview cancelled', 'AbortError')); return }
    const source = kind === 'video' ? document.createElement('video') : new Image()
    const isVideo = source instanceof HTMLVideoElement
    const readyEvent = isVideo ? 'loadeddata' : 'load'
    let settled = false
    const dispose = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      source.removeEventListener(readyEvent, capture)
      source.removeEventListener('error', failed)
      if (source instanceof HTMLVideoElement) {
        source.pause()
        source.removeAttribute('src')
        source.load()
      } else source.removeAttribute('src')
    }
    const finish = (error?: Error, result?: string) => {
      if (settled) return
      settled = true
      dispose()
      if (error) reject(error)
      else resolve(result!)
    }
    const abort = () => finish(new DOMException('Preview cancelled', 'AbortError'))
    const failed = () => finish(new Error('无法读取媒体预览'))
    const capture = () => {
      // A source can finish loading during a drag. Defer its synchronous pixel
      // copy/JPEG encoding as well, and do not time out while awaiting idle.
      clearTimeout(timeout)
      void waitForCanvasIdle(signal).then(() => {
        if (signal.aborted || settled) { abort(); return }
        const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
        const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
        if (!width || !height) throw new Error('媒体尺寸无效')
        const ratio = Math.min(1, maxEdge / Math.max(width, height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(width * ratio))
        canvas.height = Math.max(1, Math.round(height * ratio))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法创建预览')
        context.drawImage(source, 0, 0, canvas.width, canvas.height)
        const result = canvas.toDataURL('image/jpeg', 0.82)
        canvas.width = canvas.height = 0
        finish(undefined, result)
      }).catch((error) => finish(error instanceof Error ? error : new Error(String(error))))
    }
    const timeout = setTimeout(failed, 15_000)
    signal.addEventListener('abort', abort, { once: true })
    source.addEventListener(readyEvent, capture, { once: true })
    source.addEventListener('error', failed, { once: true })
    source.crossOrigin = 'anonymous'
    if (source instanceof HTMLVideoElement) {
      source.muted = true
      source.playsInline = true
      source.preload = 'auto'
    } else source.decoding = 'async'
    source.src = url
    if (source instanceof HTMLVideoElement) source.load()
  })
}

export const ProjectAssetPreview = memo(function ProjectAssetPreview({ url, kind, name, maxEdge = 320 }: {
  url: string
  kind: ProjectMediaKind
  name: string
  maxEdge?: PreviewSize
}) {
  const container = useRef<HTMLDivElement>(null)
  // Cached images can paint on the first mount, before IntersectionObserver's
  // initial callback. Unknown visibility must not start a new decode.
  const [nearViewport, setNearViewport] = useState<boolean | null>(null)
  // The complete workspace URL includes project identity, path and any version.
  const mediaKey = `${kind}:${url}`
  const key = previewKey(mediaKey, maxEdge)
  const [preview, setPreview] = useState<Preview | null>(() => cachedPreview(mediaKey, maxEdge))
  const current = preview?.mediaKey === mediaKey ? preview : null

  useEffect(() => {
    if (!container.current || kind === 'audio') return
    const observer = new IntersectionObserver(([entry]) => setNearViewport(entry.isIntersecting), { rootMargin: '160px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [kind])

  useEffect(() => {
    if (nearViewport !== true || !url || kind === 'audio') {
      if (nearViewport === false || !url || kind === 'audio') setPreview(null)
      return
    }
    const cache = previewCache(maxEdge)
    const cached = cache.get(key)
    if (cached) { setPreview({ mediaKey, maxEdge, source: cached }); return }
    // Never blank an image merely because its requested resolution changed.
    setPreview((previous) => previous?.mediaKey === mediaKey && previous.source
      ? previous : cachedPreview(mediaKey, maxEdge, true))
    const controller = new AbortController()
    const signal = controller.signal
    void decoders.run(async () => {
      await waitForCanvasIdle(signal)
      return cache.get(key) ?? await createThumbnail(url, kind, signal, maxEdge)
    }, signal).then((source) => {
      if (signal.aborted) return
      cache.set(key, source)
      setPreview({ mediaKey, maxEdge, source })
    }, () => {
      if (!signal.aborted) setPreview((previous) => previous?.mediaKey === mediaKey && previous.source
        ? previous : { mediaKey, maxEdge, failed: true })
    })
    return () => controller.abort()
  }, [key, kind, maxEdge, mediaKey, nearViewport, url])

  return (
    <div ref={container} className="flex h-full w-full items-center justify-center" aria-label={`${name}预览`}>
      {kind === 'audio' ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#d4af37]/20 bg-[#d4af37]/[0.08] text-xl text-[#e8c766]">♪</div>
      ) : nearViewport !== false && current?.source ? (
        <img src={current.source} alt={name} draggable={false} loading="lazy" decoding="async" className="h-full w-full object-contain"
          onError={() => setPreview({ mediaKey, maxEdge, failed: true })} />
      ) : (
        <span className="text-[10px] text-white/35">{current?.failed ? '预览不可用' : kind === 'video' ? '视频' : '图片'}</span>
      )}
    </div>
  )
})
