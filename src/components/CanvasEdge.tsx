import { memo, useMemo } from 'react'
import { BaseEdge, getBezierPath, useStore, type EdgeProps, type ReactFlowState } from '@xyflow/react'
import { clipCanvasBezierPath } from '../shared/canvas-edge-path'

// A quantized, padded window avoids recomputing every curve on every pan pixel.
// It covers the whole screen, including paths whose endpoints are both offscreen.
function edgeWindow(state: ReactFlowState): readonly number[] {
  const [x, y, zoom] = state.transform
  const tile = 512
  const padding = 256
  return [
    Math.floor((-x - padding) / zoom / tile) * tile,
    Math.floor((-y - padding) / zoom / tile) * tile,
    Math.ceil((-x + state.width + padding) / zoom / tile) * tile,
    Math.ceil((-y + state.height + padding) / zoom / tile) * tile,
  ]
}
const sameWindow = (a: readonly number[], b: readonly number[]) => a.every((value, index) => value === b[index])

export const CanvasEdge = memo(function CanvasEdge(props: EdgeProps) {
  const [left, top, right, bottom] = useStore(edgeWindow, sameWindow)
  const [path, labelX, labelY] = useMemo(() => getBezierPath(props), [
    props.sourceX, props.sourceY, props.targetX, props.targetY, props.sourcePosition, props.targetPosition,
  ])
  const clipped = useMemo(() => clipCanvasBezierPath(path, {
    x: left, y: top, width: right - left, height: bottom - top,
  }), [path, left, top, right, bottom])
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
