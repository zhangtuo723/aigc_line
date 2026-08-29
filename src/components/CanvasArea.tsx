import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
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
import { listCachedComfyWorkflows } from '../shared/comfy-workflows'
import type {
  CanvasCommandRequest,
  CanvasCommandResponse,
  CanvasNodeData,
  CanvasNodeKind,
  ComfyWorkflowInfo,
  ProjectMediaAsset,
  ProjectMediaKind,
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
import { buildCanvasNodeDetail, buildCanvasOverview } from '../shared/canvas-read-model'
import { connectedDirectorImageNodeIds } from '../shared/director-references'
import { orderImageReferences } from '../shared/image-references'
import type { DirectorActorModelId, DirectorAspectRatio, DirectorBodyType, DirectorElementKind, DirectorPoseId, DirectorProject, DirectorShot, DirectorVec3 } from '../shared/director.types'
import { directorProjectSchema, directorSceneDraftSchema } from '../shared/director-schema'
import {
  addDirectorElement,
  applyDirectorSceneDraft,
  createDefaultDirectorProject,
  createDirectorElement,
  createDirectorShot,
  directorId,
  directorMaxFrame,
  normalizeDirectorProject,
  patchDirectorShot,
  upsertDirectorActorTrack,
  upsertDirectorCameraKeyframe,
  validateDirectorProject,
} from '../features/director/director-model'
import './canvas-capabilities'

const DirectorStageDialog = lazy(() => import('../features/director/DirectorStageDialog').then((module) => ({
  default: module.DirectorStageDialog,
})))
const ImageEditorDialog = lazy(() => import('../features/image-editor/ImageEditorDialog').then((module) => ({
  default: module.ImageEditorDialog,
})))

type StoryNodeKind = CanvasNodeKind
type InteractionMode = 'select' | 'pan'

type StoryNodeData = CanvasNodeData

type StoryNode = Node<StoryNodeData, 'storyNode'>
type StoryEdge = Edge<Record<string, never>, 'default'>

interface FlowSnapshot {
  type: 'react-flow'
  version: 1 | 2 | 3 | 4
  nodes: StoryNode[]
  edges: StoryEdge[]
  viewport: Viewport
  dismissedArtifacts?: Record<string, number>
}

const isDirectorVec3 = (value: unknown): value is DirectorVec3 => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return ['x', 'y', 'z'].every((key) => typeof record[key] === 'number' && Number.isFinite(record[key]))
}

const requireDirectorParam = (params: Record<string, unknown>, key: string): unknown => {
  if (!(key in params)) throw new Error(`缺少参数：${key}`)
  return params[key]
}

function applyDirectorAtomicAction(
  project: DirectorProject,
  actionId: string,
  params: Record<string, unknown>,
): DirectorProject {
  if (actionId === 'add-element') {
    const kind = requireDirectorParam(params, 'kind')
    const kinds: DirectorElementKind[] = ['actor', 'crowd', 'box', 'sphere', 'cylinder', 'wall', 'floor', 'platform', 'stairs', 'ramp', 'cone', 'capsule']
    if (typeof kind !== 'string' || !kinds.includes(kind as DirectorElementKind)) throw new Error('kind 无效')
    let element = createDirectorElement(kind as DirectorElementKind, project.elements.length)
    if (typeof params.name === 'string') element = { ...element, name: params.name }
    if (isDirectorVec3(params.position)) element = { ...element, transform: { ...element.transform, position: params.position } }
    if (kind === 'actor' || kind === 'crowd') {
      if (['director-rig-v1', 'lightweight-v1'].includes(String(params.actorModelId))) element = { ...element, actorModelId: params.actorModelId as DirectorActorModelId }
      if (['standard', 'heavy', 'slim', 'short', 'tall'].includes(String(params.bodyType))) element = { ...element, bodyType: params.bodyType as DirectorBodyType }
      if (['stand', 'walk', 'sit', 'arms-crossed', 'point', 'kneel', 'hands-on-hips', 'wave', 'hands-up', 'crouch', 'lean', 'look-back'].includes(String(params.poseId))) element = { ...element, poseId: params.poseId as DirectorPoseId }
      if (typeof params.heightM === 'number' && Number.isFinite(params.heightM)) element = { ...element, heightM: Math.max(0.8, Math.min(2.4, params.heightM)) }
    }
    return addDirectorElement(project, element)
  }
  if (actionId === 'add-shot') {
    let shot = createDirectorShot(project.shots.length)
    if (typeof params.name === 'string') shot = { ...shot, name: params.name }
    if (typeof params.durationSec === 'number' && Number.isFinite(params.durationSec) && params.durationSec > 0) shot = { ...shot, durationSec: params.durationSec }
    if (['16:9', '9:16', '4:3', '1:1'].includes(String(params.aspectRatio))) shot = { ...shot, aspectRatio: params.aspectRatio as DirectorAspectRatio }
    return { ...project, shots: [...project.shots, shot], activeShotId: shot.id }
  }
  if (actionId === 'apply-scene-draft') {
    const referenceNodeId = requireDirectorParam(params, 'referenceNodeId')
    if (typeof referenceNodeId !== 'string' || !referenceNodeId.trim()) throw new Error('referenceNodeId 无效')
    const sceneDraft = directorSceneDraftSchema.safeParse(requireDirectorParam(params, 'draft'))
    if (!sceneDraft.success) {
      const issue = sceneDraft.error.issues.slice(0, 5).map((item) => `${item.path.join('.') || 'root'} ${item.message}`).join('；')
      throw new Error(`场景草案不符合约束：${issue}`)
    }
    return applyDirectorSceneDraft(project, referenceNodeId, sceneDraft.data)
  }
  const shotId = requireDirectorParam(params, 'shotId')
  if (typeof shotId !== 'string' || !project.shots.some((shot) => shot.id === shotId)) throw new Error('shotId 无效')
  const shot = project.shots.find((item) => item.id === shotId)!
  if (actionId === 'set-actor-path') {
    const elementId = requireDirectorParam(params, 'elementId')
    const points = requireDirectorParam(params, 'points')
    if (typeof elementId !== 'string' || !project.elements.some((element) => element.id === elementId && element.kind === 'actor')) throw new Error('elementId 必须指向演员')
    if (!Array.isArray(points) || points.length < 2 || !points.every(isDirectorVec3)) throw new Error('points 至少需要两个有效三维坐标')
    const maxFrame = directorMaxFrame(shot, project.fps)
    const startFrame = typeof params.startFrame === 'number' ? Math.floor(params.startFrame) : 0
    const endFrame = typeof params.endFrame === 'number' ? Math.floor(params.endFrame) : maxFrame
    return upsertDirectorActorTrack(project, shotId, {
      id: shot.actorTracks.find((track) => track.elementId === elementId)?.id ?? directorId('actor-track'),
      elementId,
      startFrame,
      endFrame,
      points,
      interpolation: params.interpolation === 'linear' ? 'linear' : 'smooth',
      orientToPath: params.orientToPath !== false,
      motion: params.motion === 'run' ? 'run' : 'walk',
    })
  }
  if (actionId === 'set-camera-constraint') {
    const mode = requireDirectorParam(params, 'mode')
    if (!['free', 'look-at', 'follow'].includes(String(mode))) throw new Error('mode 无效')
    const targetElementId = typeof params.targetElementId === 'string' ? params.targetElementId : undefined
    if (mode !== 'free' && !project.elements.some((element) => element.id === targetElementId && element.kind === 'actor')) throw new Error('注视/跟随模式必须提供有效演员 targetElementId')
    return patchDirectorShot(project, shotId, {
      cameraConstraint: {
        mode: mode as 'free' | 'look-at' | 'follow',
        targetElementId: mode === 'free' ? undefined : targetElementId,
        targetOffset: isDirectorVec3(params.targetOffset) ? params.targetOffset : shot.cameraConstraint.targetOffset,
        followOffset: isDirectorVec3(params.followOffset) ? params.followOffset : shot.cameraConstraint.followOffset,
      },
    })
  }
  if (actionId === 'set-camera-keyframe') {
    const frame = requireDirectorParam(params, 'frame')
    const position = requireDirectorParam(params, 'position')
    const target = requireDirectorParam(params, 'target')
    if (typeof frame !== 'number' || !Number.isFinite(frame) || !isDirectorVec3(position) || !isDirectorVec3(target)) throw new Error('frame/position/target 无效')
    const interpolation = ['hold', 'linear', 'smooth', 'ease-in', 'ease-out'].includes(String(params.interpolation))
      ? params.interpolation as 'hold' | 'linear' | 'smooth' | 'ease-in' | 'ease-out'
      : 'smooth'
    return upsertDirectorCameraKeyframe(project, shotId, frame, {
      position,
      target,
      fov: typeof params.fov === 'number' && Number.isFinite(params.fov) ? params.fov : shot.fov,
    }, interpolation)
  }
  throw new Error(`未知导演台动作：${actionId}`)
}

const SAVE_DEBOUNCE_MS = 700
const DEFAULT_VIEWPORT: Viewport = { x: 80, y: 70, zoom: 0.86 }
const PROJECT_ASSET_DRAG_TYPE = 'application/x-aigc-project-media'
const KIND_LABELS: Record<StoryNodeKind, string> = {
  image: '图片',
  'image-editor': '画板',
  video: '视频',
  audio: '音频',
  upscale: '视频放大',
  director: '3D 导演台',
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
    if (kind === 'director' && key === 'directorProject') {
      const parsed = directorProjectSchema.safeParse(fieldValue)
      if (!parsed.success) throw new Error('字段 directorProject 无效：工程结构不完整或字段类型错误')
      const issues = validateDirectorProject(parsed.data as DirectorProject)
      if (issues.length > 0) throw new Error(`字段 directorProject 无效：${issues.join('；')}`)
    }
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

/** Remove retired shot/text nodes and upgrade legacy storyboard tables to image → video chains. */
const migrateLegacySnapshot = (snapshot: FlowSnapshot): FlowSnapshot => {
  const legacyBoards = snapshot.nodes.filter((node) => (node.data.kind as string) === 'storyboard')
  const retiredShots = snapshot.nodes.filter((node) => (node.data.kind as string) === 'shot')
  const retiredTexts = snapshot.nodes.filter((node) => (node.data.kind as string) === 'text')
  const retiredNodes = [...retiredShots, ...retiredTexts]
  const removedIds = new Set([...legacyBoards, ...retiredNodes].map((node) => node.id))
  const nodes = snapshot.nodes.filter((node) => !removedIds.has(node.id)).map((node) => (
    node.data.kind === 'director'
      ? {
          ...node,
          data: {
            ...node.data,
            directorProject: normalizeDirectorProject(node.data.directorProject, node.data.title),
          },
        }
      : node
  ))
  const edges = snapshot.edges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target))

  for (const retired of retiredNodes) {
    const legacyData = retired.data as Record<string, unknown>
    const legacyPrompt = (retired.data.kind as string) === 'shot' ? legacyData.scene : legacyData.prompt
    const incoming = snapshot.edges.filter((edge) => edge.target === retired.id && !removedIds.has(edge.source))
    const outgoing = snapshot.edges.filter((edge) => edge.source === retired.id && !removedIds.has(edge.target))
    if (typeof legacyPrompt === 'string' && legacyPrompt.trim()) {
      for (const edge of outgoing) {
        const target = nodes.find((node) => node.id === edge.target)
        if (target && (target.data.kind === 'image' || target.data.kind === 'video') && !target.data.prompt) {
          target.data = { ...target.data, prompt: legacyPrompt }
        }
      }
    }
    for (const source of incoming) {
      for (const target of outgoing) {
        if (source.source === target.target || edges.some((edge) => edge.source === source.source && edge.target === target.target)) continue
        edges.push(makeLinkedEdge(`edge-${source.source}-${target.target}-migrated`, source.source, target.target))
      }
    }
  }

  for (const board of legacyBoards) {
    const shots = Array.isArray((board.data as Record<string, unknown>).shots)
      ? (board.data as Record<string, unknown>).shots as StoryboardShot[]
      : []
    shots.forEach((shot, offset) => {
      const imageId = `${board.id}-shot-${shot.index}-image`
      const videoId = `${board.id}-shot-${shot.index}-video`
      let image = nodes.find((node) => node.id === imageId)
      if (!image) {
        image = makeNode('image', shot.index, { x: board.position.x, y: board.position.y + offset * 330 })
        image.id = imageId
        image.data.title = `镜头 ${shot.index} · 图片`
        nodes.push(image)
      }
      image.data = {
        ...image.data,
        title: image.data.title || `镜头 ${shot.index} · 图片`,
        prompt: image.data.prompt || shot.textToImagePrompt || shot.scene,
        sourcePath: image.data.sourcePath || shot.imageSource,
        sourceHistory: image.data.sourceHistory || shot.imageSourceHistory,
      }
      let video = nodes.find((node) => node.id === videoId)
      if (!video) {
        video = makeNode('video', shot.index, { x: board.position.x + 520, y: board.position.y + offset * 330 })
        video.id = videoId
        video.data.title = `镜头 ${shot.index} · 视频`
        nodes.push(video)
      }
      video.data = {
        ...video.data,
        title: video.data.title || `镜头 ${shot.index} · 视频`,
        prompt: video.data.prompt || shot.imageToVideoPrompt || shot.camera || shot.scene,
        duration: ([5, 10, 15] as const).includes(shot.duration as 5 | 10 | 15) ? shot.duration : 5,
        sourcePath: video.data.sourcePath || shot.videoSource,
        sourceHistory: video.data.sourceHistory || shot.videoSourceHistory,
      }
      if (!edges.some((edge) => edge.source === imageId && edge.target === videoId)) {
        edges.push(makeLinkedEdge(`edge-${imageId}-${videoId}`, imageId, videoId))
      }
    })
  }
  return { ...snapshot, version: 4, nodes, edges }
}

const nodeIcon = (kind: StoryNodeKind) => {
  if (kind === 'upscale') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </svg>
    )
  }
  if (kind === 'image' || kind === 'image-editor') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
        {kind === 'image-editor'
          ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 16.5V20h3.5L18.8 8.7a2.1 2.1 0 0 0-3-3L4.5 17M13.8 7.7l2.5 2.5M4 4h7M4 8h5" />
          : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="m3 16 5-5 4 4 2-2 7 7M14.5 7.5h.01M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />}
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
  if (kind === 'director') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M4 6.5 12 3l8 3.5v10L12 21l-8-4.5v-10Z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="m4 6.5 8 4 8-4M12 10.5V21M7.5 8.2 16 4.6" />
      </svg>
    )
  }
  return null
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
    : item.kind === 'text-to-image')
  const selectedWorkflow = availableWorkflows.find((item) => item.id === current?.data.workflowId)
    ?? availableWorkflows[0]
  const isGoogleImageWorkflow = kind === 'image' && (selectedWorkflow?.id.startsWith('google-') ?? false)
  const isSeedreamImageWorkflow = kind === 'image' && (selectedWorkflow?.id.startsWith('seedream-') ?? false)
  const isCloudImageWorkflow = isGoogleImageWorkflow || isSeedreamImageWorkflow
  const imageReferenceLimit = isGoogleImageWorkflow ? 14 : isSeedreamImageWorkflow ? 10 : 0
  const isSeedanceWorkflow = selectedWorkflow?.id.startsWith('seedance-') ?? false
  const isReferenceWorkflow = (selectedWorkflow?.id.startsWith('minimax-h3-r2v') ?? false) || isSeedanceWorkflow
  const isFirstLastWorkflow = kind === 'video' && selectedWorkflow?.id === 'minimax-h3-t2v-flf2v'
  const incoming = edges
    .filter((edge) => edge.target === id)
    .map((edge) => ({ edge, source: nodes.find((node) => node.id === edge.source) }))
    .filter((item): item is { edge: StoryEdge; source: StoryNode } => !!item.source)
  const imageCandidates = incoming.filter(({ source }) => source.data.kind === 'image' && source.data.sourcePath)
  const orderedCloudImageNodes = orderImageReferences(
    imageCandidates.map(({ source }) => source),
    current?.data.referenceImageNodeIds,
    imageReferenceLimit,
  )
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

  const moveCloudImageReference = (nodeId: string, delta: -1 | 1) => {
    const ids = orderedCloudImageNodes.map((node) => node.id)
    const from = ids.indexOf(nodeId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    setNodes((list) => list.map((node) => node.id === id
      ? { ...node, data: { ...node.data, referenceImageNodeIds: ids } }
      : node))
  }

  useEffect(() => {
    let active = true
    listCachedComfyWorkflows()
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
              className={`flex w-[340px] max-w-full items-center justify-between gap-2 rounded-full border px-3 py-1 transition ${workflowMenuOpen ? 'border-[#d4af37]/45 bg-[#d4af37]/10 text-[#f0d98c]' : 'border-white/[0.06] bg-white/[0.05] text-white/48 hover:text-white/75'}`}
              title={kind === 'image' ? '选择图片生成模型' : '选择视频生成模型'}
            >
              <span className="min-w-0 truncate">
                {selectedWorkflow?.name ?? (kind === 'video' ? '视频工作流待配置' : '加载工作流…')}
              </span>
              <span className="shrink-0 text-[8px]">▼</span>
            </button>
            {workflowMenuOpen && (
              <div className="absolute right-0 top-full z-[110] mt-1.5 w-[380px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-white/[0.12] bg-[#242429] p-1 shadow-[0_14px_36px_rgba(0,0,0,0.7)]">
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
                      {workflow.id.startsWith('google-') ? 'Google · 多图' : workflow.id.startsWith('seedream-') ? '方舟 · 多图' : workflow.id.startsWith('seedance-') ? '方舟 · 全模态' : workflow.id.startsWith('minimax-h3-r2v') ? (workflow.id.endsWith('-turbo') ? '全模态 · 加速' : '全模态') : workflow.kind === 'image-to-video' ? '视频' : workflow.kind === 'image-to-image' ? '图生图' : 'ComfyUI · 文生图'}
                    </span>
                  </button>
                ))}
              </div>
            )}
        </div>
      </div>

      {isCloudImageWorkflow && (
        <div className="mb-2.5 rounded-xl border border-dashed border-white/15 bg-black/15 p-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[9px] text-white/45">
            {nodeIcon('image')}
            <span>多图参考</span>
            <span className="text-white/25">提示词可按“图1、图2…”引用</span>
            <span className="ml-auto text-white/25">{orderedCloudImageNodes.length}/{imageReferenceLimit}</span>
          </div>
          {orderedCloudImageNodes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {orderedCloudImageNodes.map((referenceNode, index) => {
                const edge = incoming.find(({ source }) => source.id === referenceNode.id)?.edge
                return (
                  <div
                    key={referenceNode.id}
                    className="nodrag group/cloud-ref relative flex h-[66px] w-[66px] flex-col items-center justify-center gap-1 rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/[0.07] px-1 pt-1 text-[8px] text-white/65"
                    title={`图${index + 1} · ${referenceNode.data.title}`}
                  >
                    <span className="absolute left-1 top-1 flex h-4 min-w-4 items-center justify-center rounded bg-[#d4af37]/15 px-1 text-[8px] text-[#e8c766]">图{index + 1}</span>
                    {referenceNode.data.preview ? (
                      <img src={referenceNode.data.preview} className="h-8 w-8 rounded object-cover" draggable={false} />
                    ) : nodeIcon('image')}
                    <span className="w-full truncate text-center">{referenceNode.data.title}</span>
                    <div className="absolute bottom-0.5 right-0.5 flex gap-0.5 opacity-0 transition group-hover/cloud-ref:opacity-100">
                      <button
                        onClick={() => moveCloudImageReference(referenceNode.id, -1)}
                        disabled={index === 0}
                        className="flex h-4 w-4 items-center justify-center rounded bg-black/60 text-white/60 hover:text-white disabled:opacity-25"
                        title="向前移动"
                      >‹</button>
                      <button
                        onClick={() => moveCloudImageReference(referenceNode.id, 1)}
                        disabled={index === orderedCloudImageNodes.length - 1}
                        className="flex h-4 w-4 items-center justify-center rounded bg-black/60 text-white/60 hover:text-white disabled:opacity-25"
                        title="向后移动"
                      >›</button>
                      {edge && (
                        <button
                          onClick={() => void deleteElements({ edges: [edge] })}
                          className="flex h-4 w-4 items-center justify-center rounded bg-black/60 text-white/60 hover:text-white"
                          title="移除参考并断开连线"
                        >×</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-2 text-center text-[9px] text-white/25">连接一个或多个已有图片节点即可添加参考图</div>
          )}
          {imageCandidates.length > imageReferenceLimit && (
            <div className="mt-1.5 text-[9px] text-amber-300/65">已连接 {imageCandidates.length} 张，只会发送前 {imageReferenceLimit} 张</div>
          )}
        </div>
      )}

      {kind === 'image' && !isCloudImageWorkflow && imageCandidates.length > 0 && (
        <div className="mb-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-[9px] text-white/35">
          当前 ComfyUI 图片工作流仅支持文生图，已连接图片不会作为生成参考。
        </div>
      )}

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
            ['image', '图片轨', referenceImageNodes, 9, isSeedanceWorkflow ? '图片' : 'Picture'],
            ['video', '视频轨', referenceVideoNodes, 3, isSeedanceWorkflow ? '视频' : 'Video'],
            ['audio', '音频轨', referenceAudioNodes, 3, isSeedanceWorkflow ? '音频' : 'Audio'],
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
                      title={`${isSeedanceWorkflow ? `${token}${index + 1}` : `<${token} ${index + 1}>`} · ${trackNode.data.title}；拖回本轨道末尾可调整顺序`}
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

      {!isFirstLastWorkflow && !isReferenceWorkflow && !isCloudImageWorkflow && incoming.length > 0 && (
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

      <textarea
        value={current?.data.prompt ?? ''}
        onChange={(event) => {
          const prompt = event.target.value
          setNodes((list) => list.map((node) => node.id === id ? { ...node, data: { ...node.data, prompt } } : node))
        }}
        placeholder={kind === 'image'
          ? '描述你想要生成的画面内容，连接其他节点可引用素材…'
          : isReferenceWorkflow
            ? isSeedanceWorkflow
              ? '描述视频并用“图片1”“视频1”“音频1”指定参考素材；无参考素材时也可文生视频…'
              : '描述视频并用 <Picture 1>、<Video 1>、<Audio 1> 指定参考素材…'
            : '描述视频的运动、镜头和节奏，连接图片节点可作为首尾帧参考…'}
        className="min-h-[140px] w-full resize-none border-0 bg-transparent px-1 text-[12px] leading-5 text-[#e8e6df] outline-none placeholder:text-white/25"
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
                {(['16:9', '9:16', '1:1', '4:3'] as const).map((ratio) => (
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
          title={kind === 'image' ? '使用所选模型生成图片' : '使用 MiniMax H3 生成视频'}
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
  const canvasNodes = useNodes<StoryNode>()
  const canvasEdges = useEdges<StoryEdge>()
  const { getNodes, setNodes, setEdges } = useReactFlow<StoryNode, StoryEdge>()
  const currentProject = useAppStore((state) => state.currentProject)
  const addCanvasNodeReference = useAppStore((state) => state.addCanvasNodeReference)
  const sendScopedAgentMessage = useAppStore((state) => state.sendScopedAgentMessage)
  const agentThinkingByProject = useAppStore((state) => state.agentThinkingByProject)
  const isReferencedInChat = useAppStore((state) => state.referencedCanvasNodes.some((ref) => ref.id === id))
  const [audioImporting, setAudioImporting] = useState(false)
  const [videoAudioExtracting, setVideoAudioExtracting] = useState(false)
  const [videoAudioExtractionError, setVideoAudioExtractionError] = useState('')
  const [directorOpen, setDirectorOpen] = useState(false)
  const [imageEditorOpen, setImageEditorOpen] = useState(false)
  const [boardPreviewFailed, setBoardPreviewFailed] = useState(false)
  const isUpscale = data.kind === 'upscale'
  const isDirector = data.kind === 'director'
  const isImageEditor = data.kind === 'image-editor'
  const visualMediaKind = data.kind === 'image' || data.kind === 'video'
    ? data.kind
    : isUpscale ? 'video' : null
  const isAudio = data.kind === 'audio'
  const aspectRatio = data.aspectRatio ?? '16:9'
  const aspectRatioValue = aspectRatio === '1:1' ? '1 / 1' : aspectRatio === '4:3' ? '4 / 3' : aspectRatio === '9:16' ? '9 / 16' : '16 / 9'
  const directorProject = useMemo(
    () => isDirector ? normalizeDirectorProject(data.directorProject, data.title) : undefined,
    [data.directorProject, data.title, isDirector],
  )
  const directorAgentBusy = currentProject ? agentThinkingByProject[currentProject.id] === true : false
  const directorReferenceImages = useMemo(() => {
    const incomingIds = new Set(connectedDirectorImageNodeIds(id, canvasNodes, canvasEdges))
    return canvasNodes
      .filter((node) => incomingIds.has(node.id) && node.data.kind === 'image' && typeof node.data.sourcePath === 'string')
      .map((node) => ({
        nodeId: node.id,
        title: node.data.title,
        sourcePath: node.data.sourcePath!,
        preview: node.data.preview ?? (currentProject ? workspacePreview(currentProject.id, node.data.sourcePath!) : undefined),
      }))
  }, [canvasEdges, canvasNodes, currentProject, id])
  const imageEditorInputs = useMemo(() => {
    const incomingIds = new Set(canvasEdges.filter((edge) => edge.target === id).map((edge) => edge.source))
    return canvasNodes.filter((node) => incomingIds.has(node.id) && node.data.kind === 'image' && typeof node.data.sourcePath === 'string')
  }, [canvasEdges, canvasNodes, id])
  const selectedImageEditorInput = isImageEditor ? imageEditorInputs[0] : undefined
  const imageEditorSources = useMemo(() => currentProject ? imageEditorInputs.map((node) => ({
    nodeId: node.id,
    title: node.data.title,
    url: node.data.preview ?? workspacePreview(currentProject.id, node.data.sourcePath!),
  })) : [], [currentProject, imageEditorInputs])
  const imageEditorPreviewSources = imageEditorSources.slice(0, 9)
  const imageEditorPreviewColumns = imageEditorPreviewSources.length <= 3
    ? Math.max(1, imageEditorPreviewSources.length)
    : imageEditorPreviewSources.length === 4 ? 2 : 3
  const imageEditorPreviewRows = Math.ceil(imageEditorPreviewSources.length / imageEditorPreviewColumns)
  const boardPreview = currentProject && data.boardPreviewPath
    ? `${workspacePreview(currentProject.id, data.boardPreviewPath)}?v=${data.boardPreviewUpdatedAt ?? 0}`
    : undefined
  useEffect(() => setBoardPreviewFailed(false), [boardPreview])

  const exportImageEditorSelection = async ({ pngData, width, height }: { pngData: ArrayBuffer; width: number; height: number }) => {
    if (!currentProject) throw new Error('当前项目不可用')
    const projectId = currentProject.id
    const inputNodeId = selectedImageEditorInput?.id
    const assertContext = () => {
      if (useAppStore.getState().currentProject?.id !== projectId) throw new Error('项目已切换，已取消写回图片编辑结果')
      const editorNode = getNodes().find((node) => node.id === id && node.data.kind === 'image-editor')
      if (!editorNode) throw new Error('画板节点已不存在，已取消写回')
      if (inputNodeId) {
        const input = getNodes().find((node) => node.id === inputNodeId && node.data.kind === 'image')
        if (!input) throw new Error('输入图片节点已不存在，已取消写回')
      }
    }
    assertContext()
    const result = await window.electronAPI.saveImageEdit({ projectId, nodeId: id, inputNodeId, pngData, width, height })
    if (!result.success || !result.relativePath) throw new Error(result.error || '图片编辑结果保存失败')
    assertContext()
    const sourcePath = result.relativePath
    const preview = workspacePreview(projectId, sourcePath)
    const ratio = width / height
    const aspectRatio: StoryNodeData['aspectRatio'] = ratio > 1.55 ? '16:9' : ratio > 1.15 ? '4:3' : ratio < 0.72 ? '9:16' : '1:1'
    const liveNodes = getNodes()
    const editorNode = liveNodes.find((node) => node.id === id)
    if (!editorNode) throw new Error('画板节点已不存在，已取消创建输出节点')
    const outputCount = canvasEdges.filter((edge) => edge.source === id).length
    const imageNode = makeNode('image', liveNodes.length + 1, {
      x: editorNode.position.x + 600 + outputCount * 680,
      y: editorNode.position.y,
    })
    imageNode.data = {
      ...imageNode.data,
      title: `${data.title} · 导出 ${outputCount + 1}`,
      aspectRatio,
      sourcePath,
      preview,
      prompt: '',
      readOnly: true,
    }
    setNodes((nodes) => [...nodes, imageNode])
    setEdges((edges) => [...edges, makeLinkedEdge(`edge-${id}-${imageNode.id}`, id, imageNode.id)])
  }

  const updateBoardState = (boardState: NonNullable<StoryNodeData['boardState']>) => {
    setNodes((nodes) => nodes.map((node) => node.id === id && node.data.kind === 'image-editor'
      ? { ...node, data: { ...node.data, boardState } }
      : node))
  }

  const saveBoardPreview = async ({ pngData, width, height }: { pngData: ArrayBuffer; width: number; height: number }) => {
    if (!currentProject) throw new Error('当前项目不可用')
    const projectId = currentProject.id
    const assertContext = () => {
      if (useAppStore.getState().currentProject?.id !== projectId) throw new Error('项目已切换，已取消保存画板预览')
      if (!getNodes().some((node) => node.id === id && node.data.kind === 'image-editor')) {
        throw new Error('画板节点已不存在，已取消保存预览')
      }
    }
    assertContext()
    const result = await window.electronAPI.saveBoardPreview({ projectId, nodeId: id, pngData, width, height })
    if (!result.success || !result.relativePath) throw new Error(result.error || '画板预览保存失败')
    assertContext()
    setNodes((nodes) => nodes.map((node) => node.id === id && node.data.kind === 'image-editor'
      ? { ...node, data: { ...node.data, boardPreviewPath: result.relativePath, boardPreviewUpdatedAt: Date.now() } }
      : node))
  }

  const updateDirectorProject = (directorProject: DirectorProject) => {
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? { ...node, data: { ...node.data, directorProject } }
      : node))
  }

  const captureDirectorStill = async (
    pngDataUrl: string,
    shot: DirectorShot,
    directorProject: DirectorProject,
  ): Promise<string> => {
    if (!currentProject) throw new Error('当前项目不可用')
    const captureProjectId = currentProject.id
    const assertCaptureContext = () => {
      if (useAppStore.getState().currentProject?.id !== captureProjectId) {
        throw new Error('项目已切换，已取消写回本次导演台截图')
      }
      if (!getNodes().some((node) => node.id === id && node.data.kind === 'director')) {
        throw new Error('导演台节点已不存在，已取消写回截图')
      }
    }
    const pngData = await fetch(pngDataUrl).then((response) => response.arrayBuffer())
    assertCaptureContext()
    const result = await window.electronAPI.saveDirectorStill({
      projectId: captureProjectId,
      nodeId: id,
      shotId: shot.id,
      shotName: shot.name,
      pngData,
    })
    if (!result.success || !result.relativePath) throw new Error(result.error || '导演台截图保存失败')
    assertCaptureContext()

    const relativePath = result.relativePath
    const preview = workspacePreview(captureProjectId, relativePath)
    const liveNodes = getNodes()
    const sourceNode = liveNodes.find((node) => node.id === id)
    if (!sourceNode) throw new Error('导演台节点已不存在，已取消写回截图')
    const outputCount = liveNodes.filter((node) => node.data.kind === 'image' && node.data.sourcePath?.includes('generated/director-stills/')).length
    const imageNode = makeNode('image', liveNodes.length + 1, {
      x: (sourceNode?.position.x ?? 120) + 600 + outputCount * 680,
      y: sourceNode?.position.y ?? 100,
    })
    imageNode.data = {
      ...imageNode.data,
      title: `${shot.name} · 构图参考`,
      aspectRatio: shot.aspectRatio,
      sourcePath: relativePath,
      preview,
      prompt: shot.notes ?? '',
      readOnly: true,
    }
    setNodes((nodes) => [
      ...nodes.map((node) => node.id === id
        ? { ...node, data: { ...node.data, directorProject, sourcePath: relativePath, preview } }
        : node),
      imageNode,
    ])
    setEdges((edges) => [...edges, makeLinkedEdge(`edge-${id}-${imageNode.id}`, id, imageNode.id)])
    return relativePath
  }

  const requestDirectorSceneFromAgent = async (
    reference: { nodeId: string; title: string; sourcePath: string },
    instruction: string,
  ): Promise<void> => {
    if (!currentProject) throw new Error('当前项目不可用')
    const liveReference = getNodes().find((node) => node.id === reference.nodeId && node.data.kind === 'image')
    if (!liveReference || liveReference.data.sourcePath !== reference.sourcePath) throw new Error('参考图片节点已变化，请重新选择')
    const extra = instruction.trim() ? `\n补充要求：${instruction.trim()}` : ''
    await sendScopedAgentMessage(
      `请使用你的多模态能力读取所引用图片节点的 sourcePath，并分析图片内容；然后为所引用的 3D 导演台生成一个可编辑的简易白模空间。先调用 GetCanvasCapabilities 获取 director 的 apply-scene-draft 参数约束，再调用 InvokeNodeAction 将草案应用到导演台。只使用 box、wall、cylinder、sphere、floor、platform、stairs、ramp、cone、capsule，最多 40 个体块；优先用 floor/platform/stairs/ramp 表达地面、高台、楼梯和斜坡。每个体块必须正确声明 ground/elevated，地面、道路、建筑主体、围墙和家具必须 ground，只有屋顶、横梁、招牌等真实离地结构才使用 elevated。注意 position 是底面锚点而不是中心点，scale.y 才是完整高度。保留演员、手工元素、其他参考图生成的元素和全部机位。完成后用 GetCanvasNode 核对导演台工程，并确认全部 ground 元素的 position.y 都为 0。${extra}`,
      [
        { id, title: data.title, kind: 'director' },
        { id: reference.nodeId, title: reference.title, kind: 'image' },
      ],
    )
  }

  const exportDirectorVideo = async (
    webmData: ArrayBuffer,
    shot: DirectorShot,
    directorProject: DirectorProject,
  ): Promise<string> => {
    if (!currentProject) throw new Error('当前项目不可用')
    const exportProjectId = currentProject.id
    const assertExportContext = () => {
      if (useAppStore.getState().currentProject?.id !== exportProjectId) {
        throw new Error('项目已切换，已取消写回本次导演台预演视频')
      }
      if (!getNodes().some((node) => node.id === id && node.data.kind === 'director')) {
        throw new Error('导演台节点已不存在，已取消写回预演视频')
      }
    }
    assertExportContext()
    const result = await window.electronAPI.saveDirectorVideo({
      projectId: exportProjectId,
      nodeId: id,
      shotId: shot.id,
      shotName: shot.name,
      webmData,
    })
    if (!result.success || !result.relativePath) throw new Error(result.error || '导演台预演视频保存失败')
    assertExportContext()

    const relativePath = result.relativePath
    const preview = workspacePreview(exportProjectId, relativePath)
    const liveNodes = getNodes()
    const sourceNode = liveNodes.find((node) => node.id === id)
    if (!sourceNode) throw new Error('导演台节点已不存在，已取消写回预演视频')
    const outputCount = liveNodes.filter((node) => (
      node.data.sourcePath?.includes('generated/director-stills/')
      || node.data.sourcePath?.includes('generated/director-videos/')
    )).length
    const videoNode = makeNode('video', liveNodes.length + 1, {
      x: sourceNode.position.x + 600 + outputCount * 680,
      y: sourceNode.position.y,
    })
    videoNode.data = {
      ...videoNode.data,
      title: `${shot.name} · 预演视频`,
      aspectRatio: shot.aspectRatio,
      duration: shot.durationSec,
      sourcePath: relativePath,
      preview,
      prompt: shot.notes ?? '',
      readOnly: true,
    }
    setNodes((nodes) => [
      ...nodes.map((node) => node.id === id
        ? { ...node, data: { ...node.data, directorProject } }
        : node),
      videoNode,
    ])
    setEdges((edges) => [...edges, makeLinkedEdge(`edge-${id}-${videoNode.id}`, id, videoNode.id)])
    return relativePath
  }

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

  const extractVideoAudio = async () => {
    if (!currentProject || data.kind !== 'video' || !data.sourcePath || videoAudioExtracting) return
    const projectId = currentProject.id
    const sourcePath = data.sourcePath
    const assertContext = () => {
      if (useAppStore.getState().currentProject?.id !== projectId) throw new Error('项目已切换，已取消写回提取的音频')
      const sourceNode = getNodes().find((node) => node.id === id && node.data.kind === 'video')
      if (!sourceNode || sourceNode.data.sourcePath !== sourcePath) throw new Error('源视频节点已变化，已取消写回提取的音频')
    }
    setVideoAudioExtracting(true)
    setVideoAudioExtractionError('')
    try {
      assertContext()
      const result = await window.electronAPI.extractVideoAudio({
        projectId,
        nodeId: id,
        sourceVideoPath: sourcePath,
      })
      if (!result.success || !result.relativePath) throw new Error(result.error || 'ComfyUI 没有返回提取后的音频')
      assertContext()
      const liveNodes = getNodes()
      const sourceNode = liveNodes.find((node) => node.id === id)!
      const outputCount = liveNodes.filter((node) => (
        node.data.kind === 'audio' && canvasEdges.some((edge) => edge.source === id && edge.target === node.id)
      )).length
      const audioNode = makeNode('audio', liveNodes.length + 1, {
        x: sourceNode.position.x + 680,
        y: sourceNode.position.y + 230 + outputCount * 190,
      })
      audioNode.data = {
        ...audioNode.data,
        title: `${data.title} · 提取音频 ${outputCount + 1}`,
        sourcePath: result.relativePath,
        preview: workspacePreview(projectId, result.relativePath),
        readOnly: true,
      }
      setNodes((nodes) => [...nodes, audioNode])
      setEdges((edges) => [...edges, makeLinkedEdge(`edge-${id}-${audioNode.id}`, id, audioNode.id)])
    } catch (error) {
      setVideoAudioExtractionError(error instanceof Error ? error.message : String(error))
    } finally {
      setVideoAudioExtracting(false)
    }
  }

  return (
    <div className={data.kind === 'image' || data.kind === 'video' ? 'w-[620px]' : isDirector || isImageEditor ? 'w-[520px]' : 'w-[420px]'}>
      <div className="mb-1.5 flex items-center gap-1 text-[11px] text-white/48">
        {nodeIcon(data.kind)}
        <span className="min-w-0 truncate">{data.title}</span>
        {data.generationStatus === 'generating' && (
          <span className="ml-1 flex items-center gap-1 text-[9px] text-[#e8c766]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#e8c766]" />
            生成中
          </span>
        )}
        {data.readOnly && (
          <span className="ml-1 rounded border border-[#d4af37]/25 bg-[#d4af37]/10 px-1.5 py-0.5 text-[9px] text-[#e8c766]">
            {data.kind === 'video' ? '只读预演视频' : data.kind === 'audio' ? '只读提取音频' : '只读构图参考'}
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
        {selected && data.kind === 'video' && data.sourcePath && (
          <button
            className="nodrag flex h-6 flex-shrink-0 items-center gap-1 rounded-md border border-[#d4af37]/25 bg-[#d4af37]/10 px-2 text-[10px] text-[#e8c766] transition hover:bg-[#d4af37]/15 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={(event) => {
              event.stopPropagation()
              void extractVideoAudio()
            }}
            disabled={videoAudioExtracting}
            title="从该视频中提取音轨，并在画布上创建独立音频节点"
          >
            <span>{videoAudioExtracting ? '提取中…' : '提取音频'}</span>
          </button>
        )}
        <NodeDeleteButton id={id} />
      </div>
      <div
        className={`relative overflow-visible rounded-xl border bg-[#202023] shadow-[0_10px_35px_rgba(0,0,0,0.3)] transition ${selected ? 'border-[#e8c766]/75 shadow-[0_0_0_1px_rgba(232,199,102,0.18),0_18px_45px_rgba(0,0,0,0.4)]' : 'border-white/[0.13]'}`}
      >
        <Handle type="target" position={Position.Left} className="story-handle" />
        {isImageEditor ? (
          <div className="nodrag nowheel overflow-hidden rounded-[11px] bg-[#121318]" onPointerDown={(event) => event.stopPropagation()}>
            <div className="relative aspect-video overflow-hidden bg-[radial-gradient(circle_at_50%_35%,#273148_0%,#11141c_50%,#090a0e_100%)]">
              {boardPreview && !boardPreviewFailed ? (
                <div className="relative h-full w-full bg-[#0d0f14]">
                  <img src={boardPreview} alt="画板中心预览" className="h-full w-full object-cover" draggable={false} onError={() => setBoardPreviewFailed(true)} />
                  <span className="absolute bottom-3 left-3 rounded-md border border-white/10 bg-black/55 px-2 py-1 text-[9px] text-white/65">画板中心预览</span>
                </div>
              ) : imageEditorPreviewSources.length > 0 ? (
                <div
                  className="grid h-full w-full gap-0.5 bg-black/45"
                  style={{
                    gridTemplateColumns: `repeat(${imageEditorPreviewColumns}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${imageEditorPreviewRows}, minmax(0, 1fr))`,
                  }}
                >
                  {imageEditorPreviewSources.map((source, index) => {
                    const hiddenCount = imageEditorSources.length - imageEditorPreviewSources.length
                    const showOverflow = hiddenCount > 0 && index === imageEditorPreviewSources.length - 1
                    return (
                      <div key={source.nodeId} className="relative min-h-0 overflow-hidden bg-[#0d0f14]" title={source.title}>
                        <img src={source.url} alt={source.title} className="h-full w-full object-cover" draggable={false} />
                        {showOverflow && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/65 text-lg font-semibold text-white/85 backdrop-blur-[1px]">
                            +{hiddenCount}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/30">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d4af37]/25 bg-[#d4af37]/10 text-2xl text-[#e8c766]">✎</div>
                  <div className="text-center"><p className="text-xs text-white/55">从空白画板开始创作</p><p className="mt-1 text-[10px]">也可连接图片，将其作为可编辑素材载入</p></div>
                </div>
              )}
              {imageEditorInputs.length > 0 && <span className="absolute bottom-3 left-3 rounded-md border border-white/10 bg-black/55 px-2 py-1 text-[9px] text-white/65">已连接 {imageEditorInputs.length} 张图片</span>}
            </div>
            <div className="space-y-2 border-t border-white/8 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1"><p className="text-[11px] text-white/65">Excalidraw 自由画板</p><p className="mt-0.5 truncate text-[9px] text-white/30">{imageEditorInputs.length > 0 ? `${imageEditorInputs.length} 张连接素材 · 多选后右键导出` : '无需输入 · 可直接绘制并导出'}</p></div>
                <button onClick={() => setImageEditorOpen(true)} className="rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 px-4 py-2 text-[10px] font-medium text-[#f0d98c] hover:bg-[#d4af37]/15">打开画板</button>
              </div>
            </div>
          </div>
        ) : isDirector ? (
          <div className="nodrag nowheel overflow-hidden rounded-[11px] bg-[#121318]" onPointerDown={(event) => event.stopPropagation()}>
            <div className="relative aspect-video overflow-hidden bg-[radial-gradient(circle_at_50%_30%,#273148_0%,#11141c_48%,#090a0e_100%)]">
              {data.preview ? (
                <img src={data.preview} alt="导演台最近构图" className="h-full w-full object-contain" draggable={false} />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/32">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d4af37]/25 bg-[#d4af37]/10 text-2xl text-[#e8c766]">◫</div>
                  <div className="text-center"><p className="text-xs text-white/55">虚拟片场尚未拍摄构图</p><p className="mt-1 text-[10px]">布置演员、道具与多机位，再输出参考图</p></div>
                </div>
              )}
              <div className="absolute bottom-3 left-3 flex gap-2 text-[9px] text-white/55">
                <span className="rounded-md border border-white/10 bg-black/45 px-2 py-1">{directorProject?.elements.length ?? 0} 个元素</span>
                <span className="rounded-md border border-white/10 bg-black/45 px-2 py-1">{directorProject?.shots.length ?? 1} 个 Shot</span>
                <span className="rounded-md border border-white/10 bg-black/45 px-2 py-1">24 FPS</span>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-white/8 px-4 py-3">
              <div><p className="text-[11px] text-white/65">3D Blocking 与机位预演</p><p className="mt-0.5 text-[9px] text-white/30">工程随画布保存，截图自动创建图片节点</p></div>
              <button onClick={() => setDirectorOpen(true)} className="rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 px-4 py-2 text-[10px] font-medium text-[#f0d98c] hover:bg-[#d4af37]/15">打开导演台</button>
            </div>
          </div>
        ) : visualMediaKind ? (
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
                <span className="text-[11px] tracking-wider">{data.kind === 'image' ? '图片生成中' : '视频生成中'}</span>
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
            {!data.readOnly && (
              <button
                onClick={() => void importAudio()}
                disabled={audioImporting}
                className="rounded-xl border border-[#d4af37]/25 bg-[#d4af37]/10 px-4 py-2 text-[11px] text-[#f0d98c] transition hover:bg-[#d4af37]/15 disabled:opacity-50"
              >
                {audioImporting ? '导入中…' : data.preview ? '替换本地音频' : '上传本地音频'}
              </button>
            )}
            {data.generationError && <p className="text-[10px] text-rose-300">{data.generationError}</p>}
          </div>
        ) : null}
        <Handle type="source" position={Position.Right} className="story-handle" />
      </div>
      {selected && visualMediaKind && !isUpscale && !data.readOnly && <PromptPanel id={id} kind={visualMediaKind} />}
      {selected && data.kind === 'video' && videoAudioExtractionError && (
        <p className="mt-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[10px] text-rose-200">{videoAudioExtractionError}</p>
      )}
      {selected && isUpscale && <UpscalePanel id={id} />}
      {directorOpen && isDirector && (
        <Suspense fallback={<div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#090a0e] text-sm text-[#e8c766]">正在加载 3D 导演台…</div>}>
          <DirectorStageDialog
            project={directorProject ?? createDefaultDirectorProject(data.title)}
            onChange={updateDirectorProject}
            onCapture={captureDirectorStill}
            onExportVideo={exportDirectorVideo}
            referenceImages={directorReferenceImages}
            agentBusy={directorAgentBusy}
            onRequestAgentScene={requestDirectorSceneFromAgent}
            onClose={() => setDirectorOpen(false)}
          />
        </Suspense>
      )}
      {imageEditorOpen && isImageEditor && currentProject && (
        <Suspense fallback={<div className="fixed inset-0 z-[220] flex items-center justify-center bg-[#090a0e] text-sm text-[#e8c766]">正在加载画板…</div>}>
          <ImageEditorDialog
            key={imageEditorSources.map((source) => source.nodeId).join('|')}
            title={data.title}
            sources={imageEditorSources}
            boardState={data.boardState}
            onChange={updateBoardState}
            onPreview={saveBoardPreview}
            onExport={exportImageEditorSelection}
            onClose={() => setImageEditorOpen(false)}
          />
        </Suspense>
      )}
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
    ...(kind === 'image' || kind === 'video' ? { prompt: '' } : {}),
    aspectRatio: kind === 'image' || kind === 'image-editor' || kind === 'video' || kind === 'upscale' ? '16:9' : undefined,
    duration: kind === 'video' ? 5 : undefined,
    scale: kind === 'upscale' ? 2 : undefined,
    quality: kind === 'upscale' ? 'ULTRA' : undefined,
    directorProject: kind === 'director' ? createDefaultDirectorProject(`导演场景 ${index}`) : undefined,
  },
})

const workspacePreview = (projectId: string, relativePath: string): string => (
  `workspace://${projectId}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
)

const makeProjectMediaNode = (
  asset: ProjectMediaAsset,
  projectId: string,
  index: number,
  position: { x: number; y: number },
): StoryNode => {
  const node = makeNode(asset.kind, index, position)
  return {
    ...node,
    data: {
      ...node.data,
      title: asset.name,
      sourcePath: asset.relativePath,
      preview: workspacePreview(projectId, asset.relativePath),
    },
  }
}

const formatAssetSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

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
  const currentProject = useAppStore((state) => state.currentProject)
  const artifacts = useAppStore((state) => state.artifacts)
  const folderPath = currentProject?.folderPath
  const [nodes, setNodes, onNodesChange] = useNodesState<StoryNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<StoryEdge>([])
  const [dismissedArtifacts, setDismissedArtifacts] = useState<Record<string, number>>({})
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('select')
  const [assetPanelOpen, setAssetPanelOpen] = useState(false)
  const [assetFilter, setAssetFilter] = useState<'all' | ProjectMediaKind>('all')
  const [projectAssets, setProjectAssets] = useState<ProjectMediaAsset[]>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assetError, setAssetError] = useState('')
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const { screenToFlowPosition, setViewport, getViewport, fitView } = useReactFlow<StoryNode, StoryEdge>()
  const loadedFolderRef = useRef<string | null>(null)
  const readyToSaveRef = useRef(false)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const nodesRef = useRef<StoryNode[]>([])
  const edgesRef = useRef<StoryEdge[]>([])
  const projectIdRef = useRef<string | null>(currentProject?.id ?? null)
  const revisionRef = useRef(0)
  projectIdRef.current = currentProject?.id ?? null

  const loadProjectAssets = useCallback(async () => {
    if (!currentProject) return
    setAssetsLoading(true)
    setAssetError('')
    try {
      const result = await window.electronAPI.listProjectMedia(currentProject.id)
      if (!result.success) throw new Error(result.error || '无法读取项目资产')
      if (projectIdRef.current !== currentProject.id) return
      setProjectAssets(result.assets)
    } catch (error) {
      if (projectIdRef.current === currentProject.id) {
        setAssetError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (projectIdRef.current === currentProject.id) setAssetsLoading(false)
    }
  }, [currentProject])

  const appendProjectAssets = useCallback((assets: ProjectMediaAsset[], origin: { x: number; y: number }) => {
    if (!currentProject || assets.length === 0) return
    setNodes((current) => [
      ...current,
      ...assets.map((asset, index) => makeProjectMediaNode(
        asset,
        currentProject.id,
        current.length + index + 1,
        { x: origin.x + index * 36, y: origin.y + index * 36 },
      )),
    ])
  }, [currentProject, setNodes])

  const uploadProjectMedia = useCallback(async () => {
    if (!currentProject || uploadingMedia) return
    setUploadingMedia(true)
    setAssetError('')
    try {
      const result = await window.electronAPI.importProjectMedia(currentProject.id)
      if (result.canceled) return
      if (!result.success || !result.assets?.length) throw new Error(result.error || '没有导入任何媒体')
      if (projectIdRef.current !== currentProject.id) return
      const center = screenToFlowPosition({ x: window.innerWidth * 0.38, y: window.innerHeight * 0.45 })
      appendProjectAssets(result.assets, center)
      if (assetPanelOpen) await loadProjectAssets()
    } catch (error) {
      if (projectIdRef.current === currentProject.id) {
        setAssetError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (projectIdRef.current === currentProject.id) setUploadingMedia(false)
    }
  }, [appendProjectAssets, assetPanelOpen, currentProject, loadProjectAssets, screenToFlowPosition, uploadingMedia])

  const toggleAssetPanel = useCallback(() => {
    setAssetPanelOpen((open) => {
      if (!open) void loadProjectAssets()
      return !open
    })
  }, [loadProjectAssets])

  const handleAssetDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(PROJECT_ASSET_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleAssetDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const serialized = event.dataTransfer.getData(PROJECT_ASSET_DRAG_TYPE)
    if (!serialized) return
    event.preventDefault()
    try {
      const asset = JSON.parse(serialized) as ProjectMediaAsset
      if (!['image', 'video', 'audio'].includes(asset.kind) || !asset.relativePath) return
      appendProjectAssets([asset], screenToFlowPosition({ x: event.clientX, y: event.clientY }))
    } catch {
      setAssetError('无法读取拖拽的项目资产')
    }
  }, [appendProjectAssets, screenToFlowPosition])

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
    if (projectIdRef.current !== projectId) return
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
    if (current.data.readOnly) return
    if (!(current.data.prompt ?? '').trim()) {
      patchNodeData(nodeId, { generationStatus: 'error', generationError: '请先输入文生图提示词' })
      return
    }
    patchNodeData(nodeId, { generationStatus: 'generating', generationError: '' })
    try {
      const workflows: ComfyWorkflowInfo[] = await listCachedComfyWorkflows()
      const available = workflows.filter((item) => item.kind === 'text-to-image')
      const selectedWorkflow = available.find((item) => item.id === current.data.workflowId) ?? available[0]
      const incomingImageNodes = edgesRef.current
        .filter((edge) => edge.target === nodeId)
        .map((edge) => nodesRef.current.find((node) => node.id === edge.source))
        .filter((source): source is StoryNode => !!source && source.data.kind === 'image' && !!source.data.sourcePath)
      const imageReferenceLimit = selectedWorkflow?.id.startsWith('google-')
        ? 14
        : selectedWorkflow?.id.startsWith('seedream-')
          ? 10
          : 0
      const referenceImagePaths = orderImageReferences(
        incomingImageNodes,
        current.data.referenceImageNodeIds,
        imageReferenceLimit,
      ).map((source) => source.data.sourcePath!)
      const result = await window.electronAPI.generateImage({
        projectId: project.id,
        nodeId,
        prompt: current.data.prompt ?? '',
        aspectRatio: current.data.aspectRatio ?? '16:9',
        workflowId: selectedWorkflow?.id,
        referenceImagePaths: imageReferenceLimit > 0 ? referenceImagePaths : undefined,
      })
      if (!result.success || !result.relativePath) {
        throw new Error(result.error || '图片生成服务没有返回图片')
      }
      applyGenerationResult(nodeId, project.id, result.relativePath)
    } catch (error) {
      if (projectIdRef.current !== project.id) return
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
      const workflows: ComfyWorkflowInfo[] = await listCachedComfyWorkflows()
      const available = workflows.filter((item) => item.kind === 'image-to-video')
      const selectedWorkflow = available.find((item) => item.id === current.data.workflowId) ?? available[0]
      const isSeedanceWorkflow = selectedWorkflow?.id.startsWith('seedance-') ?? false
      const isReferenceWorkflow = (selectedWorkflow?.id.startsWith('minimax-h3-r2v') ?? false) || isSeedanceWorkflow
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
              : !isSeedanceWorkflow && referenceImagePaths.length + referenceVideoPaths.length + referenceAudioPaths.length === 0
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
        throw new Error(result.error || '视频生成服务没有返回视频')
      }
      applyGenerationResult(nodeId, project.id, result.relativePath)
    } catch (error) {
      if (projectIdRef.current !== project.id) return
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
      if (projectIdRef.current !== project.id) return
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
    const directorActions = ['add-element', 'add-shot', 'set-actor-path', 'set-camera-constraint', 'set-camera-keyframe', 'apply-scene-draft']
    const unregisterDirector = directorActions.map((actionId) => registerNodeKindAction('director', actionId, async (nodeId, params = {}) => {
      const node = nodesRef.current.find((item) => item.id === nodeId)
      if (!node || node.data.kind !== 'director') throw new Error(`导演台节点不存在：${nodeId}`)
      if (actionId === 'apply-scene-draft') {
        const referenceNodeId = typeof params.referenceNodeId === 'string' ? params.referenceNodeId : ''
        const referenceNode = nodesRef.current.find((item) => item.id === referenceNodeId && item.data.kind === 'image')
        if (!referenceNode?.data.sourcePath) throw new Error('referenceNodeId 必须指向已有输出的图片节点')
      }
      const current = normalizeDirectorProject(node.data.directorProject, node.data.title)
      const next = { ...applyDirectorAtomicAction(current, actionId, params), updatedAt: Date.now() }
      const issues = validateDirectorProject(next)
      if (issues.length > 0) throw new Error(issues.join('；'))
      nodesRef.current = nodesRef.current.map((item) => item.id === nodeId
        ? { ...item, data: { ...item.data, directorProject: next } }
        : item)
      setNodes(nodesRef.current)
      return { action: actionId, nodeId, updatedAt: next.updatedAt }
    }))
    return () => {
      unregisterImage()
      unregisterVideo()
      unregisterUpscale()
      unregisterDirector.forEach((unregister) => unregister())
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
        if (command.action === 'get-overview') {
          respond({
            success: true,
            result: buildCanvasOverview(nodesRef.current, edgesRef.current),
          })
          return
        }

        if (command.action === 'get-node') {
          const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId.trim() : ''
          if (!nodeId) throw new Error('请提供 nodeId')
          const detail = buildCanvasNodeDetail(nodesRef.current, edgesRef.current, nodeId)
          if (!detail) throw new Error(`找不到节点：${nodeId}`)
          respond({ success: true, result: detail })
          return
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
                result: { nodeKinds },
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
          void (async () => {
            const results = await Promise.all(nodeIds.map(async (nodeId) => {
              const node = nodesRef.current.find((item) => item.id === nodeId)
              if (!node) return { nodeId, accepted: false as const, error: `找不到节点：${nodeId}` }
              if (node.data.readOnly) return { nodeId, accepted: false as const, error: '该节点是只读构图参考，不能修改或执行生成动作' }
              const actionDescriptor = getNodeCapabilities(node.data.kind)
                ?.actions.find((item) => item.id === actionId)
              if (!actionDescriptor) return { nodeId, accepted: false as const, error: `该节点类型（${node.data.kind}）不支持动作：${actionId || '(未提供 action)'}` }
              const nodeHandler = getNodeAction(nodeId, actionId)
              const kindHandler = getNodeKindAction(node.data.kind, actionId)
              if (!nodeHandler && !kindHandler) return { nodeId, accepted: false as const, error: '动作处理器尚未注册（画布未就绪）' }
              const invoke = () => nodeHandler ? nodeHandler(params) : kindHandler!(nodeId, params)
              if (actionDescriptor.async) {
                void Promise.resolve(invoke()).catch(() => undefined)
                return { nodeId, accepted: true as const, async: true, statusField: actionDescriptor.statusField }
              }
              try {
                const output = await Promise.resolve(invoke())
                return { nodeId, accepted: true as const, async: false, output }
              } catch (error) {
                return { nodeId, accepted: false as const, error: error instanceof Error ? error.message : String(error) }
              }
            }))
            const acceptedCount = results.filter((item) => item.accepted).length
            respond({
              success: acceptedCount > 0,
              revision: revisionRef.current,
              result: { action: actionId, accepted: acceptedCount, total: nodeIds.length, results },
              ...(acceptedCount > 0 ? {} : { error: results.map((item) => 'error' in item ? item.error : '').filter(Boolean).join('；') }),
            })
          })()
          return
        }

        if (command.action === 'create-nodes') {
          const inputs = Array.isArray(payload.nodes) ? payload.nodes as Record<string, unknown>[] : []
          if (inputs.length === 0) throw new Error('至少需要创建一个节点')
          const occupied = new Set(nodesRef.current.map((node) => node.id))
          const created = inputs.map((input, index) => {
            const kind = input.kind as StoryNodeKind
            if (!['image', 'image-editor', 'video', 'audio', 'upscale', 'director'].includes(kind)) throw new Error(`无效节点类型：${String(kind)}`)
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
              (kind === 'image' || kind === 'image-editor' || kind === 'video' || kind === 'audio' || kind === 'upscale' || kind === 'director') &&
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
          respond({ success: true, revision: revisionRef.current, result: { createdNodeIds: created.map((node) => node.id) } })
          return
        }

        if (command.action === 'update-nodes') {
          const updates = Array.isArray(payload.updates) ? payload.updates as Record<string, unknown>[] : []
          const ids = new Set(updates.map((update) => String(update.id)))
          const missing = [...ids].filter((id) => !nodesRef.current.some((node) => node.id === id))
          if (missing.length > 0) throw new Error(`找不到节点：${missing.join(', ')}`)
          const immutableUpdates = updates.filter((update) => {
            const node = nodesRef.current.find((item) => item.id === String(update.id))
            return node?.data.readOnly && Object.keys(update).some((key) => key !== 'id' && key !== 'position')
          })
          if (immutableUpdates.length > 0) {
            throw new Error(`只读构图参考节点不能修改内容：${immutableUpdates.map((update) => String(update.id)).join(', ')}`)
          }
          nodesRef.current = nodesRef.current.map((node) => {
            const update = updates.find((item) => item.id === node.id)
            if (!update) return node
            const position = update.position && typeof update.position === 'object'
              ? update.position as { x: number; y: number }
              : node.position
            const data = { ...node.data, ...pickMutableNodeData(node.data.kind, update), kind: node.data.kind }
            if (
              (node.data.kind === 'image' || node.data.kind === 'image-editor' || node.data.kind === 'video' || node.data.kind === 'audio' || node.data.kind === 'upscale' || node.data.kind === 'director') &&
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
          respond({ success: true, revision: revisionRef.current, result: { updatedNodeIds: [...ids] } })
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
          respond({ success: true, revision: revisionRef.current, result: { deletedNodeIds } })
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
          respond({ success: true, revision: revisionRef.current, result: { createdEdgeIds } })
          return
        }

        if (command.action === 'disconnect-edges') {
          const ids = new Set(Array.isArray(payload.edgeIds) ? payload.edgeIds.map(String) : [])
          const deletedEdgeIds = edgesRef.current.filter((edge) => ids.has(edge.id)).map((edge) => edge.id)
          edgesRef.current = edgesRef.current.filter((edge) => !ids.has(edge.id))
          setEdges(edgesRef.current)
          revisionRef.current += 1
          respond({ success: true, revision: revisionRef.current, result: { deletedEdgeIds } })
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
    setAssetPanelOpen(false)
    setProjectAssets([])
    setAssetError('')

    const requestedFolderPath = folderPath
    void window.electronAPI.loadCanvasSnapshot(requestedFolderPath)
      .then((snapshot: unknown) => {
        if (loadedFolderRef.current !== requestedFolderPath) return
        if (isFlowSnapshot(snapshot)) {
          const migrated = migrateLegacySnapshot(snapshot)
          const restoredNodes = migrated.nodes.map<StoryNode>((node) => {
            return node.data.generationStatus === 'generating'
              ? { ...node, data: { ...node.data, generationStatus: 'idle' as const, generationError: '' } }
              : node
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
      .catch((error: unknown) => {
        if (loadedFolderRef.current === requestedFolderPath) {
          console.error('Failed to load canvas snapshot:', error)
        }
      })
      .finally(() => {
        if (loadedFolderRef.current === requestedFolderPath) readyToSaveRef.current = true
      })
  }, [folderPath, setEdges, setNodes, setViewport])

  useEffect(() => {
    if (!folderPath || !readyToSaveRef.current) return
    clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      const snapshot: FlowSnapshot = {
        type: 'react-flow',
        version: 4,
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
          const imageId = `${artifact.id}-shot-${shot.index}-image`
          const videoId = `${artifact.id}-shot-${shot.index}-video`
          const existingImage = nodes.find((node) => node.id === imageId)
          const existingVideo = nodes.find((node) => node.id === videoId)
          const imageNode: StoryNode = {
            ...makeNode('image', shot.index, { x: 100, y: originY + shotOffset * 330 }),
            id: imageId,
            data: {
              kind: 'image',
              title: `镜头 ${shot.index} · 图片`,
              prompt: shot.textToImagePrompt || shot.scene,
              artifactId: artifact.id,
              aspectRatio: '16:9',
              sourcePath: shot.imageSource,
              sourceHistory: shot.imageSourceHistory,
              preview: shot.imageSource && currentProject
                ? `workspace://${currentProject.id}/${shot.imageSource.split('/').map(encodeURIComponent).join('/')}`
                : undefined,
            },
          }
          const videoNode: StoryNode = {
            ...makeNode('video', shot.index, { x: 620, y: originY + shotOffset * 330 }),
            id: videoId,
            data: {
              kind: 'video',
              title: `镜头 ${shot.index} · 视频`,
              prompt: shot.imageToVideoPrompt || shot.camera || shot.scene,
              aspectRatio: '16:9',
              duration: ([5, 10, 15] as const).includes(shot.duration as 5 | 10 | 15) ? shot.duration : 5,
              sourcePath: shot.videoSource,
              sourceHistory: shot.videoSourceHistory,
              preview: shot.videoSource && currentProject
                ? `workspace://${currentProject.id}/${shot.videoSource.split('/').map(encodeURIComponent).join('/')}`
                : undefined,
            },
          }
          if (!existingImage) additions.push(imageNode)
          if (!existingVideo) additions.push(videoNode)
          linkedEdges.push(
            makeLinkedEdge(
              `${imageId}-to-video`,
              imageNode.id,
              videoNode.id,
            ),
          )
        })
        continue
      }

      if (existingArtifactNode) continue

      if (artifact.type !== 'image') continue
      const kind: StoryNodeKind = 'image'
      additions.push({
        ...makeNode(kind, sequence, {
          x: 100 + (sequence % 3) * 470,
          y: 100 + Math.floor(sequence / 3) * 380,
        }),
        data: {
          kind,
          title: artifact.title,
          prompt: '',
          preview: artifact.content,
          artifactId: artifact.id,
          sourcePath: artifact.path,
          aspectRatio: '16:9',
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
    // React Flow listens for Delete/Backspace globally. Full-screen node editors
    // are rendered in portals, so their keyboard events can still produce
    // node-removal changes. Keep non-removal changes, but never remove underlying
    // canvas nodes while any node editor is mounted.
    const safeChanges = document.querySelector('[data-canvas-node-editor-dialog]')
      ? changes.filter((change) => change.type !== 'remove')
      : changes
    const removedIds = new Set(
      safeChanges.filter((change) => change.type === 'remove').map((change) => change.id),
    )
    if (removedIds.size === 0) {
      if (safeChanges.length > 0) onNodesChange(safeChanges)
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

    onNodesChange(safeChanges)
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
      {(['image', 'image-editor', 'video', 'audio', 'upscale', 'director'] as StoryNodeKind[]).map((kind) => (
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

  const visibleProjectAssets = assetFilter === 'all'
    ? projectAssets
    : projectAssets.filter((asset) => asset.kind === assetFilter)

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
        onDragOver={handleAssetDragOver}
        onDrop={handleAssetDrop}
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
        onlyRenderVisibleElements
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background color="rgba(255,255,255,0.16)" gap={18} size={1} variant={BackgroundVariant.Dots} />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(node) => node.data.kind === 'image' ? '#8b7355' : node.data.kind === 'image-editor' ? '#9a6d8d' : node.data.kind === 'video' ? '#566b7f' : node.data.kind === 'audio' ? '#7f6656' : node.data.kind === 'upscale' ? '#4f7f74' : node.data.kind === 'director' ? '#b08b2f' : '#67636e'}
          maskColor="rgba(5,5,8,0.72)"
        />
      </ReactFlow>
      <div className="pointer-events-auto absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2 rounded-2xl border border-white/10 bg-[#19191e]/95 p-2 shadow-[0_12px_35px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <button
          onClick={() => void uploadProjectMedia()}
          disabled={uploadingMedia}
          className="group flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-xl text-white/55 transition hover:bg-white/[0.08] hover:text-[#e8c766] disabled:cursor-wait disabled:opacity-45"
          title="上传本地图片、视频或音频"
        >
          {uploadingMedia ? (
            <span className="h-4 w-4 animate-spin rounded-full border border-white/25 border-t-[#e8c766]" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
            </svg>
          )}
          <span className="text-[9px]">上传</span>
        </button>
        <div className="mx-2 h-px bg-white/10" />
        <button
          onClick={toggleAssetPanel}
          className={`flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-xl transition ${assetPanelOpen ? 'bg-[#d4af37]/15 text-[#e8c766]' : 'text-white/55 hover:bg-white/[0.08] hover:text-[#e8c766]'}`}
          title="查看项目资产"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3.5 7.5h17v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11Zm3-4h11l2 4h-15l2-4Z" />
          </svg>
          <span className="text-[9px]">资产</span>
        </button>
      </div>

      {assetPanelOpen && (
        <aside className="pointer-events-auto absolute left-20 top-1/2 z-20 flex max-h-[72vh] w-[390px] -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#151519]/98 shadow-[0_20px_60px_rgba(0,0,0,0.65)] backdrop-blur-xl">
          <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
            <div>
              <h3 className="text-[12px] font-medium tracking-[0.16em] text-[#e8e6df]">项目资产</h3>
              <p className="mt-0.5 text-[9px] text-white/30">拖拽素材到画布即可创建节点</p>
            </div>
            <span className="ml-auto rounded-md bg-white/[0.06] px-2 py-1 text-[9px] tabular-nums text-white/35">{projectAssets.length}</span>
            <button
              onClick={() => void loadProjectAssets()}
              disabled={assetsLoading}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-40"
              title="刷新资产"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={`h-3.5 w-3.5 ${assetsLoading ? 'animate-spin' : ''}`}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
              </svg>
            </button>
            <button
              onClick={() => setAssetPanelOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition hover:bg-white/[0.07] hover:text-white"
              title="关闭"
            >
              ×
            </button>
          </div>

          <div className="flex gap-1 border-b border-white/8 px-3 py-2">
            {([
              ['all', '全部'],
              ['image', '图片'],
              ['video', '视频'],
              ['audio', '音频'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setAssetFilter(value)}
                className={`rounded-lg px-3 py-1.5 text-[10px] transition ${assetFilter === value ? 'bg-[#d4af37]/14 text-[#e8c766]' : 'text-white/38 hover:bg-white/[0.05] hover:text-white/65'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {assetError && (
              <div className="mb-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.08] px-3 py-2 text-[10px] leading-4 text-rose-300">{assetError}</div>
            )}
            {assetsLoading && projectAssets.length === 0 ? (
              <div className="flex h-40 items-center justify-center gap-2 text-[10px] text-white/35">
                <span className="h-4 w-4 animate-spin rounded-full border border-white/20 border-t-[#e8c766]" />
                正在扫描项目素材…
              </div>
            ) : visibleProjectAssets.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center text-center text-white/28">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="mb-3 h-8 w-8">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3.5 7.5h17v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11Zm3-4h11l2 4h-15l2-4Z" />
                </svg>
                <p className="text-[11px]">暂无{assetFilter === 'all' ? '项目素材' : `${assetFilter === 'image' ? '图片' : assetFilter === 'video' ? '视频' : '音频'}素材`}</p>
                <p className="mt-1 text-[9px] text-white/20">可点击左侧上传按钮添加</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {visibleProjectAssets.map((asset) => {
                  const preview = currentProject ? workspacePreview(currentProject.id, asset.relativePath) : ''
                  return (
                    <div
                      key={asset.relativePath}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'copy'
                        event.dataTransfer.setData(PROJECT_ASSET_DRAG_TYPE, JSON.stringify(asset))
                      }}
                      className="group cursor-grab overflow-hidden rounded-xl border border-white/10 bg-white/[0.025] transition hover:border-[#d4af37]/35 hover:bg-[#d4af37]/[0.04] active:cursor-grabbing"
                      title="拖拽到画布创建节点"
                    >
                      <div className="flex h-24 items-center justify-center overflow-hidden bg-black/35">
                        {asset.kind === 'image' ? (
                          <img src={preview} alt={asset.name} draggable={false} loading="lazy" className="h-full w-full object-contain" />
                        ) : asset.kind === 'video' ? (
                          <video src={preview} muted preload="metadata" draggable={false} className="h-full w-full object-contain" />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#d4af37]/20 bg-[#d4af37]/[0.08] text-xl text-[#e8c766]">♪</div>
                        )}
                      </div>
                      <div className="p-2.5">
                        <p className="truncate text-[10px] text-white/70">{asset.name}</p>
                        <div className="mt-1.5 flex items-center justify-between text-[8px] text-white/28">
                          <span>{asset.kind === 'image' ? '图片' : asset.kind === 'video' ? '视频' : '音频'}</span>
                          <span>{formatAssetSize(asset.size)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </aside>
      )}

      {!assetPanelOpen && assetError && (
        <button
          onClick={() => { setAssetPanelOpen(true); void loadProjectAssets() }}
          className="pointer-events-auto absolute left-20 top-1/2 z-20 ml-2 mt-16 max-w-[280px] -translate-y-1/2 rounded-lg border border-rose-500/20 bg-[#21171a]/95 px-3 py-2 text-left text-[10px] leading-4 text-rose-300 shadow-xl"
        >
          {assetError}
        </button>
      )}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="mb-20 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d4af37]/20 bg-[#d4af37]/[0.06] text-2xl text-[#e8c766]">✦</div>
            <p className="mt-4 text-sm tracking-[0.2em] text-white/65">创建你的第一个生产节点</p>
            <p className="mt-2 text-xs text-white/30">从下方添加图片、视频、音频或视频放大节点</p>
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
