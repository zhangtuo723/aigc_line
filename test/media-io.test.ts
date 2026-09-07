import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readBoundedMedia, downloadMediaToFile } from '../electron/main/services/media-io'
let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'aigc-media-io-')) })
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }) })
describe('bounded media I/O', () => {
  it('rejects oversized inputs before opening or allocating their content', async () => {
    const file = path.join(root, 'large.mp4'); await fs.writeFile(file, Buffer.alloc(1024))
    const open = vi.spyOn(fs, 'open')
    await expect(readBoundedMedia(file, 128, '视频')).rejects.toThrow('大小必须')
    expect(open).not.toHaveBeenCalled()
    expect(await readBoundedMedia(file, 2048, '视频')).toEqual(Buffer.alloc(1024))
  })
  it('streams complete downloads and removes partial files after the size limit is exceeded', async () => {
    const output = path.join(root, 'output.mp4')
    await downloadMediaToFile(new Response(Buffer.from('complete')), output, 100)
    expect(await fs.readFile(output, 'utf8')).toBe('complete')
    const stream = new ReadableStream({ start(controller) { controller.enqueue(Buffer.alloc(10)); controller.enqueue(Buffer.alloc(10)); controller.close() } })
    await expect(downloadMediaToFile(new Response(stream), output, 15)).rejects.toThrow('大小上限')
    expect(await fs.readFile(output, 'utf8')).toBe('complete')
    expect(await fs.readdir(root)).toEqual(['output.mp4'])
  })
})
