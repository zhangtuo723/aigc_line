import type { CanvasEdgeClipRect } from './canvas-edge-path'

export interface CanvasRenderWindow extends CanvasEdgeClipRect { zoom: number }

/** Reuse the padded region until the viewport approaches its boundary. */
export function canvasRenderWindow(
  previous: CanvasRenderWindow | undefined,
  transform: readonly number[],
  width: number,
  height: number,
): CanvasRenderWindow {
  const [tx, ty, zoom] = transform
  const x = -tx / zoom
  const y = -ty / zoom
  const guard = 64 / zoom
  if (previous && previous.zoom === zoom
    && x >= previous.x + guard && y >= previous.y + guard
    && x + width / zoom <= previous.x + previous.width - guard
    && y + height / zoom <= previous.y + previous.height - guard) return previous
  const padding = 384 / zoom
  return { x: x - padding, y: y - padding, width: width / zoom + 2 * padding, height: height / zoom + 2 * padding, zoom }
}
