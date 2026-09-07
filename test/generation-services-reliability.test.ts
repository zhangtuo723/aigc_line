import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const environment = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { isPackaged: false }, net: {}, session: {} }))
vi.mock('../electron/main/services/project.store', () => ({ loadProject: vi.fn(async (id: string) => ({ id, folderPath: environment.root })) }))
vi.mock('../electron/main/services/settings.service', () => ({ getRuntimeSettings: vi.fn(async () => ({
  comfyuiBaseUrl: 'http://comfy.invalid', defaultImageWorkflowId: 'krea2-turbo-t2i', seedreamBaseUrl: 'https://ark.invalid', seedreamApiKey: 'fake-key',
})) }))
import { generateVideoWithComfyUI } from '../electron/main/services/comfyui.service'
import { generateVideoWithSeedance } from '../electron/main/services/seedance-video.service'
import { listProjectGenerationTasks } from '../electron/main/services/generation-task.service'

beforeEach(async () => { environment.root = await fs.mkdtemp(path.join(os.tmpdir(), 'aigc-service-reliability-')) })
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await fs.rm(environment.root, { recursive: true, force: true }) })

describe('generation service integration', () => {
  it('uploads equal basenames as distinct assets and persists the resulting video', async () => {
    for (const directory of ['hero', 'scene']) await fs.mkdir(path.join(environment.root, directory))
    await fs.writeFile(path.join(environment.root, 'hero', 'reference.png'), 'hero-image')
    await fs.writeFile(path.join(environment.root, 'scene', 'reference.png'), 'scene-image')
    const uploads = new Map<string, string>()
    let workflow: Record<string, { inputs: Record<string, unknown> }> = {}
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/upload/image')) {
        const form = options!.body as FormData
        const file = form.get('image') as File
        expect(form.get('overwrite')).toBe('false')
        uploads.set(file.name, await file.text())
        return Response.json({ name: file.name })
      }
      if (url.endsWith('/prompt')) { workflow = JSON.parse(String(options!.body)).prompt; return Response.json({ prompt_id: 'job-1' }) }
      if (url.includes('/history/')) return Response.json({ 'job-1': { outputs: { '92': { videos: [{ filename: 'result.mp4' }] } }, status: { completed: true } } })
      if (url.includes('/view?')) return new Response('video-result')
      throw new Error(`Unexpected URL ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const result = await generateVideoWithComfyUI({ projectId: 'p', nodeId: 'v', workflowId: 'minimax-h3-r2v', prompt: 'test', aspectRatio: '16:9', referenceImagePaths: ['hero/reference.png', 'scene/reference.png'] })
    expect(uploads.size).toBe(2)
    const first = workflow['910001'].inputs.image as string
    const second = workflow['910002'].inputs.image as string
    expect(first).not.toBe(second)
    expect(uploads.get(first)).toBe('hero-image'); expect(uploads.get(second)).toBe('scene-image')
    expect(await fs.readFile(path.join(environment.root, result.relativePath!), 'utf8')).toBe('video-result')
    expect((await listProjectGenerationTasks('p'))[0]).toMatchObject({ status: 'succeeded', relativePath: result.relativePath, taskId: 'job-1' })
  })
  it('retries a transient Seedance query failure without submitting a second paid task', async () => {
    let posts = 0; let queries = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') { posts++; return Response.json({ id: 'seedance-job' }) }
      if (url.includes('/tasks/')) {
        queries++
        if (queries === 1) throw new TypeError('transient network reset')
        return Response.json({ status: 'succeeded', content: { video_url: 'https://cdn.invalid/video.mp4' } })
      }
      return new Response('seedance-video')
    }))
    const request = { projectId: 'p', nodeId: 'v', workflowId: 'seedance-2.0', prompt: 'test', aspectRatio: '16:9' as const }
    const result = await generateVideoWithSeedance(request)
    expect(posts).toBe(1); expect(queries).toBe(2)
    expect(await generateVideoWithSeedance(request)).toEqual(result)
    expect(posts).toBe(1)
  })
  it('terminates a ComfyUI task removed from both queue and history', async () => {
    let time = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => { time += 15_000; return time })
    let queueChecks = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'removed-job' })
      if (url.includes('/history/')) return Response.json({})
      if (url.endsWith('/queue')) { queueChecks++; return Response.json({ queue_running: [], queue_pending: [] }) }
      throw new Error(`Unexpected URL ${url}`)
    }))
    await expect(generateVideoWithComfyUI({ projectId: 'p', nodeId: 'removed', workflowId: 'minimax-h3-t2v-flf2v', prompt: 'test', aspectRatio: '16:9' })).rejects.toThrow('已从队列和历史中移除')
    expect(queueChecks).toBe(3)
    expect((await listProjectGenerationTasks('p'))[0]).toMatchObject({ status: 'failed', taskId: 'removed-job' })
  })
})
