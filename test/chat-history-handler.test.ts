import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../src/shared/ipc.types'
import { IPC_CHANNELS } from '../src/shared/ipc.channels'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  read: vi.fn(), update: vi.fn(), load: vi.fn(), stage: vi.fn(), saveText: vi.fn(), enqueue: vi.fn(),
  claudeIds: [] as string[], codexIds: [] as string[], pending: new Set<string>(),
}))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => state.handlers.set(channel, handler) }, nativeImage: {} }))
vi.mock('electron-log/main', () => ({ default: { error: vi.fn() } }))
vi.mock('../electron/main/services/agent/models', () => ({ listAgentModels: vi.fn() }))
vi.mock('../electron/main/services/agent/codex-session', () => ({
  getCodexQueue: vi.fn(), sendCodexQueuedNow: vi.fn(),
  isCodexMessagePending: (_folder: string, id: string) => state.pending.has(id),
  getActiveCodexToolIds: () => state.codexIds,
}))
vi.mock('../electron/main/services/agent/session-manager', () => ({ getActiveClaudeToolIds: () => state.claudeIds }))
vi.mock('../electron/main/services/agent', () => ({ clearAgentContext: vi.fn(), enqueueAgentMessage: state.enqueue, interruptAgentTurn: vi.fn(), listAvailableSkills: vi.fn() }))
vi.mock('../electron/main/services/chat-attachment.service', () => ({ stageChatAttachments: state.stage, saveChatTextAttachment: state.saveText }))
vi.mock('../electron/main/services/project.store', () => ({ loadProject: state.load, readChatHistory: state.read, updateChatMessage: state.update }))
import { registerChatHandlers } from '../electron/main/ipc/chat.handlers'

const tool = (id: string): ChatMessage => ({ id, role: 'tool', content: '', timestamp: 1, toolCall: { id: `call-${id}`, toolName: 'Read', toolInput: '{}', status: 'running' } })
const loadHistory = () => state.handlers.get(IPC_CHANNELS.chat.loadHistory)!(null, '/project') as Promise<ChatMessage[]>

beforeEach(() => {
  vi.clearAllMocks()
  state.claudeIds = []; state.codexIds = []; state.pending.clear()
  registerChatHandlers()
})

describe('chat history keeps runtime and persistence consistent', () => {
  it('saves text only in an existing project and reports disk errors', async () => {
    const save = state.handlers.get(IPC_CHANNELS.chat.saveTextAttachment)!
    state.load.mockResolvedValue(null)
    expect(await save(null, 'missing', 'input')).toEqual({ success: false, error: '项目不存在或已被删除' })
    expect(state.saveText).not.toHaveBeenCalled()
    state.load.mockResolvedValue({ folderPath: '/project' })
    state.saveText.mockRejectedValue(new Error('disk full'))
    expect(await save(null, 'project', ' exact input\n')).toEqual({ success: false, error: 'disk full' })
    expect(state.saveText).toHaveBeenCalledWith('/project', ' exact input\n')
  })

  it('keeps live Claude/Codex calls running and interrupts only orphaned calls', async () => {
    const records = [tool('claude'), tool('codex'), tool('orphan')]
    state.read.mockResolvedValue(records)
    state.claudeIds = ['call-claude']; state.codexIds = ['call-codex']
    state.update.mockImplementation(async (_folder, id, update) => update(records.find((message) => message.id === id)))
    const result = await loadHistory()
    expect(result.map((message) => message.toolCall?.status)).toEqual(['running', 'running', 'interrupted'])
    expect(state.update).toHaveBeenCalledTimes(1)
    expect(state.update.mock.calls[0][1]).toBe('orphan')
  })

  it('does not overwrite a tool completion that wins the persistence race', async () => {
    const initial = tool('complete-during-load')
    const completed = { ...initial, content: 'finished', toolCall: { ...initial.toolCall!, status: 'completed' as const, result: 'ok' } }
    state.read.mockResolvedValue([initial])
    state.update.mockImplementation(async (_folder, _id, update) => {
      const next = update(completed)
      expect(next).toBe(completed)
      return next
    })
    expect(await loadHistory()).toEqual([completed])
  })

  it('does not cancel a queued message that was sent during the load', async () => {
    const queued: ChatMessage = { id: 'queued', role: 'user', content: 'hello', timestamp: 1, deliveryStatus: 'queued' }
    const sent: ChatMessage = { ...queued, deliveryStatus: 'sent' }
    state.read.mockResolvedValue([queued])
    state.update.mockImplementation(async (_folder, _id, update) => {
      const next = update(sent)
      expect(next).toBe(sent)
      return next
    })
    expect(await loadHistory()).toEqual([sent])
  })

  it('rechecks active tools when writing an interrupted status', async () => {
    const running = tool('became-active')
    state.read.mockResolvedValue([running])
    state.update.mockImplementation(async (_folder, _id, update) => {
      state.codexIds = ['call-became-active']
      return update(running)
    })
    expect((await loadHistory())[0].toolCall?.status).toBe('running')
  })

  it('rejects missing projects and staging failures so the renderer retains its draft', async () => {
    const send = state.handlers.get(IPC_CHANNELS.chat.sendMessage)!
    state.load.mockResolvedValueOnce(null)
    await expect(send(null, 'missing', { id: 'user', attachments: [] })).rejects.toThrow('项目不存在')
    state.load.mockResolvedValueOnce({ id: 'project', folderPath: '/project' })
    state.stage.mockRejectedValueOnce(new Error('attachment copy failed'))
    await expect(send(null, 'project', { id: 'user', attachments: [] })).rejects.toThrow('attachment copy failed')
    expect(state.enqueue).not.toHaveBeenCalled()
  })
})
