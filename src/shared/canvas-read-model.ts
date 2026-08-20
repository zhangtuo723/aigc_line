import type {
  CanvasEdgeSnapshot,
  CanvasNodeData,
  CanvasNodeKind,
  CanvasPoint,
} from './ipc.types'

type GenerationStatus = NonNullable<CanvasNodeData['generationStatus']>

interface ReadableCanvasNode {
  id: string
  type?: string
  position: CanvasPoint
  selected?: boolean
  data: CanvasNodeData
}

interface ReadableCanvasEdge extends Omit<CanvasEdgeSnapshot, 'selected'> {
  selected?: boolean
}

export interface CanvasNodeSummary {
  id: string
  kind: CanvasNodeKind
  title: string
  generationStatus: GenerationStatus
  hasOutput: boolean
}

export interface CanvasOverview {
  nodeCount: number
  edgeCount: number
  countsByKind: Record<CanvasNodeKind, number>
  countsByGenerationStatus: Record<GenerationStatus, number>
  nodes: CanvasNodeSummary[]
}

export interface CanvasConnectionSummary {
  edgeId: string
  nodeId: string
  kind: CanvasNodeKind
  title: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface CanvasNodeDetail {
  id: string
  type: 'storyNode'
  position: CanvasPoint
  selected?: boolean
  data: CanvasNodeData
  incomingConnections: CanvasConnectionSummary[]
  outgoingConnections: CanvasConnectionSummary[]
}

const summarizeNode = (node: ReadableCanvasNode): CanvasNodeSummary => ({
  id: node.id,
  kind: node.data.kind,
  title: node.data.title,
  generationStatus: node.data.generationStatus ?? 'idle',
  hasOutput: typeof node.data.sourcePath === 'string' && node.data.sourcePath.length > 0,
})

export function buildCanvasOverview(
  nodes: readonly ReadableCanvasNode[],
  edges: readonly ReadableCanvasEdge[],
): CanvasOverview {
  const countsByKind: Record<CanvasNodeKind, number> = {
    image: 0,
    video: 0,
    audio: 0,
    upscale: 0,
    director: 0,
  }
  const countsByGenerationStatus: Record<GenerationStatus, number> = {
    idle: 0,
    generating: 0,
    error: 0,
  }
  const summaries = nodes.map((node) => {
    const summary = summarizeNode(node)
    countsByKind[summary.kind] += 1
    countsByGenerationStatus[summary.generationStatus] += 1
    return summary
  })

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    countsByKind,
    countsByGenerationStatus,
    nodes: summaries,
  }
}

export function buildCanvasNodeDetail(
  nodes: readonly ReadableCanvasNode[],
  edges: readonly ReadableCanvasEdge[],
  nodeId: string,
): CanvasNodeDetail | null {
  const node = nodes.find((item) => item.id === nodeId)
  if (!node) return null

  const connectionSummary = (edge: ReadableCanvasEdge, connectedNodeId: string): CanvasConnectionSummary | null => {
    const connected = nodes.find((item) => item.id === connectedNodeId)
    if (!connected) return null
    return {
      edgeId: edge.id,
      nodeId: connected.id,
      kind: connected.data.kind,
      title: connected.data.title,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    }
  }
  const compact = (items: Array<CanvasConnectionSummary | null>): CanvasConnectionSummary[] => (
    items.filter((item): item is CanvasConnectionSummary => item !== null)
  )

  return {
    id: node.id,
    type: 'storyNode',
    position: node.position,
    selected: node.selected,
    data: {
      ...node.data,
      preview: typeof node.data.preview === 'string' && node.data.preview.startsWith('data:')
        ? '[inline preview omitted]'
        : node.data.preview,
    },
    incomingConnections: compact(edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => connectionSummary(edge, edge.source))),
    outgoingConnections: compact(edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => connectionSummary(edge, edge.target))),
  }
}
