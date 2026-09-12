import { memo, useMemo, useSyncExternalStore } from 'react'
import { BaseEdge, getBezierPath, useStoreApi, type EdgeProps } from '@xyflow/react'
import { clipCanvasBezierPath } from '../shared/canvas-edge-path'
import { canvasRenderWindow } from '../shared/canvas-render-window'

// A shared, padded window avoids recomputing every curve on every pan pixel.
// It covers the whole screen, including paths whose endpoints are both offscreen.
function createRenderWindowStore(store: ReturnType<typeof useStoreApi>) {
  let state = store.getState()
  let window = canvasRenderWindow(undefined, state.transform, state.width, state.height)
  const listeners = new Set<() => void>()
  let unsubscribe: (() => void) | undefined
  const update = () => {
    const next = store.getState()
    if (next.transform === state.transform && next.width === state.width && next.height === state.height) return
    state = next
    const nextWindow = canvasRenderWindow(window, state.transform, state.width, state.height)
    if (nextWindow === window) return
    window = nextWindow
    listeners.forEach((listener) => listener())
  }
  return {
    getSnapshot: () => window,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      if (!unsubscribe) { unsubscribe = store.subscribe(update); update() }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) { unsubscribe?.(); unsubscribe = undefined }
      }
    },
  }
}
// One viewport subscription per canvas, rather than allocations and comparisons
// in every edge on every pointer event. Weak keys isolate separate projects.
const renderWindows = new WeakMap<ReturnType<typeof useStoreApi>, ReturnType<typeof createRenderWindowStore>>()

export const CanvasEdge = memo(function CanvasEdge(props: EdgeProps) {
  const store = useStoreApi()
  const windowStore = useMemo(() => {
    let existing = renderWindows.get(store)
    if (!existing) { existing = createRenderWindowStore(store); renderWindows.set(store, existing) }
    return existing
  }, [store])
  const window = useSyncExternalStore(windowStore.subscribe, windowStore.getSnapshot)
  const [path, labelX, labelY] = useMemo(() => getBezierPath(props), [
    props.sourceX, props.sourceY, props.targetX, props.targetY, props.sourcePosition, props.targetPosition,
  ])
  const clipped = useMemo(() => clipCanvasBezierPath(path, window), [path, window])
  if (!clipped.path) return null
  // A clip can have several disjoint subpaths. SVG repeats markers per subpath;
  // draw arrows only on the fragment containing the original endpoint.
  const markerStyle = { ...props.style, strokeWidth: props.style?.strokeWidth ?? 1.5, fill: 'none', stroke: 'none' }
  return <>
    <BaseEdge id={props.id} path={clipped.path} style={props.style} interactionWidth={props.interactionWidth}
      label={props.label} labelX={labelX} labelY={labelY} labelStyle={props.labelStyle}
      labelShowBg={props.labelShowBg} labelBgStyle={props.labelBgStyle}
      labelBgPadding={props.labelBgPadding} labelBgBorderRadius={props.labelBgBorderRadius} />
    {props.markerStart && clipped.startPath && <path d={clipped.startPath} style={markerStyle} markerStart={props.markerStart} pointerEvents="none" />}
    {props.markerEnd && clipped.endPath && <path d={clipped.endPath} style={markerStyle} markerEnd={props.markerEnd} pointerEvents="none" />}
  </>
})
