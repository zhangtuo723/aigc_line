import { describe, expect, it } from 'vitest'
import {
  SEEDREAM_IMAGE_MODELS,
  buildSeedreamImageRequest,
  isSeedreamImageWorkflow,
} from '../electron/main/services/seedream-image.service'

describe('Seedream image models', () => {
  it('registers only Seedream 5.0 Pro and Lite with their Ark model ids', () => {
    expect(SEEDREAM_IMAGE_MODELS.map(({ id, model }) => ({ id, model }))).toEqual([
      { id: 'seedream-5.0-pro', model: 'doubao-seedream-5-0-260128' },
      { id: 'seedream-5.0-lite', model: 'doubao-seedream-5-0-lite-260128' },
    ])
  })

  it('routes only Seedream workflow ids to the Ark API', () => {
    expect(isSeedreamImageWorkflow('seedream-5.0-pro')).toBe(true)
    expect(isSeedreamImageWorkflow('seedream-5.0-lite')).toBe(true)
    expect(isSeedreamImageWorkflow('krea2-turbo-t2i')).toBe(false)
  })

  it.each([
    ['16:9', '2816x1584'],
    ['9:16', '1584x2816'],
    ['4:3', '2368x1776'],
    ['1:1', '2048x2048'],
  ] as const)('uses the official Seedream 5.0 Pro 2K reference size for %s', (aspectRatio, size) => {
    expect(buildSeedreamImageRequest({ prompt: ' 测试 ', aspectRatio }, 'model-id')).toEqual({
      model: 'model-id',
      prompt: '测试',
      size,
      sequential_image_generation: 'disabled',
      stream: false,
      response_format: 'b64_json',
      output_format: 'jpeg',
      watermark: false,
    })
  })

  it('serializes multiple reference images as an ordered array', () => {
    expect(buildSeedreamImageRequest(
      { prompt: '测试', aspectRatio: '16:9' },
      'model-id',
      ['data:image/png;base64,first', 'data:image/jpeg;base64,second'],
    ).image).toEqual(['data:image/png;base64,first', 'data:image/jpeg;base64,second'])
  })
})
