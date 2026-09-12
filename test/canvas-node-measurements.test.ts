import { expect, it } from 'vitest'
import type { Node, NodeChange } from '@xyflow/react'
import { filterUnchangedNodeMeasurements } from '../src/shared/canvas-node-measurements'

it('ignores repeated mount measurements but preserves real size changes and resizing', () => {
  const nodes: Node[] = [{ id: 'a', position: { x: 0, y: 0 }, data: {}, measured: { width: 620, height: 380 } }]
  const unchanged: NodeChange = { id: 'a', type: 'dimensions', dimensions: { width: 620, height: 380 } }
  const changes: NodeChange[] = [
    unchanged,
    { ...unchanged, dimensions: { width: 620, height: 680 } },
    { ...unchanged, resizing: false },
    { ...unchanged, setAttributes: true },
    { ...unchanged, id: 'new' },
    { id: 'a', type: 'position', position: { x: 20, y: 10 } },
    { id: 'a', type: 'select', selected: true },
    { id: 'a', type: 'remove' },
  ]
  expect(filterUnchangedNodeMeasurements(changes, nodes)).toEqual(changes.slice(1))
})
