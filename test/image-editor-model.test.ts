import { describe, expect, it } from 'vitest'
import { boardExportSize, BOARD_MAX_EXPORT_PIXELS, loadBoardItems, mergeBoardSources } from '../src/features/image-editor/image-editor-model'

describe('board recovery and pixel budgets', () => {
  it('preserves drawings and image transforms when a connected file fails, then recovers it in place', () => {
    const rectangle = { id: 'drawing', type: 'rectangle', x: 30 }
    const image = { id: 'image-editor-element-photo', type: 'image', fileId: 'old', status: 'saved', x: 312, angle: 1.5 }
    const failed = { ...image, fileId: 'current', status: 'error', x: 0, angle: 0 }
    const recovered = mergeBoardSources([rectangle, image], [failed])
    expect(recovered[0]).toBe(rectangle)
    expect(recovered[1]).toMatchObject({ x: 312, angle: 1.5, status: 'error', fileId: 'current' })
    expect(mergeBoardSources(recovered, [{ ...failed, status: 'saved' }])[1]).toMatchObject({ x: 312, status: 'saved' })
  })

  it('removes disconnected images, adds new inputs, and keeps drawings', () => {
    const result = mergeBoardSources([
      { id: 'drawing', type: 'rectangle' }, { id: 'image-editor-element-old', type: 'image' }, { id: 'unconnected-image', type: 'image' },
    ], [{ id: 'image-editor-element-new', type: 'image' }])
    expect(result.map((element) => element.id)).toEqual(['drawing', 'image-editor-element-new'])
  })

  it('bounds huge distant selections before raster allocation without upscaling small exports', () => {
    for (const [width, height] of [[100_000, 100_000], [1_000_000, 200], [8000, 8000]]) {
      const size = boardExportSize(width, height)
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(8192)
      expect(size.width * size.height).toBeLessThanOrEqual(BOARD_MAX_EXPORT_PIXELS)
      expect(size.scale).toBeLessThan(1)
    }
    expect(boardExportSize(640, 480)).toEqual({ width: 640, height: 480, scale: 1 })
    expect(() => boardExportSize(Infinity, 10)).toThrow()
  })

  it('isolates failed sources and limits concurrent image work to two', async () => {
    let active = 0
    let maximum = 0
    const result = await loadBoardItems([0, 1, 2, 3, 4], async (value) => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      if (value === 1) throw new Error('broken image')
      return value
    })
    expect(maximum).toBe(2)
    expect(result.map((item) => item.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled'])
  })
})
