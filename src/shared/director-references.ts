export interface DirectorReferenceNodeLike {
  id: string
  data: { kind: string; sourcePath?: unknown }
}

export interface DirectorReferenceEdgeLike {
  source: string
  target: string
}

/** Returns only image nodes with outputs that have an incoming edge to the director node. */
export function connectedDirectorImageNodeIds(
  directorNodeId: string,
  nodes: readonly DirectorReferenceNodeLike[],
  edges: readonly DirectorReferenceEdgeLike[],
): string[] {
  const incomingIds = new Set(edges.filter((edge) => edge.target === directorNodeId).map((edge) => edge.source))
  return nodes
    .filter((node) => incomingIds.has(node.id)
      && node.data.kind === 'image'
      && typeof node.data.sourcePath === 'string'
      && node.data.sourcePath.length > 0)
    .map((node) => node.id)
}
