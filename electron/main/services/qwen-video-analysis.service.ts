import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { getRuntimeSettings, QWEN_OMNI_MODEL } from './settings.service'

const INLINE_RAW_FILE_LIMIT = 7 * 1024 * 1024
const MAX_TEMP_UPLOAD_SIZE = 100 * 1024 * 1024
const ANALYSIS_TIMEOUT_MS = 5 * 60_000

const VIDEO_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
}

interface UploadPolicy {
  policy: string
  signature: string
  upload_dir: string
  upload_host: string
  oss_access_key_id: string
  x_oss_object_acl: string
  x_oss_forbid_overwrite: string
}

export interface AnalyzeVideoResult {
  model: string
  analysisText: string
  reportPath: string
}

const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, '')

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0
}

export function validatePublicVideoUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error(`无效的视频 URL：${input}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('远程视频地址只支持 http:// 或 https://')
  }
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('远程视频地址不能指向本机或私有网络')
  }
  const ipVersion = net.isIP(hostname)
  if ((ipVersion === 4 && isPrivateIpv4(hostname)) || (ipVersion === 6 && (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')))) {
    throw new Error('远程视频地址不能指向本机或私有网络')
  }
  return url.toString()
}

export function resolveAnalysisVideoInput(folderPath: string, input: string): { kind: 'remote'; url: string } | { kind: 'local'; filePath: string } {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('视频地址不能为空')
  if (/^https?:\/\//i.test(trimmed)) return { kind: 'remote', url: validatePublicVideoUrl(trimmed) }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error('视频地址只支持项目内文件路径或公开的 http(s) URL')
  }
  const root = path.resolve(folderPath)
  const filePath = path.resolve(root, trimmed)
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`本地视频必须位于项目目录内：${input}`)
  }
  return { kind: 'local', filePath }
}

function isBeijingDashScope(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return hostname === 'dashscope.aliyuncs.com' || hostname.endsWith('.cn-beijing.maas.aliyuncs.com')
  } catch {
    return false
  }
}

async function uploadTemporaryFile(filePath: string, apiKey: string): Promise<string> {
  const stat = await fs.stat(filePath)
  if (stat.size > MAX_TEMP_UPLOAD_SIZE) {
    throw new Error(`视频大小 ${(stat.size / 1024 / 1024).toFixed(1)} MB 超过 DashScope 临时上传的 100 MB 限制`)
  }
  const policyResponse = await fetch(
    `https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(QWEN_OMNI_MODEL)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!policyResponse.ok) throw new Error(`DashScope 临时上传授权失败：HTTP ${policyResponse.status}`)
  const payload = await policyResponse.json() as { data?: UploadPolicy; message?: string }
  const policy = payload.data
  if (!policy?.upload_host || !policy.upload_dir) throw new Error(`DashScope 临时上传授权缺少必要字段：${payload.message || '未知错误'}`)
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
  const uploadResponse = await fetch(policy.upload_host, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
  if (!uploadResponse.ok) throw new Error(`DashScope 临时文件上传失败：HTTP ${uploadResponse.status}`)
  return `oss://${objectKey}`
}

async function encodeLocalVideo(filePath: string, apiKey: string, baseUrl: string): Promise<{ url: string; usesOss: boolean }> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error(`视频路径不是文件：${filePath}`)
  const extension = path.extname(filePath).toLowerCase()
  const mime = VIDEO_MIME_TYPES[extension]
  if (!mime) throw new Error(`不支持的视频格式：${extension || '无扩展名'}`)
  if (stat.size <= INLINE_RAW_FILE_LIMIT) {
    const bytes = await fs.readFile(filePath)
    return { url: `data:${mime};base64,${bytes.toString('base64')}`, usesOss: false }
  }
  if (!isBeijingDashScope(baseUrl)) {
    throw new Error(`视频为 ${(stat.size / 1024 / 1024).toFixed(1)} MB，大文件自动上传仅支持中国北京 DashScope 端点`)
  }
  return { url: await uploadTemporaryFile(filePath, apiKey), usesOss: true }
}

function extractStreamText(streamBody: string): { text: string; finishReason?: string } {
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
        choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown }; finish_reason?: string | null }>
        error?: { message?: string }
      }
      if (payload.error?.message) streamError = payload.error.message
      if (payload.choices?.[0]?.finish_reason) finishReason = payload.choices[0].finish_reason
      const content = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content
      if (typeof content === 'string') chunks.push(content)
      else if (Array.isArray(content)) {
        for (const item of content) if (item && typeof item === 'object' && 'text' in item) chunks.push(String(item.text))
      }
    } catch {
      // Ignore individual malformed SSE keep-alives; the final empty check remains strict.
    }
  }
  if (streamError) throw new Error(`Qwen 流式响应失败：${streamError}`)
  return { text: chunks.join(''), finishReason }
}

function makeReportStem(videoInput: string): string {
  try {
    const remote = new URL(videoInput)
    return path.basename(remote.pathname, path.extname(remote.pathname)) || 'remote-video'
  } catch {
    return path.basename(videoInput, path.extname(videoInput)) || 'video'
  }
}

export async function analyzeVideoWithQwen(folderPath: string, videoInput: string, analysisRequest: string): Promise<AnalyzeVideoResult> {
  const requirement = analysisRequest.trim()
  if (!requirement) throw new Error('分析要求不能为空')
  const settings = await getRuntimeSettings()
  if (!settings.qwenApiKey) throw new Error('请先在设置页配置 Qwen API Key')
  if (!settings.qwenBaseUrl) throw new Error('请先在设置页配置 Qwen API URL')
  const input = resolveAnalysisVideoInput(folderPath, videoInput)
  const baseUrl = normalizeUrl(settings.qwenBaseUrl)
  const encoded = input.kind === 'remote'
    ? { url: input.url, usesOss: false }
    : await encodeLocalVideo(input.filePath, settings.qwenApiKey, baseUrl)
  const prompt = `你是通用音视频分析助手。完整、按时间顺序检查视频的画面和音轨，并严格围绕用户的分析要求作答。不要套用固定分镜审核维度，不要臆测不可见或不可听的信息。关键判断必须给出时间戳或时间范围；无法确认时明确说明不确定性。用清晰的中文 Markdown 返回分析结果，不要输出 JSON 或代码块。\n\n用户的分析要求：\n${requirement}`
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.qwenApiKey}`,
      'Content-Type': 'application/json',
      ...(encoded.usesOss ? { 'X-DashScope-OssResourceResolve': 'enable' } : {}),
    },
    body: JSON.stringify({
      model: QWEN_OMNI_MODEL,
      messages: [{ role: 'user', content: [
        { type: 'video_url', video_url: { url: encoded.url }, fps: 2, max_pixels: 655360, total_pixels: 134217728 },
        { type: 'text', text: prompt },
      ] }],
      stream: true,
      stream_options: { include_usage: true },
      modalities: ['text'],
      enable_thinking: false,
      temperature: 0,
      max_tokens: 8_000,
    }),
    signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Qwen 视频分析失败：HTTP ${response.status} · ${(await response.text()).slice(0, 1_000)}`)
  const streamed = extractStreamText(await response.text())
  if (streamed.finishReason === 'length') throw new Error('Qwen 视频分析结果因输出长度限制被截断，请缩小分析范围后重试')
  const analysisText = streamed.text.trim()
  if (!analysisText) throw new Error('Qwen3.5-Omni 返回了空分析结果')
  const reportDir = path.join(folderPath, 'generated', 'analyses')
  await fs.mkdir(reportDir, { recursive: true })
  const stem = makeReportStem(videoInput).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'video'
  const reportFile = path.join(reportDir, `${stem}-${Date.now()}-video-analysis.md`)
  const header = `<!--\nvideoInput: ${videoInput}\nmodel: ${QWEN_OMNI_MODEL}\nanalyzedAt: ${new Date().toISOString()}\n-->\n\n`
  await fs.writeFile(reportFile, `${header}${analysisText}\n`, 'utf8')
  return {
    model: QWEN_OMNI_MODEL,
    analysisText,
    reportPath: path.relative(folderPath, reportFile).split(path.sep).join('/'),
  }
}
