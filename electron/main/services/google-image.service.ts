import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageAspectRatio,
} from '../../../src/shared/ipc.types'
import { loadProject } from './project.store'
import { getRuntimeSettings } from './settings.service'
import { fetchGoogleApi } from './google-network.service'

export const GOOGLE_IMAGE_MODELS = [
  {
    id: 'google-gemini-3.1-flash-image',
    model: 'gemini-3.1-flash-image',
    name: 'Nano Banana 2 · 文生图 / 图生图 · 2K',
  },
  {
    id: 'google-gemini-3-pro-image',
    model: 'gemini-3-pro-image',
    name: 'Nano Banana Pro · 文生图 / 图生图 · 2K',
  },
] as const

export type GoogleImagePart = {
  text?: string
  inlineData?: { mimeType?: string; data?: string }
  inline_data?: { mime_type?: string; data?: string }
}

export function buildGoogleImageParts(
  prompt: string,
  images: Array<{ mimeType: string; data: string }>,
): GoogleImagePart[] {
  return [
    { text: prompt.trim() },
    ...images.map(({ mimeType, data }) => ({ inline_data: { mime_type: mimeType, data } })),
  ]
}

type GoogleImageResponse = {
  candidates?: Array<{
    content?: { parts?: GoogleImagePart[] }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  error?: { message?: string }
}

export function buildGoogleImageGenerationConfig(aspectRatio: ImageAspectRatio) {
  return {
    responseModalities: ['IMAGE'],
    imageConfig: {
      aspectRatio,
      imageSize: '2K',
    },
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

async function resolveProjectImage(projectRoot: string, relativePath: string): Promise<string> {
  if (!relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error('参考图片路径必须是项目内的相对路径')
  }
  const root = await fs.realpath(path.resolve(projectRoot))
  const filePath = await fs.realpath(path.resolve(root, relativePath))
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('参考图片路径不在当前项目目录内')
  }
  return filePath
}

function responseImage(payload: GoogleImageResponse): { data: string; mimeType: string } {
  const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? []
  for (const part of parts) {
    const inline = part.inlineData
      ? { data: part.inlineData.data, mimeType: part.inlineData.mimeType }
      : { data: part.inline_data?.data, mimeType: part.inline_data?.mime_type }
    if (inline.data && inline.mimeType?.startsWith('image/')) {
      return { data: inline.data, mimeType: inline.mimeType }
    }
  }
  const blocked = payload.promptFeedback?.blockReason
    || payload.candidates?.map((candidate) => candidate.finishReason).find(Boolean)
  const modelText = parts.map((part) => part.text).filter(Boolean).join(' ').trim()
  throw new Error(blocked
    ? `Google 图片生成未返回图片：${blocked}${modelText ? ` · ${modelText}` : ''}`
    : `Google 图片生成未返回图片${modelText ? `：${modelText}` : ''}`)
}

export function isGoogleImageWorkflow(workflowId?: string): boolean {
  return GOOGLE_IMAGE_MODELS.some((item) => item.id === workflowId)
}

export async function generateImageWithGoogle(
  request: GenerateImageRequest,
): Promise<GenerateImageResult> {
  const project = await loadProject(request.projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  const prompt = request.prompt.trim()
  if (!prompt) throw new Error('请先输入图片生成提示词')

  const selected = GOOGLE_IMAGE_MODELS.find((item) => item.id === request.workflowId)
  if (!selected) throw new Error('未选择有效的 Nano Banana 图片模型')
  const settings = await getRuntimeSettings()
  if (!settings.googleAiApiKey) throw new Error('请先在设置页配置 Google AI Studio API Key')

  const referencePaths = [...new Set(
    request.referenceImagePaths ?? (request.referenceImagePath ? [request.referenceImagePath] : []),
  )]
  if (referencePaths.length > 14) throw new Error('Nano Banana 最多支持 14 张参考图片')
  const referenceImages: Array<{ mimeType: string; data: string }> = []
  for (const referencePath of referencePaths) {
    const imagePath = await resolveProjectImage(project.folderPath, referencePath)
    const extension = path.extname(imagePath).toLowerCase()
    const mimeType = MIME_BY_EXTENSION[extension]
    if (!mimeType) throw new Error('Nano Banana 图生图仅支持 PNG、JPEG、WebP 或 GIF 参考图片')
    const bytes = await fs.readFile(imagePath)
    if (bytes.byteLength > 20 * 1024 * 1024) {
      throw new Error('Nano Banana 参考图片不能超过 20 MB')
    }
    referenceImages.push({ mimeType, data: bytes.toString('base64') })
  }
  const parts = buildGoogleImageParts(prompt, referenceImages)

  const response = await fetchGoogleApi(
    `https://generativelanguage.googleapis.com/v1/models/${selected.model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': settings.googleAiApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: buildGoogleImageGenerationConfig(request.aspectRatio),
      }),
      signal: AbortSignal.timeout(5 * 60_000),
    },
    settings.googleAiProxyUrl,
  )
  const responseText = await response.text()
  let payload: GoogleImageResponse
  try {
    payload = JSON.parse(responseText) as GoogleImageResponse
  } catch {
    throw new Error(`Google 图片生成返回了无效响应（HTTP ${response.status}）`)
  }
  if (!response.ok) {
    throw new Error(`Google 图片生成失败（HTTP ${response.status}）：${payload.error?.message || responseText.slice(0, 500)}`)
  }

  const generated = responseImage(payload)
  const bytes = Buffer.from(generated.data, 'base64')
  if (!bytes.length) throw new Error('Google 图片生成返回了空图片')
  const safeNodeId = request.nodeId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(-48)
  const outputDir = path.join(project.folderPath, 'generated', 'images')
  await fs.mkdir(outputDir, { recursive: true })
  const extension = EXTENSION_BY_MIME[generated.mimeType] ?? '.png'
  const outputPath = path.join(outputDir, `${safeNodeId}-${Date.now()}${extension}`)
  await fs.writeFile(outputPath, bytes)

  return {
    success: true,
    relativePath: path.relative(project.folderPath, outputPath).split(path.sep).join('/'),
  }
}
