/** Locate an immediate EBML child without searching inside encoded frame data. */
function child(bytes: Uint8Array, start: number, end: number, wanted: number): { start: number; end: number } {
  const variableLength = (offset: number, max: number) => {
    let mask = 0x80
    let length = 1
    while (length <= max && !(bytes[offset] & mask)) { mask >>= 1; length++ }
    if (length > max || offset + length > end) throw new Error('视频封装头不完整')
    return { length, mask }
  }
  for (let offset = start; offset < end;) {
    const idHeader = variableLength(offset, 4)
    let id = 0
    for (let i = 0; i < idHeader.length; i++) id = id * 256 + bytes[offset++]
    const sizeHeader = variableLength(offset, 8)
    let size = bytes[offset] & (sizeHeader.mask - 1)
    let unknown = size === sizeHeader.mask - 1
    for (let i = 1; i < sizeHeader.length; i++) {
      size = size * 256 + bytes[offset + i]
      unknown &&= bytes[offset + i] === 255
    }
    offset += sizeHeader.length
    const childEnd = unknown ? end : offset + size
    if (!Number.isSafeInteger(childEnd) || childEnd > end) throw new Error('视频封装长度无效')
    if (id === wanted) return { start: offset, end: childEnd }
    offset = childEnd
  }
  throw new Error('视频封装缺少时长信息')
}

/** webm-muxer 5.1 stores the last frame's start as duration; include its display time. */
export function finalizeDirectorWebMDuration(buffer: ArrayBuffer, durationMicroseconds: number): ArrayBuffer {
  if (!Number.isFinite(durationMicroseconds) || durationMicroseconds <= 0) throw new Error('视频时长无效')
  const bytes = new Uint8Array(buffer)
  const segment = child(bytes, 0, bytes.length, 0x18538067)
  const info = child(bytes, segment.start, segment.end, 0x1549a966)
  const scale = child(bytes, info.start, info.end, 0x2ad7b1)
  let nanosecondsPerTick = 0
  for (let offset = scale.start; offset < scale.end; offset++) nanosecondsPerTick = nanosecondsPerTick * 256 + bytes[offset]
  const duration = child(bytes, info.start, info.end, 0x4489)
  if (duration.end - duration.start !== 8 || nanosecondsPerTick <= 0) throw new Error('视频封装时长格式无效')
  new DataView(buffer).setFloat64(duration.start, durationMicroseconds * 1000 / nanosecondsPerTick)
  return buffer
}
