import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listProjectMediaAssetsAtRoot } from '../electron/main/services/project-media.service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )))
})

describe('project media assets', () => {
  it('scans only supported media under generated and uploads', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aigc-canvas-media-'))
    temporaryDirectories.push(root)
    await fs.mkdir(path.join(root, 'generated', 'images'), { recursive: true })
    await fs.mkdir(path.join(root, 'uploads', 'audio'), { recursive: true })
    await fs.mkdir(path.join(root, 'other'), { recursive: true })
    await fs.writeFile(path.join(root, 'generated', 'images', 'frame.png'), 'image')
    await fs.writeFile(path.join(root, 'uploads', 'audio', 'voice.wav'), 'audio')
    await fs.writeFile(path.join(root, 'generated', 'notes.txt'), 'ignore')
    await fs.writeFile(path.join(root, 'other', 'outside.mp4'), 'ignore')

    const assets = await listProjectMediaAssetsAtRoot(root)

    expect(assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'image', relativePath: 'generated/images/frame.png' }),
      expect.objectContaining({ kind: 'audio', relativePath: 'uploads/audio/voice.wav' }),
    ]))
    expect(assets).toHaveLength(2)
  })
})
