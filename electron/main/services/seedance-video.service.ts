import fs from 'node:fs/promises'
import path from 'node:path'
import type { GenerateVideoRequest, GenerateVideoResult } from '../../../src/shared/ipc.types'
import { loadProject } from './project.store'
import { getRuntimeSettings } from './settings.service'

export const SEEDANCE_VIDEO_MODELS = [
  {
    id: 'seedance-2.0',
    model: 'doubao-seedance-2-0-260128',
    name: 'Doubao Seedance 2.0 · 方舟全模态 · 720p',
  },
] as const

type ReferenceKind = 'image' | 'video' | 'audio'

type SeedanceContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: 'reference_image' }
  | { type: 'video_url'; video_url: { url: string }; role: 'reference_video' }
  | { type: 'audio_url'; audio_url: { url: string }; role: 'reference_audio' }

type SeedanceTaskResponse = {
  id?: string
  status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired'
  content?: { video_url?: string }
  error?: { code?: string; message?: string }
}

const MEDIA_TYPES: Record<string, { kind: ReferenceKind; mimeType: string }> = {
  '.png': { kind: 'image', mimeType: 'image/png' },
  '.jpg': { kind: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mimeType: 'image/jpeg' },
  '.webp': { kind: 'image', mimeType: 'image/webp' },
  '.gif': { kind: 'image', mimeType: 'image/gif' },
  '.mp4': { kind: 'video', mimeType: 'video/mp4' },
  '.webm': { kind: 'video', mimeType: 'video/webm' },
  '.mov': { kind: 'video', mimeType: 'video/quicktime' },
  '.mp3': { kind: 'audio', mimeType: 'audio/mpeg' },
  '.wav': { kind: 'audio', mimeType: 'audio/wav' },
  '.m4a': { kind: 'audio', mimeType: 'audio/mp4' },
  '.aac': { kind: 'audio', mimeType: 'audio/aac' },
  '.flac': { kind: 'audio', mimeType: 'audio/flac' },
  '.ogg': { kind: 'audio', mimeType: 'audio/ogg' },
}

const REFERENCE_LIMITS: Record<ReferenceKind, { count: number; bytes: number; label: string }> = {
  image: { count: 9, bytes: 30 * 1024 * 1024, label: '图片' },
  video: { count: 3, bytes: 50 * 1024 * 1024, label: '视频' },
  audio: { count: 3, bytes: 15 * 1024 * 1024, label: '音频' },
}

const POLL_INTERVAL_MS = 5_000
const GENERATION_TIMEOUT_MS = 25 * 60_000

export function isSeedanceVideoWorkflow(workflowId?: string): boolean {
  return SEEDANCE_VIDEO_MODELS.some((item) => item.id === workflowId)
}

export function buildSeedanceVideoRequest(
  request: Pick<GenerateVideoRequest, 'prompt' | 'aspectRatio' | 'duration'>,
  model: string,
  references: SeedanceContent[] = [],
) {
  const duration = Math.max(4, Math.min(15, Math.round(Number(request.duration ?? 5))))
  return {
    model,
    content: [
      { type: 'text' as const, text: request.prompt.trim() },
      ...references,
    ],
    ratio: request.aspectRatio,
    duration,
    resolution: '720p',
    generate_audio: true,
    watermark: false,
  }
}

async function readProjectReference(
  projectRoot: string,
  relativePath: string,
  expectedKind: ReferenceKind,
): Promise<string> {
  if (!relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error('Seedance 参考素材路径必须是项目内的相对路径')
  }
  const root = await fs.realpath(path.resolve(projectRoot))
  const filePath = await fs.realpath(path.resolve(root, relativePath))
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Seedance 参考素材不在当前项目目录内')
  }
  const mediaType = MEDIA_TYPES[path.extname(filePath).toLowerCase()]
  if (!mediaType || mediaType.kind !== expectedKind) {
    throw new Error(`Seedance 不支持该${REFERENCE_LIMITS[expectedKind].label}参考素材格式`)
  }
  const bytes = await fs.readFile(filePath)
  if (bytes.byteLength > REFERENCE_LIMITS[expectedKind].bytes) {
    throw new Error(`Seedance 单个${REFERENCE_LIMITS[expectedKind].label}参考素材不能超过 ${REFERENCE_LIMITS[expectedKind].bytes / 1024 / 1024} MB`)
  }
  return `data:${mediaType.mimeType};base64,${bytes.toString('base64')}`
}

async function buildReferenceContent(projectRoot: string, request: GenerateVideoRequest): Promise<SeedanceContent[]> {
  const groups = [
    { kind: 'image' as const, paths: request.referenceImagePaths ?? [] },
    { kind: 'video' as const, paths: request.referenceVideoPaths ?? [] },
    { kind: 'audio' as const, paths: request.referenceAudioPaths ?? [] },
  ]
  const content: SeedanceContent[] = []
  for (const { kind, paths } of groups) {
    const filtered = paths.filter(Boolean)
    if (filtered.length > REFERENCE_LIMITS[kind].count) {
      throw new Error(`Seedance 2.0 最多连接 ${REFERENCE_LIMITS[kind].count} 个${REFERENCE_LIMITS[kind].label}参考素材`)
    }
    for (const relativePath of filtered) {
      const url = await readProjectReference(projectRoot, relativePath, kind)
      if (kind === 'image') content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
      if (kind === 'video') content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' })
      if (kind === 'audio') content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })
    }
  }
  return content
}

async function fetchSeedanceJson(url: string, apiKey: string, init?: RequestInit): Promise<SeedanceTaskResponse> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  })
  const responseText = await response.text()
  let payload: SeedanceTaskResponse
  try {
    payload = JSON.parse(responseText) as SeedanceTaskResponse
  } catch {
    throw new Error(`Seedance API 返回了无效响应（HTTP ${response.status}）`)
  }
  if (!response.ok) {
    const detail = payload.error?.message || responseText.slice(0, 500)
    throw new Error(`Seedance API 请求失败（HTTP ${response.status}）：${detail}`)
  }
  return payload
}

async function waitForSeedanceTask(baseUrl: string, apiKey: string, taskId: string): Promise<string> {
  const deadline = Date.now() + GENERATION_TIMEOUT_MS
  while (Date.now() < deadline) {
    const task = await fetchSeedanceJson(`${baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, apiKey)
    if (task.status === 'succeeded') {
      if (!task.content?.video_url) throw new Error('Seedance 任务成功但未返回视频地址')
      return task.content.video_url
    }
    if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired') {
      throw new Error(`Seedance 视频生成失败：${task.error?.message || task.status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error('Seedance 视频生成等待超时，请稍后重试')
}

export async function generateVideoWithSeedance(request: GenerateVideoRequest): Promise<GenerateVideoResult> {
  const project = await loadProject(request.projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  if (!request.prompt.trim()) throw new Error('请先输入视频生成提示词')
  const selected = SEEDANCE_VIDEO_MODELS.find((item) => item.id === request.workflowId)
  if (!selected) throw new Error('未选择有效的 Seedance 视频模型')

  const settings = await getRuntimeSettings()
  if (!settings.seedreamApiKey) throw new Error('请先在设置页配置方舟 Agent Plan API Key')
  const references = await buildReferenceContent(project.folderPath, request)
  const body = buildSeedanceVideoRequest(request, selected.model, references)
  const submitted = await fetchSeedanceJson(
    `${settings.seedreamBaseUrl}/contents/generations/tasks`,
    settings.seedreamApiKey,
    {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2 * 60_000),
    },
  )
  if (!submitted.id) throw new Error('Seedance 未返回视频生成任务 ID')

  const videoUrl = await waitForSeedanceTask(settings.seedreamBaseUrl, settings.seedreamApiKey, submitted.id)
  const download = await fetch(videoUrl, { signal: AbortSignal.timeout(2 * 60_000) })
  if (!download.ok) throw new Error(`Seedance 生成结果下载失败（HTTP ${download.status}）`)
  const bytes = Buffer.from(await download.arrayBuffer())
  if (!bytes.length) throw new Error('Seedance 生成结果为空')

  const safeNodeId = request.nodeId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(-48)
  const outputDir = path.join(project.folderPath, 'generated', 'videos')
  await fs.mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `${safeNodeId}-seedance-${Date.now()}.mp4`)
  await fs.writeFile(outputPath, bytes)
  return {
    success: true,
    relativePath: path.relative(project.folderPath, outputPath).split(path.sep).join('/'),
    promptId: submitted.id,
  }
}
