import { memo, useEffect, useRef, useState } from 'react'
import type { ProjectMediaKind } from '../shared/ipc.types'
import { AssetPreviewCache, AssetPreviewPool } from './project-asset-preview-cache'

const previews = new AssetPreviewCache()
const decoders = new AssetPreviewPool(2)

function createThumbnail(url: string, kind: 'image' | 'video', signal: AbortSignal): Promise<string> {
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
      if (signal.aborted) { abort(); return }
      try {
        const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
        const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
        if (!width || !height) throw new Error('媒体尺寸无效')
        const ratio = Math.min(1, 320 / Math.max(width, height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(width * ratio))
        canvas.height = Math.max(1, Math.round(height * ratio))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法创建预览')
        context.drawImage(source, 0, 0, canvas.width, canvas.height)
        const result = canvas.toDataURL('image/jpeg', 0.82)
        canvas.width = canvas.height = 0
        finish(undefined, result)
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
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

export const ProjectAssetPreview = memo(function ProjectAssetPreview({ url, kind, name }: {
  url: string
  kind: ProjectMediaKind
  name: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const [nearViewport, setNearViewport] = useState(false)
  const [preview, setPreview] = useState<{ key: string; source?: string; failed?: boolean } | null>(null)
  // The complete workspace URL includes project identity, path and any version.
  const key = `${kind}:${url}`
  const current = preview?.key === key ? preview : null

  useEffect(() => {
    if (!container.current || kind === 'audio') return
    const observer = new IntersectionObserver(([entry]) => setNearViewport(entry.isIntersecting), { rootMargin: '160px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [kind])

  useEffect(() => {
    if (!nearViewport || !url || kind === 'audio') { setPreview(null); return }
    setPreview(null)
    const cached = previews.get(key)
    if (cached) { setPreview({ key, source: cached }); return }
    const controller = new AbortController()
    const signal = controller.signal
    void decoders.run(async () => {
      if (signal.aborted) throw new DOMException('Preview cancelled', 'AbortError')
      return previews.get(key) ?? await createThumbnail(url, kind, signal)
    }, signal).then((source) => {
      if (signal.aborted) return
      previews.set(key, source)
      setPreview({ key, source })
    }, () => {
      if (!signal.aborted) setPreview({ key, failed: true })
    })
    return () => controller.abort()
  }, [key, kind, nearViewport, url])

  return (
    <div ref={container} className="flex h-full w-full items-center justify-center" aria-label={`${name}预览`}>
      {kind === 'audio' ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#d4af37]/20 bg-[#d4af37]/[0.08] text-xl text-[#e8c766]">♪</div>
      ) : nearViewport && current?.source ? (
        <img src={current.source} alt={name} draggable={false} loading="lazy" decoding="async" className="h-full w-full object-contain"
          onError={() => setPreview({ key, failed: true })} />
      ) : (
        <span className="text-[10px] text-white/35">{current?.failed ? '预览不可用' : kind === 'video' ? '视频' : '图片'}</span>
      )}
    </div>
  )
})
