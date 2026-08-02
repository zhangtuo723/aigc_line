import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { ComfyWorkflowInfo, StoryboardShot } from '../shared/ipc.types'

type StoryNodeKind = 'text' | 'image' | 'video' | 'storyboard'
type InteractionMode = 'select' | 'pan'

interface StoryNodeData extends Record<string, unknown> {
  kind: StoryNodeKind
  title: string
  prompt: string
  preview?: string
  artifactId?: string
  shots?: StoryboardShot[]
  shotIndex?: number
  aspectRatio?: '16:9' | '1:1' | '4:3'
  sourcePath?: string
  sourceHistory?: string[]
  workflowId?: string
  duration?: number
  generationStatus?: 'idle' | 'generating' | 'error'
  generationError?: string
}

type StoryNode = Node<StoryNodeData, 'storyNode'>
type StoryEdge = Edge<Record<string, never>, 'default'>

interface FlowSnapshot {
  type: 'react-flow'
  version: 1
  nodes: StoryNode[]
  edges: StoryEdge[]
  viewport: Viewport
  dismissedArtifacts?: Record<string, number>
}

const SAVE_DEBOUNCE_MS = 700
const DEFAULT_VIEWPORT: Viewport = { x: 80, y: 70, zoom: 0.86 }

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

const nodeIcon = (kind: StoryNodeKind) => {
  if (kind === 'storyboard') {
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
  const updateArtifactContent = useAppStore((state) => state.updateArtifactContent)
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
  const incoming = edges
    .filter((edge) => edge.target === id)
    .map((edge) => ({ edge, source: nodes.find((node) => node.id === edge.source) }))
    .filter((item): item is { edge: StoryEdge; source: StoryNode } => !!item.source)

  useEffect(() => {
    let active = true
    window.electronAPI.listComfyWorkflows()
      .then((items: ComfyWorkflowInfo[]) => { if (active) setWorkflows(items) })
      .catch(() => { if (active) setWorkflows([]) })
    return () => { active = false }
  }, [])

  const generateImage = async () => {
    if (kind !== 'image' || !currentProject || !current) return
    if (!current.data.prompt.trim()) {
      setNodes((list) => list.map((node) => node.id === id
        ? { ...node, data: { ...node.data, generationStatus: 'error', generationError: '请先输入文生图提示词' } }
        : node))
      return
    }
    setNodes((list) => list.map((node) => node.id === id
      ? { ...node, data: { ...node.data, generationStatus: 'generating', generationError: '' } }
      : node))
    try {
      const result = await window.electronAPI.generateImage({
        projectId: currentProject.id,
        nodeId: id,
        prompt: current.data.prompt,
        aspectRatio,
        workflowId: selectedWorkflow?.id,
        referenceImagePath: incoming.find(({ source }) => source.data.kind === 'image' && source.data.sourcePath)?.source.data.sourcePath,
      })
      if (!result.success || !result.relativePath) {
        throw new Error(result.error || 'ComfyUI 没有返回图片')
      }

      const relativePath = result.relativePath
      const preview = `workspace://${currentProject.id}/${relativePath
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
      const previousPath = current.data.sourcePath
      setNodes((list) => list.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              preview,
              sourcePath: relativePath,
              sourceHistory: previousPath
                ? [...(node.data.sourceHistory ?? []), previousPath]
                : node.data.sourceHistory ?? [],
              generationStatus: 'idle',
              generationError: '',
            },
          }
        : node))

      const storyboardSource = incoming.find(({ source }) => source.data.kind === 'storyboard')?.source
      const artifactId = storyboardSource?.data.artifactId
      const shotIndex = current.data.shotIndex
      if (artifactId && typeof shotIndex === 'number') {
        const artifact = useAppStore.getState().artifacts.find((item) => item.id === artifactId)
        if (artifact) {
          const shots = parseStoryboard(artifact.content)
          const nextShots = shots.map((shot) => shot.index === shotIndex
            ? {
                ...shot,
                textToImagePrompt: current.data.prompt,
                imageSource: relativePath,
                imageSourceHistory: shot.imageSource
                  ? [...(shot.imageSourceHistory ?? []), shot.imageSource]
                  : shot.imageSourceHistory ?? [],
              }
            : shot)
          const content = JSON.stringify(nextShots, null, 2)
          updateArtifactContent(artifact.id, content)
          if (artifact.path) {
            await window.electronAPI.saveArtifactContent(currentProject.id, artifact.path, content)
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setNodes((list) => list.map((node) => node.id === id
        ? { ...node, data: { ...node.data, generationStatus: 'error', generationError: message } }
        : node))
    }
  }

  const generateVideo = async () => {
    if (kind !== 'video' || !currentProject || !current) return
    if (!current.data.prompt.trim()) {
      setNodes((list) => list.map((node) => node.id === id
        ? { ...node, data: { ...node.data, generationStatus: 'error', generationError: '请先输入图生视频提示词' } }
        : node))
      return
    }
    const referenceNode = incoming.find(({ source }) => source.data.kind === 'image' && source.data.sourcePath)?.source
    if (!referenceNode?.data.sourcePath) {
      setNodes((list) => list.map((node) => node.id === id
        ? { ...node, data: { ...node.data, generationStatus: 'error', generationError: '请先连接一个已经生成图片的节点作为视频首帧' } }
        : node))
      return
    }
    setNodes((list) => list.map((node) => node.id === id
      ? { ...node, data: { ...node.data, generationStatus: 'generating', generationError: '' } }
      : node))
    try {
      const result = await window.electronAPI.generateVideo({
        projectId: currentProject.id,
        nodeId: id,
        prompt: current.data.prompt,
        aspectRatio,
        duration: currentDuration,
        workflowId: selectedWorkflow?.id,
        referenceImagePath: referenceNode.data.sourcePath,
      })
      if (!result.success || !result.relativePath) {
        throw new Error(result.error || 'ComfyUI 没有返回视频')
      }
      const relativePath = result.relativePath
      const preview = `workspace://${currentProject.id}/${relativePath
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
      const previousPath = current.data.sourcePath
      setNodes((list) => list.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              preview,
              sourcePath: relativePath,
              sourceHistory: previousPath
                ? [...(node.data.sourceHistory ?? []), previousPath]
                : node.data.sourceHistory ?? [],
              generationStatus: 'idle',
              generationError: '',
            },
          }
        : node))

      const storyboardEdge = edges.find((edge) => edge.target === referenceNode.id)
      const storyboardSource = storyboardEdge
        ? nodes.find((node) => node.id === storyboardEdge.source && node.data.kind === 'storyboard')
        : undefined
      const artifactId = storyboardSource?.data.artifactId
      const shotIndex = current.data.shotIndex
      if (artifactId && typeof shotIndex === 'number') {
        const artifact = useAppStore.getState().artifacts.find((item) => item.id === artifactId)
        if (artifact) {
          const shots = parseStoryboard(artifact.content)
          const nextShots = shots.map((shot) => shot.index === shotIndex
            ? {
                ...shot,
                duration: currentDuration,
                imageToVideoPrompt: current.data.prompt,
                videoSource: relativePath,
                videoSourceHistory: shot.videoSource
                  ? [...(shot.videoSourceHistory ?? []), shot.videoSource]
                  : shot.videoSourceHistory ?? [],
              }
            : shot)
          const content = JSON.stringify(nextShots, null, 2)
          updateArtifactContent(artifact.id, content)
          if (artifact.path) {
            await window.electronAPI.saveArtifactContent(currentProject.id, artifact.path, content)
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setNodes((list) => list.map((node) => node.id === id
        ? { ...node, data: { ...node.data, generationStatus: 'error', generationError: message } }
        : node))
    }
  }

  return (
    <div className="nodrag nowheel mt-3 cursor-default rounded-2xl border border-white/[0.09] bg-[#17171b] p-3 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
      <div className="mb-3 flex items-center gap-1.5 text-[10px] text-white/45">
        <span className="rounded-full bg-white/[0.06] px-2 py-1">＋ 参考</span>
        <span className="rounded-full bg-white/[0.06] px-2 py-1">◎ 标记</span>
        <span className="rounded-full bg-white/[0.06] px-2 py-1">◇ 风格</span>
        <div className="nodrag relative ml-auto">
            <button
              onClick={() => setWorkflowMenuOpen((open) => !open)}
              className={`flex max-w-[190px] items-center gap-1.5 rounded-full border px-2.5 py-1 transition ${workflowMenuOpen ? 'border-[#d4af37]/45 bg-[#d4af37]/10 text-[#f0d98c]' : 'border-white/[0.06] bg-white/[0.05] text-white/48 hover:text-white/75'}`}
              title="选择 ComfyUI 工作流"
            >
              <span className="truncate">{selectedWorkflow?.name ?? '加载工作流…'}</span>
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
                      {workflow.kind === 'image-to-video' ? '图生视频' : workflow.kind === 'image-to-image' ? '图生图' : '文生图'}
                    </span>
                  </button>
                ))}
              </div>
            )}
        </div>
      </div>

      {incoming.length > 0 && (
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
        placeholder={kind === 'image' ? '描述你想要生成的画面内容，连接其他节点可引用素材…' : '描述视频的运动、镜头和节奏，连接图片节点可作为首帧参考…'}
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
              <span>RTX 放大</span>
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
          onClick={() => void (kind === 'image' ? generateImage() : generateVideo())}
          disabled={generationState === 'generating' || !selectedWorkflow}
          className="flex h-9 min-w-[72px] items-center justify-center gap-2 rounded-xl bg-[#e8e6df] px-4 text-[11px] font-semibold tracking-wider text-[#17171b] shadow-[0_5px_18px_rgba(255,255,255,0.08)] transition hover:bg-white hover:shadow-[0_7px_22px_rgba(255,255,255,0.13)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          title={kind === 'image' ? '使用 ComfyUI 生成图片' : '使用 LTX 2.3 生成视频'}
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

function StoryboardNodeCard({ id, data, selected }: { id: string; data: StoryNodeData; selected: boolean }) {
  const shots = data.shots ?? []

  return (
    <div className="w-[620px]">
      <div className="mb-1.5 flex items-center gap-1 text-[11px] text-white/48">
        {nodeIcon('storyboard')}
        <span>{data.title}</span>
        <span className="ml-auto text-white/25">{shots.length} 个镜头</span>
        <NodeDeleteButton id={id} />
      </div>
      <div className={`overflow-visible rounded-xl border bg-[#17171b] shadow-[0_10px_35px_rgba(0,0,0,0.3)] ${selected ? 'border-[#e8c766]/75' : 'border-white/[0.13]'}`}>
        <Handle type="target" position={Position.Left} className="story-handle" />
        <div className="grid grid-cols-[52px_1fr_80px_110px] rounded-t-[11px] border-b border-white/[0.08] bg-white/[0.045] px-3 py-2 text-[10px] font-medium text-white/38">
          <span>镜号</span>
          <span>画面 / 台词</span>
          <span>时长</span>
          <span>运镜</span>
        </div>
        {shots.length > 0 ? shots.map((shot) => (
          <div
            key={shot.index}
            className="relative grid min-h-[86px] grid-cols-[52px_1fr_80px_110px] items-start border-b border-white/[0.06] px-3 py-3 text-[11px] last:rounded-b-[11px] last:border-b-0"
          >
            <span className="font-medium text-[#e8c766]">#{shot.index}</span>
            <div className="pr-4">
              <p className="line-clamp-2 leading-5 text-white/76">{shot.scene}</p>
              {shot.dialogue && <p className="mt-1 line-clamp-1 text-white/38">{shot.dialogue}</p>}
            </div>
            <span className="text-white/52">{shot.duration}s</span>
            <span className="truncate text-white/52">{shot.camera || '—'}</span>
            <Handle
              id={`shot-${shot.index}`}
              type="source"
              position={Position.Right}
              className="story-handle"
              title={`连接镜头 ${shot.index}`}
            />
          </div>
        )) : (
          <div className="px-4 py-10 text-center text-xs text-white/30">分镜数据为空或格式不正确</div>
        )}
      </div>
    </div>
  )
}

function StoryNodeCard({ id, data, selected }: NodeProps<StoryNode>) {
  const { setNodes } = useReactFlow<StoryNode, StoryEdge>()
  if (data.kind === 'storyboard') {
    return <StoryboardNodeCard id={id} data={data} selected={selected} />
  }
  const mediaKind = data.kind === 'image' || data.kind === 'video' ? data.kind : null
  const aspectRatio = data.aspectRatio ?? '16:9'
  const aspectRatioValue = aspectRatio === '1:1' ? '1 / 1' : aspectRatio === '4:3' ? '4 / 3' : '16 / 9'

  return (
    <div className={mediaKind ? 'w-[420px]' : 'w-[250px]'}>
      <div className="mb-1.5 flex items-center gap-1 text-[11px] text-white/48">
        {nodeIcon(data.kind)}
        <span>{data.title}</span>
        {data.generationStatus === 'generating' && (
          <span className="ml-1 flex items-center gap-1 text-[9px] text-[#e8c766]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#e8c766]" />
            生成中
          </span>
        )}
        <span className="ml-auto" />
        <NodeDeleteButton id={id} />
      </div>
      <div
        className={`relative overflow-visible rounded-xl border bg-[#202023] shadow-[0_10px_35px_rgba(0,0,0,0.3)] transition ${selected ? 'border-[#e8c766]/75 shadow-[0_0_0_1px_rgba(232,199,102,0.18),0_18px_45px_rgba(0,0,0,0.4)]' : 'border-white/[0.13]'}`}
      >
        <Handle type="target" position={Position.Left} className="story-handle" />
        {mediaKind ? (
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
              <EmptyPreview kind={mediaKind} />
            )}
            {data.generationStatus === 'generating' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#101014]/75 text-[#e8c766] backdrop-blur-[2px]">
                <span className="h-7 w-7 animate-spin rounded-full border-2 border-[#e8c766]/20 border-t-[#e8c766]" />
                <span className="text-[11px] tracking-wider">ComfyUI 生成中</span>
              </div>
            )}
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
      {selected && mediaKind && <PromptPanel id={id} kind={mediaKind} />}
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
    title: `${kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'storyboard' ? '分镜表' : '文本'}节点 ${index}`,
    prompt: '',
    aspectRatio: kind === 'image' || kind === 'video' ? '16:9' : undefined,
    duration: kind === 'video' ? 5 : undefined,
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

  useEffect(() => {
    if (!folderPath || loadedFolderRef.current === folderPath) return
    loadedFolderRef.current = folderPath
    readyToSaveRef.current = false
    setNodes([])
    setEdges([])
    setDismissedArtifacts({})

    void window.electronAPI.loadCanvasSnapshot(folderPath)
      .then((snapshot: unknown) => {
        if (isFlowSnapshot(snapshot)) {
          setNodes(snapshot.nodes.map((node) => node.data.generationStatus === 'generating'
            ? { ...node, data: { ...node.data, generationStatus: 'idle', generationError: '' } }
            : node))
          setEdges(snapshot.edges.map((edge) => ({ ...edge, type: 'default' as const })))
          setDismissedArtifacts(snapshot.dismissedArtifacts ?? {})
          void setViewport(snapshot.viewport ?? DEFAULT_VIEWPORT)
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
        version: 1,
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
    const dataUpdates = new Map<string, StoryNodeData>()

    for (const artifact of artifacts) {
      if ((dismissedArtifacts[artifact.id] ?? -1) >= artifact.timestamp) continue
      const matchingArtifactNodes = nodes.filter((node) => node.data.artifactId === artifact.id)
      const existingArtifactNode = matchingArtifactNodes.find((node) => node.data.kind === 'storyboard') ?? matchingArtifactNodes[0]
      const sequence = nodes.length + additions.length + 1

      if (artifact.type === 'storyboard') {
        const shots = parseStoryboard(artifact.content)
        const originY = 80 + Math.floor(sequence / 2) * 80
        const boardNode: StoryNode = existingArtifactNode?.data.kind === 'storyboard'
          ? existingArtifactNode
          : {
              ...makeNode('storyboard', sequence, { x: 80, y: originY }),
              data: {
                kind: 'storyboard',
                title: artifact.title,
                prompt: '',
                artifactId: artifact.id,
                shots,
              },
            }
        if (existingArtifactNode?.data.kind !== 'storyboard') {
          additions.push(boardNode)
        } else {
          const nextData: StoryNodeData = { ...boardNode.data, title: artifact.title, shots }
          if (JSON.stringify(boardNode.data.shots) !== JSON.stringify(shots) || boardNode.data.title !== artifact.title) {
            dataUpdates.set(boardNode.id, nextData)
          }
        }

        shots.forEach((shot, shotOffset) => {
          const imageId = `${boardNode.id}-shot-${shot.index}-image`
          const videoId = `${boardNode.id}-shot-${shot.index}-video`
          const existingImage = nodes.find((node) => node.id === imageId)
          const existingVideo = nodes.find((node) => node.id === videoId)
          const imageNode: StoryNode = {
            ...makeNode('image', shot.index, { x: 800, y: originY + shotOffset * 330 }),
            id: imageId,
            data: {
              kind: 'image',
              title: `镜头 ${shot.index} · 图片`,
              prompt: shot.textToImagePrompt || shot.scene,
              shotIndex: shot.index,
              aspectRatio: '16:9',
            },
          }
          const videoNode: StoryNode = {
            ...makeNode('video', shot.index, { x: 1320, y: originY + shotOffset * 330 }),
            id: videoId,
            data: {
              kind: 'video',
              title: `镜头 ${shot.index} · 视频`,
              prompt: shot.imageToVideoPrompt || shot.camera || '',
              shotIndex: shot.index,
              aspectRatio: '16:9',
              duration: ([5, 10, 15] as const).includes(shot.duration as 5 | 10 | 15) ? shot.duration : 5,
            },
          }
          if (!existingImage) additions.push(imageNode)
          if (!existingVideo) additions.push(videoNode)
          linkedEdges.push(
            makeLinkedEdge(
              `${boardNode.id}-shot-${shot.index}-to-image`,
              boardNode.id,
              imageNode.id,
              `shot-${shot.index}`,
            ),
            makeLinkedEdge(
              `${boardNode.id}-shot-${shot.index}-image-to-video`,
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

    if (additions.length > 0 || dataUpdates.size > 0) {
      setNodes((current) => [
        ...current.map((node) => dataUpdates.has(node.id) ? { ...node, data: dataUpdates.get(node.id)! } : node),
        ...additions,
      ])
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

    for (const node of nodes) {
      if (removedIds.has(node.id) && node.data.kind === 'storyboard') {
        const childPrefix = `${node.id}-shot-`
        for (const candidate of nodes) {
          if (candidate.id.startsWith(childPrefix)) removedIds.add(candidate.id)
        }
      }
    }

    const explicitRemovedIds = new Set(
      changes.filter((change) => change.type === 'remove').map((change) => change.id),
    )
    const expandedChanges: NodeChange<StoryNode>[] = [
      ...changes,
      ...[...removedIds]
        .filter((id) => !explicitRemovedIds.has(id))
        .map((id) => ({ type: 'remove' as const, id })),
    ]

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

    onNodesChange(expandedChanges)
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
      {(['text', 'image', 'video'] as StoryNodeKind[]).map((kind) => (
        <button
          key={kind}
          onClick={() => addNode(kind)}
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] text-white/60 transition hover:bg-white/[0.08] hover:text-white"
          title={`添加${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '文本'}节点`}
        >
          {nodeIcon(kind)}
          {kind === 'image' ? '图片' : kind === 'video' ? '视频' : '文本'}
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
          nodeColor={(node) => node.data.kind === 'image' ? '#8b7355' : node.data.kind === 'video' ? '#566b7f' : '#67636e'}
          maskColor="rgba(5,5,8,0.72)"
        />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="mb-20 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d4af37]/20 bg-[#d4af37]/[0.06] text-2xl text-[#e8c766]">✦</div>
            <p className="mt-4 text-sm tracking-[0.2em] text-white/65">创建你的第一个分镜节点</p>
            <p className="mt-2 text-xs text-white/30">从下方添加文本、图片或视频节点</p>
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
