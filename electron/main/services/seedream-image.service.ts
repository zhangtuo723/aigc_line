import fs from 'node:fs/promises'
import path from 'node:path'
import type { GenerateImageRequest, GenerateImageResult } from '../../../src/shared/ipc.types'
import { seedreamImageDimensionsFor } from '../../../src/shared/media-dimensions'
import { loadProject } from './project.store'
import { getRuntimeSettings } from './settings.service'

export const SEEDREAM_IMAGE_MODELS = [
  {
    id: 'seedream-5.0-pro',
    model: 'doubao-seedream-5-0-260128',
    name: 'Doubao-Seedream-5.0-pro · 文生图 / 图生图 · 2K',
  },
  {
    id: 'seedream-5.0-lite',
    model: 'doubao-seedream-5-0-lite-260128',
    name: 'Doubao-Seedream-5.0-lite · 文生图 / 图生图 · 2K',
  },
] as const

type SeedreamResponse = {
  data?: Array<{ b64_json?: string; url?: string }>
  error?: { message?: string; code?: string }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

export function isSeedreamImageWorkflow(workflowId?: string): boolean {
  return SEEDREAM_IMAGE_MODELS.some((item) => item.id === workflowId)
}

export function buildSeedreamImageRequest(
  request: Pick<GenerateImageRequest, 'prompt' | 'aspectRatio'>,
  model: string,
  images: string[] = [],
) {
  const { width, height } = seedreamImageDimensionsFor(request.aspectRatio)
  return {
    model,
    prompt: request.prompt.trim(),
    size: `${width}x${height}`,
    sequential_image_generation: 'disabled',
    stream: false,
    response_format: 'b64_json',
    output_format: 'jpeg',
    watermark: false,
    ...(images.length > 0 ? { image: images } : {}),
  }
}

async function resolveReferenceImage(projectRoot: string, relativePath: string): Promise<{ path: string; mimeType: string }> {
  if (!relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error('参考图片路径必须是项目内的相对路径')
  }
  const root = await fs.realpath(path.resolve(projectRoot))
  const filePath = await fs.realpath(path.resolve(root, relativePath))
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('参考图片路径不在当前项目目录内')
  }
  const mimeType = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()]
  if (!mimeType) throw new Error('Seedream 图生图仅支持 PNG 或 JPEG 参考图片')
  return { path: filePath, mimeType }
}

export async function generateImageWithSeedream(request: GenerateImageRequest): Promise<GenerateImageResult> {
  const project = await loadProject(request.projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  const selected = SEEDREAM_IMAGE_MODELS.find((item) => item.id === request.workflowId)
  if (!selected) throw new Error('未选择有效的 Seedream 图片模型')
  if (!request.prompt.trim()) throw new Error('请先输入图片生成提示词')

  const settings = await getRuntimeSettings()
  if (!settings.seedreamApiKey) throw new Error('请先在设置页配置火山方舟 Seedream API Key')
  const referencePaths = [...new Set(
    request.referenceImagePaths ?? (request.referenceImagePath ? [request.referenceImagePath] : []),
  )]
  if (referencePaths.length > 10) throw new Error('Seedream 最多支持 10 张参考图片')
  const referenceImages: string[] = []
  for (const referencePath of referencePaths) {
    const reference = await resolveReferenceImage(project.folderPath, referencePath)
    const bytes = await fs.readFile(reference.path)
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Seedream 参考图片不能超过 10 MB')
    referenceImages.push(`data:${reference.mimeType};base64,${bytes.toString('base64')}`)
  }
  const body = buildSeedreamImageRequest(request, selected.model, referenceImages)

  const response = await fetch(`${settings.seedreamBaseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.seedreamApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60_000),
  })
  const responseText = await response.text()
  let payload: SeedreamResponse
  try {
    payload = JSON.parse(responseText) as SeedreamResponse
  } catch {
    throw new Error(`Seedream 图片生成返回了无效响应（HTTP ${response.status}）`)
  }
  if (!response.ok) {
    throw new Error(`Seedream 图片生成失败（HTTP ${response.status}）：${payload.error?.message || responseText.slice(0, 500)}`)
  }

  const result = payload.data?.[0]
  let bytes: Buffer
  if (result?.b64_json) {
    bytes = Buffer.from(result.b64_json, 'base64')
  } else if (result?.url) {
    const download = await fetch(result.url, { signal: AbortSignal.timeout(60_000) })
    if (!download.ok) throw new Error(`Seedream 生成结果下载失败（HTTP ${download.status}）`)
    bytes = Buffer.from(await download.arrayBuffer())
  } else {
    throw new Error('Seedream 图片生成未返回图片')
  }
  if (!bytes.length) throw new Error('Seedream 图片生成返回了空图片')

  const safeNodeId = request.nodeId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(-48)
  const outputDir = path.join(project.folderPath, 'generated', 'images')
  await fs.mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `${safeNodeId}-${Date.now()}.jpg`)
  await fs.writeFile(outputPath, bytes)
  return {
    success: true,
    relativePath: path.relative(project.folderPath, outputPath).split(path.sep).join('/'),
  }
}
