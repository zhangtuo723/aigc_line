import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ProjectChatMessagePush } from '../src/shared/ipc.types'

const flush = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../src/shared/pending-edits', () => ({ flushPendingEdits: flush, beginEditBarrier: () => () => {} }))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
const project = (id: string) => ({ id, folderPath: `/projects/${id}`, name: id, agent: { provider: 'codex' as const, model: '' }, createdAt: 1, updatedAt: 1 })
const message = (id: string, content = id): ChatMessage => ({ id, role: 'assistant', content, timestamp: 1 })
let push: (payload: ProjectChatMessagePush) => void
let end: (payload: { projectId: string }) => void
let api: { loadProject: ReturnType<typeof vi.fn>; closeProject: ReturnType<typeof vi.fn>; loadChatHistory: ReturnType<typeof vi.fn>; sendChatMessage: ReturnType<typeof vi.fn> }
let store: typeof import('../src/stores/app.store')['useAppStore']

beforeEach(async () => {
  vi.resetModules()
  flush.mockClear()
  api = { loadProject: vi.fn(async (id: string) => project(id)), closeProject: vi.fn(async () => {}), loadChatHistory: vi.fn(async () => []), sendChatMessage: vi.fn(async () => {}) }
  vi.stubGlobal('window', { electronAPI: { ...api, onChatMessage: (handler: typeof push) => { push = handler }, onTurnEnd: (handler: typeof end) => { end = handler }, onArtifact: vi.fn() } })
  store = (await import('../src/stores/app.store')).useAppStore
})

describe('chat store project and streaming races', () => {
  it('waits for saved edits and persisted close before clearing the workspace', async () => {
    await store.getState().selectProject('a')
    push({ projectId: 'a', message: message('history') })
    const saving = deferred<void>()
    const closing = deferred<void>()
    flush.mockReturnValueOnce(saving.promise)
    api.closeProject.mockReturnValueOnce(closing.promise)
    const close = store.getState().closeProject()
    expect(api.closeProject).not.toHaveBeenCalled()
    expect(store.getState().currentPage).toBe('project')
    saving.resolve()
    await vi.waitFor(() => expect(api.closeProject).toHaveBeenCalledWith('a'))
    expect(store.getState().currentProject?.id).toBe('a')
    closing.resolve()
    await close
    expect(store.getState().currentProject).toBeNull()
    expect(store.getState().currentPage).toBe('home')
    push({ projectId: 'a', message: message('background') })
    expect(store.getState().messages).toEqual([])
  })
  it('keeps the workspace and restore target when saving fails', async () => {
    await store.getState().selectProject('a')
    flush.mockRejectedValueOnce(new Error('disk full'))
    await expect(store.getState().closeProject()).rejects.toThrow('disk full')
    expect(api.closeProject).not.toHaveBeenCalled()
    expect(store.getState().currentProject?.id).toBe('a')
    expect(store.getState().currentPage).toBe('project')
  })
  it('keeps the workspace when persisting the close fails and permits retry', async () => {
    await store.getState().selectProject('a')
    api.closeProject.mockRejectedValueOnce(new Error('index unavailable'))
    await expect(store.getState().closeProject()).rejects.toThrow('index unavailable')
    expect(store.getState().currentProject?.id).toBe('a')
    await store.getState().closeProject()
    expect(store.getState().currentPage).toBe('home')
  })
  it('upserts a stream and avoids rebuilding unrelated runtime state on every chunk', async () => {
    await store.getState().selectProject('a')
    push({ projectId: 'a', message: message('stream', 'part') })
    const runtime = store.getState().agentThinkingByProject
    push({ projectId: 'a', message: message('stream', 'final') })
    expect(store.getState().messages).toEqual([message('stream', 'final')])
    expect(store.getState().agentThinkingByProject).toBe(runtime)
    expect(flush).toHaveBeenCalledOnce()
  })

  it('retains live output delivered while history is loading', async () => {
    const pending = deferred<ChatMessage[]>()
    api.loadChatHistory.mockReturnValueOnce(pending.promise)
    const selected = store.getState().selectProject('a')
    await vi.waitFor(() => expect(api.loadChatHistory).toHaveBeenCalledOnce())
    push({ projectId: 'a', message: message('live') })
    pending.resolve([message('history')])
    await selected
    expect(store.getState().messages.map((item) => item.id)).toEqual(['history', 'live'])
  })

  it('rejects stale same-project history after an A to B to A switch', async () => {
    const pending = deferred<ChatMessage[]>()
    api.loadChatHistory.mockReturnValueOnce(pending.promise)
    const first = store.getState().selectProject('a')
    await vi.waitFor(() => expect(api.loadChatHistory).toHaveBeenCalledOnce())
    await store.getState().selectProject('b')
    api.loadChatHistory.mockResolvedValueOnce([message('fresh-a')])
    await store.getState().selectProject('a')
    pending.resolve([message('stale-a')])
    await first
    expect(store.getState().messages.map((item) => item.id)).toEqual(['fresh-a'])
  })

  it('restores failed-message references without overwriting references added while awaiting', async () => {
    await store.getState().selectProject('a')
    store.getState().addCanvasNodeReference({ id: 'old', title: 'old', kind: 'image' })
    const pending = deferred<void>()
    api.sendChatMessage.mockReturnValueOnce(pending.promise)
    const send = store.getState().sendChatMessage('keep this', [{ name: 'file', type: 'txt', path: '/missing' }])
    const rejection = expect(send).rejects.toThrow('missing')
    store.getState().addCanvasNodeReference({ id: 'new', title: 'new', kind: 'video' })
    pending.reject(new Error('missing'))
    await rejection
    expect(store.getState().referencedCanvasNodes.map((item) => item.id)).toEqual(['new', 'old'])
    expect(store.getState().messages).toHaveLength(0)
  })

  it('never restores failed references into a different project', async () => {
    await store.getState().selectProject('a')
    store.getState().addCanvasNodeReference({ id: 'a-node', title: 'a', kind: 'image' })
    const pending = deferred<void>()
    api.sendChatMessage.mockReturnValueOnce(pending.promise)
    const rejection = expect(store.getState().sendChatMessage('a message')).rejects.toThrow('failure')
    await store.getState().selectProject('b')
    pending.reject(new Error('failure'))
    await rejection
    expect(store.getState().currentProject?.id).toBe('b')
    expect(store.getState().referencedCanvasNodes).toEqual([])
  })

  it('keeps an existing active turn when a follow-up message fails staging', async () => {
    await store.getState().selectProject('a')
    push({ projectId: 'a', message: message('active') })
    api.sendChatMessage.mockRejectedValueOnce(new Error('missing attachment'))
    await expect(store.getState().sendChatMessage('follow-up')).rejects.toThrow('missing attachment')
    expect(store.getState().agentThinkingByProject.a).toBe(true)
  })

  it('does not revive a turn that ended while a follow-up was being staged', async () => {
    await store.getState().selectProject('a')
    push({ projectId: 'a', message: message('active') })
    const pending = deferred<void>()
    api.sendChatMessage.mockReturnValueOnce(pending.promise)
    const rejection = expect(store.getState().sendChatMessage('follow-up')).rejects.toThrow('missing')
    end({ projectId: 'a' })
    pending.reject(new Error('missing'))
    await rejection
    expect(store.getState().agentThinkingByProject.a).toBe(false)
  })
})
