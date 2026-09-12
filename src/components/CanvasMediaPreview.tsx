import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useStore, type ReactFlowState } from '@xyflow/react'
import { prepareCanvasOriginalImage, ProjectAssetPreview } from './ProjectAssetPreview'
import { useNearCanvasViewport } from './canvas-visibility'

// Subscribe only to a screen-sized quality tier, not the changing viewport.
// Ordinary navigation never mounts every visible 2K/4K original at once.
const imagePreviewSize = (state: ReactFlowState): 640 | 1280 =>
  620 * state.transform[2] * (globalThis.devicePixelRatio || 1) > 640 ? 1280 : 640

export const CanvasImagePreview = memo(function CanvasImagePreview({ url, name, selected }: {
  url: string
  name: string
  selected?: boolean
}) {
  const maxEdge = useStore(imagePreviewSize)
  const [originalReady, setOriginalReady] = useState<string | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const nearViewport = useNearCanvasViewport(container)

  useEffect(() => {
    if (!selected || nearViewport !== true) { setOriginalReady(null); return }
    const controller = new AbortController()
    void prepareCanvasOriginalImage(url, controller.signal).then(() => {
      if (!controller.signal.aborted) setOriginalReady(url)
    }, () => { /* A failed original leaves the usable preview in place. */ })
    return () => controller.abort()
  }, [selected, url, nearViewport])

  const showOriginal = selected && nearViewport === true && originalReady === url
  return (
    <div ref={container} className="relative h-full w-full">
      <div className="h-full w-full" aria-hidden={showOriginal || undefined}>
        <ProjectAssetPreview url={url} kind="image" name={name} maxEdge={maxEdge} />
      </div>
      {showOriginal && (
        <img src={url} alt={name} draggable={false} decoding="async" className="absolute inset-0 h-full w-full object-contain"
          onError={() => setOriginalReady(null)} />
      )}
    </div>
  )
})

function AudioPlayer({ url }: { url: string }) {
  const audio = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const element = audio.current!
    element.src = url
    return () => { element.pause(); element.removeAttribute('src'); element.load() }
  }, [url])
  return <audio ref={audio} controls preload="metadata" className="w-full" />
}

export const CanvasAudioPreview = memo(function CanvasAudioPreview({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null)
  const nearViewport = useNearCanvasViewport(container)
  return <div ref={container} className="h-[54px] w-full">
    {nearViewport === true && <AudioPlayer url={url} />}
  </div>
})

// One explicitly opened player per canvas renderer. Posters share the bounded
// asset decoder pool; the dozens of idle cards retain no video elements.
let activePlayer: symbol | null = null
const playbackListeners = new Set<() => void>()
function setActivePlayer(player: symbol | null) {
  if (activePlayer === player) return
  activePlayer = player
  playbackListeners.forEach((listener) => listener())
}
function subscribePlayback(listener: () => void) {
  playbackListeners.add(listener)
  return () => { playbackListeners.delete(listener) }
}

function VideoPlayer({ url, name, onClose, onError }: {
  url: string
  name: string
  onClose: () => void
  onError: (message: string) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const element = video.current!
    // Set the source in setup as well as clearing it in cleanup, including
    // React StrictMode's development setup/cleanup/setup cycle.
    element.src = url
    element.load()
    return () => {
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
  }, [url])

  return (
    <div className="nodrag nowheel relative h-full w-full" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <video ref={video} aria-label={name} className="h-full w-full cursor-auto object-contain"
        controls autoPlay playsInline preload="metadata" onEnded={onClose}
        onError={(event) => {
          const error = event.currentTarget.error
          onError(`视频加载失败：${error?.message || `媒体错误码 ${error?.code ?? '未知'}`}`)
        }} />
      <button type="button" onClick={(event) => { event.stopPropagation(); onClose() }}
        className="absolute right-2 top-2 rounded-md bg-black/75 px-2 py-1 text-[11px] text-white/80 hover:bg-black/90">收起视频</button>
    </div>
  )
}

export const CanvasVideoPreview = memo(function CanvasVideoPreview({ url, name }: { url: string; name: string }) {
  // The caller keys this component by URL so a regenerated result cannot reuse
  // an old activation or error. Unmount also ends playback on project changes.
  const [token] = useState(() => Symbol('canvas-video'))
  const active = useSyncExternalStore(subscribePlayback, () => activePlayer === token)
  const [error, setError] = useState('')
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && activePlayer === token) setActivePlayer(null)
    })
    observer.observe(container.current!)
    return () => {
      observer.disconnect()
      if (activePlayer === token) setActivePlayer(null)
    }
  }, [token])

  return (
    <div ref={container} className="relative h-full w-full">
      {active ? (
        <VideoPlayer url={url} name={name} onClose={() => setActivePlayer(null)}
          onError={(message) => { setError(message); setActivePlayer(null) }} />
      ) : (
        <>
          <ProjectAssetPreview url={url} kind="video" name={name} maxEdge={640} />
          <button type="button" aria-label={`播放视频：${name}`} title="播放视频"
            className="nodrag nowheel absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/65 text-lg text-white hover:bg-black/85"
            onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); setError(''); setActivePlayer(token) }}>▶</button>
          {error && <p role="alert" className="absolute inset-x-2 bottom-2 rounded-md bg-black/85 p-2 text-[11px] text-rose-200">{error}</p>}
        </>
      )}
    </div>
  )
})
