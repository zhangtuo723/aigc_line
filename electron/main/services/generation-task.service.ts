import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { GenerateImageRequest, GenerateVideoRequest, UpscaleVideoRequest, ExtractVideoAudioRequest, GenerateVideoResult, Project } from '../../../src/shared/ipc.types'
import { loadProject } from './project.store'
import { atomicWriteFile, serializeFileOperation } from './atomic-file'
import { withMediaPreparation } from './media-io'

type GenerationRequest = GenerateImageRequest | GenerateVideoRequest | UpscaleVideoRequest | ExtractVideoAudioRequest
export type GenerationOperation = 'image' | 'video' | 'upscale' | 'extract-audio'
export interface PersistedGenerationTask {
  version: 1
  id: string
  projectId: string
  nodeId: string
  provider: 'comfyui' | 'seedance' | 'google' | 'seedream'
  operation: GenerationOperation
  status: 'submitting' | 'running' | 'succeeded' | 'failed' | 'unknown'
  taskId?: string
  relativePath?: string
  error?: string
  acknowledged?: boolean
  updatedAt: number
  request: GenerationRequest
  fingerprint: string
}
export class TerminalGenerationError extends Error {}
const active = new Map<string, Promise<GenerateVideoResult>>()
const activeFingerprints = new Map<string, string>()
const nextRecovery = new Map<string, number>()
const taskDirectory = (root: string) => path.join(root, '.aigc-line', 'generation-tasks')
const taskPath = (root: string, nodeId: string) => path.join(taskDirectory(root), createHash('sha256').update(nodeId).digest('hex') + '.json')
const requestKeys = ['projectId', 'nodeId', 'prompt', 'aspectRatio', 'duration', 'workflowId', 'referenceImagePath', 'lastFrameImagePath', 'referenceImagePaths', 'referenceVideoPaths', 'referenceAudioPaths', 'sourceVideoPath', 'scale', 'quality'] as const
function captureRequest(request: GenerationRequest): GenerationRequest {
  const record = request as unknown as Record<string, unknown>
  return JSON.parse(JSON.stringify(Object.fromEntries(requestKeys.filter(key => record[key] !== undefined).map(key => [key, record[key]]))))
}
async function readTask(file: string): Promise<PersistedGenerationTask | null> {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as PersistedGenerationTask
    if (value.version !== 1 || !value.id || !value.nodeId || !value.request || !['comfyui', 'seedance', 'google', 'seedream'].includes(value.provider)) throw new Error('生成任务记录格式无效')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Synchronous cloud APIs have no remote query ID; preserve completed outputs without retrying uncertain submissions. */
export function runLocalGeneration(
  options: { project: Project; provider: 'google' | 'seedream'; request: GenerateImageRequest },
  generate: (markSubmitting: () => void) => Promise<GenerateVideoResult>,
): Promise<GenerateVideoResult> {
  let result: GenerateVideoResult | undefined
  return runGenerationTask({ ...options, operation: 'image' }, {
    submit: async markSubmitting => {
      result = await generate(markSubmitting)
      return `local-${randomUUID()}`
    },
    complete: async () => {
      if (!result) throw new Error('同步图片接口无法恢复中断的请求，请核实原生成结果')
      return result
    },
  })
}
const writeTask = (file: string, task: PersistedGenerationTask) => serializeFileOperation(file, () => atomicWriteFile(file, JSON.stringify(task)))

/** Deduplicates a node's in-flight request and resumes its persisted remote ID without resubmitting. */
export function runGenerationTask(
  options: { project: Project; provider: PersistedGenerationTask['provider']; operation: GenerationOperation; request: GenerationRequest },
  work: { submit: (markSubmitting: () => void) => Promise<string>; complete: (taskId: string) => Promise<GenerateVideoResult> },
): Promise<GenerateVideoResult> {
  const file = taskPath(options.project.folderPath, options.request.nodeId)
  const request = captureRequest(options.request)
  const fingerprint = createHash('sha256').update(JSON.stringify({ provider: options.provider, operation: options.operation, request })).digest('hex')
  const existing = active.get(file)
  if (existing) return activeFingerprints.get(file) === fingerprint ? existing : Promise.reject(new Error('该节点正在生成，请等待当前任务完成再修改生成参数'))
  const operation = (async () => {
    let task = await readTask(file)
    const recoverable = task && (task.status === 'running' || task.status === 'submitting' || task.status === 'unknown' || (task.status === 'succeeded' && !task.acknowledged))
    if (recoverable && task!.fingerprint !== fingerprint) throw new Error('该节点还有未确认的生成任务，请先恢复结果或处理原任务后再更改参数生成')
    if (task?.status === 'succeeded' && !task.acknowledged && task.relativePath) {
      return { success: true, relativePath: task.relativePath, promptId: task.taskId }
    }
    if (task && ['submitting', 'unknown'].includes(task.status)) throw new Error('上次生成提交结果未知，为避免重复扣费不会自动重提，请在生成服务中确认任务状态')
    if (!task || task.status !== 'running') {
      task = { version: 1, id: randomUUID(), projectId: request.projectId, nodeId: request.nodeId, provider: options.provider,
        operation: options.operation, request, fingerprint, status: 'submitting', updatedAt: Date.now() }
      await writeTask(file, task)
      let submissionStarted = false
      try {
        task.taskId = await withMediaPreparation(() => work.submit(() => { submissionStarted = true }))
        task.status = 'running'
        task.updatedAt = Date.now()
        await writeTask(file, task)
      } catch (error) {
        task.status = task.taskId ? 'running' : !submissionStarted || error instanceof TerminalGenerationError ? 'failed' : 'unknown'
        task.error = error instanceof Error ? error.message : String(error)
        task.updatedAt = Date.now()
        await writeTask(file, task)
        throw error
      }
    }
    try {
      if (!task.taskId) throw new TerminalGenerationError('生成任务缺少服务端 ID')
      const result = await work.complete(task.taskId)
      if (!result.success || !result.relativePath) throw new Error(result.error || '生成结果未保存')
      task.status = 'succeeded'; task.relativePath = result.relativePath; task.error = undefined; task.updatedAt = Date.now()
      await writeTask(file, task)
      return { ...result, promptId: task.taskId }
    } catch (error) {
      task.status = error instanceof TerminalGenerationError ? 'failed' : 'running'
      task.error = error instanceof Error ? error.message : String(error)
      task.updatedAt = Date.now()
      await writeTask(file, task)
      nextRecovery.set(file, Date.now() + 30_000)
      throw error
    }
  })()
  active.set(file, operation)
  activeFingerprints.set(file, fingerprint)
  void operation.finally(() => { if (active.get(file) === operation) { active.delete(file); activeFingerprints.delete(file) } }).catch(() => undefined)
  return operation
}

/** Uses current provider settings and a persisted request; runGenerationTask never POSTs a running task again. */
export async function resumeProjectGenerationTasks(projectId: string): Promise<void> {
  const project = await loadProject(projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  await resumeTasks(project, await readProjectTasks(project))
}
async function resumeTasks(project: Project, tasks: PersistedGenerationTask[]): Promise<void> {
  for (const task of tasks) {
    const file = taskPath(project.folderPath, task.nodeId)
    if (active.has(file)) continue
    if (task.status === 'submitting') {
      task.status = 'unknown'; task.error = '应用在生成提交完成前退出，提交状态未知，请先核实服务端结果'; task.updatedAt = Date.now()
      await writeTask(file, task)
      continue
    }
    if (task.status !== 'running' || !task.taskId || (nextRecovery.get(file) ?? 0) > Date.now()) continue
    nextRecovery.set(file, Date.now() + 30_000)
    const request = task.request
    if (task.provider === 'google' || task.provider === 'seedream') {
      task.status = 'unknown'; task.error = '同步图片接口请求已中断，无法查询原提交状态，请先核实服务端结果'; task.updatedAt = Date.now()
      await writeTask(file, task)
    } else if (task.provider === 'seedance') {
      const service = await import('./seedance-video.service')
      void service.generateVideoWithSeedance(request as GenerateVideoRequest).catch(() => undefined)
    } else {
      const service = await import('./comfyui.service')
      const operation = task.operation === 'image' ? service.generateImageWithComfyUI(request as GenerateImageRequest)
        : task.operation === 'upscale' ? service.upscaleVideoWithComfyUI(request as UpscaleVideoRequest)
        : task.operation === 'extract-audio' ? service.extractVideoAudioWithComfyUI(request as ExtractVideoAudioRequest)
        : service.generateVideoWithComfyUI(request as GenerateVideoRequest)
      void operation.catch(() => undefined)
    }
  }
}
async function readProjectTasks(project: Project): Promise<PersistedGenerationTask[]> {
  let files: string[]
  try { files = await fs.readdir(taskDirectory(project.folderPath)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const tasks: PersistedGenerationTask[] = []
  for (const file of files.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    const task = await readTask(path.join(taskDirectory(project.folderPath), file))
    if (task && task.projectId === project.id) tasks.push(task)
  }
  return tasks
}
export async function listProjectGenerationTasks(projectId: string): Promise<PersistedGenerationTask[]> {
  const project = await loadProject(projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  const tasks = await readProjectTasks(project)
  void resumeTasks(project, structuredClone(tasks)).catch(() => undefined)
  return tasks
}
export async function acknowledgeGenerationTaskResult(projectId: string, nodeId: string, taskId: string): Promise<void> {
  const project = await loadProject(projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  const file = taskPath(project.folderPath, nodeId)
  await serializeFileOperation(file, async () => {
    const task = await readTask(file)
    if (!task || task.taskId !== taskId || task.status !== 'succeeded') return
    task.acknowledged = true
    await atomicWriteFile(file, JSON.stringify(task))
  })
}

/** Local acknowledgement only: the caller must obtain explicit confirmation after checking the provider. */
export async function dismissGenerationTask(projectId: string, nodeId: string, taskIdOrLocalId: string): Promise<void> {
  const project = await loadProject(projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  const file = taskPath(project.folderPath, nodeId)
  await serializeFileOperation(file, async () => {
    if (active.has(file)) throw new Error('任务仍在运行，不能解除限制')
    const task = await readTask(file)
    if (!task || (task.taskId ?? task.id) !== taskIdOrLocalId) throw new Error('任务已变化，请刷新后重试')
    if (!['unknown', 'failed', 'succeeded'].includes(task.status)) throw new Error('该任务状态不能解除限制')
    await atomicWriteFile(path.join(taskDirectory(project.folderPath), `dismissed-${randomUUID()}.json`), JSON.stringify({ ...task, dismissedAt: Date.now() }))
    task.status = 'failed'; task.acknowledged = true; task.updatedAt = Date.now(); task.error = '用户已核实原任务并解除本地限制；未取消服务端任务'
    await atomicWriteFile(file, JSON.stringify(task))
  })
}

export async function retryGenerationRead<T>(read: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await read() }
    catch (error) {
      if (error instanceof TerminalGenerationError || attempt >= attempts - 1) throw error
      await new Promise(resolve => setTimeout(resolve, Math.min(8_000, 500 * 2 ** attempt)))
    }
  }
}
