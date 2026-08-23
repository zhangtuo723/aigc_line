import { describe, expect, it } from 'vitest'
import '../src/components/canvas-capabilities'
import { getNodeCapabilities } from '../src/shared/node-capabilities'
import { buildCanvasOverview } from '../src/shared/canvas-read-model'

describe('board node registration', () => {
  it('exposes the image-editor kind to canvas capabilities', () => {
    const capability = getNodeCapabilities('image-editor')

    expect(capability?.label).toBe('画板节点')
    expect(capability?.fields).toEqual([
      expect.objectContaining({ key: 'title', type: 'string' }),
      expect.objectContaining({ key: 'boardState', type: 'object', readonly: true }),
      expect.objectContaining({ key: 'boardPreviewPath', type: 'string', readonly: true }),
      expect.objectContaining({ key: 'boardPreviewUpdatedAt', type: 'number', readonly: true }),
    ])
    expect(capability?.actions).toEqual([])
  })

  it('includes image-editor nodes in the compact overview', () => {
    const overview = buildCanvasOverview([
      {
        id: 'editor-1',
        type: 'storyNode',
        position: { x: 10, y: 20 },
        data: { kind: 'image-editor', title: '图片编辑台' },
      },
    ], [])

    expect(overview.countsByKind['image-editor']).toBe(1)
    expect(overview.nodes[0]).toMatchObject({ id: 'editor-1', kind: 'image-editor', hasOutput: false })
  })
})
