import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdges,
  useEdgesState,
  useNodes,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useAppStore } from '../stores/app.store'
import type {
  CanvasCommandRequest,
  CanvasCommandResponse,
  CanvasNodeData,
  CanvasNodeKind,
  ComfyWorkflowInfo,
  StoryboardShot,
} from '../shared/ipc.types'
import {
  getCapabilityField,
  getNodeAction,
  getNodeKindAction,
  getNodeCapabilities,
  registerNodeKindAction,
  resolveDynamicOptions,
  validateNodeFieldValue,
} from '../shared/node-capabilities'
import './canvas-capabilities'

type StoryNodeKind = CanvasNodeKind
type InteractionMode = 'select' | 'pan'

type StoryNodeData = CanvasNodeData

type StoryNode = Node<StoryNodeData, 'storyNode'>
type StoryEdge = Edge<Record<string, never>, 'default'>

interface FlowSnapshot {
  type: 'react-flow'
  version: 1 | 2
  nodes: StoryNode[]
  edges: StoryEdge[]
  viewport: Viewport
  dismissedArtifacts?: Record<string, number>
}

const SAVE_DEBOUNCE_MS = 700
const DEFAULT_VIEWPORT: Viewport = { x: 80, y: 70, zoom: 0.86 }
const KIND_LABELS: Record<StoryNodeKind, string> = {
  shot: '镜头',
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  upscale: '视频放大',
}
/**
 * Registry-driven field picking: only fields declared writable for the node
 * kind in the capability registry are accepted. Unregistered keys are
 * silently ignored (tolerant, like the old hardcoded whitelist); registered
 * but invalid values throw so the caller (usually the agent) gets feedback.
 */
const pickMutableNodeData = (
  kind: StoryNodeKind,
  value: Record<string, unknown>,
): Partial<StoryNodeData> => {
  const result: Partial<StoryNodeData> = {}
  for (const [key, fieldValue] of Object.entries(value)) {
    if (key === 'id' || key === 'kind' || key === 'position') continue
    const field = getCapabilityField(kind, key)
    if (!field) continue
    if (field.readonly) throw new Error(`字段为只读，不可修改：${key}`)
    const error = validateNodeFieldValue(field, fieldValue)
    if (error) throw new Error(`字段 ${key} 无效：${error}`)
    Object.assign(result, { [key]: fieldValue })
  }
  return result
}

const isFlowSnapshot = (value: unknown): value is FlowSnapshot => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<FlowSnapshot>
  return candidate.type === 'react-flow' && Array.isArray(candidate.nodes) && Array.isArray(candidate.edges)
}

const parseStoryboard = (content: string): StoryboardShot[] => {
  try {
    const value: unknown = JSON.parse(content)
    if (!Array.isArray(value)) return []
    return value.filter((shot): shot is StoryboardShot => (
      !!shot &&
      typeof shot === 'object' &&
      typeof (shot as Partial<StoryboardShot>).index === 'number' &&
      typeof (shot as Partial<StoryboardShot>).scene === 'string'
    ))
  } catch {
    return []
  }
}

/** Upgrade legacy storyboard-table nodes into independent shot nodes. */
const migrateLegacySnapshot = (snapshot: FlowSnapshot): FlowSnapshot => {
  const legacyBoards = snapshot.nodes.filter((node) => (node.data.kind as string) === 'storyboard')
  if (legacyBoards.length === 0) return { ...snapshot, version: 2 }

  const boardIds = new Set(legacyBoards.map((node) => node.id))
  const nodes = snapshot.nodes.filter((node) => !boardIds.has(node.id))
  const edges = snapshot.edges.filter((edge) => !boardIds.has(edge.source) && !boardIds.has(edge.target))

  for (const board of legacyBoards) {
    const shots = Array.isArray((board.data as Record<string, unknown>).shots)
      ? (board.data as Record<string, unknown>).shots as StoryboardShot[]
      : []
    shots.forEach((shot, offset) => {
      const shotId = `${board.id}-shot-${shot.index}`
      const imageId = `${board.id}-shot-${shot.index}-image`
      const videoId = `${board.id}-shot-${shot.index}-video`
      nodes.push({
        id: shotId,
        type: 'storyNode',
        position: { x: board.position.x, y: board.position.y + offset * 330 },
        data: {
          kind: 'shot',
          title: `镜头 ${shot.index}`,
          shotNumber: shot.index,
          scene: shot.scene,
        },
      })
      if (nodes.some((node) => node.id === imageId)) {
        edges.push(makeLinkedEdge(`edge-${shotId}-${imageId}`, shotId, imageId))
      }
      const image = nodes.find((node) => node.id === imageId)
      if (image) {
        image.data = {
          ...image.data,
          prompt: image.data.prompt || shot.textToImagePrompt || shot.scene,
          sourcePath: image.data.sourcePath || shot.imageSource,
          sourceHistory: image.data.sourceHistory || shot.imageSourceHistory,
        }
      }
      const video = nodes.find((node) => node.id === videoId)
      if (video) {
        video.data = {
          ...video.data,
          prompt: video.data.prompt || shot.imageToVideoPrompt || shot.camera || '',
          sourcePath: video.data.sourcePath || shot.videoSource,
          sourceHistory: video.data.sourceHistory || shot.videoSourceHistory,
        }
      }
    })
  }
  return { ...snapshot, version: 2, nodes, edges }
}

/** Remove fields that belonged to the old storyboard-shaped shot model. */
const simplifyShotNode = (node: StoryNode): StoryNode => {
  if (node.data.kind !== 'shot') return node
  const {
    prompt: _legacyPrompt,
    duration: _legacyDuration,
    dialogue: _legacyDialogue,
    camera: _legacyCamera,
    ...data
  } = node.data
  return { ...node, data: data as StoryNodeData }
}

const nodeIcon = (kind: StoryNodeKind) => {
  if (kind === 'upscale') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </svg>
    )
  }
  if (kind === 'shot') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 5h16M4 10h16M4 15h16M4 20h16M8 4v17" />
      </svg>
    )
  }
  if (kind === 'image') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="m3 16 5-5 4 4 2-2 7 7M14.5 7.5h.01M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      </svg>
    )
  }
  if (kind === 'video') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
        <rect x="3" y="5" width="14" height="14" rx="2" strokeWidth="1.8" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="m17 10 4-2v8l-4-2" />
      </svg>
    )
  }
  if (kind === 'audio') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 12h2l2-6 3 12 3-9 2 6 2-3h2" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
      <path strokeLinecap="round" strokeWidth="1.8" d="M5 6h14M5 10h14M5 14h10M5 18h8" />
    </svg>
  )
}

function EmptyPreview({ kind }: { kind: 'image' | 'video' }) {
  return (
    <div className="flex h-full items-center justify-center text-white/20">
      {kind === 'image' ? (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-16 w-16">
          <path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14h18Zm-3.8-2H6.8l3.1-4 2.2 2.7 1.6-1.9L17.2 17ZM15.5 6.5a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-16 w-16">
          <path d="M8 5.8v12.4c0 1.1 1.2 1.7 2.1 1.1l9-6.2c.8-.5.8-1.7 0-2.2l-9-6.2C9.2 4.1 8 4.7 8 5.8Z" />
        </svg>
      )}
    </div>
  )
}

function PromptPanel({ id, kind }: { id: string; kind: 'image' | 'video' }) {
  const nodes = useNodes<StoryNode>()
  const edges = useEdges<StoryEdge>()
  const { setNodes, deleteElements } = useReactFlow<StoryNode, StoryEdge>()
  const currentProject = useAppStore((state) => state.currentProject)
  const [ratioMenuOpen, setRatioMenuOpen] = useState(false)
  const [durationMenuOpen, setDurationMenuOpen] = useState(false)
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false)
  const [workflows, setWorkflows] = useState<ComfyWorkflowInfo[]>([])
  const current = nodes.find((node) => node.id === id)
  const aspectRatio = current?.data.aspectRatio ?? '16:9'
  const currentDuration = ([5, 10, 15] as const).find((value) => value === current?.data.duration) ?? 5
  const generationState = current?.data.generationStatus ?? 'idle'
  const generationError = current?.data.generationError ?? ''
  const availableWorkflows = workflows.filter((item) => kind === 'video'
    ? item.kind === 'image-to-video'
    : item.kind === 'text-to-image' || item.kind === 'image-to-image')
  const selectedWorkflow = availableWorkflows.find((item) => item.id === current?.data.workflowId)
    ?? availableWorkflows[0]
  const isReferenceWorkflow = selectedWorkflow?.id === 'minimax-h3-r2v'
  const isFirstLastWorkflow = kind === 'video' && selectedWorkflow?.id === 'minimax-h3-t2v-flf2v'
  const incoming = edges
    .filter((edge) => edge.target === id)
    .map((edge) => ({ edge, source: nodes.find((node) => node.id === edge.source) }))
    .filter((item): item is { edge: StoryEdge; source: StoryNode } => !!item.source)
  const imageCandidates = incoming.filter(({ source }) => source.data.kind === 'image' && source.data.sourcePath)
  const referenceCandidates = incoming.filter(({ source }) => (
    source.data.kind === 'image' || source.data.kind === 'video' || source.data.kind === 'audio'
  ) && source.data.sourcePath)
  const firstFrameNode = imageCandidates.find(({ source }) => source.id === current?.data.firstFrameNodeId)?.source
  const lastFrameNode = imageCandidates.find(({ source }) => source.id === current?.data.lastFrameNodeId)?.source
  const resolveReferenceTrack = (nodeIds: string[] | undefined, trackKind: 'image' | 'video' | 'audio') => (
    (nodeIds ?? [])
      .map((nodeId) => referenceCandidates.find(({ source }) => source.id === nodeId)?.source)
      .filter((node): node is StoryNode => !!node && node.data.kind === trackKind)
  )
  const referenceImageNodes = resolveReferenceTrack(current?.data.referenceImageNodeIds, 'image')
  const referenceVideoNodes = resolveReferenceTrack(current?.data.referenceVideoNodeIds, 'video')
  const referenceAudioNodes = resolveReferenceTrack(current?.data.referenceAudioNodeIds, 'audio')

  const assignFrame = (field: 'firstFrameNodeId' | 'lastFrameNodeId', nodeId?: string) => {
    setNodes((list) => list.map((node) => node.id === id
      ? { ...node, data: { ...node.data, [field]: nodeId } }
      : node))
  }

  const dropFrame = (event: DragEvent<HTMLDivElement>, field: 'firstFrameNodeId' | 'lastFrameNodeId') => {
    event.preventDefault()
    event.stopPropagation()
    const nodeId = event.dataTransfer.getData('application/x-aigc-node-id')
    if (imageCandidates.some(({ source }) => source.id === nodeId)) assignFrame(field, nodeId)
  }

  const referenceTrackField = {
    image: 'referenceImageNodeIds',
    video: 'referenceVideoNodeIds',
    audio: 'referenceAudioNodeIds',
  } as const
  const referenceTrackLimit = { image: 9, video: 3, audio: 3 } as const

  const assignReference = (trackKind: 'image' | 'video' | 'audio', nodeId: string) => {
    const candidate = referenceCandidates.find(({ source }) => source.id === nodeId)?.source
    if (!candidate || candidate.data.kind !== trackKind) return
    const field = referenceTrackField[trackKind]
    setNodes((list) => list.map((node) => {
      if (node.id !== id) return node
      const validCandidateIds = new Set(referenceCandidates
        .filter(({ source }) => source.data.kind === trackKind)
        .map(({ source }) => source.id))
      const existing = (node.data[field] ?? [])
        .filter((item) => item !== nodeId && validCandidateIds.has(item))
      if (existing.length >= referenceTrackLimit[trackKind]) return node
      return { ...node, data: { ...node.data, [field]: [...existing, nodeId] } }
    }))
  }

  const removeReference = (trackKind: 'image' | 'video' | 'audio', nodeId: string) => {
    const field = referenceTrackField[trackKind]
    setNodes((list) => list.map((node) => node.id === id
      ? { ...node, data: { ...node.data, [field]: (node.data[field] ?? []).filter((item) => item !== nodeId) } }
      : node))
  }

  const dropReference = (event: DragEvent<HTMLDivElement>, trackKind: 'image' | 'video' | 'audio') => {
    event.preventDefault()
    event.stopPropagation()
    assignReference(trackKind, event.dataTransfer.getData('application/x-aigc-node-id'))
  }

  useEffect(() => {
    let active = true
    window.electronAPI.listComfyWorkflows()
      .then((items: ComfyWorkflowInfo[]) => { if (active) setWorkflows(items) })
      .catch(() => { if (active) setWorkflows([]) })
    return () => { active = false }
  }, [])

  return (
    <div className="nodrag nowheel mt-3 cursor-default rounded-2xl border border-white/[0.09] bg-[#17171b] p-3 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
      <div className="mb-3 flex items-center text-[10px] text-white/45">
        <div className="nodrag relative ml-auto">
            <button
              onClick={() => setWorkflowMenuOpen((open) => !open)}
              className={`flex max-w-[190px] items-center gap-1.5 rounded-full border px-2.5 py-1 transition ${workflowMenuOpen ? 'border-[#d4af37]/45 bg-[#d4af37]/10 text-[#f0d98c]' : 'border-white/[0.06] bg-white/[0.05] text-white/48 hover:text-white/75'}`}
              title="选择 ComfyUI 工作流"
            >
              <span className="truncate">
                {selectedWorkflow?.name ?? (kind === 'video' ? '视频工作流待配置' : '加载工作流…')}
              </span>
              <span className="text-[8px]">▼</span>
            </button>
            {workflowMenuOpen && (
              <div className="absolute right-0 top-full z-[110] mt-1.5 w-[230px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#242429] p-1 shadow-[0_14px_36px_rgba(0,0,0,0.7)]">
                {availableWorkflows.map((workflow) => (
                  <button
                    key={workflow.id}
                    onClick={() => {
                      setNodes((list) => list.map((node) => node.id === id
                        ? { ...node, data: { ...node.data, workflowId: workflow.id } }
                        : node))
                      setWorkflowMenuOpen(false)
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${selectedWorkflow?.id === workflow.id ? 'bg-[#d4af37]/15 text-[#f0d98c]' : 'text-white/58 hover:bg-white/[0.08] hover:text-white'}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{workflow.name}</span>
                    <span className="flex-shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px] text-white/35">
                      {workflow.id === 'minimax-h3-r2v' ? '全模态' : workflow.kind === 'image-to-video' ? '视频' : workflow.kind === 'image-to-image' ? '图生图' : '文生图'}
                    </span>
                  </button>
                ))}
              </div>
            )}
        </div>
      </div>

      {isFirstLastWorkflow && imageCandidates.length > 0 && (
        <div className="mb-2.5">
          <div className="mb-1.5 text-[9px] text-white/35">候选图片（拖到首帧或尾帧）</div>
          <div className="flex flex-wrap gap-2">
            {imageCandidates.map(({ edge, source }, index) => (
              <div
                key={edge.id}
                draggable
                onDragStart={(event) => {
                  event.stopPropagation()
                  event.dataTransfer.setData('application/x-aigc-node-id', source.id)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
                className="nodrag group/ref relative flex h-16 w-16 cursor-grab flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.09] px-1 text-[9px] text-[#e8e6df] active:cursor-grabbing"
                title={`拖拽分配：${source.data.title}`}
              >
                <span className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#25252b] text-[9px] text-white">
                  {index + 1}
                </span>
                {source.data.preview ? (
                  <img src={source.data.preview} className="h-9 w-9 flex-shrink-0 rounded-md object-cover" draggable={false} />
                ) : nodeIcon(source.data.kind)}
                <span className="w-full truncate text-center">{source.data.title}</span>
                <button
                  className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-white/55 opacity-0 transition hover:text-white group-hover/ref:opacity-100"
                  onClick={() => void deleteElements({ edges: [edge] })}
                  title="移除候选并断开连线"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {isFirstLastWorkflow && (
        <div className="mb-2.5 grid grid-cols-2 gap-2">
          {([
            ['firstFrameNodeId', '首帧', firstFrameNode],
            ['lastFrameNodeId', '尾帧', lastFrameNode],
          ] as const).map(([field, label, frameNode]) => (
            <div
              key={field}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }}
              onDrop={(event) => dropFrame(event, field)}
              className={`relative flex h-[78px] items-center gap-2 overflow-hidden rounded-xl border border-dashed px-2 transition ${frameNode ? 'border-[#d4af37]/55 bg-[#d4af37]/[0.07]' : 'border-white/15 bg-black/15 hover:border-[#d4af37]/40'}`}
            >
              {frameNode ? (
                <>
                  {frameNode.data.preview ? (
                    <img src={frameNode.data.preview} className="h-14 w-14 flex-shrink-0 rounded-lg object-cover" draggable={false} />
                  ) : (
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                      {nodeIcon('image')}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-[9px] text-[#d7bc63]">{label}</div>
                    <div className="truncate text-[10px] text-white/70">{frameNode.data.title}</div>
                  </div>
                  <button
                    onClick={() => assignFrame(field)}
                    className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/50 text-[10px] text-white/55 hover:text-white"
                    title={`清空${label}`}
                  >
                    ×
                  </button>
                </>
              ) : (
                <div className="w-full text-center">
                  <div className="text-[11px] text-white/60">{label}</div>
                  <div className="mt-1 text-[9px] text-white/25">拖入候选图片</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isReferenceWorkflow && referenceCandidates.length > 0 && (
        <div className="mb-2.5">
          <div className="mb-1.5 text-[9px] text-white/35">候选素材（拖到同类型轨道）</div>
          <div className="flex flex-wrap gap-2">
            {referenceCandidates.map(({ edge, source }, index) => (
              <div
                key={edge.id}
                draggable
                onDragStart={(event) => {
                  event.stopPropagation()
                  event.dataTransfer.setData('application/x-aigc-node-id', source.id)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
                className="nodrag group/ref relative flex h-16 w-16 cursor-grab flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.09] px-1 text-[9px] text-[#e8e6df] active:cursor-grabbing"
                title={`拖拽分配：${source.data.title}`}
              >
                <span className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#25252b] text-[9px] text-white">
                  {index + 1}
                </span>
                {source.data.kind === 'image' && source.data.preview ? (
                  <img src={source.data.preview} className="h-9 w-9 flex-shrink-0 rounded-md object-cover" draggable={false} />
                ) : nodeIcon(source.data.kind)}
                <span className="w-full truncate text-center">{source.data.title}</span>
                <button
                  className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-white/55 opacity-0 transition hover:text-white group-hover/ref:opacity-100"
                  onClick={() => void deleteElements({ edges: [edge] })}
                  title="移除候选并断开连线"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {isReferenceWorkflow && (
        <div className="mb-2.5 space-y-2">
          {([
            ['image', '图片轨', referenceImageNodes, 9, 'Picture'],
            ['video', '视频轨', referenceVideoNodes, 3, 'Video'],
            ['audio', '音频轨', referenceAudioNodes, 3, 'Audio'],
          ] as const).map(([trackKind, label, trackNodes, limit, token]) => (
            <div
              key={trackKind}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }}
              onDrop={(event) => dropReference(event, trackKind)}
              className="min-h-[58px] rounded-xl border border-dashed border-white/15 bg-black/15 p-2 transition hover:border-[#d4af37]/40"
            >
              <div className="mb-1.5 flex items-center gap-1.5 text-[9px] text-white/45">
                {nodeIcon(trackKind)}
                <span>{label}</span>
                <span className="ml-auto text-white/25">{trackNodes.length}/{limit}</span>
              </div>
              {trackNodes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {trackNodes.map((trackNode, index) => (
                    <div
                      key={trackNode.id}
                      draggable
                      onDragStart={(event) => {
                        event.stopPropagation()
                        event.dataTransfer.setData('application/x-aigc-node-id', trackNode.id)
                        event.dataTransfer.effectAllowed = 'copyMove'
                      }}
                      className="nodrag group/track relative flex h-14 w-14 cursor-grab flex-col items-center justify-center gap-1 rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/[0.07] px-1 pt-1 text-[8px] text-white/65 active:cursor-grabbing"
                      title={`<${token} ${index + 1}> · ${trackNode.data.title}；拖回本轨道末尾可调整顺序`}
                    >
                      <span className="absolute left-1 top-1 flex h-4 min-w-4 items-center justify-center rounded bg-[#d4af37]/15 px-1 text-[8px] text-[#e8c766]">{index + 1}</span>
                      {trackNode.data.kind === 'image' && trackNode.data.preview ? (
                        <img src={trackNode.data.preview} className="h-7 w-7 rounded object-cover" draggable={false} />
                      ) : (
                        <span className="text-white/55">{nodeIcon(trackKind)}</span>
                      )}
                      <span className="w-full truncate text-center">{trackNode.data.title}</span>
                      <button
                        onClick={() => removeReference(trackKind, trackNode.id)}
                        className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/45 text-white/45 hover:text-white"
                        title={`移出${label}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-1 text-center text-[9px] text-white/22">拖入{trackKind === 'image' ? '图片' : trackKind === 'video' ? '视频' : '音频'}素材</div>
              )}
            </div>
          ))}
        </div>
      )}

      {!isFirstLastWorkflow && !isReferenceWorkflow && incoming.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-2">
          {incoming.map(({ edge, source }, index) => (
            <div
              key={edge.id}
              className="group/ref relative flex h-12 min-w-12 max-w-[150px] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.09] px-2.5 text-[11px] text-[#e8e6df]"
              title={`引用：${source.data.title}`}
            >
              <span className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#25252b] text-[9px] text-white">
                {index + 1}
              </span>
              {nodeIcon(source.data.kind)}
              <span className="truncate">{source.data.title}</span>
              <button
                className="ml-auto flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-black/40 text-white/55 opacity-0 transition hover:text-white group-hover/ref:opacity-100"
                onClick={() => void deleteElements({ edges: [edge] })}
                title="移除引用并断开连线"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {kind === 'video' && isReferenceWorkflow && (
        <div className="mb-2.5 rounded-lg border border-[#d4af37]/15 bg-[#d4af37]/[0.05] px-2.5 py-2 text-[9px] leading-4 text-white/42">
          最多 9 张图片、3 个视频、3 段音频。按轨道中的顺序在提示词中使用
          {' '}<span className="text-[#e8c766]">&lt;Picture 1&gt;</span>、
          <span className="text-[#e8c766]">&lt;Video 1&gt;</span>、
          <span className="text-[#e8c766]">&lt;Audio 1&gt;</span>。参考视频建议为 24fps、2–15 秒；视频自带音轨时会占用一个 Audio 编号。
        </div>
      )}

      <textarea
        value={current?.data.prompt ?? ''}
        onChange={(event) => {
          const prompt = event.target.value
          setNodes((list) => list.map((node) => node.id === id ? { ...node, data: { ...node.data, prompt } } : node))
        }}
        placeholder={kind === 'image'
          ? '描述你想要生成的画面内容，连接其他节点可引用素材…'
          : isReferenceWorkflow
            ? '描述视频并用 <Picture 1>、<Video 1>、<Audio 1> 指定参考素材…'
            : '描述视频的运动、镜头和节奏，连接图片节点可作为首尾帧参考…'}
        className="min-h-20 w-full resize-none border-0 bg-transparent px-1 text-[12px] leading-5 text-[#e8e6df] outline-none placeholder:text-white/25"
      />

      {generationError && (
        <div className="mt-1.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-2.5 py-2 text-[10px] leading-4 text-rose-300">
          {generationError}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[10px] text-white/40">
        <div className="flex items-center gap-1.5">
          <div className="nodrag relative">
            <button
              onClick={() => setRatioMenuOpen((open) => !open)}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] outline-none transition ${ratioMenuOpen ? 'border-[#d4af37]/50 bg-[#d4af37]/10 text-[#f0d98c]' : 'border-white/[0.08] bg-white/[0.05] text-white/55 hover:border-[#d4af37]/35 hover:text-white'}`}
              title="画幅比例"
            >
              <span>{aspectRatio}</span>
              <svg viewBox="0 0 12 12" fill="currentColor" className={`h-2.5 w-2.5 transition-transform ${ratioMenuOpen ? 'rotate-180' : ''}`}>
                <path d="m2.2 4 3.8 4 3.8-4H2.2Z" />
              </svg>
            </button>
            {ratioMenuOpen && (
              <div className="absolute bottom-full left-0 z-[100] mb-1.5 min-w-[76px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#242429] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.65)]">
                {(['16:9', '1:1', '4:3'] as const).map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => {
                      setNodes((list) => list.map((node) => node.id === id
                        ? { ...node, data: { ...node.data, aspectRatio: ratio } }
                        : node))
                      setRatioMenuOpen(false)
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[10px] transition ${aspectRatio === ratio ? 'bg-[#d4af37]/15 text-[#f0d98c]' : 'text-white/60 hover:bg-white/[0.08] hover:text-white'}`}
                  >
                    <span>{ratio}</span>
                    {aspectRatio === ratio && <span className="text-[#e8c766]">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span>·</span>
          {kind === 'image' ? (
            <span>标准画质 · 2K</span>
          ) : (
            <>
              <span>原生音画</span>
              <span>·</span>
              <div className="nodrag relative">
                <button
                  onClick={() => setDurationMenuOpen((open) => !open)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] outline-none transition ${durationMenuOpen ? 'border-[#d4af37]/50 bg-[#d4af37]/10 text-[#f0d98c]' : 'border-white/[0.08] bg-white/[0.05] text-white/55 hover:border-[#d4af37]/35 hover:text-white'}`}
                  title="生成时长"
                >
                  <span>{currentDuration}s</span>
                  <svg viewBox="0 0 12 12" fill="currentColor" className={`h-2.5 w-2.5 transition-transform ${durationMenuOpen ? 'rotate-180' : ''}`}>
                    <path d="m2.2 4 3.8 4 3.8-4H2.2Z" />
                  </svg>
                </button>
                {durationMenuOpen && (
                  <div className="absolute bottom-full left-0 z-[100] mb-1.5 min-w-[72px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#242429] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.65)]">
                    {([5, 10, 15] as const).map((duration) => (
                      <button
                        key={duration}
                        onClick={() => {
                          setNodes((list) => list.map((node) => node.id === id
                            ? { ...node, data: { ...node.data, duration } }
                            : node))
                          setDurationMenuOpen(false)
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[10px] transition ${currentDuration === duration ? 'bg-[#d4af37]/15 text-[#f0d98c]' : 'text-white/60 hover:bg-white/[0.08] hover:text-white'}`}
                      >
                        <span>{duration}s</span>
                        {currentDuration === duration && <span className="text-[#e8c766]">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => void getNodeKindAction(kind, 'generate')?.(id)}
          disabled={generationState === 'generating' || !selectedWorkflow}
          className="flex h-9 min-w-[72px] items-center justify-center gap-2 rounded-xl bg-[#e8e6df] px-4 text-[11px] font-semibold tracking-wider text-[#17171b] shadow-[0_5px_18px_rgba(255,255,255,0.08)] transition hover:bg-white hover:shadow-[0_7px_22px_rgba(255,255,255,0.13)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          title={kind === 'image' ? '使用 ComfyUI 生成图片' : '使用 MiniMax H3 生成视频'}
        >
          {generationState === 'generating' ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#17171b]/30 border-t-[#17171b]" />
              <span>生成中</span>
            </>
          ) : '生成'}
        </button>
      </div>
    </div>
  )
}

const UPSCALE_SCALES = [2, 3, 4] as const
const UPSCALE_QUALITIES = ['FAST', 'MEDIUM', 'HIGH', 'ULTRA'] as const
const UPSCALE_QUALITY_LABELS: Record<(typeof UPSCALE_QUALITIES)[number], string> = {
  FAST: '快速',
  MEDIUM: '均衡',
  HIGH: '高质量',
  ULTRA: '极致',
}

function UpscalePanel({ id }: { id: string }) {
  const nodes = useNodes<StoryNode>()
  const edges = useEdges<StoryEdge>()
  const { setNodes, deleteElements } = useReactFlow<StoryNode, StoryEdge>()
  const [scaleMenuOpen, setScaleMenuOpen] = useState(false)
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false)
  const current = nodes.find((node) => node.id === id)
  const scale = UPSCALE_SCALES.find((value) => value === current?.data.scale) ?? 2
  const quality = UPSCALE_QUALITIES.find((value) => value === current?.data.quality) ?? 'ULTRA'
  const generationState = current?.data.generationStatus ?? 'idle'
  const generationError = current?.data.generationError ?? ''
  const inputCandidates = edges
    .filter((edge) => edge.target === id)
    .map((edge) => ({ edge, source: nodes.find((node) => node.id === edge.source) }))
    .filter((item): item is { edge: StoryEdge; source: StoryNode } => (
      !!item.source &&
      (item.source.data.kind === 'video' || item.source.data.kind === 'upscale') &&
      !!item.source.data.sourcePath
    ))
  const inputNode = inputCandidates.find(({ source }) => source.id === current?.data.inputNodeId)?.source
    ?? inputCandidates[0]?.source

  const selectInput = (nodeId: string) => {
    setNodes((list) => list.map((node) => node.id === id
      ? { ...node, data: { ...node.data, inputNodeId: nodeId } }
      : node))
  }

  return (
    <div className="nodrag nowheel mt-3 cursor-default rounded-2xl border border-white/[0.09] bg-[#17171b] p-3 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
      <div className="mb-2.5 rounded-xl border border-dashed border-white/15 bg-black/15 p-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[9px] text-white/45">
          {nodeIcon('video')}
          <span>输入视频</span>
          {inputCandidates.length > 1 && <span className="text-white/25">点击切换</span>}
        </div>
        {inputCandidates.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {inputCandidates.map(({ edge, source }) => {
              const active = inputNode?.id === source.id
              return (
                <div
                  key={edge.id}
                  className={`group/ref relative flex h-9 min-w-9 max-w-[150px] items-center gap-2 rounded-lg border px-2.5 text-[10px] transition ${active ? 'border-[#d4af37]/55 bg-[#d4af37]/[0.1] text-[#f0d98c]' : 'border-white/10 bg-white/[0.06] text-white/55 hover:border-white/25 hover:text-white/85'}`}
                >
                  <button
                    className="flex min-w-0 items-center gap-2"
                    onClick={() => selectInput(source.id)}
                    title={active ? `当前输入：${source.data.title}` : `切换输入为：${source.data.title}`}
                  >
                    {nodeIcon('video')}
                    <span className="truncate">{source.data.title}</span>
                    {active && <span className="flex-shrink-0 text-[8px] text-[#e8c766]">✓</span>}
                  </button>
                  <button
                    className="ml-auto flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-black/40 text-white/45 opacity-0 transition hover:text-white group-hover/ref:opacity-100"
                    onClick={() => void deleteElements({ edges: [edge] })}
                    title="断开连线"
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="py-1 text-center text-[10px] text-white/35">连接一个已有视频节点作为输入</div>
        )}
      </div>

      {generationError && (
        <div className="mb-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-2.5 py-2 text-[10px] leading-4 text-rose-300">
          {generationError}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-white/40">
        <div className="flex items-center gap-1.5">
          <div className="nodrag relative">
            <button
              onClick={() => setScaleMenuOpen((open) => !open)}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] outline-none transition ${scaleMenuOpen ? 'border-[#d4af37]/50 bg-[#d4af37]/10 text-[#f0d98c]' : 'border-white/[0.08] bg-white/[0.05] text-white/55 hover:border-[#d4af37]/35 hover:text-white'}`}
              title="放大倍数"
            >
              <span>{scale}x</span>
              <svg viewBox="0 0 12 12" fill="currentColor" className={`h-2.5 w-2.5 transition-transform ${scaleMenuOpen ? 'rotate-180' : ''}`}>
                <path d="m2.2 4 3.8 4 3.8-4H2.2Z" />
              </svg>
            </button>
            {scaleMenuOpen && (
              <div className="absolute bottom-full left-0 z-[100] mb-1.5 min-w-[72px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#242429] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.65)]">
                {UPSCALE_SCALES.map((value) => (
                  <button
                    key={value}
                    onClick={() => {
                      setNodes((list) => list.map((node) => node.id === id
                        ? { ...node, data: { ...node.data, scale: value } }
                        : node))
                      setScaleMenuOpen(false)
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[10px] transition ${scale === value ? 'bg-[#d4af37]/15 text-[#f0d98c]' : 'text-white/60 hover:bg-white/[0.08] hover:text-white'}`}
                  >
                    <span>{value}x</span>
                    {scale === value && <span className="text-[#e8c766]">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span>·</span>
          <div className="nodrag relative">
            <button
              onClick={() => setQualityMenuOpen((open) => !open)}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] outline-none transition ${qualityMenuOpen ? 'border-[#d4af37]/50 bg-[#d4af37]/10 text-[#f0d98c]' : 'border-white/[0.08] bg-white/[0.05] text-white/55 hover:border-[#d4af37]/35 hover:text-white'}`}
              title="放大质量"
            >
              <span>{UPSCALE_QUALITY_LABELS[quality]}</span>
              <svg viewBox="0 0 12 12" fill="currentColor" className={`h-2.5 w-2.5 transition-transform ${qualityMenuOpen ? 'rotate-180' : ''}`}>
                <path d="m2.2 4 3.8 4 3.8-4H2.2Z" />
              </svg>
            </button>
            {qualityMenuOpen && (
              <div className="absolute bottom-full left-0 z-[100] mb-1.5 min-w-[88px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#242429] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.65)]">
                {UPSCALE_QUALITIES.map((value) => (
                  <button
                    key={value}
                    onClick={() => {
                      setNodes((list) => list.map((node) => node.id === id
                        ? { ...node, data: { ...node.data, quality: value } }
                        : node))
                      setQualityMenuOpen(false)
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[10px] transition ${quality === value ? 'bg-[#d4af37]/15 text-[#f0d98c]' : 'text-white/60 hover:bg-white/[0.08] hover:text-white'}`}
                  >
                    <span>{UPSCALE_QUALITY_LABELS[value]}</span>
                    {quality === value && <span className="text-[#e8c766]">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => void getNodeKindAction('upscale', 'generate')?.(id)}
          disabled={generationState === 'generating' || !inputNode}
          className="flex h-9 min-w-[72px] items-center justify-center gap-2 rounded-xl bg-[#e8e6df] px-4 text-[11px] font-semibold tracking-wider text-[#17171b] shadow-[0_5px_18px_rgba(255,255,255,0.08)] transition hover:bg-white hover:shadow-[0_7px_22px_rgba(255,255,255,0.13)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          title="使用 RTX Video Super Resolution 放大视频"
        >
          {generationState === 'generating' ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#17171b]/30 border-t-[#17171b]" />
              <span>放大中</span>
            </>
          ) : '放大'}
        </button>
      </div>
    </div>
  )
}

function NodeDeleteButton({ id }: { id: string }) {
  const { deleteElements } = useReactFlow<StoryNode, StoryEdge>()
  return (
    <button
      className="nodrag ml-2 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-sm text-white/30 transition hover:bg-rose-500/15 hover:text-rose-300"
      onClick={(event) => {
        event.stopPropagation()
        void deleteElements({ nodes: [{ id }] })
      }}
      title="从画布删除"
    >
      ×
    </button>
  )
}

function StoryNodeCard({ id, data, selected }: NodeProps<StoryNode>) {
  const { setNodes } = useReactFlow<StoryNode, StoryEdge>()
  const currentProject = useAppStore((state) => state.currentProject)
  const addCanvasNodeReference = useAppStore((state) => state.addCanvasNodeReference)
  const isReferencedInChat = useAppStore((state) => state.referencedCanvasNodes.some((ref) => ref.id === id))
  const [audioImporting, setAudioImporting] = useState(false)
  const isUpscale = data.kind === 'upscale'
  const visualMediaKind = data.kind === 'image' || data.kind === 'video'
    ? data.kind
    : isUpscale ? 'video' : null
  const isAudio = data.kind === 'audio'
  const isShot = data.kind === 'shot'
  const isMedia = !!visualMediaKind || isAudio
  const aspectRatio = data.aspectRatio ?? '16:9'
  const aspectRatioValue = aspectRatio === '1:1' ? '1 / 1' : aspectRatio === '4:3' ? '4 / 3' : '16 / 9'

  const importAudio = async () => {
    if (!currentProject || audioImporting) return
    setAudioImporting(true)
    try {
      const result = await window.electronAPI.importAudio(currentProject.id)
      if (result.canceled) return
      if (!result.success || !result.relativePath) throw new Error(result.error || '音频导入失败')
      const preview = `workspace://${currentProject.id}/${result.relativePath
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              title: result.name || node.data.title,
              preview,
              sourcePath: result.relativePath,
              generationStatus: 'idle',
              generationError: '',
            },
          }
        : node))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? { ...node, data: { ...node.data, generationStatus: 'error', generationError: message } }
        : node))
    } finally {
      setAudioImporting(false)
    }
  }

  return (
    <div className={isMedia ? 'w-[420px]' : 'w-[250px]'}>
      <div className="mb-1.5 flex items-center gap-1 text-[11px] text-white/48">
        {nodeIcon(data.kind)}
        <span className="min-w-0 truncate">{data.title}</span>
        {data.generationStatus === 'generating' && (
          <span className="ml-1 flex items-center gap-1 text-[9px] text-[#e8c766]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#e8c766]" />
            生成中
          </span>
        )}
        <span className="ml-auto" />
        {selected && (
          <button
            className={`nodrag flex h-6 flex-shrink-0 items-center gap-1 rounded-md border px-2 text-[10px] transition ${isReferencedInChat ? 'border-sky-400/30 bg-sky-400/10 text-sky-200' : 'border-white/10 bg-white/[0.04] text-white/55 hover:border-[#d4af37]/35 hover:text-[#e8c766]'}`}
            onClick={(event) => {
              event.stopPropagation()
              addCanvasNodeReference({ id, title: data.title, kind: data.kind })
            }}
            title={isReferencedInChat ? '该节点已添加到对话' : '把该节点作为附件添加到下一条对话'}
          >
            <span>{isReferencedInChat ? '✓' : '+'}</span>
            <span>{isReferencedInChat ? '已添加到对话' : '添加到对话'}</span>
          </button>
        )}
        <NodeDeleteButton id={id} />
      </div>
      <div
        className={`relative overflow-visible rounded-xl border bg-[#202023] shadow-[0_10px_35px_rgba(0,0,0,0.3)] transition ${selected ? 'border-[#e8c766]/75 shadow-[0_0_0_1px_rgba(232,199,102,0.18),0_18px_45px_rgba(0,0,0,0.4)]' : 'border-white/[0.13]'}`}
      >
        <Handle type="target" position={Position.Left} className="story-handle" />
        {visualMediaKind ? (
          <div className="relative overflow-hidden rounded-[11px] bg-[#202023] transition-[height] duration-200" style={{ aspectRatio: aspectRatioValue }}>
            {data.preview ? (
              data.kind === 'image' ? (
                <img src={data.preview} alt={data.title} draggable={false} className="h-full w-full object-contain" />
              ) : (
                <video
                  src={data.preview}
                  className="nodrag nowheel h-full w-full cursor-auto object-contain"
                  controls
                  playsInline
                  preload="metadata"
                  onPointerDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onLoadedMetadata={() => {
                    if (!data.generationError) return
                    setNodes((nodes) => nodes.map((node) => node.id === id
                      ? { ...node, data: { ...node.data, generationError: '' } }
                      : node))
                  }}
                  onError={(event) => {
                    const mediaError = event.currentTarget.error
                    const detail = mediaError?.message || `媒体错误码 ${mediaError?.code ?? '未知'}`
                    setNodes((nodes) => nodes.map((node) => node.id === id
                      ? { ...node, data: { ...node.data, generationStatus: 'error', generationError: `视频加载失败：${detail}` } }
                      : node))
                  }}
                />
              )
            ) : (
              <EmptyPreview kind={visualMediaKind} />
            )}
            {data.generationStatus === 'generating' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#101014]/75 text-[#e8c766] backdrop-blur-[2px]">
                <span className="h-7 w-7 animate-spin rounded-full border-2 border-[#e8c766]/20 border-t-[#e8c766]" />
                <span className="text-[11px] tracking-wider">ComfyUI 生成中</span>
              </div>
            )}
          </div>
        ) : isAudio ? (
          <div className="nodrag nowheel flex min-h-[150px] flex-col items-center justify-center gap-4 rounded-[11px] bg-[#17171b] p-5" onPointerDown={(event) => event.stopPropagation()}>
            {data.preview ? (
              <audio src={data.preview} controls preload="metadata" className="w-full" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-white/28">
                <div className="text-3xl">♪</div>
                <span className="text-[11px]">尚未上传音频</span>
              </div>
            )}
            <button
              onClick={() => void importAudio()}
              disabled={audioImporting}
              className="rounded-xl border border-[#d4af37]/25 bg-[#d4af37]/10 px-4 py-2 text-[11px] text-[#f0d98c] transition hover:bg-[#d4af37]/15 disabled:opacity-50"
            >
              {audioImporting ? '导入中…' : data.preview ? '替换本地音频' : '上传本地音频'}
            </button>
            {data.generationError && <p className="text-[10px] text-rose-300">{data.generationError}</p>}
          </div>
        ) : isShot ? (
          <div className="min-h-[150px] space-y-3 p-5">
            <div className="text-[10px] uppercase tracking-wider text-[#e8c766]">#{data.shotNumber ?? '—'}</div>
            <p className="whitespace-pre-wrap text-[12px] leading-6 text-white/75">
              {data.scene || '概括这个镜头的剧情或画面内容。'}
            </p>
          </div>
        ) : (
          <div className="min-h-[190px] p-5">
            <div className="mb-5 flex justify-center text-white/25">{nodeIcon('text')}</div>
            <p className="whitespace-pre-wrap text-[12px] leading-6 text-white/70">
              {data.prompt || '在这里编写剧情、旁白或镜头说明。文本节点可以连接到图片节点作为提示词参考。'}
            </p>
          </div>
        )}
        <Handle type="source" position={Position.Right} className="story-handle" />
      </div>
      {selected && visualMediaKind && !isUpscale && <PromptPanel id={id} kind={visualMediaKind} />}
      {selected && isUpscale && <UpscalePanel id={id} />}
    </div>
  )
}

const nodeTypes = { storyNode: StoryNodeCard }

const makeNode = (kind: StoryNodeKind, index: number, position?: { x: number; y: number }): StoryNode => ({
  id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  type: 'storyNode',
  position: position ?? { x: 120 + index * 45, y: 100 + index * 35 },
  data: {
    kind,
    title: `${KIND_LABELS[kind]}节点 ${index}`,
    ...(kind === 'text' || kind === 'image' || kind === 'video' ? { prompt: '' } : {}),
    shotNumber: kind === 'shot' ? index : undefined,
    aspectRatio: kind === 'image' || kind === 'video' || kind === 'upscale' ? '16:9' : undefined,
    duration: kind === 'video' ? 5 : undefined,
    scale: kind === 'upscale' ? 2 : undefined,
    quality: kind === 'upscale' ? 'ULTRA' : undefined,
  },
})

const makeLinkedEdge = (
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
): StoryEdge => ({
  id,
  source,
  target,
  sourceHandle,
  type: 'default',
  animated: true,
  markerEnd: { type: MarkerType.ArrowClosed, color: '#8aa5c2', width: 14, height: 14 },
  style: { stroke: '#8aa5c2', strokeWidth: 1.5 },
})

function CanvasFlow() {
  const { currentProject, artifacts } = useAppStore()
  const folderPath = currentProject?.folderPath
  const [nodes, setNodes, onNodesChange] = useNodesState<StoryNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<StoryEdge>([])
  const [dismissedArtifacts, setDismissedArtifacts] = useState<Record<string, number>>({})
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('select')
  const { screenToFlowPosition, setViewport, getViewport, fitView } = useReactFlow<StoryNode, StoryEdge>()
  const loadedFolderRef = useRef<string | null>(null)
  const readyToSaveRef = useRef(false)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const nodesRef = useRef<StoryNode[]>([])
  const edgesRef = useRef<StoryEdge[]>([])
  const revisionRef = useRef(0)

  useEffect(() => {
    if (nodesRef.current !== nodes) revisionRef.current += 1
    nodesRef.current = nodes
  }, [nodes])
  useEffect(() => {
    if (edgesRef.current !== edges) revisionRef.current += 1
    edgesRef.current = edges
  }, [edges])

  // Kind-level 'generate' handlers. They read live state from refs and the
  // store instead of component closures, so they work for every node id,
  // including off-screen nodes React Flow has virtualized away.
  const patchNodeData = (nodeId: string, patch: Partial<StoryNodeData>) => {
    setNodes((list) => list.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, ...patch } }
      : node))
  }

  const applyGenerationResult = (nodeId: string, projectId: string, relativePath: string) => {
    const preview = `workspace://${projectId}/${relativePath
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`
    setNodes((list) => list.map((node) => node.id === nodeId
      ? {
          ...node,
          data: {
            ...node.data,
            preview,
            sourcePath: relativePath,
            sourceHistory: node.data.sourcePath
              ? [...(node.data.sourceHistory ?? []), node.data.sourcePath]
              : node.data.sourceHistory ?? [],
            generationStatus: 'idle',
            generationError: '',
          },
        }
      : node))
  }

  const generateImageNode = async (nodeId: string) => {
    const project = useAppStore.getState().currentProject
    const current = nodesRef.current.find((node) => node.id === nodeId)
    if (!project || !current || current.data.kind !== 'image') return
    if (!(current.data.prompt ?? '').trim()) {
      patchNodeData(nodeId, { generationStatus: 'error', generationError: '请先输入文生图提示词' })
      return
    }
    patchNodeData(nodeId, { generationStatus: 'generating', generationError: '' })
    try {
      const workflows: ComfyWorkflowInfo[] = await window.electronAPI.listComfyWorkflows()
      const available = workflows.filter((item) => item.kind === 'text-to-image' || item.kind === 'image-to-image')
      const selectedWorkflow = available.find((item) => item.id === current.data.workflowId) ?? available[0]
      const referenceImagePath = edgesRef.current
        .filter((edge) => edge.target === nodeId)
        .map((edge) => nodesRef.current.find((node) => node.id === edge.source))
        .find((source) => source?.data.kind === 'image' && source.data.sourcePath)
        ?.data.sourcePath
      const result = await window.electronAPI.generateImage({
        projectId: project.id,
        nodeId,
        prompt: current.data.prompt ?? '',
        aspectRatio: current.data.aspectRatio ?? '16:9',
        workflowId: selectedWorkflow?.id,
        referenceImagePath,
      })
      if (!result.success || !result.relativePath) {
        throw new Error(result.error || 'ComfyUI 没有返回图片')
      }
      applyGenerationResult(nodeId, project.id, result.relativePath)
    } catch (error) {
      patchNodeData(nodeId, {
        generationStatus: 'error',
        generationError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const generateVideoNode = async (nodeId: string) => {
    const project = useAppStore.getState().currentProject
    const current = nodesRef.current.find((node) => node.id === nodeId)
    if (!project || !current || current.data.kind !== 'video') return
    if (!(current.data.prompt ?? '').trim()) {
      patchNodeData(nodeId, { generationStatus: 'error', generationError: '请先输入视频生成提示词' })
      return
    }
    patchNodeData(nodeId, { generationStatus: 'generating', generationError: '' })
    try {
      const workflows: ComfyWorkflowInfo[] = await window.electronAPI.listComfyWorkflows()
      const available = workflows.filter((item) => item.kind === 'image-to-video')
      const selectedWorkflow = available.find((item) => item.id === current.data.workflowId) ?? available[0]
      const isReferenceWorkflow = selectedWorkflow?.id === 'minimax-h3-r2v'
      const isFirstLastWorkflow = selectedWorkflow?.id === 'minimax-h3-t2v-flf2v'
      const incomingSources = edgesRef.current
        .filter((edge) => edge.target === nodeId)
        .map((edge) => nodesRef.current.find((node) => node.id === edge.source))
        .filter((source): source is StoryNode => !!source)
      const imageCandidates = incomingSources.filter((source) => source.data.kind === 'image' && source.data.sourcePath)
      const referenceCandidates = incomingSources.filter((source) => (
        source.data.kind === 'image' || source.data.kind === 'video' || source.data.kind === 'audio'
      ) && source.data.sourcePath)
      const resolveTrackPaths = (nodeIds: string[] | undefined, trackKind: 'image' | 'video' | 'audio') =>
        (nodeIds ?? [])
          .map((trackNodeId) => referenceCandidates.find((source) => source.id === trackNodeId))
          .filter((source): source is StoryNode => !!source && source.data.kind === trackKind)
          .map((source) => source.data.sourcePath!)
      const referenceImagePaths = resolveTrackPaths(current.data.referenceImageNodeIds, 'image')
      const referenceVideoPaths = resolveTrackPaths(current.data.referenceVideoNodeIds, 'video')
      const referenceAudioPaths = resolveTrackPaths(current.data.referenceAudioNodeIds, 'audio')
      if (isReferenceWorkflow) {
        const error = referenceImagePaths.length > 9
          ? '全模态参考图片轨最多放入 9 张图片'
          : referenceVideoPaths.length > 3
            ? '全模态参考视频轨最多放入 3 个视频'
            : referenceAudioPaths.length > 3
              ? '全模态参考音频轨最多放入 3 段音频'
              : referenceImagePaths.length + referenceVideoPaths.length + referenceAudioPaths.length === 0
                ? '请从候选素材中至少拖一个图片、视频或音频到参考轨道'
                : ''
        if (error) {
          patchNodeData(nodeId, { generationStatus: 'error', generationError: error })
          return
        }
      }
      const firstFrameNode = imageCandidates.find((source) => source.id === current.data.firstFrameNodeId)
      const lastFrameNode = imageCandidates.find((source) => source.id === current.data.lastFrameNodeId)
      const result = await window.electronAPI.generateVideo({
        projectId: project.id,
        nodeId,
        prompt: current.data.prompt ?? '',
        aspectRatio: current.data.aspectRatio ?? '16:9',
        duration: ([5, 10, 15] as const).find((value) => value === current.data.duration) ?? 5,
        workflowId: selectedWorkflow?.id,
        referenceImagePath: isFirstLastWorkflow ? firstFrameNode?.data.sourcePath : undefined,
        lastFrameImagePath: isFirstLastWorkflow ? lastFrameNode?.data.sourcePath : undefined,
        referenceImagePaths: isReferenceWorkflow ? referenceImagePaths : undefined,
        referenceVideoPaths: isReferenceWorkflow ? referenceVideoPaths : undefined,
        referenceAudioPaths: isReferenceWorkflow ? referenceAudioPaths : undefined,
      })
      if (!result.success || !result.relativePath) {
        throw new Error(result.error || 'ComfyUI 没有返回视频')
      }
      applyGenerationResult(nodeId, project.id, result.relativePath)
    } catch (error) {
      patchNodeData(nodeId, {
        generationStatus: 'error',
        generationError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const upscaleVideoNode = async (nodeId: string) => {
    const project = useAppStore.getState().currentProject
    const current = nodesRef.current.find((node) => node.id === nodeId)
    if (!project || !current || current.data.kind !== 'upscale') return
    const inputCandidates = edgesRef.current
      .filter((edge) => edge.target === nodeId)
      .map((edge) => nodesRef.current.find((node) => node.id === edge.source))
      .filter((source): source is StoryNode => (
        !!source &&
        (source.data.kind === 'video' || source.data.kind === 'upscale') &&
        !!source.data.sourcePath
      ))
    const inputNode = inputCandidates.find((source) => source.id === current.data.inputNodeId)
      ?? inputCandidates[0]
    if (!inputNode?.data.sourcePath) {
      patchNodeData(nodeId, { generationStatus: 'error', generationError: '请连接一个已有视频节点作为输入' })
      return
    }
    patchNodeData(nodeId, { generationStatus: 'generating', generationError: '' })
    try {
      const result = await window.electronAPI.upscaleVideo({
        projectId: project.id,
        nodeId,
        sourceVideoPath: inputNode.data.sourcePath,
        scale: UPSCALE_SCALES.find((value) => value === current.data.scale) ?? 2,
        quality: UPSCALE_QUALITIES.find((value) => value === current.data.quality) ?? 'ULTRA',
      })
      if (!result.success || !result.relativePath) {
        throw new Error(result.error || 'ComfyUI 没有返回放大后的视频')
      }
      applyGenerationResult(nodeId, project.id, result.relativePath)
    } catch (error) {
      patchNodeData(nodeId, {
        generationStatus: 'error',
        generationError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  useEffect(() => {
    const unregisterImage = registerNodeKindAction('image', 'generate', (nodeId) => generateImageNode(nodeId))
    const unregisterVideo = registerNodeKindAction('video', 'generate', (nodeId) => generateVideoNode(nodeId))
    const unregisterUpscale = registerNodeKindAction('upscale', 'generate', (nodeId) => upscaleVideoNode(nodeId))
    return () => {
      unregisterImage()
      unregisterVideo()
      unregisterUpscale()
    }
    // Handlers only touch stable refs/setters, so registering once is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!currentProject) return
    return window.electronAPI.onCanvasCommand((command: CanvasCommandRequest) => {
      if (command.projectId !== currentProject.id) return
      const respond = (response: Omit<CanvasCommandResponse, 'requestId'>) => {
        window.electronAPI.sendCanvasCommandResult({ requestId: command.requestId, ...response })
      }
      try {
        const payload = (command.payload && typeof command.payload === 'object'
          ? command.payload
          : {}) as Record<string, unknown>
        const expectedRevision = payload.expectedRevision
        if (typeof expectedRevision === 'number' && expectedRevision !== revisionRef.current) {
          throw new Error(`画布版本已变化：期望 ${expectedRevision}，当前 ${revisionRef.current}`)
        }

        if (command.action === 'get-state') {
          const selectionOnly = payload.selectionOnly === true
          const visibleNodes = selectionOnly
            ? nodesRef.current.filter((node) => node.selected)
            : nodesRef.current
          const visibleIds = new Set(visibleNodes.map((node) => node.id))
          const visibleEdges = selectionOnly
            ? edgesRef.current.filter((edge) => visibleIds.has(edge.source) || visibleIds.has(edge.target))
            : edgesRef.current
          respond({
            success: true,
            revision: revisionRef.current,
            result: {
              revision: revisionRef.current,
              nodeCount: visibleNodes.length,
              edgeCount: visibleEdges.length,
              nodes: visibleNodes.map((node) => ({
                ...node,
                data: {
                  ...node.data,
                  preview: typeof node.data.preview === 'string' && node.data.preview.startsWith('data:')
                    ? '[inline preview omitted]'
                    : node.data.preview,
                },
              })),
              edges: visibleEdges,
              viewport: getViewport(),
            },
          })
          return
        }

        if (command.action === 'get-capabilities') {
          // Dynamic options (e.g. the live ComfyUI workflow list) are resolved
          // asynchronously, so this branch responds from an async task.
          void (async () => {
            try {
              const nodeKinds = []
              for (const descriptor of getNodeCapabilities()) {
                const fields = []
                for (const field of descriptor.fields) {
                  if (!field.dynamicOptions) {
                    fields.push(field)
                    continue
                  }
                  const options = await resolveDynamicOptions(field).catch(() => [])
                  const { dynamicOptions: _, ...rest } = field
                  fields.push({ ...rest, options })
                }
                nodeKinds.push({ ...descriptor, fields })
              }
              respond({
                success: true,
                revision: revisionRef.current,
                result: { revision: revisionRef.current, nodeKinds },
              })
            } catch (error) {
              respond({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          })()
          return
        }

        if (command.action === 'invoke-action') {
          const rawIds = Array.isArray(payload.nodeIds) ? payload.nodeIds : [payload.nodeId]
          const nodeIds = rawIds
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          if (nodeIds.length === 0) throw new Error('请提供 nodeId 或 nodeIds')
          const actionId = String(payload.action ?? '')
          const params = payload.params && typeof payload.params === 'object'
            ? payload.params as Record<string, unknown>
            : undefined
          const results = nodeIds.map((nodeId) => {
            const node = nodesRef.current.find((item) => item.id === nodeId)
            if (!node) return { nodeId, accepted: false as const, error: `找不到节点：${nodeId}` }
            const actionDescriptor = getNodeCapabilities(node.data.kind)
              ?.actions.find((item) => item.id === actionId)
            if (!actionDescriptor) {
              return { nodeId, accepted: false as const, error: `该节点类型（${node.data.kind}）不支持动作：${actionId || '(未提供 action)'}` }
            }
            // Prefer a live per-node handler; fall back to the kind-level
            // handler, which works even when the node component is unmounted.
            const nodeHandler = getNodeAction(nodeId, actionId)
            const kindHandler = getNodeKindAction(node.data.kind, actionId)
            if (!nodeHandler && !kindHandler) {
              return { nodeId, accepted: false as const, error: '动作处理器尚未注册（画布未就绪）' }
            }
            // Fire-and-forget: async action progress and errors surface through
            // the node's data (statusField), which the caller polls via get-state.
            void Promise.resolve(
              nodeHandler ? nodeHandler(params) : kindHandler!(nodeId, params),
            ).catch(() => undefined)
            return {
              nodeId,
              accepted: true as const,
              async: actionDescriptor.async === true,
              statusField: actionDescriptor.statusField,
            }
          })
          const acceptedCount = results.filter((item) => item.accepted).length
          respond({
            success: acceptedCount > 0,
            revision: revisionRef.current,
            result: {
              action: actionId,
              accepted: acceptedCount,
              total: nodeIds.length,
              results,
            },
          })
          return
        }

        if (command.action === 'create-nodes') {
          const inputs = Array.isArray(payload.nodes) ? payload.nodes as Record<string, unknown>[] : []
          if (inputs.length === 0) throw new Error('至少需要创建一个节点')
          const occupied = new Set(nodesRef.current.map((node) => node.id))
          const created = inputs.map((input, index) => {
            const kind = input.kind as StoryNodeKind
            if (!['shot', 'text', 'image', 'video', 'audio', 'upscale'].includes(kind)) throw new Error(`无效节点类型：${String(kind)}`)
            const id = typeof input.id === 'string' && input.id.trim()
              ? input.id.trim()
              : `${kind}-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`
            if (occupied.has(id)) throw new Error(`节点 ID 已存在：${id}`)
            occupied.add(id)
            const position = input.position && typeof input.position === 'object'
              ? input.position as { x: number; y: number }
              : { x: 120 + (nodesRef.current.length + index) * 45, y: 100 + index * 280 }
            const base = makeNode(kind, nodesRef.current.length + index + 1, position)
            const data: StoryNodeData = {
              ...base.data,
              ...pickMutableNodeData(kind, input),
              kind,
              title: typeof input.title === 'string' ? input.title : base.data.title,
            }
            if (
              (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'upscale') &&
              data.sourcePath && !data.preview
            ) {
              data.preview = `workspace://${currentProject.id}/${data.sourcePath.split('/').map(encodeURIComponent).join('/')}`
            }
            return {
              ...base,
              id,
              data,
            }
          })
          nodesRef.current = [...nodesRef.current, ...created]
          setNodes(nodesRef.current)
          revisionRef.current += 1
          respond({ success: true, revision: revisionRef.current, result: { createdNodeIds: created.map((node) => node.id), revision: revisionRef.current } })
          return
        }

        if (command.action === 'update-nodes') {
          const updates = Array.isArray(payload.updates) ? payload.updates as Record<string, unknown>[] : []
          const ids = new Set(updates.map((update) => String(update.id)))
          const missing = [...ids].filter((id) => !nodesRef.current.some((node) => node.id === id))
          if (missing.length > 0) throw new Error(`找不到节点：${missing.join(', ')}`)
          nodesRef.current = nodesRef.current.map((node) => {
            const update = updates.find((item) => item.id === node.id)
            if (!update) return node
            const position = update.position && typeof update.position === 'object'
              ? update.position as { x: number; y: number }
              : node.position
            const data = { ...node.data, ...pickMutableNodeData(node.data.kind, update), kind: node.data.kind }
            if (
              (node.data.kind === 'image' || node.data.kind === 'video' || node.data.kind === 'audio' || node.data.kind === 'upscale') &&
              typeof update.sourcePath === 'string' && !('preview' in update)
            ) {
              data.preview = update.sourcePath
                ? `workspace://${currentProject.id}/${update.sourcePath.split('/').map(encodeURIComponent).join('/')}`
                : undefined
            }
            return { ...node, position, data }
          })
          setNodes(nodesRef.current)
          revisionRef.current += 1
          respond({ success: true, revision: revisionRef.current, result: { updatedNodeIds: [...ids], revision: revisionRef.current } })
          return
        }

        if (command.action === 'delete-nodes') {
          const ids = new Set(Array.isArray(payload.nodeIds) ? payload.nodeIds.map(String) : [])
          const deletedNodeIds = nodesRef.current.filter((node) => ids.has(node.id)).map((node) => node.id)
          nodesRef.current = nodesRef.current.filter((node) => !ids.has(node.id))
          edgesRef.current = edgesRef.current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))
          setNodes(nodesRef.current)
          setEdges(edgesRef.current)
          for (const nodeId of deletedNodeIds) {
            useAppStore.getState().removeCanvasNodeReference(nodeId)
          }
          revisionRef.current += 1
          respond({ success: true, revision: revisionRef.current, result: { deletedNodeIds, revision: revisionRef.current } })
          return
        }

        if (command.action === 'connect-nodes') {
          const connections = Array.isArray(payload.connections) ? payload.connections as { source: string; target: string }[] : []
          const nodeIds = new Set(nodesRef.current.map((node) => node.id))
          const createdEdgeIds: string[] = []
          for (const connection of connections) {
            if (!nodeIds.has(connection.source) || !nodeIds.has(connection.target)) {
              throw new Error(`连接包含不存在的节点：${connection.source} → ${connection.target}`)
            }
            if (connection.source === connection.target) throw new Error('不能连接节点自身')
            if (edgesRef.current.some((edge) => edge.source === connection.source && edge.target === connection.target)) continue
            const id = `edge-${connection.source}-${connection.target}-${Date.now().toString(36)}`
            edgesRef.current = [...edgesRef.current, makeLinkedEdge(id, connection.source, connection.target)]
            createdEdgeIds.push(id)
          }
          setEdges(edgesRef.current)
          revisionRef.current += 1
          respond({ success: true, revision: revisionRef.current, result: { createdEdgeIds, revision: revisionRef.current } })
          return
        }

        if (command.action === 'disconnect-edges') {
          const ids = new Set(Array.isArray(payload.edgeIds) ? payload.edgeIds.map(String) : [])
          const deletedEdgeIds = edgesRef.current.filter((edge) => ids.has(edge.id)).map((edge) => edge.id)
          edgesRef.current = edgesRef.current.filter((edge) => !ids.has(edge.id))
          setEdges(edgesRef.current)
          revisionRef.current += 1
          respond({ success: true, revision: revisionRef.current, result: { deletedEdgeIds, revision: revisionRef.current } })
          return
        }

        throw new Error(`不支持的画布命令：${command.action}`)
      } catch (error) {
        respond({ success: false, revision: revisionRef.current, error: error instanceof Error ? error.message : String(error) })
      }
    })
  }, [currentProject, getViewport, setEdges, setNodes])

  useEffect(() => {
    if (!folderPath || loadedFolderRef.current === folderPath) return
    loadedFolderRef.current = folderPath
    readyToSaveRef.current = false
    nodesRef.current = []
    edgesRef.current = []
    revisionRef.current = 0
    setNodes([])
    setEdges([])
    setDismissedArtifacts({})

    void window.electronAPI.loadCanvasSnapshot(folderPath)
      .then((snapshot: unknown) => {
        if (isFlowSnapshot(snapshot)) {
          const migrated = migrateLegacySnapshot(snapshot)
          const restoredNodes = migrated.nodes.map<StoryNode>((node) => {
            const currentNode = simplifyShotNode(node)
            return currentNode.data.generationStatus === 'generating'
              ? { ...currentNode, data: { ...currentNode.data, generationStatus: 'idle' as const, generationError: '' } }
              : currentNode
          })
          const restoredEdges = migrated.edges.map((edge) => ({ ...edge, type: 'default' as const }))
          nodesRef.current = restoredNodes
          edgesRef.current = restoredEdges
          setNodes(restoredNodes)
          setEdges(restoredEdges)
          setDismissedArtifacts(migrated.dismissedArtifacts ?? {})
          void setViewport(migrated.viewport ?? DEFAULT_VIEWPORT)
        } else {
          void setViewport(DEFAULT_VIEWPORT)
        }
      })
      .catch((error: unknown) => console.error('Failed to load canvas snapshot:', error))
      .finally(() => { readyToSaveRef.current = true })
  }, [folderPath, setEdges, setNodes, setViewport])

  useEffect(() => {
    if (!folderPath || !readyToSaveRef.current) return
    clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      const snapshot: FlowSnapshot = {
        type: 'react-flow',
        version: 2,
        nodes,
        edges,
        viewport: getViewport(),
        dismissedArtifacts,
      }
      window.electronAPI.saveCanvasSnapshot(folderPath, snapshot)
        .catch((error: unknown) => console.error('Failed to save canvas snapshot:', error))
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(saveTimeoutRef.current)
  }, [dismissedArtifacts, edges, folderPath, getViewport, nodes])

  useEffect(() => {
    if (!readyToSaveRef.current || artifacts.length === 0) return
    const additions: StoryNode[] = []
    const linkedEdges: StoryEdge[] = []

    for (const artifact of artifacts) {
      if ((dismissedArtifacts[artifact.id] ?? -1) >= artifact.timestamp) continue
      const matchingArtifactNodes = nodes.filter((node) => node.data.artifactId === artifact.id)
      const existingArtifactNode = matchingArtifactNodes[0]
      const sequence = nodes.length + additions.length + 1

      if (artifact.type === 'storyboard') {
        if (existingArtifactNode) continue
        const shots = parseStoryboard(artifact.content)
        const originY = 80 + Math.floor(sequence / 2) * 80
        shots.forEach((shot, shotOffset) => {
          const shotId = `${artifact.id}-shot-${shot.index}`
          const imageId = `${shotId}-image`
          const videoId = `${shotId}-video`
          const shotNode: StoryNode = {
            ...makeNode('shot', shot.index, { x: 100, y: originY + shotOffset * 330 }),
            id: shotId,
            data: {
              kind: 'shot',
              title: `镜头 ${shot.index}`,
              shotNumber: shot.index,
              scene: shot.scene,
              artifactId: artifact.id,
            },
          }
          const existingImage = nodes.find((node) => node.id === imageId)
          const existingVideo = nodes.find((node) => node.id === videoId)
          const imageNode: StoryNode = {
            ...makeNode('image', shot.index, { x: 560, y: originY + shotOffset * 330 }),
            id: imageId,
            data: {
              kind: 'image',
              title: `镜头 ${shot.index} · 图片`,
              prompt: shot.textToImagePrompt || shot.scene,
              aspectRatio: '16:9',
              sourcePath: shot.imageSource,
              sourceHistory: shot.imageSourceHistory,
              preview: shot.imageSource && currentProject
                ? `workspace://${currentProject.id}/${shot.imageSource.split('/').map(encodeURIComponent).join('/')}`
                : undefined,
            },
          }
          const videoNode: StoryNode = {
            ...makeNode('video', shot.index, { x: 1080, y: originY + shotOffset * 330 }),
            id: videoId,
            data: {
              kind: 'video',
              title: `镜头 ${shot.index} · 视频`,
              prompt: shot.imageToVideoPrompt || shot.camera || '',
              aspectRatio: '16:9',
              duration: ([5, 10, 15] as const).includes(shot.duration as 5 | 10 | 15) ? shot.duration : 5,
              sourcePath: shot.videoSource,
              sourceHistory: shot.videoSourceHistory,
              preview: shot.videoSource && currentProject
                ? `workspace://${currentProject.id}/${shot.videoSource.split('/').map(encodeURIComponent).join('/')}`
                : undefined,
            },
          }
          additions.push(shotNode)
          if (!existingImage) additions.push(imageNode)
          if (!existingVideo) additions.push(videoNode)
          linkedEdges.push(
            makeLinkedEdge(
              `${shotId}-to-image`,
              shotId,
              imageNode.id,
            ),
            makeLinkedEdge(
              `${shotId}-image-to-video`,
              imageNode.id,
              videoNode.id,
            ),
          )
        })
        continue
      }

      if (existingArtifactNode) continue

      const kind: StoryNodeKind = artifact.type === 'image' ? 'image' : 'text'
      additions.push({
        ...makeNode(kind, sequence, {
          x: 100 + (sequence % 3) * 470,
          y: 100 + Math.floor(sequence / 3) * 380,
        }),
        data: {
          kind,
          title: artifact.title,
          prompt: kind === 'text' ? artifact.content.slice(0, 500) : '',
          preview: kind === 'image' ? artifact.content : undefined,
          artifactId: artifact.id,
          sourcePath: kind === 'image' ? artifact.path : undefined,
          aspectRatio: kind === 'image' ? '16:9' : undefined,
        },
      })
    }

    if (additions.length > 0) {
      setNodes((current) => [...current, ...additions])
    }
    if (linkedEdges.length > 0) {
      setEdges((current) => {
        const existingIds = new Set(current.map((edge) => edge.id))
        const freshEdges = linkedEdges.filter((edge) => !existingIds.has(edge.id))
        return freshEdges.length > 0 ? [...current, ...freshEdges] : current
      })
    }
  }, [artifacts, dismissedArtifacts, nodes, setEdges, setNodes])

  const handleNodesChange = useCallback((changes: NodeChange<StoryNode>[]) => {
    const removedIds = new Set(
      changes.filter((change) => change.type === 'remove').map((change) => change.id),
    )
    if (removedIds.size === 0) {
      onNodesChange(changes)
      return
    }

    for (const nodeId of removedIds) {
      useAppStore.getState().removeCanvasNodeReference(nodeId)
    }

    const removedArtifacts = nodes
      .filter((node) => removedIds.has(node.id) && node.data.artifactId)
      .map((node) => node.data.artifactId!)
    if (removedArtifacts.length > 0) {
      setDismissedArtifacts((current) => {
        const next = { ...current }
        for (const artifactId of removedArtifacts) {
          const artifact = artifacts.find((item) => item.id === artifactId)
          next[artifactId] = artifact?.timestamp ?? Date.now()
        }
        return next
      })
    }

    onNodesChange(changes)
    setEdges((current) => current.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)))
  }, [artifacts, nodes, onNodesChange, setEdges])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    setEdges((current) => {
      if (current.some((edge) => edge.source === connection.source && edge.target === connection.target)) return current
      return addEdge(makeLinkedEdge(
        `edge-${connection.source}-${connection.target}-${Date.now().toString(36)}`,
        connection.source,
        connection.target,
        connection.sourceHandle ?? undefined,
      ), current) as StoryEdge[]
    })
  }, [setEdges])

  const addNode = useCallback((kind: StoryNodeKind) => {
    const center = screenToFlowPosition({ x: window.innerWidth * 0.38, y: window.innerHeight * 0.48 })
    setNodes((current) => [...current, makeNode(kind, current.length + 1, center)])
  }, [screenToFlowPosition, setNodes])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      if (event.key.toLowerCase() === 'v') setInteractionMode('select')
      if (event.key.toLowerCase() === 'h') setInteractionMode('pan')
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  const toolbar = useMemo(() => (
    <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-white/10 bg-[#19191e]/95 p-1.5 shadow-[0_12px_35px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <button
        onClick={() => setInteractionMode('select')}
        className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${interactionMode === 'select' ? 'bg-[#e8e6df] text-[#17171b]' : 'text-white/50 hover:bg-white/[0.08] hover:text-white'}`}
        title="选择工具：拖动框选多个节点 (V)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="m5 3 13 8-6 2-3 6L5 3Z" />
        </svg>
      </button>
      <button
        onClick={() => setInteractionMode('pan')}
        className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${interactionMode === 'pan' ? 'bg-[#e8e6df] text-[#17171b]' : 'text-white/50 hover:bg-white/[0.08] hover:text-white'}`}
        title="抓手工具：拖动画布 (H)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M8 11V6.5a1.5 1.5 0 0 1 3 0V10m0-4.5a1.5 1.5 0 0 1 3 0V10m0-3.5a1.5 1.5 0 0 1 3 0V11m0-2.5a1.5 1.5 0 0 1 3 0v5c0 4.1-2.8 7.5-7 7.5h-1.2a6 6 0 0 1-4.5-2L3.5 15a1.7 1.7 0 0 1 2.4-2.4L8 14.5V11Z" />
        </svg>
      </button>
      <div className="mx-1 h-5 w-px bg-white/10" />
      {(['shot', 'text', 'image', 'video', 'audio', 'upscale'] as StoryNodeKind[]).map((kind) => (
        <button
          key={kind}
          onClick={() => addNode(kind)}
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] text-white/60 transition hover:bg-white/[0.08] hover:text-white"
          title={`添加${KIND_LABELS[kind]}节点`}
        >
          {nodeIcon(kind)}
          {KIND_LABELS[kind]}
        </button>
      ))}
      <div className="mx-1 h-5 w-px bg-white/10" />
      <button onClick={() => void fitView({ padding: 0.2, duration: 350 })} className="rounded-xl px-3 py-2 text-[11px] text-white/45 transition hover:bg-white/[0.08] hover:text-white">
        适应画布
      </button>
    </div>
  ), [addNode, fitView, interactionMode])

  return (
    <div className="relative h-full w-full bg-[#0a0a0f]">
      <ReactFlow<StoryNode, StoryEdge>
        className={interactionMode === 'select' ? 'canvas-select-mode' : 'canvas-pan-mode'}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        selectionOnDrag={interactionMode === 'select'}
        selectionMode={SelectionMode.Partial}
        panOnDrag={interactionMode === 'pan' ? true : [1, 2]}
        nodesDraggable={interactionMode === 'select'}
        defaultViewport={DEFAULT_VIEWPORT}
        minZoom={0.2}
        maxZoom={2}
        connectionLineType={ConnectionLineType.Bezier}
        connectionLineStyle={{ stroke: '#e8c766', strokeWidth: 1.5 }}
        deleteKeyCode={['Backspace', 'Delete']}
        colorMode="dark"
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background color="rgba(255,255,255,0.16)" gap={18} size={1} variant={BackgroundVariant.Dots} />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(node) => node.data.kind === 'image' ? '#8b7355' : node.data.kind === 'video' ? '#566b7f' : node.data.kind === 'audio' ? '#7f6656' : node.data.kind === 'upscale' ? '#4f7f74' : '#67636e'}
          maskColor="rgba(5,5,8,0.72)"
        />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="mb-20 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d4af37]/20 bg-[#d4af37]/[0.06] text-2xl text-[#e8c766]">✦</div>
            <p className="mt-4 text-sm tracking-[0.2em] text-white/65">创建你的第一个分镜节点</p>
            <p className="mt-2 text-xs text-white/30">从下方添加镜头、文本、图片、视频或音频节点</p>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">{toolbar}</div>
    </div>
  )
}

export function CanvasArea() {
  return (
    <ReactFlowProvider>
      <CanvasFlow />
    </ReactFlowProvider>
  )
}
