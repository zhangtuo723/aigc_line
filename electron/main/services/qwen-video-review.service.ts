import fs from 'node:fs/promises'
import path from 'node:path'
import type { CanvasNodeSnapshot, CanvasStateSnapshot } from '../../../src/shared/ipc.types'
import { getRuntimeSettings, QWEN_OMNI_MODEL } from './settings.service'

const INLINE_RAW_FILE_LIMIT = 7 * 1024 * 1024
const MAX_TEMP_UPLOAD_SIZE = 100 * 1024 * 1024
const REVIEW_TIMEOUT_MS = 5 * 60_000

const REVIEW_DIMENSIONS = [
  { id: 'identity_continuity', label: '角色身份与服装连续性' },
  { id: 'scene_props', label: '场景与道具一致性' },
  { id: 'action_narrative', label: '动作与叙事执行' },
  { id: 'shot_camera', label: '子镜头、运镜与转场' },
  { id: 'visual_quality', label: '画面与生成技术质量' },
  { id: 'dialogue_speaker', label: '台词、旁白与说话人' },
  { id: 'sound_design', label: '环境音、音效与 BGM' },
  { id: 'lip_av_sync', label: '口型与音画同步' },
  { id: 'spec_timeline', label: '提示词与时间线符合度' },
] as const

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

export interface QwenVideoReviewRequest {
  videoNodeId: string
  sourcePath: string
  expectedContent: string
  referenceImagePaths?: string[]
  referenceNodeIds?: string[]
  relatedShotNodeIds?: string[]
}

export interface QwenVideoReviewResult {
  model: string
  reportPath: string
  reviewText: string
}

interface UploadPolicy {
  policy: string
  signature: string
  upload_dir: string
  upload_host: string
  max_file_size_mb?: number
  oss_access_key_id: string
  x_oss_object_acl: string
  x_oss_forbid_overwrite: string
}

const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, '')

function resolveWorkspaceFile(folderPath: string, inputPath: string): string {
  const root = path.resolve(folderPath)
  const filePath = path.resolve(root, inputPath)
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`媒体路径必须位于项目目录内：${inputPath}`)
  }
  return filePath
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))]
}

function resolveTargetVideoNode(state: CanvasStateSnapshot, nodeId: string): CanvasNodeSnapshot {
  const nodesById = new Map(state.nodes.map((node) => [node.id, node]))
  const startNode = nodesById.get(nodeId)
  if (!startNode) throw new Error(`画布中找不到节点：${nodeId}`)
  if (startNode.data.kind === 'video') {
    if (!startNode.data.sourcePath) throw new Error(`视频节点 ${nodeId} 还没有生成结果 sourcePath`)
    return startNode
  }
  if (startNode.data.kind !== 'shot' && startNode.data.kind !== 'image') {
    throw new Error(`节点 ${nodeId} 不是 shot、image 或 video 节点，无法定位待审查视频`)
  }

  const visited = new Set([nodeId])
  let frontier = [nodeId]
  const videos: CanvasNodeSnapshot[] = []
  while (frontier.length && videos.length < 2) {
    const next: string[] = []
    for (const sourceId of frontier) {
      for (const edge of state.edges.filter((item) => item.source === sourceId)) {
        if (visited.has(edge.target)) continue
        visited.add(edge.target)
        const target = nodesById.get(edge.target)
        if (!target) continue
        if (target.data.kind === 'video') videos.push(target)
        else next.push(target.id)
      }
    }
    frontier = next
  }
  if (!videos.length) throw new Error(`节点 ${nodeId} 的下游没有 video 节点`)
  if (videos.length > 1) throw new Error(`节点 ${nodeId} 关联了多个 video 节点，请改传具体 video 节点 ID`)
  if (!videos[0].data.sourcePath) throw new Error(`视频节点 ${videos[0].id} 还没有生成结果 sourcePath`)
  return videos[0]
}

export function resolveVideoReviewRequest(
  state: CanvasStateSnapshot,
  nodeId: string,
): QwenVideoReviewRequest {
  const videoNode = resolveTargetVideoNode(state, nodeId)
  const videoNodeId = videoNode.id
  const nodesById = new Map(state.nodes.map((node) => [node.id, node]))
  const incomingNodeIds = state.edges
    .filter((edge) => edge.target === videoNodeId)
    .map((edge) => edge.source)
  const incomingNodes = incomingNodeIds
    .map((id) => nodesById.get(id))
    .filter((node): node is CanvasNodeSnapshot => !!node)

  const explicitReferenceIds = unique([
    ...(videoNode.data.referenceImageNodeIds ?? []),
    videoNode.data.firstFrameNodeId,
    videoNode.data.lastFrameNodeId,
  ])
  const fallbackImageIds = incomingNodes
    .filter((node) => node.data.kind === 'image')
    .map((node) => node.id)
  const referenceNodeIds = unique([
    ...explicitReferenceIds,
    ...fallbackImageIds,
  ]).slice(0, 9)
  const referenceNodes = referenceNodeIds
    .map((id) => nodesById.get(id))
    .filter((node): node is CanvasNodeSnapshot => node?.data.kind === 'image' && !!node.data.sourcePath)

  const directShotIds = incomingNodes
    .filter((node) => node.data.kind === 'shot')
    .map((node) => node.id)
  const upstreamShotIds = incomingNodes
    .filter((node) => node.data.kind === 'image')
    .flatMap((imageNode) => state.edges
      .filter((edge) => edge.target === imageNode.id)
      .map((edge) => nodesById.get(edge.source))
      .filter((node): node is CanvasNodeSnapshot => node?.data.kind === 'shot')
      .map((node) => node.id))
  const relatedShotNodeIds = unique([...directShotIds, ...upstreamShotIds])
  const relatedShots = relatedShotNodeIds
    .map((id) => nodesById.get(id))
    .filter((node): node is CanvasNodeSnapshot => !!node)

  const shotContext = relatedShots.length
    ? relatedShots.map((node) => ({
      nodeId: node.id,
      title: node.data.title,
      shotNumber: node.data.shotNumber,
      scene: node.data.scene,
    }))
    : [{ note: '未找到通过画布连线关联的 shot 节点' }]
  const referenceContext = referenceNodes.map((node, index) => ({
    picture: `<Picture ${index + 1}>`,
    nodeId: node.id,
    title: node.data.title,
    prompt: node.data.prompt,
    sourcePath: node.data.sourcePath,
  }))
  const expectedContent = [
    'Canvas video node:',
    JSON.stringify({
      nodeId: videoNode.id,
      title: videoNode.data.title,
      workflowId: videoNode.data.workflowId,
      duration: videoNode.data.duration,
      aspectRatio: videoNode.data.aspectRatio,
    }, null, 2),
    'Related shot context:',
    JSON.stringify(shotContext, null, 2),
    'Ordered reference image context:',
    JSON.stringify(referenceContext, null, 2),
    'Original video generation prompt:',
    videoNode.data.prompt?.trim() || 'No video prompt was stored on this node.',
  ].join('\n\n')

  return {
    videoNodeId,
    sourcePath: videoNode.data.sourcePath,
    expectedContent,
    referenceImagePaths: referenceNodes.map((node) => node.data.sourcePath as string),
    referenceNodeIds: referenceNodes.map((node) => node.id),
    relatedShotNodeIds,
  }
}

function isBeijingDashScope(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return hostname === 'dashscope.aliyuncs.com' || hostname.endsWith('.cn-beijing.maas.aliyuncs.com')
  } catch {
    return false
  }
}

async function uploadTemporaryFile(
  filePath: string,
  apiKey: string,
  model: string,
): Promise<string> {
  const stat = await fs.stat(filePath)
  if (stat.size > MAX_TEMP_UPLOAD_SIZE) {
    throw new Error(`文件大小 ${(stat.size / 1024 / 1024).toFixed(1)} MB 超过 DashScope 临时上传的 100 MB 限制`)
  }
  const policyResponse = await fetch(
    `https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!policyResponse.ok) {
    throw new Error(`DashScope 临时上传授权失败：HTTP ${policyResponse.status} · ${(await policyResponse.text()).slice(0, 500)}`)
  }
  const payload = await policyResponse.json() as { data?: UploadPolicy; message?: string }
  const policy = payload.data
  if (!policy?.upload_host || !policy.upload_dir) {
    throw new Error(`DashScope 临时上传授权缺少必要字段：${payload.message || '未知错误'}`)
  }
  const fileName = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectKey = `${policy.upload_dir}/${Date.now()}-${fileName}`
  const bytes = await fs.readFile(filePath)
  const form = new FormData()
  form.append('OSSAccessKeyId', policy.oss_access_key_id)
  form.append('Signature', policy.signature)
  form.append('policy', policy.policy)
  form.append('x-oss-object-acl', policy.x_oss_object_acl)
  form.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite)
  form.append('key', objectKey)
  form.append('success_action_status', '200')
  form.append('file', new Blob([new Uint8Array(bytes)]), fileName)
  const uploadResponse = await fetch(policy.upload_host, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(120_000),
  })
  if (!uploadResponse.ok) {
    throw new Error(`DashScope 临时文件上传失败：HTTP ${uploadResponse.status} · ${(await uploadResponse.text()).slice(0, 500)}`)
  }
  return `oss://${objectKey}`
}

async function encodeMedia(
  filePath: string,
  apiKey: string,
  baseUrl: string,
): Promise<{ url: string; usesOss: boolean }> {
  const stat = await fs.stat(filePath)
  const extension = path.extname(filePath).toLowerCase()
  const mime = MIME_TYPES[extension]
  if (!mime) throw new Error(`Qwen 音视频审查不支持此文件格式：${extension || '无扩展名'}`)
  if (stat.size <= INLINE_RAW_FILE_LIMIT) {
    const bytes = await fs.readFile(filePath)
    return { url: `data:${mime};base64,${bytes.toString('base64')}`, usesOss: false }
  }
  if (!isBeijingDashScope(baseUrl)) {
    throw new Error(
      `视频为 ${(stat.size / 1024 / 1024).toFixed(1)} MB，Base64 直传会超过 10 MB 限制。`
      + '大文件自动上传目前仅支持中国北京 DashScope 端点。',
    )
  }
  return { url: await uploadTemporaryFile(filePath, apiKey, QWEN_OMNI_MODEL), usesOss: true }
}

function extractResponseText(payload: unknown): string {
  const choice = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
  const content = choice?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => item && typeof item === 'object' && 'text' in item ? String(item.text) : '')
      .filter(Boolean)
      .join('\n')
  }
  throw new Error('Qwen 返回了空响应')
}

function extractStreamText(streamBody: string): string {
  const chunks: string[] = []
  for (const line of streamBody.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      const payload = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>
      }
      const content = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content
      if (typeof content === 'string') chunks.push(content)
      else if (Array.isArray(content)) {
        for (const item of content) {
          if (item && typeof item === 'object' && 'text' in item) chunks.push(String(item.text))
        }
      }
    } catch {
      // Ignore keep-alives and malformed individual SSE events; the final empty check remains strict.
    }
  }
  if (chunks.length) return chunks.join('')
  try {
    return extractResponseText(JSON.parse(streamBody))
  } catch {
    throw new Error('Qwen 流式响应中没有可读取的文本')
  }
}

function buildReviewPrompt(expectedContent: string, referenceCount: number): string {
  return `You are an evidence-based audiovisual video reviewer. Inspect the complete target video chronologically at the supplied visual sampling rate.${referenceCount ? ` Compare it with the ${referenceCount} reference image(s), in their supplied order.` : ''}

Expected production specification:
${expectedContent}

Review only claims supported by direct evidence. Inspect both the complete visual stream and complete audio track. Cite precise timestamps such as 00:03.500, or start/end ranges, for every finding. Score each dimension independently from 0 to 100 and report both strengths and defects. Do not calculate an overall score and do not decide pass, fail, acceptance, repair, or regeneration; the production Agent will make that decision from your evidence and dimension scores.

Review exactly these dimensions without weights:
${REVIEW_DIMENSIONS.map((dimension, index) => `${index + 1}. ${dimension.label} (${dimension.id})`).join('\n')}

List conspicuous high-impact problems in highImpactIssues, but do not turn them into an automatic verdict. The production Agent decides their importance in context. Examples include wrong or unrecognizable principal character, identity changes, missing or materially incorrect dialogue, wrong speaker, prohibited BGM, severe lip/audio-video desynchronization, missing key story action, or corrupted footage. Keep small artifacts and cosmetic imperfections in the relevant dimension findings instead.

Transcribe every spoken line verbatim with speaker (or "unknown speaker"), language, tone/emotion, start and end timestamps. Do not infer inaudible words. Compare the result against the complete expected production specification.

Return a plain-text Chinese Markdown review, not JSON, XML, YAML, a code block, or a key-value object. Use this readable structure:
# 分镜视频审核
## 总体观察
## 九维评分
### 1. 角色身份与服装连续性 — 评分：NN/100
For every dimension include 时间戳证据、发现的问题、优点和修改建议. Repeat for all nine dimensions in the supplied order.
## 高影响问题
## 对白转写
## 审核局限
Do not provide an overall score or a pass/fail/regenerate decision.`
}

async function requestQwenReview(
  baseUrl: string,
  apiKey: string,
  usesOss: boolean,
  content: Array<Record<string, unknown>>,
): Promise<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(usesOss ? { 'X-DashScope-OssResourceResolve': 'enable' } : {}),
    },
    body: JSON.stringify({
      model: QWEN_OMNI_MODEL,
      messages: [{ role: 'user', content }],
      stream: true,
      stream_options: { include_usage: true },
      modalities: ['text'],
      enable_thinking: false,
      temperature: 0,
      max_tokens: 4_000,
    }),
    signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Qwen 音视频审核失败：HTTP ${response.status} · ${(await response.text()).slice(0, 1_000)}`)
  }
  return extractStreamText(await response.text())
}

export async function reviewVideoWithQwen(
  folderPath: string,
  request: QwenVideoReviewRequest,
): Promise<QwenVideoReviewResult> {
  const settings = await getRuntimeSettings()
  if (!settings.qwenApiKey) throw new Error('请先在设置页配置 Qwen API Key')
  if (!settings.qwenBaseUrl) throw new Error('请先在设置页配置 Qwen API URL')

  const videoPath = resolveWorkspaceFile(folderPath, request.sourcePath)
  const video = await encodeMedia(
    videoPath,
    settings.qwenApiKey,
    settings.qwenBaseUrl,
  )
  const referencePaths = (request.referenceImagePaths ?? []).slice(0, 9)
  const references = await Promise.all(referencePaths.map(async (inputPath) => {
    const filePath = resolveWorkspaceFile(folderPath, inputPath)
    return encodeMedia(filePath, settings.qwenApiKey, settings.qwenBaseUrl)
  }))
  const usesOss = video.usesOss || references.some((item) => item.usesOss)
  const content: Array<Record<string, unknown>> = [
    {
      type: 'video_url',
      video_url: { url: video.url },
      fps: 2,
      max_pixels: 655360,
      total_pixels: 134217728,
    },
    ...references.map((item) => ({ type: 'image_url', image_url: { url: item.url }, max_pixels: 2621440 })),
    { type: 'text', text: buildReviewPrompt(request.expectedContent, references.length) },
  ]
  const baseUrl = normalizeUrl(settings.qwenBaseUrl)
  const reviewText = (await requestQwenReview(baseUrl, settings.qwenApiKey, usesOss, content)).trim()
  if (!reviewText) throw new Error('Qwen3.5-Omni 返回了空审核文本')
  const reportDir = path.join(folderPath, 'generated', 'reviews')
  await fs.mkdir(reportDir, { recursive: true })
  const stem = path.basename(videoPath, path.extname(videoPath)).replace(/[^a-zA-Z0-9_-]/g, '_')
  const reportName = `${stem}-${Date.now()}-storyboard-video-review.md`
  const reportFile = path.join(reportDir, reportName)
  const reportHeader = [
    '<!--',
    `videoNodeId: ${request.videoNodeId}`,
    `sourcePath: ${request.sourcePath}`,
    `referenceNodeIds: ${(request.referenceNodeIds ?? []).join(', ')}`,
    `relatedShotNodeIds: ${(request.relatedShotNodeIds ?? []).join(', ')}`,
    `model: ${QWEN_OMNI_MODEL}`,
    `reviewedAt: ${new Date().toISOString()}`,
    '-->',
    '',
  ].join('\n')
  await fs.writeFile(reportFile, `${reportHeader}${reviewText}\n`, 'utf8')
  return {
    model: QWEN_OMNI_MODEL,
    reportPath: path.relative(folderPath, reportFile).split(path.sep).join('/'),
    reviewText,
  }
}
