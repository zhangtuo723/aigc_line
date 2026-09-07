import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const environment = vi.hoisted(() => ({ root: '' }))
vi.mock('../electron/main/services/project.store', () => ({ loadProject: vi.fn(async (id: string) => ({ id, folderPath: environment.root })) }))
import { acknowledgeGenerationTaskResult, dismissGenerationTask, resumeProjectGenerationTasks, runGenerationTask, runLocalGeneration, TerminalGenerationError } from '../electron/main/services/generation-task.service'
import type { Project, GenerateVideoRequest } from '../src/shared/ipc.types'

let project: Project
let request: GenerateVideoRequest
beforeEach(async () => {
  environment.root = await fs.mkdtemp(path.join(os.tmpdir(), 'aigc-generation-test-'))
  project = { id: 'project-1', folderPath: environment.root } as Project
  request = { projectId: project.id, nodeId: 'video-1', prompt: 'a scene', workflowId: 'seedance-2.0', aspectRatio: '16:9' }
})
afterEach(async () => { await fs.rm(environment.root, { recursive: true, force: true }) })
const options = () => ({ project, provider: 'seedance' as const, operation: 'video' as const, request })
async function record() {
  const dir = path.join(environment.root, '.aigc-line', 'generation-tasks')
  return JSON.parse(await fs.readFile(path.join(dir, (await fs.readdir(dir)).find(name => /^[a-f0-9]{64}\.json$/.test(name))!), 'utf8'))
}

describe('persistent generation tasks', () => {
  it('persists a submitted ID and resumes after polling failure without posting again', async () => {
    const submit = vi.fn(async mark => { mark(); return 'remote-123' })
    await expect(runGenerationTask(options(), { submit, complete: async () => { throw new Error('offline') } })).rejects.toThrow('offline')
    expect(await record()).toMatchObject({ status: 'running', taskId: 'remote-123' })
    const complete = vi.fn(async id => ({ success: true, relativePath: `generated/${id}.mp4` }))
    expect(await runGenerationTask(options(), { submit, complete })).toMatchObject({ success: true, promptId: 'remote-123' })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith('remote-123')
  })
  it('deduplicates concurrent calls and retains a result until the canvas acknowledges it', async () => {
    const submit = vi.fn(async mark => { mark(); return 'remote-1' })
    const complete = vi.fn(async () => ({ success: true, relativePath: 'generated/result.mp4' }))
    const work = { submit, complete }
    await Promise.all([runGenerationTask(options(), work), runGenerationTask(options(), work)])
    await runGenerationTask(options(), work)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledTimes(1)
    await acknowledgeGenerationTaskResult(project.id, request.nodeId, 'remote-1')
    await runGenerationTask(options(), work)
    expect(submit).toHaveBeenCalledTimes(2)
  })
  it('keeps uncertain submissions blocked but permits retry after an explicit remote failure', async () => {
    const submit = vi.fn(async mark => { mark(); throw new TypeError('connection reset after POST') })
    const complete = vi.fn()
    await expect(runGenerationTask(options(), { submit, complete })).rejects.toThrow('connection reset')
    await expect(runGenerationTask(options(), { submit, complete })).rejects.toThrow('提交结果未知')
    expect(submit).toHaveBeenCalledTimes(1)
    request = { ...request, nodeId: 'other' }
    await expect(runGenerationTask(options(), { submit: async mark => { mark(); return 'cancelled-task' }, complete: async () => { throw new TerminalGenerationError('cancelled') } })).rejects.toThrow('cancelled')
    expect(await runGenerationTask(options(), { submit: async mark => { mark(); return 'replacement' }, complete: async () => ({ success: true, relativePath: 'result.mp4' }) })).toMatchObject({ promptId: 'replacement' })
  })
  it('never stores unexpected credentials and prevents a changed request from replacing a pending task', async () => {
    const unsafe = { ...request, apiKey: 'DO-NOT-SAVE', token: 'DO-NOT-SAVE' }
    await expect(runGenerationTask({ ...options(), request: unsafe }, { submit: async mark => { mark(); return 'pending' }, complete: async () => { throw new Error('offline') } })).rejects.toThrow()
    expect(JSON.stringify(await record())).not.toContain('DO-NOT-SAVE')
    await expect(runGenerationTask({ ...options(), request: { ...request, prompt: 'changed' } }, { submit: vi.fn(), complete: vi.fn() })).rejects.toThrow('未确认')
  })
  it('records synchronous cloud results and only unblocks uncertain tasks after explicit local dismissal', async () => {
    const generate = vi.fn(async mark => { mark(); return { success: true, relativePath: 'generated/local.png' } })
    const result = await runLocalGeneration({ project, provider: 'google', request }, generate)
    expect(result.promptId).toMatch(/^local-/)
    expect(await record()).toMatchObject({ provider: 'google', status: 'succeeded', relativePath: 'generated/local.png' })
    await runLocalGeneration({ project, provider: 'google', request }, generate)
    expect(generate).toHaveBeenCalledTimes(1)
    await acknowledgeGenerationTaskResult(project.id, request.nodeId, result.promptId!)
    await expect(runLocalGeneration({ project, provider: 'google', request }, async mark => { mark(); throw new Error('unknown submission') })).rejects.toThrow()
    const unknown = await record()
    await expect(dismissGenerationTask(project.id, request.nodeId, 'wrong')).rejects.toThrow('任务已变化')
    await dismissGenerationTask(project.id, request.nodeId, unknown.id)
    expect((await fs.readdir(path.join(environment.root, '.aigc-line', 'generation-tasks'))).some(name => name.startsWith('dismissed-'))).toBe(true)
    await runLocalGeneration({ project, provider: 'google', request }, generate)
    expect(generate).toHaveBeenCalledTimes(2)
  })
  it('converts a stale submission marker to actionable unknown without posting again', async () => {
    await runGenerationTask(options(), { submit: async mark => { mark(); return 'old' }, complete: async () => ({ success: true, relativePath: 'generated/old.mp4' }) })
    const dir = path.join(environment.root, '.aigc-line', 'generation-tasks')
    const file = path.join(dir, (await fs.readdir(dir))[0])
    const stale = await record(); stale.status = 'submitting'; delete stale.taskId
    await fs.writeFile(file, JSON.stringify(stale))
    await resumeProjectGenerationTasks(project.id)
    expect(await record()).toMatchObject({ status: 'unknown' })
  })
})
