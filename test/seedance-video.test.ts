import { describe, expect, it, vi } from 'vitest'

vi.mock('../electron/main/services/project.store', () => ({
  loadProject: vi.fn(),
}))

vi.mock('../electron/main/services/settings.service', () => ({
  getRuntimeSettings: vi.fn(),
}))

import {
  buildSeedanceVideoRequest,
  isSeedanceVideoWorkflow,
  SEEDANCE_VIDEO_MODELS,
} from '../electron/main/services/seedance-video.service'

describe('Seedance 2.0 video request', () => {
  it('registers the Seedance workflow and official model ID', () => {
    expect(isSeedanceVideoWorkflow('seedance-2.0')).toBe(true)
    expect(isSeedanceVideoWorkflow('minimax-h3-r2v')).toBe(false)
    expect(SEEDANCE_VIDEO_MODELS[0].model).toBe('doubao-seedance-2-0-260128')
  })

  it('builds a 720p multimodal request with synchronized audio', () => {
    const body = buildSeedanceVideoRequest(
      { prompt: '  图片1中的人物向前走  ', aspectRatio: '16:9', duration: 15 },
      'doubao-seedance-2-0-260128',
      [{
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,AAAA' },
        role: 'reference_image',
      }],
    )
    expect(body).toMatchObject({
      model: 'doubao-seedance-2-0-260128',
      ratio: '16:9',
      duration: 15,
      resolution: '720p',
      generate_audio: true,
      watermark: false,
    })
    expect(body.content).toEqual([
      { type: 'text', text: '图片1中的人物向前走' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,AAAA' },
        role: 'reference_image',
      },
    ])
  })

  it('clamps duration to the supported 4–15 second range', () => {
    expect(buildSeedanceVideoRequest(
      { prompt: 'test', aspectRatio: '1:1', duration: 2 },
      'doubao-seedance-2-0-260128',
    ).duration).toBe(4)
    expect(buildSeedanceVideoRequest(
      { prompt: 'test', aspectRatio: '4:3', duration: 20 },
      'doubao-seedance-2-0-260128',
    ).duration).toBe(15)
  })
})
