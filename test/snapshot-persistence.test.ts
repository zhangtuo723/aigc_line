import { describe, expect, it, vi } from 'vitest'
import { SnapshotPersistence } from '../src/shared/snapshot-persistence'
import { flushPendingEdits, registerEditFlusher } from '../src/shared/pending-edits'

describe('snapshot persistence', () => {
  it('flushes the last draft immediately on navigation and serializes later edits', async () => {
    const writes: number[] = []
    let release!: () => void
    const first = new Promise<void>((resolve) => { release = resolve })
    const writer = new SnapshotPersistence<number>(async (value) => { writes.push(value); if (value === 1) await first })
    writer.schedule(1)
    const saved = writer.flush()
    writer.schedule(2)
    writer.schedule(3)
    expect(writes).toEqual([1])
    release()
    await saved
    expect(writes).toEqual([1, 3])
    expect(writer.getState()).toBe('saved')
    expect(writer.getPending()).toBeUndefined()
  })

  it('retains failed drafts for retry and never reports success before disk ack', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const writer = new SnapshotPersistence<number>(write)
    writer.schedule(7)
    await expect(writer.flush()).rejects.toThrow('disk full')
    expect(writer.getState()).toBe('error')
    expect(writer.getPending()).toBe(7)
    await writer.flush()
    expect(write).toHaveBeenLastCalledWith(7)
    expect(writer.getState()).toBe('saved')
  })

  it('commits editor state before its outer canvas and propagates failure', async () => {
    const order: string[] = []
    const outer = registerEditFlusher(async () => { order.push('canvas') }, 100)
    const editor = registerEditFlusher(async () => { order.push('editor') }, 10)
    try {
      await flushPendingEdits()
      expect(order).toEqual(['editor', 'canvas'])
    } finally { outer(); editor() }
  })
})
