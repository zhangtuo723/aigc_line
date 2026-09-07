import { ArrayBufferTarget, Muxer } from 'webm-muxer'
import { finalizeDirectorWebMDuration } from './director-webm-duration'

export const directorFrameTime = (frame: number, fps: number) => Math.round(frame * 1_000_000 / fps)

export async function boundedExportWait<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs = 30_000): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
    const abort = () => { finish(); reject(signal.reason ?? new Error('导出已取消')) }
    const timer = setTimeout(() => { finish(); reject(new Error('导出等待超时，请重试或减少场景复杂度')) }, timeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    promise.then((value) => { finish(); resolve(value) }, (error) => { finish(); reject(error) })
  })
}

/** Every project frame is rendered and encoded once, independent of wall time. */
export async function encodeDirectorWebM(options: {
  width: number; height: number; fps: number; frameCount: number; signal: AbortSignal;
  renderFrame: (frame: number) => Promise<HTMLCanvasElement>;
  onProgress?: (completed: number, total: number) => void;
}): Promise<ArrayBuffer> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('当前环境不支持逐帧视频编码，请更新应用运行环境')
  const { width, height, fps, frameCount, signal } = options
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > fps * 60) throw new Error('单次预演视频支持最多 60 秒')
  let config: VideoEncoderConfig | undefined
  let codec = ''
  for (const candidate of [{ codec: 'vp09.00.40.08', id: 'V_VP9' }, { codec: 'vp8', id: 'V_VP8' }]) {
    const next: VideoEncoderConfig = { codec: candidate.codec, width, height, bitrate: 8_000_000, framerate: fps, latencyMode: 'quality' }
    if ((await boundedExportWait(VideoEncoder.isConfigSupported(next), signal)).supported) { config = next; codec = candidate.id; break }
  }
  if (!config) throw new Error('当前环境没有可用的 VP9/VP8 逐帧编码器')
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec, width, height, frameRate: fps }, firstTimestampBehavior: 'strict' })
  let outputCount = 0
  let bytes = 0
  let failure: Error | undefined
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      try {
        bytes += chunk.byteLength
        if (bytes > 128 * 1024 * 1024) throw new Error('预演视频超过 128 MB，请缩短镜头')
        muxer.addVideoChunk(chunk, metadata)
        outputCount += 1
      } catch (error) { failure = error instanceof Error ? error : new Error(String(error)) }
    },
    error: (error) => { failure = error },
  })
  try {
    encoder.configure(config)
    for (let index = 0; index < frameCount; index++) {
      signal.throwIfAborted()
      if (failure) throw failure
      const canvas = await boundedExportWait(options.renderFrame(index), signal)
      signal.throwIfAborted()
      const timestamp = directorFrameTime(index, fps)
      const frame = new VideoFrame(canvas, { timestamp, duration: directorFrameTime(index + 1, fps) - timestamp })
      try { encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 }) }
      finally { frame.close() }
      if (encoder.encodeQueueSize >= 8 || index % 12 === 11) await boundedExportWait(encoder.flush(), signal)
      options.onProgress?.(index + 1, frameCount)
    }
    await boundedExportWait(encoder.flush(), signal)
    if (failure) throw failure
    if (outputCount !== frameCount) throw new Error(`视频帧不完整（${outputCount}/${frameCount}），已取消保存，请重试`)
    muxer.finalize()
    return finalizeDirectorWebMDuration(muxer.target.buffer, directorFrameTime(frameCount, fps))
  } finally { if (encoder.state !== 'closed') encoder.close() }
}
