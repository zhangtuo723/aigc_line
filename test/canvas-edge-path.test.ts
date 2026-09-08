import { describe, expect, it } from 'vitest'
import { getBezierPath, Position } from '@xyflow/react'
import { clipCanvasBezierPath } from '../src/shared/canvas-edge-path'

type Point = [number, number]
type Cubic = [Point, Point, Point, Point]

function curves(path: string): Cubic[] {
  const values = (path.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number)
  expect(values.length % 8).toBe(0)
  return Array.from({ length: values.length / 8 }, (_, index) => {
    const offset = index * 8
    return [0, 2, 4, 6].map((step) => [values[offset + step], values[offset + step + 1]]) as Cubic
  })
}

function point(curve: Cubic, t: number): Point {
  const u = 1 - t
  const weights = [u ** 3, 3 * u ** 2 * t, 3 * u * t ** 2, t ** 3]
  return [0, 1].map((axis) => curve.reduce((sum, control, index) => sum + control[axis] * weights[index], 0)) as Point
}

// Fixtures with one linear coordinate let us recover the original parameter
// independently of the clipping implementation, then compare the whole curve.
function expectExactSubcurves(original: Cubic, clipped: Cubic[], linearAxis: 0 | 1) {
  const start = original[0][linearAxis]
  const span = original[3][linearAxis] - start
  for (const curve of clipped) {
    const from = (curve[0][linearAxis] - start) / span
    const to = (curve[3][linearAxis] - start) / span
    for (let step = 0; step <= 20; step++) {
      const t = step / 20
      const actual = point(curve, t)
      const expected = point(original, from + (to - from) * t)
      expect(actual[0]).toBeCloseTo(expected[0], 7)
      expect(actual[1]).toBeCloseTo(expected[1], 7)
    }
  }
}

describe('canvas Bézier geometry clipping', () => {
  it('keeps an official getBezierPath string unchanged when its control hull is inside', () => {
    const [path] = getBezierPath({ sourceX: 10, sourceY: 20, sourcePosition: Position.Right,
      targetX: 150, targetY: 180, targetPosition: Position.Left })
    expect(clipCanvasBezierPath(path, { x: 0, y: 0, width: 200, height: 200 })).toEqual({
      path, includesStart: true, includesEnd: true, startPath: path, endPath: path,
    })
  })

  it('removes a fully outside curve and both endpoint markers', () => {
    expect(clipCanvasBezierPath('M-300,-100 C-200,-100 -200,100 -300,100', { x: 0, y: 0, width: 100, height: 100 }))
      .toEqual({ path: '', includesStart: false, includesEnd: false })
  })

  it('reduces a cross-screen long curve to exact cubic geometry near the viewport', () => {
    const path = 'M-10000,-10000 C-3333.3333333333335,-5000 3333.3333333333335,5000 10000,10000'
    const original = curves(path)[0]
    const result = clipCanvasBezierPath(path, { x: -100, y: -1000, width: 200, height: 2000 })
    const clipped = curves(result.path)
    expect(clipped).toHaveLength(1)
    expect(result.includesStart).toBe(false)
    expect(result.includesEnd).toBe(false)
    expect(result.startPath).toBeUndefined()
    expect(result.endPath).toBeUndefined()
    const xs = clipped.flatMap((curve) => curve.map(([x]) => x))
    expect(Math.min(...xs)).toBeGreaterThan(-106)
    expect(Math.max(...xs)).toBeLessThan(106)
    expect(clipped[0][0][0]).toBeLessThanOrEqual(-100)
    expect(clipped[0][3][0]).toBeGreaterThanOrEqual(100)
    expectExactSubcurves(original, clipped, 0)
    expect(result.path).not.toMatch(/[LQ]/)
  })

  it('retains the visible middle when both endpoints are outside', () => {
    const result = clipCanvasBezierPath('M-100,0 C150,-100 150,100 -100,0', { x: 0, y: -100, width: 100, height: 200 })
    const clipped = curves(result.path)
    expect(clipped).toHaveLength(1)
    expect(point(clipped[0], 0.5)[0]).toBeCloseTo(87.5, 7)
    expect(result.includesStart).toBe(false)
    expect(result.includesEnd).toBe(false)
  })

  it('returns distinct exact subpaths when a cubic enters the viewport three times', () => {
    const path = 'M-100,0 C300,100 -300,200 100,300'
    const result = clipCanvasBezierPath(path, { x: -10, y: 0, width: 20, height: 300 })
    const clipped = curves(result.path)
    expect(clipped).toHaveLength(3)
    expect(result.path.match(/M/g)).toHaveLength(3)
    expect(result.path.match(/C/g)).toHaveLength(3)
    expect(result.includesStart).toBe(false)
    expect(result.includesEnd).toBe(false)
    expectExactSubcurves(curves(path)[0], clipped, 1)
  })

  it('keeps markers only on single subpaths containing the real endpoints', () => {
    const path = 'M0,0 C300,100 -300,200 0,300'
    const both = clipCanvasBezierPath(path, { x: -10, y: 0, width: 20, height: 300 })
    expect(curves(both.path)).toHaveLength(3)
    expect(both.includesStart).toBe(true)
    expect(both.includesEnd).toBe(true)
    expect(curves(both.startPath!)).toHaveLength(1)
    expect(curves(both.endPath!)).toHaveLength(1)
    expect(curves(both.startPath!)[0][0]).toEqual([0, 0])
    expect(curves(both.endPath!)[0][3]).toEqual([0, 300])
    const startOnly = clipCanvasBezierPath(path, { x: -10, y: 0, width: 20, height: 100 })
    expect(startOnly.includesStart).toBe(true)
    expect(startOnly.includesEnd).toBe(false)
    expect(startOnly.endPath).toBeUndefined()
    const endOnly = clipCanvasBezierPath(path, { x: -10, y: 200, width: 20, height: 100 })
    expect(endOnly.includesStart).toBe(false)
    expect(endOnly.includesEnd).toBe(true)
    expect(endOnly.startPath).toBeUndefined()
  })

  it('supports negative, decimal, compact-sign, and exponent coordinates', () => {
    const path = ' M -1e3,-.5 C -3.333333333333333e2,-.25 +3.333333333333333e2.25 1E3,+.5 '
    const result = clipCanvasBezierPath(path, { x: -10, y: -1, width: 20, height: 2 })
    expect(result.path).not.toBe(path)
    expect(result.path).not.toBe('')
    expectExactSubcurves(curves(path)[0], curves(result.path), 0)
  })

  it.each(['M0 0 L10 10', 'm0 0 c1 1 2 2 3 3', 'M0 0 C1 1 2 2 3 3 C4 4 5 5 6 6', 'M0 0 CNaN 1 2 2 3 3', 'M0 0 C1e999 1 2 2 3 3'])
    ('preserves unsupported or nonfinite path input: %s', (path) => {
      const result = clipCanvasBezierPath(path, { x: 0, y: 0, width: 10, height: 10 })
      expect(result.path).toBe(path)
      expect(result.includesStart).toBe(true)
      expect(result.includesEnd).toBe(true)
    })

  it('preserves input if the viewport rectangle is invalid', () => {
    const path = 'M0 0 C1 1 2 2 3 3'
    expect(clipCanvasBezierPath(path, { x: NaN, y: 0, width: 10, height: 10 }).path).toBe(path)
    expect(clipCanvasBezierPath(path, { x: 0, y: 0, width: -1, height: 10 }).path).toBe(path)
  })
})
