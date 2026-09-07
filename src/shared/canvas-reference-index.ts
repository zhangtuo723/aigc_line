type ReferenceNode = { id: string; data: { kind: string; title: string; sourcePath?: string; preview?: string } }
const EMPTY: never[] = []

/** Rebuild adjacency once per graph change; notify only consumers whose media changed. */
export class CanvasReferenceIndex<T extends ReferenceNode> {
  private values = new Map<string, T[]>()
  private listeners = new Map<string, Set<() => void>>()
  get = (id: string): T[] => this.values.get(id) ?? EMPTY
  subscribe(id: string, listener: () => void) {
    const listeners = this.listeners.get(id) ?? new Set()
    listeners.add(listener)
    this.listeners.set(id, listeners)
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(id) }
  }
  update(nodes: T[], edges: { source: string; target: string }[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const next = new Map<string, T[]>()
    for (const edge of edges) {
      const source = byId.get(edge.source)
      const target = byId.get(edge.target)
      if (!source?.data.sourcePath || source.data.kind !== 'image' || !['director', 'image-editor'].includes(target?.data.kind ?? '')) continue
      const incoming = next.get(edge.target) ?? []
      if (!incoming.some((node) => node.id === source.id)) incoming.push(source)
      next.set(edge.target, incoming)
    }
    for (const id of new Set([...this.values.keys(), ...next.keys()])) {
      const previous = this.get(id)
      const incoming = next.get(id) ?? EMPTY
      if (previous.length === incoming.length && previous.every((node, i) => {
        const other = incoming[i]
        return node.id === other.id && node.data.title === other.data.title && node.data.sourcePath === other.data.sourcePath && node.data.preview === other.data.preview
      })) continue
      if (incoming.length) this.values.set(id, incoming)
      else this.values.delete(id)
      this.listeners.get(id)?.forEach((listener) => listener())
    }
  }
}
