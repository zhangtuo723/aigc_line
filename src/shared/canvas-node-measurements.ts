import type { Node, NodeChange } from '@xyflow/react'

/** Visibility remounts may report an already known size; do not treat these as edits. */
export function filterUnchangedNodeMeasurements<T extends Node>(changes: NodeChange<T>[], nodes: readonly T[]): NodeChange<T>[] {
  if (!changes.some((change) => change.type === 'dimensions')) return changes
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return changes.filter((change) => {
    if (change.type !== 'dimensions' || !change.dimensions || change.setAttributes || change.resizing !== undefined) return true
    const measured = byId.get(change.id)?.measured
    return measured?.width !== change.dimensions.width || measured?.height !== change.dimensions.height
  })
}
