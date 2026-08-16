import fs from 'node:fs/promises'
import path from 'node:path'
import type { CanvasNodeSnapshot, CanvasStateSnapshot } from '../../../src/shared/ipc.types'
import { getRuntimeSettings, QWEN_OMNI_MODEL } from './settings.service'

const INLINE_RAW_FILE_LIMIT = 7 * 1024 * 1024
const MAX_TEMP_UPLOAD_SIZE = 100 * 1024 * 1024
const REVIEW_TIMEOUT_MS = 5 * 60_000

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
}

type ReferenceMediaKind = 'image' | 'video' | 'audio'

export interface QwenReviewReferenceMedia {
  kind: ReferenceMediaKind
  label: string
  nodeId: string
  sourcePath: string
  title?: string
  prompt?: string
}

export interface QwenVideoReviewRequest {
  videoNodeId: string
  sourcePath: string
  expectedContent: string
  duration?: number
  referenceMedia?: QwenReviewReferenceMedia[]
}

export interface QwenVideoReviewResult {
  model: string
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
  if (startNode.data.kind !== 'image') {
    throw new Error(`节点 ${nodeId} 不是 image 或 video 节点，无法定位待审查视频`)
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

  const explicitImageIds = videoNode.data.referenceImageNodeIds ?? []
  const frameIds = unique([videoNode.data.firstFrameNodeId, videoNode.data.lastFrameNodeId])
  const fallbackImageIds = incomingNodes
    .filter((node) => node.data.kind === 'image')
    .map((node) => node.id)
  const imageIds = explicitImageIds.length
    ? explicitImageIds
    : frameIds.length
      ? frameIds
      : fallbackImageIds.slice(0, 9)

  const resolveReferences = (
    ids: string[],
    kind: ReferenceMediaKind,
    prefix: string,
    limit: number,
  ): QwenReviewReferenceMedia[] => ids.slice(0, limit).map((id, index) => {
    const node = nodesById.get(id)
    if (!node) throw new Error(`${prefix} ${index + 1} 引用的节点不存在：${id}`)
    if (node.data.kind !== kind) {
      throw new Error(`${prefix} ${index + 1} 引用的节点 ${id} 不是 ${kind} 节点`)
    }
    if (!node.data.sourcePath) {
      throw new Error(`${prefix} ${index + 1} 引用的节点 ${id} 还没有生成结果 sourcePath`)
    }
    return {
      kind,
      label: `<${prefix} ${index + 1}>`,
      nodeId: id,
      sourcePath: node.data.sourcePath,
      title: node.data.title,
      prompt: node.data.prompt,
    }
  })
  const referenceMedia = [
    ...resolveReferences(imageIds, 'image', 'Picture', 9),
    ...resolveReferences(videoNode.data.referenceVideoNodeIds ?? [], 'video', 'Video', 3),
    ...resolveReferences(videoNode.data.referenceAudioNodeIds ?? [], 'audio', 'Audio', 3),
  ]

  const referenceContext = referenceMedia.map(({ kind, label, nodeId: id, title, prompt, sourcePath }) => ({
    kind, label, nodeId: id, title, prompt, sourcePath,
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
    'Ordered generation reference media context:',
    JSON.stringify(referenceContext, null, 2),
    'Original video generation prompt:',
    videoNode.data.prompt?.trim() || 'No video prompt was stored on this node.',
  ].join('\n\n')

  return {
    videoNodeId,
    sourcePath: videoNode.data.sourcePath,
    expectedContent,
    duration: typeof videoNode.data.duration === 'number' ? videoNode.data.duration : undefined,
    referenceMedia,
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

interface StreamTextResult {
  text: string
  finishReason?: string
}

function extractStreamText(streamBody: string): StreamTextResult {
  const chunks: string[] = []
  let finishReason: string | undefined
  let streamError: string | undefined
  for (const line of streamBody.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      const payload = JSON.parse(data) as {
        choices?: Array<{
          delta?: { content?: unknown }
          message?: { content?: unknown }
          finish_reason?: string | null
        }>
        error?: { message?: string }
      }
      if (payload.error?.message) streamError = payload.error.message
      if (payload.choices?.[0]?.finish_reason) finishReason = payload.choices[0].finish_reason
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
  if (streamError) throw new Error(`Qwen 流式响应失败：${streamError}`)
  if (chunks.length) return { text: chunks.join(''), finishReason }
  try {
    const payload = JSON.parse(streamBody) as { choices?: Array<{ finish_reason?: string | null }> }
    return {
      text: extractResponseText(payload),
      finishReason: payload.choices?.[0]?.finish_reason ?? undefined,
    }
  } catch {
    throw new Error('Qwen 流式响应中没有可读取的文本')
  }
}

function chooseReviewFps(duration?: number): number {
  if (!duration || duration <= 5) return 4
  if (duration <= 15) return 3
  return 2
}

function buildReviewPrompt(
  expectedContent: string,
  referenceEvidence: string,
  fps: number,
): string {
  const timestampResolutionMs = Math.ceil(1_000 / fps)
  return `You are an evidence-based audiovisual video reviewer. Inspect the complete target video chronologically at ${fps} visual frames per second. The video file also contains its complete audio track.

Expected production specification:
${expectedContent}

Evidence extracted from generation reference media (treat it as reference context, not as observations from the target video):
${referenceEvidence || 'No separate reference media were supplied.'}

Review only claims supported by direct evidence. Inspect both the complete visual stream and complete audio track. Include timestamps or ranges when they help locate a finding. Visual timestamps should not claim precision finer than approximately ${timestampResolutionMs} ms; label finer timing estimates as audio-derived. Scores are optional. Do not calculate an overall score and do not decide pass, fail, acceptance, repair, or regeneration; the production Agent will make that decision from your evidence.

Perform an explicit chronological defect sweep, including calm/static moments, fast motion, occlusion, interactions, camera moves, transitions, and shot boundaries. Do not treat a clip as technically sound merely because its story and prompt are broadly correct. Actively look for:
- continuity or production mistakes: unexplained identity/face/age/clothing changes, person or prop appearing/disappearing, count changes, teleporting, jump axis, spatial reversal, inconsistent eyelines, lighting/shadow/reflection mismatch, broken entrances/exits, and reference leakage such as contact sheets or duplicated views;
- visual corruption: facial melting, feature drift, extra/missing/fused fingers or limbs, broken joints, body/object fusion, warped geometry, texture crawling, flicker, ghosting, duplicated subjects, unstable text/subtitles, nonsensical objects, impossible contact/collision, clipping, penetration, floating, frozen regions, corrupted frames, black/green frames, tearing, severe blur, or sudden quality collapse;
- audio corruption: clipping, crackle, pops, buzzing, metallic/robotic or garbled speech, pitch/speed jumps, repeated or truncated syllables, dropouts, abrupt cuts, unstable volume, excessive noise/reverb, channel imbalance, unintended silence, overlapping voices, missing sounds, sound that masks dialogue, and BGM when prohibited;
- audiovisual mismatch: lip-sync drift, wrong speaker voice, voice continuing after the mouth/action stops, impacts/footsteps/door sounds at the wrong time, ambience changing without scene cause, and audio discontinuity at cuts.

For each visible or audible defect, state the timestamp/range, what is directly observed or heard, affected subject/channel, severity (minor/moderate/severe), whether it is momentary or persistent, and a concrete repair suggestion. If a category was checked and no defect was found, say so briefly; never invent a defect. Distinguish intentional stylization, motion blur, depth of field, cuts, and designed sound from genuine corruption.

Review the complete clip against all relevant concerns: character identity and clothing continuity; scene, prop, lighting, reflection and spatial continuity; action, narrative and physical plausibility; internal shots, camera movement, transitions and editing continuity; continuity mistakes and visual corruption; dialogue, narration, speaker and speech integrity; audio corruption, sound effects, ambience, mixing and prohibited BGM; lip, action-sound and audiovisual synchronization; and compliance with the generation prompt, ordered references and timeline. These are review concerns, not a required output schema. Combine related findings, omit genuinely inapplicable concerns, and add other evidence-based concerns when useful.

Call out conspicuous high-impact problems clearly, but do not turn them into an automatic verdict. The production Agent decides their importance in context. Examples include wrong or unrecognizable principal character, identity changes, severe face/body/hand corruption, unexplained subject or prop disappearance, broken spatial continuity, corrupted frames, missing or materially incorrect dialogue, unintelligible or distorted speech, clipping/dropouts, wrong speaker, prohibited BGM, severe lip/audio-video desynchronization, missing key story action, or corrupted footage. Keep small artifacts and cosmetic imperfections in the relevant findings instead.

Transcribe every spoken line with speaker (or "unknown speaker"), language, tone/emotion, and start/end timestamps. Mark uncertain or inaudible words instead of inventing them. Compare the result against the complete expected production specification.

Return a readable Chinese review. Markdown is preferred, but organize the report freely according to the actual evidence. Do not follow a mandatory heading order, field list, score notation, or fixed number of sections. Prioritize concrete observations, useful evidence, problems, strengths, suggestions, spoken-line transcription, and limitations when applicable.
Do not provide an overall score or a pass/fail/regenerate decision.`
}

async function requestQwenReview(
  baseUrl: string,
  apiKey: string,
  usesOss: boolean,
  content: Array<Record<string, unknown>>,
  maxTokens = 8_000,
): Promise<StreamTextResult> {
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
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Qwen 音视频审核失败：HTTP ${response.status} · ${(await response.text()).slice(0, 1_000)}`)
  }
  return extractStreamText(await response.text())
}

async function summarizeReferenceGroup(
  baseUrl: string,
  apiKey: string,
  references: Array<QwenReviewReferenceMedia & { encoded: { url: string; usesOss: boolean } }>,
): Promise<string> {
  if (!references.length) return ''
  const kind = references[0].kind
  const manifest = references.map(({ label, nodeId, title, prompt }) => ({ label, nodeId, title, prompt }))
  const mediaContent = references.map(({ encoded, sourcePath }) => {
    if (kind === 'image') return { type: 'image_url', image_url: { url: encoded.url } }
    if (kind === 'video') return { type: 'video_url', video_url: { url: encoded.url } }
    return {
      type: 'input_audio',
      input_audio: {
        data: encoded.url,
        format: path.extname(sourcePath).slice(1).toLowerCase() || 'mp3',
      },
    }
  })
  const response = await requestQwenReview(
    baseUrl,
    apiKey,
    references.some((item) => item.encoded.usesOss),
    [
      ...mediaContent,
      {
        type: 'text',
        text: `Analyze these ${kind} generation references in the exact supplied order. Their labels and canvas metadata are:\n${JSON.stringify(manifest, null, 2)}\nReturn concise Chinese evidence for later comparison with a generated target video. Preserve every label exactly. For images describe identity, clothing, scene, props and visual style. For videos describe identity, actions, camera, timing and sound. For audio describe speaker/voice, dialogue or lyrics, environment, sound effects and music. Do not judge the unseen target video.`,
      },
    ],
    3_000,
  )
  if (response.finishReason === 'length') throw new Error(`${kind} 参考素材分析因输出长度限制被截断`)
  return `### ${kind} references\n${response.text.trim()}`
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
  const referenceMedia = request.referenceMedia ?? []
  const references = await Promise.all(referenceMedia.map(async (reference) => {
    const filePath = resolveWorkspaceFile(folderPath, reference.sourcePath)
    return {
      ...reference,
      encoded: await encodeMedia(filePath, settings.qwenApiKey, settings.qwenBaseUrl),
    }
  }))
  const baseUrl = normalizeUrl(settings.qwenBaseUrl)
  const referenceEvidenceParts = (await Promise.all(
    (['image', 'video', 'audio'] as const).map((kind) => summarizeReferenceGroup(
      baseUrl,
      settings.qwenApiKey,
      references.filter((item) => item.kind === kind),
    )),
  )).filter(Boolean)
  const fps = chooseReviewFps(request.duration)
  const content: Array<Record<string, unknown>> = [
    {
      type: 'video_url',
      video_url: { url: video.url },
      fps,
      max_pixels: 655360,
      total_pixels: 134217728,
    },
    {
      type: 'text',
      text: buildReviewPrompt(request.expectedContent, referenceEvidenceParts.join('\n\n'), fps),
    },
  ]
  const response = await requestQwenReview(baseUrl, settings.qwenApiKey, video.usesOss, content)
  if (response.finishReason === 'length') {
    throw new Error('Qwen 审核报告因输出长度限制被截断，请缩短视频或减少单镜对白后重试')
  }
  const reviewText = response.text.trim()
  if (!reviewText) throw new Error('Qwen3.5-Omni 返回了空审核文本')
  return {
    model: QWEN_OMNI_MODEL,
    reviewText,
  }
}
