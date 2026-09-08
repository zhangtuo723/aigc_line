import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetPreviewCache, AssetPreviewPool } from '../src/components/project-asset-preview-cache'
import { beginCanvasInteraction, endCanvasInteraction, resetCanvasInteraction, waitForCanvasIdle } from '../src/components/canvas-interaction'

afterEach(() => {
  resetCanvasInteraction()
  vi.useRealTimers()
})

describe('asset thumbnail resource bounds', () => {
  it('uses complete project URLs and evicts least recently used thumbnails within both limits', () => {
    const cache = new AssetPreviewCache(2, 20)
    cache.set('workspace://a/same.png', 'a')
    cache.set('workspace://b/same.png', 'b')
    expect(cache.get('workspace://a/same.png')).toBe('a')
    cache.set('workspace://c/same.png', 'c')
    expect(cache.get('workspace://b/same.png')).toBeUndefined()
    expect(cache.get('workspace://a/same.png')).toBe('a')
    cache.set('large', 'x'.repeat(10))
    expect(cache.get('workspace://a/same.png')).toBeUndefined()
    cache.set('oversized', 'x'.repeat(11))
    expect(cache.get('oversized')).toBeUndefined()
  })

  it('bounds simultaneous decodes and never starts cancelled queued jobs', async () => {
    const pool = new AssetPreviewPool(1)
    let complete!: () => void
    const first = pool.run(() => new Promise<void>((resolve) => { complete = resolve }), new AbortController().signal)
    const controller = new AbortController()
    const skipped = vi.fn(async () => {})
    const cancelled = pool.run(skipped, controller.signal)
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
    const last = vi.fn(async () => 'ready')
    const final = pool.run(last, new AbortController().signal)
    expect(last).not.toHaveBeenCalled()
    complete()
    await first
    expect(await final).toBe('ready')
    expect(skipped).not.toHaveBeenCalled()
    expect(last).toHaveBeenCalledOnce()
  })

  it('reads an initial cached image without making abandoned renders change eviction order', () => {
    const cache = new AssetPreviewCache(2, 100)
    cache.set('first', 'poster one')
    cache.set('second', 'poster two')
    expect(cache.peek('first')).toBe('poster one')
    cache.set('third', 'poster three')
    expect(cache.peek('first')).toBeUndefined()
    expect(cache.peek('second')).toBe('poster two')
  })

  it('releases idle-waiting decoder slots on cancellation and resumes remaining work after the drag settles', async () => {
    vi.useFakeTimers()
    const pool = new AssetPreviewPool(1)
    const departed = new AbortController()
    const remaining = new AbortController()
    const decode = vi.fn(async () => 'poster')
    beginCanvasInteraction('viewport')
    const cancelled = pool.run(async () => {
      await waitForCanvasIdle(departed.signal)
      return decode()
    }, departed.signal)
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    const next = pool.run(async () => {
      await waitForCanvasIdle(remaining.signal)
      return decode()
    }, remaining.signal)
    await Promise.resolve()
    departed.abort()
    await rejection
    await vi.advanceTimersByTimeAsync(0)
    expect(decode).not.toHaveBeenCalled()
    endCanvasInteraction('viewport')
    await vi.advanceTimersByTimeAsync(179)
    expect(decode).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await next).toBe('poster')
    expect(decode).toHaveBeenCalledOnce()
  })
})
