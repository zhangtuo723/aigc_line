/** Reuse content consumers' inputs when React Flow only changes node layout or selection. */
export function retainCanvasNodeContent<T extends { id: string; data: unknown }>(previous: T[], next: T[]): T[] {
  return previous.length === next.length && previous.every((node, index) => (
    node.id === next[index].id && node.data === next[index].data
  )) ? previous : next
}
