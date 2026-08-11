import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type {
  ComfyWorkflowInfo,
  GenerateImageRequest,
  GenerateImageResult,
  GenerateVideoRequest,
  GenerateVideoResult,
  ImageAspectRatio,
  UpscaleVideoRequest,
  UpscaleVideoResult,
} from '../../../src/shared/ipc.types'
import { loadProject } from './project.store'
import { getRuntimeSettings } from './settings.service'
import { GOOGLE_IMAGE_MODELS } from './google-image.service'

type WorkflowNode = {
  class_type: string
  inputs: Record<string, unknown>
}

type ComfyWorkflow = Record<string, WorkflowNode>

interface ComfyImageOutput {
  filename: string
  subfolder?: string
  type?: string
}

interface ComfyMediaOutput extends ComfyImageOutput {
  format?: string
}

interface WorkflowTemplate extends ComfyWorkflowInfo {
  file: string
  promptNode: string
  promptField: string
  seedNode: string
  seedField: string
  widthNode?: string
  widthField?: string
  heightNode?: string
  heightField?: string
  imageNode?: string
  imageField?: string
}

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'flux2-klein-9b-t2i',
    name: 'Flux2 Klein 9B · 文生图',
    kind: 'text-to-image',
    file: 'flux2-klein-9b-text-to-image.json',
    promptNode: '76',
    promptField: 'value',
    seedNode: '75:73',
    seedField: 'noise_seed',
    widthNode: '75:68',
    widthField: 'value',
    heightNode: '75:69',
    heightField: 'value',
  },
  {
    id: 'flux2-klein-9b-edit',
    name: 'Flux2 Klein 9B · 图生图',
    kind: 'image-to-image',
    file: 'flux2-klein-9b-image-edit.json',
    promptNode: '75:74',
    promptField: 'text',
    seedNode: '75:73',
    seedField: 'noise_seed',
    widthNode: '133',
    widthField: 'width',
    heightNode: '133',
    heightField: 'height',
    imageNode: '76',
    imageField: 'image',
  },
  {
    id: 'z-image-turbo-t2i',
    name: 'Z-Image Turbo · 文生图',
    kind: 'text-to-image',
    file: 'z-image-turbo-text-to-image.json',
    promptNode: '57:27',
    promptField: 'text',
    seedNode: '57:3',
    seedField: 'seed',
    widthNode: '57:13',
    widthField: 'width',
    heightNode: '57:13',
    heightField: 'height',
  },
]

interface VideoWorkflowTemplate extends ComfyWorkflowInfo {
  file: string
  mode: 'first-last' | 'reference'
}

const VIDEO_WORKFLOWS: VideoWorkflowTemplate[] = [
  {
    id: 'minimax-h3-t2v-flf2v',
    name: 'MiniMax H3 · 文生视频 / 首尾帧',
    kind: 'image-to-video',
    file: 'video_minimax_h3_t2v.json',
    mode: 'first-last',
  },
  {
    id: 'minimax-h3-r2v',
    name: 'MiniMax H3 · 全模态参考',
    kind: 'image-to-video',
    file: 'video_minimax_h3_r2v.json',
    mode: 'reference',
  },
]

export const listComfyWorkflows = async (): Promise<ComfyWorkflowInfo[]> => {
  const { defaultImageWorkflowId } = await getRuntimeSettings()
  const googleImageWorkflows: ComfyWorkflowInfo[] = GOOGLE_IMAGE_MODELS.map(({ id, name }) => ({
    id,
    name,
    kind: 'text-to-image',
  }))
  return [...WORKFLOW_TEMPLATES, ...googleImageWorkflows, ...VIDEO_WORKFLOWS]
    .sort((a, b) => Number(b.id === defaultImageWorkflowId) - Number(a.id === defaultImageWorkflowId))
    .map(({ id, name, kind }) => ({ id, name, kind }))
}

const REQUEST_TIMEOUT_MS = 20_000
const GENERATION_TIMEOUT_MS = 5 * 60_000

const dimensionsFor = (ratio: ImageAspectRatio): { width: number; height: number } => {
  if (ratio === '1:1') return { width: 1024, height: 1024 }
  if (ratio === '4:3') return { width: 1024, height: 768 }
  return { width: 1024, height: 576 }
}

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '')

const workflowDirectory = (): string => app.isPackaged
  ? path.join(process.resourcesPath, 'comfyui-workflows')
  : path.join(process.env.APP_ROOT ?? process.cwd(), 'resources', 'comfyui-workflows')

async function loadWorkflowTemplate(template: WorkflowTemplate): Promise<ComfyWorkflow> {
  const filePath = path.join(workflowDirectory(), template.file)
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as ComfyWorkflow
  } catch (error) {
    throw new Error(`无法读取工作流模板 ${template.name}：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function loadWorkflowFile(file: string, name: string): Promise<ComfyWorkflow> {
  const filePath = path.join(workflowDirectory(), file)
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as ComfyWorkflow
  } catch (error) {
    throw new Error(`无法读取工作流模板 ${name}：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`无法连接 ComfyUI：${message}`)
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 600)
    throw new Error(`ComfyUI 请求失败 (${response.status})${detail ? `：${detail}` : ''}`)
  }
  return response.json() as Promise<T>
}

async function getFirstCheckpoint(baseUrl: string): Promise<string> {
  const objectInfo = await fetchJson<Record<string, unknown>>(
    `${baseUrl}/object_info/CheckpointLoaderSimple`,
  )
  const loader = objectInfo.CheckpointLoaderSimple as {
    input?: { required?: { ckpt_name?: unknown[] } }
  } | undefined
  const choices = loader?.input?.required?.ckpt_name?.[0]
  if (!Array.isArray(choices) || typeof choices[0] !== 'string') {
    throw new Error('ComfyUI 中没有可用的 checkpoint，请先在 models/checkpoints 中安装模型')
  }
  return choices[0]
}

async function getModels(baseUrl: string, folder: string): Promise<string[]> {
  try {
    const value = await fetchJson<unknown>(`${baseUrl}/models/${folder}`)
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

type ImageModel =
  | { kind: 'checkpoint'; checkpoint: string }
  | { kind: 'flux'; unet: string; clipL: string; t5: string; vae: string }

async function discoverImageModel(baseUrl: string): Promise<ImageModel> {
  const [checkpoints, diffusionModels, textEncoders, vaes] = await Promise.all([
    getModels(baseUrl, 'checkpoints'),
    getModels(baseUrl, 'diffusion_models'),
    getModels(baseUrl, 'text_encoders'),
    getModels(baseUrl, 'vae'),
  ])

  const imageCheckpoint = checkpoints.find((name) => !/(ltx|wan|cosmos|video|i2v|t2v)/i.test(name))
  if (imageCheckpoint) return { kind: 'checkpoint', checkpoint: imageCheckpoint }

  const fluxUnet = diffusionModels.find((name) => /flux1[-_]?dev/i.test(name))
    ?? diffusionModels.find((name) => /flux.*dev/i.test(name))
  const clipL = textEncoders.find((name) => /(^|[/\\])clip_l\./i.test(name))
  const t5 = textEncoders.find((name) => /t5.*(fp8|fp16|bf16|safetensors)/i.test(name))
  const vae = vaes.find((name) => /(^|[/\\])ae\.safetensors$/i.test(name))
  if (fluxUnet && clipL && t5 && vae) {
    return { kind: 'flux', unet: fluxUnet, clipL, t5, vae }
  }

  // Retain the object-info error message for installations that expose models
  // through a nonstandard route but still have a regular checkpoint loader.
  const checkpoint = await getFirstCheckpoint(baseUrl)
  if (!/(ltx|wan|cosmos|video|i2v|t2v)/i.test(checkpoint)) {
    return { kind: 'checkpoint', checkpoint }
  }
  throw new Error('没有检测到可用的图片模型。请安装 SD/SDXL checkpoint，或 Flux.1 + clip_l + t5xxl + ae')
}

function buildTextToImageWorkflow(
  checkpoint: string,
  prompt: string,
  negativePrompt: string,
  ratio: ImageAspectRatio,
  filenamePrefix: string,
): ComfyWorkflow {
  const { width, height } = dimensionsFor(ratio)
  const seed = Math.floor(Math.random() * 1_000_000_000_000_000)
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['1', 1] },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: 24,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: filenamePrefix, images: ['6', 0] },
    },
  }
}

function buildFluxWorkflow(
  model: Extract<ImageModel, { kind: 'flux' }>,
  prompt: string,
  ratio: ImageAspectRatio,
  filenamePrefix: string,
): ComfyWorkflow {
  const { width, height } = dimensionsFor(ratio)
  const seed = Math.floor(Math.random() * 1_000_000_000_000_000)
  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: model.unet, weight_dtype: 'default' },
    },
    '2': {
      class_type: 'DualCLIPLoader',
      inputs: { clip_name1: model.clipL, clip_name2: model.t5, type: 'flux' },
    },
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: model.vae },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['2', 0] },
    },
    '5': {
      class_type: 'FluxGuidance',
      inputs: { conditioning: ['4', 0], guidance: 3.5 },
    },
    '6': {
      class_type: 'BasicGuider',
      inputs: { model: ['1', 0], conditioning: ['5', 0] },
    },
    '7': {
      class_type: 'RandomNoise',
      inputs: { noise_seed: seed },
    },
    '8': {
      class_type: 'BasicScheduler',
      inputs: { model: ['1', 0], scheduler: 'simple', steps: 20, denoise: 1 },
    },
    '9': {
      class_type: 'KSamplerSelect',
      inputs: { sampler_name: 'euler' },
    },
    '10': {
      class_type: 'EmptySD3LatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '11': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['7', 0],
        guider: ['6', 0],
        sampler: ['9', 0],
        sigmas: ['8', 0],
        latent_image: ['10', 0],
      },
    },
    '12': {
      class_type: 'VAEDecode',
      inputs: { samples: ['11', 0], vae: ['3', 0] },
    },
    '13': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: filenamePrefix, images: ['12', 0] },
    },
  }
}

async function waitForImage(baseUrl: string, promptId: string): Promise<ComfyImageOutput> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < GENERATION_TIMEOUT_MS) {
    const history = await fetchJson<Record<string, {
      status?: { status_str?: string; completed?: boolean; messages?: unknown[] }
      outputs?: Record<string, { images?: ComfyImageOutput[] }>
    }>>(`${baseUrl}/history/${encodeURIComponent(promptId)}`)
    const record = history[promptId]
    if (record) {
      for (const output of Object.values(record.outputs ?? {})) {
        const image = output.images?.[0]
        if (image) return image
      }
      if (record.status?.status_str === 'error') {
        throw new Error(`ComfyUI 生成失败：${JSON.stringify(record.status.messages ?? []).slice(0, 800)}`)
      }
      if (record.status?.completed) {
        throw new Error('ComfyUI 工作流已完成，但没有返回图片输出')
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
  throw new Error('ComfyUI 生成超时（5 分钟）')
}

async function downloadImage(baseUrl: string, image: ComfyImageOutput): Promise<Uint8Array> {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? '',
    type: image.type ?? 'output',
  })
  let response: Response
  try {
    response = await fetch(`${baseUrl}/view?${params}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`下载 ComfyUI 图片失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new Error(`下载 ComfyUI 图片失败 (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

function findVideoOutput(value: unknown): ComfyMediaOutput | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoOutput(item)
      if (found) return found
    }
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.filename === 'string' && /\.(mp4|webm|mov|mkv)$/i.test(record.filename)) {
    return record as unknown as ComfyMediaOutput
  }
  for (const child of Object.values(record)) {
    const found = findVideoOutput(child)
    if (found) return found
  }
  return null
}

async function waitForVideo(baseUrl: string, promptId: string): Promise<ComfyMediaOutput> {
  // No overall timeout: ComfyUI queues prompts, so queue wait time is
  // unpredictable. Poll until the record resolves or reports an error.
  while (true) {
    const history = await fetchJson<Record<string, {
      status?: { status_str?: string; completed?: boolean; messages?: unknown[] }
      outputs?: Record<string, unknown>
    }>>(`${baseUrl}/history/${encodeURIComponent(promptId)}`)
    const record = history[promptId]
    if (record) {
      const video = findVideoOutput(record.outputs)
      if (video) return video
      if (record.status?.status_str === 'error') {
        throw new Error(`ComfyUI 视频生成失败：${JSON.stringify(record.status.messages ?? []).slice(0, 1200)}`)
      }
      if (record.status?.completed) throw new Error('ComfyUI 工作流已完成，但没有返回视频输出')
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
}

async function uploadReferenceMedia(
  baseUrl: string,
  projectRoot: string,
  relativePath: string,
): Promise<string> {
  const root = path.resolve(projectRoot)
  const absolutePath = path.resolve(root, relativePath)
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    throw new Error('参考媒体路径超出项目目录')
  }
  const bytes = await fs.readFile(absolutePath)
  const form = new FormData()
  form.append('image', new Blob([bytes]), path.basename(absolutePath))
  form.append('overwrite', 'true')
  let response: Response
  try {
    response = await fetch(`${baseUrl}/upload/image`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`上传参考媒体失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new Error(`上传参考媒体失败 (${response.status})`)
  const uploaded = await response.json() as { name?: string; subfolder?: string }
  if (!uploaded.name) throw new Error('ComfyUI 未返回上传后的媒体名称')
  return uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name
}

async function buildTemplateWorkflow(
  template: WorkflowTemplate,
  request: GenerateImageRequest,
  baseUrl: string,
  projectRoot: string,
  filenamePrefix: string,
): Promise<ComfyWorkflow> {
  const workflow = await loadWorkflowTemplate(template)
  const { width, height } = dimensionsFor(request.aspectRatio)
  const seed = Math.floor(Math.random() * 1_000_000_000_000_000)
  const setInput = (nodeId: string, field: string, value: unknown) => {
    const node = workflow[nodeId]
    if (!node) throw new Error(`工作流 ${template.name} 缺少节点 ${nodeId}`)
    node.inputs[field] = value
  }
  setInput(template.promptNode, template.promptField, request.prompt.trim())
  setInput(template.seedNode, template.seedField, seed)
  if (template.widthNode && template.widthField) setInput(template.widthNode, template.widthField, width)
  if (template.heightNode && template.heightField) setInput(template.heightNode, template.heightField, height)
  if (workflow['9']?.class_type === 'SaveImage') workflow['9'].inputs.filename_prefix = filenamePrefix

  if (template.kind === 'image-to-image') {
    if (!request.referenceImagePath) throw new Error('图生图工作流需要先连接一个已有图片节点作为参考图')
    if (!template.imageNode || !template.imageField) throw new Error(`工作流 ${template.name} 未配置输入图片节点`)
    const uploadedName = await uploadReferenceMedia(baseUrl, projectRoot, request.referenceImagePath)
    setInput(template.imageNode, template.imageField, uploadedName)
  }
  return workflow
}

export async function generateImageWithComfyUI(
  request: GenerateImageRequest,
): Promise<GenerateImageResult> {
  const project = await loadProject(request.projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  const prompt = request.prompt.trim()
  if (!prompt) throw new Error('请先输入文生图提示词')

  const settings = await getRuntimeSettings()
  const baseUrl = normalizeBaseUrl(settings.comfyuiBaseUrl || project.comfyuiBaseUrl || 'http://127.0.0.1:8188')
  const safeNodeId = request.nodeId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(-48)
  const filenamePrefix = `aigc-canvas/${safeNodeId}`
  const template = WORKFLOW_TEMPLATES.find((item) => item.id === (request.workflowId || settings.defaultImageWorkflowId))
    ?? WORKFLOW_TEMPLATES[0]
  const workflow = template
    ? await buildTemplateWorkflow(template, request, baseUrl, project.folderPath, filenamePrefix)
    : (() => { throw new Error('没有可用的 ComfyUI 工作流模板') })()

  const queued = await fetchJson<{ prompt_id?: string; error?: unknown }>(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: `aigc-canvas-${Date.now()}` }),
  })
  if (!queued.prompt_id) {
    throw new Error(`ComfyUI 未接受工作流：${JSON.stringify(queued.error ?? queued).slice(0, 800)}`)
  }

  const imageOutput = await waitForImage(baseUrl, queued.prompt_id)
  const bytes = await downloadImage(baseUrl, imageOutput)
  const outputDir = path.join(project.folderPath, 'generated', 'images')
  await fs.mkdir(outputDir, { recursive: true })
  const sourceExt = path.extname(imageOutput.filename).toLowerCase()
  const extension = ['.png', '.jpg', '.jpeg', '.webp'].includes(sourceExt) ? sourceExt : '.png'
  const outputName = `${safeNodeId}-${Date.now()}${extension}`
  const outputPath = path.join(outputDir, outputName)
  await fs.writeFile(outputPath, bytes)

  return {
    success: true,
    relativePath: path.relative(project.folderPath, outputPath).split(path.sep).join('/'),
    promptId: queued.prompt_id,
  }
}

const UPSCALE_SCALES = [2, 3, 4] as const
const UPSCALE_QUALITIES = ['FAST', 'MEDIUM', 'HIGH', 'ULTRA'] as const

export async function upscaleVideoWithComfyUI(
  request: UpscaleVideoRequest,
): Promise<UpscaleVideoResult> {
  const project = await loadProject(request.projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  if (!request.sourceVideoPath) throw new Error('请先连接一个已有视频节点作为输入')

  const settings = await getRuntimeSettings()
  const baseUrl = normalizeBaseUrl(settings.comfyuiBaseUrl || project.comfyuiBaseUrl || 'http://127.0.0.1:8188')
  const workflow = await loadWorkflowFile('video-upscale.json', 'RTX 视频放大')
  const uploadedName = await uploadReferenceMedia(baseUrl, project.folderPath, request.sourceVideoPath)

  const scale = (UPSCALE_SCALES as readonly number[]).includes(Number(request.scale))
    ? Number(request.scale)
    : 2
  const quality = (UPSCALE_QUALITIES as readonly string[]).includes(String(request.quality))
    ? String(request.quality)
    : 'ULTRA'
  const setInput = (nodeId: string, field: string, value: unknown) => {
    const node = workflow[nodeId]
    if (!node) throw new Error(`视频放大工作流缺少节点 ${nodeId}`)
    node.inputs[field] = value
  }
  setInput('2', 'video', uploadedName)
  setInput('3', 'resize_type.scale', scale)
  setInput('3', 'quality', quality)
  const safeNodeId = request.nodeId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(-48)
  setInput('1', 'filename_prefix', `aigc-canvas/upscale/${safeNodeId}`)

  const queued = await fetchJson<{ prompt_id?: string; error?: unknown }>(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: `aigc-canvas-upscale-${Date.now()}` }),
  })
  if (!queued.prompt_id) {
    throw new Error(`ComfyUI 未接受视频放大工作流：${JSON.stringify(queued.error ?? queued).slice(0, 1000)}`)
  }

  const output = await waitForVideo(baseUrl, queued.prompt_id)
  const bytes = await downloadImage(baseUrl, output)
  const outputDir = path.join(project.folderPath, 'generated', 'videos')
  await fs.mkdir(outputDir, { recursive: true })
  const sourceExt = path.extname(output.filename).toLowerCase()
  const extension = ['.mp4', '.webm', '.mov', '.mkv'].includes(sourceExt) ? sourceExt : '.mp4'
  const outputPath = path.join(outputDir, `${safeNodeId}-upscale-${Date.now()}${extension}`)
  await fs.writeFile(outputPath, bytes)
  return {
    success: true,
    relativePath: path.relative(project.folderPath, outputPath).split(path.sep).join('/'),
    promptId: queued.prompt_id,
  }
}
export async function generateVideoWithComfyUI(
  request: GenerateVideoRequest,
): Promise<GenerateVideoResult> {
  const project = await loadProject(request.projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  if (!request.prompt.trim()) throw new Error('请先输入视频生成提示词')

  const settings = await getRuntimeSettings()
  const baseUrl = normalizeBaseUrl(settings.comfyuiBaseUrl || project.comfyuiBaseUrl || 'http://127.0.0.1:8188')
  const template = VIDEO_WORKFLOWS.find((item) => item.id === request.workflowId) ?? VIDEO_WORKFLOWS[0]
  const workflow = await loadWorkflowFile(template.file, template.name)
  const duration = Math.max(1, Math.min(15, Number(request.duration ?? 5)))
  const dimensions = request.aspectRatio === '1:1'
    ? { width: 1024, height: 1024 }
    : request.aspectRatio === '4:3'
      ? { width: 1024, height: 768 }
      : { width: 1024, height: 576 }
  const setInput = (nodeId: string, field: string, value: unknown) => {
    const node = workflow[nodeId]
    if (!node) throw new Error(`${template.name} 工作流缺少节点 ${nodeId}`)
    node.inputs[field] = value
  }

  const imagePaths = (request.referenceImagePaths ?? []).filter(Boolean)
  const videoPaths = (request.referenceVideoPaths ?? []).filter(Boolean)
  const audioPaths = (request.referenceAudioPaths ?? []).filter(Boolean)

  if (template.mode === 'first-last') {
    setInput('105:104', 'prompt', request.prompt.trim())
    setInput('105:104', 'width', dimensions.width)
    setInput('105:104', 'height', dimensions.height)
    setInput('105:111', 'value', duration)
    setInput('105:15', 'noise_seed', Math.floor(Math.random() * 1_000_000_000_000_000))

    const frameInputs = [
      ['first_frame', request.referenceImagePath],
      ['last_frame', request.lastFrameImagePath],
    ] as const
    for (const [index, [field, relativePath]] of frameInputs.entries()) {
      if (!relativePath) continue
      const nodeId = String(900001 + index)
      const uploadedName = await uploadReferenceMedia(baseUrl, project.folderPath, relativePath)
      workflow[nodeId] = { class_type: 'LoadImage', inputs: { image: uploadedName } }
      setInput('105:104', field, [nodeId, 0])
    }
  } else {
    if (imagePaths.length > 9) throw new Error('MiniMax H3 全模态参考最多连接 9 张图片')
    if (videoPaths.length > 3) throw new Error('MiniMax H3 全模态参考最多连接 3 个视频')
    if (audioPaths.length > 3) throw new Error('MiniMax H3 全模态参考最多连接 3 段独立音频')
    if (imagePaths.length + videoPaths.length + audioPaths.length === 0) {
      throw new Error('全模态参考工作流至少需要连接一个图片、视频或音频节点')
    }
    setInput('138', 'value', request.prompt.trim())
    setInput('136', 'width', dimensions.width)
    setInput('136', 'height', dimensions.height)
    setInput('136', 'ref_image_size', 'match')
    setInput('132', 'value', duration)
    setInput('129', 'noise_seed', Math.floor(Math.random() * 1_000_000_000_000_000))

    for (const [index, relativePath] of imagePaths.entries()) {
      const nodeId = String(910001 + index)
      const uploadedName = await uploadReferenceMedia(baseUrl, project.folderPath, relativePath)
      workflow[nodeId] = { class_type: 'LoadImage', inputs: { image: uploadedName } }
      setInput('136', `ref_images.ref_image_${index}`, [nodeId, 0])
    }
    for (const [index, relativePath] of videoPaths.entries()) {
      const loadNodeId = String(920001 + index * 2)
      const componentsNodeId = String(920002 + index * 2)
      const uploadedName = await uploadReferenceMedia(baseUrl, project.folderPath, relativePath)
      workflow[loadNodeId] = { class_type: 'LoadVideo', inputs: { file: uploadedName } }
      workflow[componentsNodeId] = { class_type: 'GetVideoComponents', inputs: { video: [loadNodeId, 0] } }
      setInput('136', `ref_videos.ref_video_${index}`, [componentsNodeId, 0])
      setInput('136', `ref_video_audios.ref_video_audio_${index}`, [componentsNodeId, 1])
    }
    for (const [index, relativePath] of audioPaths.entries()) {
      const nodeId = String(930001 + index)
      const uploadedName = await uploadReferenceMedia(baseUrl, project.folderPath, relativePath)
      workflow[nodeId] = { class_type: 'LoadAudio', inputs: { audio: uploadedName } }
      setInput('136', `ref_audios.ref_audio_${index}`, [nodeId, 0])
    }
  }

  const safeNodeId = request.nodeId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(-48)
  setInput('92', 'filename_prefix', `aigc-canvas/video/${safeNodeId}`)
  setInput('92', 'format', 'mp4')
  setInput('92', 'codec', 'h264')

  const queued = await fetchJson<{ prompt_id?: string; error?: unknown }>(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: `aigc-canvas-video-${Date.now()}` }),
  })
  if (!queued.prompt_id) {
    throw new Error(`ComfyUI 未接受视频工作流：${JSON.stringify(queued.error ?? queued).slice(0, 1000)}`)
  }

  const output = await waitForVideo(baseUrl, queued.prompt_id)
  const bytes = await downloadImage(baseUrl, output)
  const outputDir = path.join(project.folderPath, 'generated', 'videos')
  await fs.mkdir(outputDir, { recursive: true })
  const sourceExt = path.extname(output.filename).toLowerCase()
  const extension = ['.mp4', '.webm', '.mov', '.mkv'].includes(sourceExt) ? sourceExt : '.mp4'
  const outputPath = path.join(outputDir, `${safeNodeId}-${Date.now()}${extension}`)
  await fs.writeFile(outputPath, bytes)
  return {
    success: true,
    relativePath: path.relative(project.folderPath, outputPath).split(path.sep).join('/'),
    promptId: queued.prompt_id,
  }
}
