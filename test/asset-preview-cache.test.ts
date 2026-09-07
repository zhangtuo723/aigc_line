import { describe, expect, it, vi } from 'vitest'
import { AssetPreviewCache, AssetPreviewPool } from '../src/components/project-asset-preview-cache'

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
})
