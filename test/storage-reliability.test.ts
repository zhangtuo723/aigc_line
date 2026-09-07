import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const environment = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => environment.root } }))
vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
import { appendChatMessage, createProject, deleteProject, listProjects, readCanvasSnapshot, readChatHistory, setLastOpened, updateChatMessage, writeCanvasSnapshot } from '../electron/main/services/project.store'

let workspace: string
beforeEach(async () => {
  environment.root = await fs.mkdtemp(path.join(os.tmpdir(), 'aigc-storage-test-'))
  workspace = path.join(environment.root, 'workspace')
  await fs.mkdir(workspace)
})
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(environment.root, { recursive: true, force: true }) })

describe('serialized persistence', () => {
  it('keeps the last concurrent snapshot complete without shared temporary file collisions', async () => {
    const snapshots = Array.from({ length: 20 }, (_, index) => ({ index, content: String(index).repeat(100_000 + index) }))
    await Promise.all(snapshots.map(snapshot => writeCanvasSnapshot(workspace, snapshot)))
    expect(await readCanvasSnapshot(workspace)).toEqual(snapshots.at(-1))
    expect(await fs.readdir(path.join(workspace, '.aigc-line'))).toEqual(['canvas-snapshot.json'])
  })
  it('does not resurrect a deleted project while another project is opening', async () => {
    const keep = await createProject('keep', workspace)
    const second = path.join(environment.root, 'second'); await fs.mkdir(second)
    const remove = await createProject('remove', second)
    await Promise.all([setLastOpened(keep.id), deleteProject(remove.id), setLastOpened(keep.id)])
    const index = await listProjects()
    expect(index.projects.map(project => project.id)).toEqual([keep.id])
    expect(index.lastOpenedId).toBe(keep.id)
  })
  it('distinguishes a missing snapshot from corruption without modifying the original', async () => {
    expect(await readCanvasSnapshot(workspace)).toBeNull()
    await fs.mkdir(path.join(workspace, '.aigc-line'))
    const file = path.join(workspace, '.aigc-line', 'canvas-snapshot.json')
    await fs.writeFile(file, '{broken')
    await expect(readCanvasSnapshot(workspace)).rejects.toThrow('原文件已保留')
    expect(await fs.readFile(file, 'utf8')).toBe('{broken')
  })
  it('updates indexed messages without rereading the log, then detects external corruption', async () => {
    const message = { id: 'm', role: 'assistant' as const, content: 'first', timestamp: 1 }
    await appendChatMessage(workspace, message)
    const reader = vi.spyOn(fs, 'readFile')
    for (let index = 0; index < 30; index++) await updateChatMessage(workspace, 'm', msg => ({ ...msg, content: `update-${index}` }))
    expect(reader).not.toHaveBeenCalled()
    const history = await readChatHistory(workspace)
    expect(history[0].content).toBe('update-29')
    history[0].content = 'caller mutation'
    expect((await readChatHistory(workspace))[0].content).toBe('update-29')
    await fs.writeFile(path.join(workspace, '.aigc-line', 'chat-events.jsonl'), '{broken}\n{also broken}\n')
    await expect(updateChatMessage(workspace, 'm', msg => msg)).rejects.toThrow('第 1 行损坏')
  })
  it('backs up and repairs an incomplete tail before an indexed update', async () => {
    await appendChatMessage(workspace, { id: 'm', role: 'user', content: 'original', timestamp: 1 })
    await fs.appendFile(path.join(workspace, '.aigc-line', 'chat-events.jsonl'), '{unfinished')
    await updateChatMessage(workspace, 'm', message => ({ ...message, content: 'updated' }))
    expect((await readChatHistory(workspace))[0].content).toBe('updated')
    expect((await fs.readdir(path.join(workspace, '.aigc-line'))).some(name => name.includes('.corrupt-'))).toBe(true)
  })
})
