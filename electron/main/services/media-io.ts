import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

let mediaJobs = 0
const mediaWaiters: Array<() => void> = []
/** Bound simultaneous base64/form preparations; streaming downloads don't consume a slot. */
export async function withMediaPreparation<T>(operation: () => Promise<T>): Promise<T> {
  if (mediaJobs >= 2) await new Promise<void>(resolve => mediaWaiters.push(resolve))
  else mediaJobs++
  try { return await operation() }
  finally {
    const next = mediaWaiters.shift()
    if (next) next()
    else mediaJobs--
  }
}

export async function assertMediaFileSize(filePath: string, maxBytes: number, label: string): Promise<number> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error(`${label}必须是普通文件`)
  if (stat.size <= 0 || stat.size > maxBytes) throw new Error(`${label}大小必须在 1 字节到 ${Math.round(maxBytes / 1024 / 1024)} MB 之间`)
  return stat.size
}
export async function readBoundedMedia(filePath: string, maxBytes: number, label: string): Promise<Buffer> {
  await assertMediaFileSize(filePath, maxBytes, label)
  const file = await fs.open(filePath, 'r')
  try {
    const chunks: Buffer[] = []; let total = 0
    for await (const chunk of file.createReadStream()) {
      total += chunk.length
      if (total > maxBytes) throw new Error(`${label}超过大小上限`)
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, total)
  } finally { await file.close() }
}
export async function downloadMediaToFile(response: Response, outputPath: string, maxBytes: number): Promise<void> {
  if (!response.ok || !response.body) throw new Error(`生成结果下载失败（HTTP ${response.status}）`)
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel(); throw new Error('生成结果超过下载大小上限')
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const temporary = `${outputPath}.${randomUUID()}.part`
  let total = 0
  try {
    const limiter = new Transform({ transform(chunk, _encoding, callback) {
      total += chunk.length
      callback(total > maxBytes ? new Error('生成结果超过下载大小上限') : null, chunk)
    } })
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), limiter, createWriteStream(temporary, { flags: 'wx' }))
    if (!total) throw new Error('生成结果为空')
    await fs.rename(temporary, outputPath)
  } finally { await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error }) }
}
