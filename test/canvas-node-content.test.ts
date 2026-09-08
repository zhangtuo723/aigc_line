import { describe, expect, it } from 'vitest'
import { retainCanvasNodeContent } from '../src/shared/canvas-node-content'

describe('canvas node content consumers', () => {
  const image = { id: 'image', data: { kind: 'image', sourcePath: 'image.png' }, position: { x: 0, y: 0 } }
  const video = { id: 'video', data: { kind: 'video', sourcePath: 'video.mp4' }, position: { x: 100, y: 0 } }

  it('keeps graph-content consumers stable throughout dragging, selection, and measurement', () => {
    const original = [image, video]
    let retained = original
    for (let frame = 0; frame < 60; frame++) {
      retained = retainCanvasNodeContent(retained, [
        { ...image, position: { x: frame, y: frame }, dragging: frame < 59, selected: true, measured: { width: 620, height: 400 } },
        video,
      ])
      expect(retained).toBe(original)
    }
  })

  it('invalidates for generated output, renamed or replaced nodes, and node membership or order changes', () => {
    const original = [image, video]
    for (const next of [
      [{ ...image, data: { ...image.data, sourcePath: 'new.png' } }, video],
      [{ ...image, id: 'replacement' }, video],
      [image],
      [image, video, { ...image, id: 'extra' }],
      [video, image],
    ]) {
      expect(retainCanvasNodeContent(original, next)).toBe(next)
    }
  })
})
