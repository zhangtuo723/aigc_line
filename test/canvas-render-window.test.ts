import { describe, expect, it } from 'vitest'
import { canvasRenderWindow } from '../src/shared/canvas-render-window'

describe('shared canvas render window', () => {
  it('does not update the clipping region on ordinary pan pixels', () => {
    const window = canvasRenderWindow(undefined, [0, 0, 0.2], 1600, 1000)
    for (let x = 1; x < 300; x++) expect(canvasRenderWindow(window, [-x, 0, 0.2], 1600, 1000)).toBe(window)
  })
  it('covers the whole viewport during large jumps, reversing direction, zoom and resize', () => {
    let window = canvasRenderWindow(undefined, [0, 0, 1], 800, 600)
    for (const [x, y, zoom, width, height] of [
      [-10000, 6000, 0.2, 1600, 1000], [9000, -14000, 2, 1600, 1000],
      [9000, -14000, 0.5, 2560, 1392], [9000, -14000, 0.5, 4000, 2500],
    ]) {
      window = canvasRenderWindow(window, [x, y, zoom], width, height)
      expect(window.x).toBeLessThanOrEqual(-x / zoom)
      expect(window.y).toBeLessThanOrEqual(-y / zoom)
      expect(window.x + window.width).toBeGreaterThanOrEqual((-x + width) / zoom)
      expect(window.y + window.height).toBeGreaterThanOrEqual((-y + height) / zoom)
    }
  })
})
