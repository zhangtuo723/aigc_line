import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../src/shared/ipc.types'
import { canClearSubmittedDraft, chatDisplayMessages, mergeChatHistory, mergeChatReferences, sameChatQueue, upsertChatMessage } from '../src/shared/chat-state'
import { normalizeInactiveChatTools } from '../src/shared/chat-history-tools'

const message = (id: string, content = id): ChatMessage => ({ id, role: 'assistant', content, timestamp: 1 })

describe('chat state reconciliation', () => {
  it('replaces streamed text in place and removes pre-existing duplicate IDs', () => {
    const first = message('stream', 'partial')
    const final = message('stream', 'complete')
    const next = upsertChatMessage([message('before'), first, first, message('after')], final)
    expect(next.map((item) => item.id)).toEqual(['before', 'stream', 'after'])
    expect(next[1]).toBe(final)
  })

  it('merges late history with newer live updates while refreshing untouched history', () => {
    const old = message('old')
    const stream = message('stream', 'first')
    const before = new Map([old, stream].map((item) => [item.id, item]))
    const updated = message('stream', 'newest')
    const result = mergeChatHistory([message('old', 'refreshed'), stream], [old, updated, message('new')], before)
    expect(result.map((item) => item.content)).toEqual(['refreshed', 'newest', 'new'])
  })

  it('keeps queued messages out of the transcript and rejects stale queue entries after dispatch', () => {
    const queued = { ...message('queued'), role: 'user' as const, deliveryStatus: 'queued' as const }
    const sent = { ...message('sent'), role: 'user' as const, deliveryStatus: 'sent' as const }
    const cancelled = { ...message('cancelled'), deliveryStatus: 'cancelled' as const }
    const result = chatDisplayMessages([queued, sent, cancelled], [queued, { ...sent, deliveryStatus: 'queued' }], true)
    expect(result.queued.map((item) => item.id)).toEqual(['queued'])
    expect(result.visible.map((item) => item.id)).toEqual(['sent', 'cancelled'])
    expect(sameChatQueue([queued], structuredClone([queued]))).toBe(true)
    expect(sameChatQueue([queued], [{ ...queued, content: 'changed' }])).toBe(false)
  })

  it('never clears a draft edited or replaced while submission was pending', () => {
    expect(canClearSubmittedDraft(3, 3, 'a', 'a')).toBe(true)
    expect(canClearSubmittedDraft(3, 4, 'a', 'a')).toBe(false)
    expect(canClearSubmittedDraft(3, 3, 'a', 'b')).toBe(false)
    expect(mergeChatReferences([{ id: 'new' }, { id: 'shared', title: 'edited' }], [{ id: 'old' }, { id: 'shared', title: 'old' }]))
      .toEqual([{ id: 'new' }, { id: 'shared', title: 'edited' }, { id: 'old' }])
  })

  it('interrupts only orphaned tools, preserving live calls and already completed calls', () => {
    const tool = (id: string, status: 'running' | 'completed'): ChatMessage => ({ ...message(id), toolCall: { id, toolName: 'Read', toolInput: '', status } })
    const active = tool('active', 'running')
    const completed = tool('done', 'completed')
    const result = normalizeInactiveChatTools([active, tool('orphan', 'running'), completed], new Set(['active']))
    expect(result.messages[0]).toBe(active)
    expect(result.messages[1].toolCall?.status).toBe('interrupted')
    expect(result.messages[2]).toBe(completed)
  })
})
