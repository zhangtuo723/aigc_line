import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginCanvasInteraction, endCanvasInteraction, resetCanvasInteraction, waitForCanvasIdle } from '../src/components/canvas-interaction'

afterEach(() => { resetCanvasInteraction(); vi.useRealTimers() })

describe('canvas media waits for interaction to settle', () => {
  it('waits for both dragging and autopanning, including a restarted gesture', async () => {
    vi.useFakeTimers()
    beginCanvasInteraction('nodes')
    beginCanvasInteraction('viewport')
    const resumed = vi.fn()
    const pending = waitForCanvasIdle(new AbortController().signal).then(resumed)
    endCanvasInteraction('nodes')
    await vi.advanceTimersByTimeAsync(500)
    expect(resumed).not.toHaveBeenCalled()
    endCanvasInteraction('viewport')
    await vi.advanceTimersByTimeAsync(100)
    beginCanvasInteraction('viewport')
    await vi.advanceTimersByTimeAsync(500)
    expect(resumed).not.toHaveBeenCalled()
    endCanvasInteraction('viewport')
    await vi.advanceTimersByTimeAsync(180)
    await pending
    expect(resumed).toHaveBeenCalledOnce()
  })

  it('cancels obsolete previews and releases remaining waits on teardown', async () => {
    beginCanvasInteraction('viewport')
    const controller = new AbortController()
    const cancelled = expect(waitForCanvasIdle(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await cancelled
    const pending = waitForCanvasIdle(new AbortController().signal)
    resetCanvasInteraction()
    await pending
    await expect(waitForCanvasIdle(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await waitForCanvasIdle(new AbortController().signal)
  })
})
