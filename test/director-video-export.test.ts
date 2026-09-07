import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { directorFrameTime, encodeDirectorWebM } from '../src/features/director/director-video-export'

const state = vi.hoisted(() => ({ times: [] as number[], closedFrames: 0, closedEncoder: 0, dropOutput: false }))
vi.mock('../src/features/director/director-webm-duration', () => ({ finalizeDirectorWebMDuration: (buffer: ArrayBuffer) => buffer }))
vi.mock('webm-muxer', () => ({
  ArrayBufferTarget: class { buffer = new ArrayBuffer(20) },
  Muxer: class { target: { buffer: ArrayBuffer }; constructor({ target }: {target: {buffer: ArrayBuffer}}) { this.target = target }; addVideoChunk(chunk: {timestamp: number}) { state.times.push(chunk.timestamp) }; finalize() {} },
}))

class FakeFrame {
  timestamp: number
  constructor(_canvas: unknown, init: {timestamp: number}) { this.timestamp = init.timestamp }
  close() { state.closedFrames++ }
}
class FakeEncoder {
  static async isConfigSupported() { return { supported: true } }
  state = 'configured'
  queue: FakeFrame[] = []
  output: (chunk: unknown) => void
  get encodeQueueSize() { return this.queue.length }
  constructor(init: { output: (chunk: unknown) => void }) { this.output = init.output }
  configure() {}
  encode(frame: FakeFrame) { this.queue.push(frame) }
  async flush() { for (const frame of this.queue.splice(0)) if (!state.dropOutput || frame.timestamp !== directorFrameTime(1, 24)) this.output({ timestamp: frame.timestamp, byteLength: 1 }) }
  close() { this.state = 'closed'; state.closedEncoder++ }
}

beforeEach(() => {
  state.times = []; state.closedFrames = 0; state.closedEncoder = 0; state.dropOutput = false
  vi.stubGlobal('VideoFrame', FakeFrame)
  vi.stubGlobal('VideoEncoder', FakeEncoder)
})
afterEach(() => vi.unstubAllGlobals())

describe('deterministic director encoding', () => {
  it('requests every integer frame once and encodes exact timestamps regardless of render delay', async () => {
    const requested: number[] = []
    await encodeDirectorWebM({ width: 640, height: 360, fps: 24, frameCount: 24, signal: new AbortController().signal, renderFrame: async (frame) => {
      requested.push(frame)
      if (frame === 3) await new Promise((resolve) => setTimeout(resolve, 10))
      return {} as HTMLCanvasElement
    } })
    expect(requested).toEqual(Array.from({length: 24}, (_, index) => index))
    expect(state.times).toEqual(requested.map((frame) => directorFrameTime(frame, 24)))
    expect(directorFrameTime(24, 24)).toBe(1_000_000)
    expect(state.closedFrames).toBe(24)
    expect(state.closedEncoder).toBe(1)
  })

  it('rejects incomplete output rather than silently publishing a skipped frame', async () => {
    state.dropOutput = true
    await expect(encodeDirectorWebM({ width: 640, height: 360, fps: 24, frameCount: 3, signal: new AbortController().signal, renderFrame: async () => ({} as HTMLCanvasElement) })).rejects.toThrow('视频帧不完整')
    expect(state.closedEncoder).toBe(1)
  })

  it('closes the encoder and stops requesting frames when cancelled', async () => {
    const controller = new AbortController()
    const requested: number[] = []
    await expect(encodeDirectorWebM({ width: 640, height: 360, fps: 24, frameCount: 24, signal: controller.signal, renderFrame: async (frame) => {
      requested.push(frame)
      controller.abort(new Error('cancelled'))
      return {} as HTMLCanvasElement
    } })).rejects.toThrow('cancelled')
    expect(requested).toEqual([0])
    expect(state.closedEncoder).toBe(1)
  })
})
