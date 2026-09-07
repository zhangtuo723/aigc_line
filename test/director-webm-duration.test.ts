import { describe, expect, it } from 'vitest'
import { ArrayBufferTarget, Muxer } from 'webm-muxer'
import { finalizeDirectorWebMDuration } from '../src/features/director/director-webm-duration'

describe('director WebM duration', () => {
  it('includes the final frame in the real muxer header without changing frame bytes', () => {
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'V_VP8', width: 640, height: 360, frameRate: 24 } })
    for (let frame = 0; frame < 48; frame++) muxer.addVideoChunkRaw(new Uint8Array([0, 1, 2, 3]), frame === 0 ? 'key' : 'delta', Math.round(frame * 1e6 / 24))
    muxer.finalize()
    const original = new Uint8Array(muxer.target.buffer.slice(0))
    const result = finalizeDirectorWebMDuration(muxer.target.buffer, 2e6)
    const updated = new Uint8Array(result)
    const durationOffset = original.findIndex((_, index) => original[index] === 0x44 && original[index + 1] === 0x89 && original[index + 2] === 0x88) + 3
    expect(durationOffset).toBeGreaterThan(3)
    expect(new DataView(original.buffer).getFloat64(durationOffset)).toBe(1958)
    expect(new DataView(result).getFloat64(durationOffset)).toBe(2000)
    expect(updated.subarray(0, durationOffset)).toEqual(original.subarray(0, durationOffset))
    expect(updated.subarray(durationOffset + 8)).toEqual(original.subarray(durationOffset + 8))
  })

  it('refuses incomplete headers', () => {
    expect(() => finalizeDirectorWebMDuration(new ArrayBuffer(20), 2e6)).toThrow('视频封装')
  })
})
