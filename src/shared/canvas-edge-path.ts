export interface CanvasEdgeClipRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ClippedCanvasEdgePath {
  path: string
  includesStart: boolean
  includesEnd: boolean
  /** Single subpaths carrying real endpoints; use these for SVG markers. */
  startPath?: string
  endPath?: string
}

type Point = { x: number; y: number }
type Cubic = [Point, Point, Point, Point]
type Interval = { from: number; to: number }
type Bounds = { left: number; top: number; right: number; bottom: number }
const MAX_CLIP_DEPTH = 12
const pathTokens = /[MC]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g

function unchanged(path: string): ClippedCanvasEdgePath {
  return { path, includesStart: true, includesEnd: true, startPath: path, endPath: path }
}

function parseCubic(path: string): Cubic | null {
  const tokens: string[] = []
  let consumed = 0
  for (const match of path.matchAll(pathTokens)) {
    if (!/^[\s,]*$/.test(path.slice(consumed, match.index))) return null
    tokens.push(match[0])
    consumed = match.index! + match[0].length
  }
  if (!/^[\s,]*$/.test(path.slice(consumed)) || tokens.length !== 10 || tokens[0] !== 'M' || tokens[3] !== 'C') return null
  const numbers = [tokens[1], tokens[2], ...tokens.slice(4)].map(Number)
  if (!numbers.every(Number.isFinite)) return null
  return [
    { x: numbers[0], y: numbers[1] },
    { x: numbers[2], y: numbers[3] },
    { x: numbers[4], y: numbers[5] },
    { x: numbers[6], y: numbers[7] },
  ]
}

function lerp(a: Point, b: Point, t: number): Point {
  // Weighted sums avoid overflowing b - a for finite, opposite coordinates.
  return { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t }
}

function split(curve: Cubic, t: number): [Cubic, Cubic] {
  const a = lerp(curve[0], curve[1], t)
  const b = lerp(curve[1], curve[2], t)
  const c = lerp(curve[2], curve[3], t)
  const d = lerp(a, b, t)
  const e = lerp(b, c, t)
  const middle = lerp(d, e, t)
  return [[curve[0], a, d, middle], [middle, e, c, curve[3]]]
}

function controlBounds(curve: Cubic): Bounds {
  return {
    left: Math.min(curve[0].x, curve[1].x, curve[2].x, curve[3].x),
    top: Math.min(curve[0].y, curve[1].y, curve[2].y, curve[3].y),
    right: Math.max(curve[0].x, curve[1].x, curve[2].x, curve[3].x),
    bottom: Math.max(curve[0].y, curve[1].y, curve[2].y, curve[3].y),
  }
}

function collectIntervals(curve: Cubic, clip: Bounds, from: number, to: number, depth: number, kept: Interval[]): void {
  const bounds = controlBounds(curve)
  // A Bézier stays inside the convex hull of its controls, and therefore this
  // AABB. Inclusive intersection keeps curves that touch the clip boundary.
  if (bounds.right < clip.left || bounds.left > clip.right || bounds.bottom < clip.top || bounds.top > clip.bottom) return
  const inside = bounds.left >= clip.left && bounds.right <= clip.right && bounds.top >= clip.top && bounds.bottom <= clip.bottom
  if (inside || depth === MAX_CLIP_DEPTH) {
    const previous = kept[kept.length - 1]
    if (previous?.to === from) previous.to = to
    else kept.push({ from, to })
    return
  }
  const [left, right] = split(curve, 0.5)
  const middle = (from + to) * 0.5
  collectIntervals(left, clip, from, middle, depth + 1, kept)
  collectIntervals(right, clip, middle, to, depth + 1, kept)
}

function subcurve(curve: Cubic, { from, to }: Interval): Cubic {
  if (from === 0 && to === 1) return curve
  const throughEnd = to === 1 ? curve : split(curve, to)[0]
  return from === 0 ? throughEnd : split(throughEnd, from / to)[1]
}

function serialize(curve: Cubic): string {
  return `M${curve[0].x},${curve[0].y} C${curve[1].x},${curve[1].y} ${curve[2].x},${curve[2].y} ${curve[3].x},${curve[3].y}`
}

/**
 * Clip the single absolute M/C path returned by React Flow's getBezierPath.
 * Kept sections are exact cubic subcurves, never polylines. At the recursion
 * limit a small boundary overshoot is retained rather than dropping a visible
 * section. Unsupported input is preserved so a future path format cannot make
 * an edge disappear.
 */
export function clipCanvasBezierPath(path: string, rect: CanvasEdgeClipRect): ClippedCanvasEdgePath {
  const clip = { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height }
  if (rect.width < 0 || rect.height < 0 || !Object.values(clip).every(Number.isFinite)) return unchanged(path)
  const curve = parseCubic(path)
  if (!curve) return unchanged(path)
  const kept: Interval[] = []
  collectIntervals(curve, clip, 0, 1, 0, kept)
  if (!kept.length) return { path: '', includesStart: false, includesEnd: false }
  if (kept.length === 1 && kept[0].from === 0 && kept[0].to === 1) return unchanged(path)
  const paths = kept.map((interval) => serialize(subcurve(curve, interval)))
  const includesStart = kept[0].from === 0
  const includesEnd = kept[kept.length - 1].to === 1
  return {
    path: paths.join(' '),
    includesStart,
    includesEnd,
    startPath: includesStart ? paths[0] : undefined,
    endPath: includesEnd ? paths[paths.length - 1] : undefined,
  }
}
