import { describe, expect, it } from 'vitest'
import { connectedDirectorImageNodeIds } from '../src/shared/director-references'

describe('director connected image references', () => {
  it('uses only incoming image nodes that already have output', () => {
    const nodes = [
      { id: 'image-connected', data: { kind: 'image', sourcePath: 'generated/images/a.png' } },
      { id: 'image-unconnected', data: { kind: 'image', sourcePath: 'generated/images/b.png' } },
      { id: 'image-empty', data: { kind: 'image' } },
      { id: 'video-connected', data: { kind: 'video', sourcePath: 'generated/videos/a.mp4' } },
    ]
    const edges = [
      { source: 'image-connected', target: 'director-1' },
      { source: 'image-empty', target: 'director-1' },
      { source: 'video-connected', target: 'director-1' },
      { source: 'director-1', target: 'image-unconnected' },
    ]
    expect(connectedDirectorImageNodeIds('director-1', nodes, edges)).toEqual(['image-connected'])
  })
})
