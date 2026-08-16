import { describe, expect, it } from 'vitest'
import {
  GOOGLE_IMAGE_MODELS,
  buildGoogleImageGenerationConfig,
  isGoogleImageWorkflow,
} from '../electron/main/services/google-image.service'
import { normalizeGoogleProxyUrl } from '../electron/main/services/google-network.service'

describe('Google image models', () => {
  it('registers the stable Nano Banana 2 and Pro model ids', () => {
    expect(GOOGLE_IMAGE_MODELS.map(({ id, model }) => ({ id, model }))).toEqual([
      {
        id: 'google-gemini-3.1-flash-image',
        model: 'gemini-3.1-flash-image',
      },
      {
        id: 'google-gemini-3-pro-image',
        model: 'gemini-3-pro-image',
      },
    ])
  })

  it('routes only Google image workflow ids to the Gemini API', () => {
    expect(isGoogleImageWorkflow('google-gemini-3.1-flash-image')).toBe(true)
    expect(isGoogleImageWorkflow('google-gemini-3-pro-image')).toBe(true)
    expect(isGoogleImageWorkflow('krea2-turbo-t2i')).toBe(false)
    expect(isGoogleImageWorkflow(undefined)).toBe(false)
  })

  it('serializes UI ratios and 2K with the Gemini imageConfig wire format', () => {
    expect(buildGoogleImageGenerationConfig('16:9')).toEqual({
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: '16:9',
        imageSize: '2K',
      },
    })
    expect(buildGoogleImageGenerationConfig('1:1').imageConfig.aspectRatio).toBe('1:1')
    expect(buildGoogleImageGenerationConfig('4:3').imageConfig.aspectRatio).toBe('4:3')
  })
})

describe('Google API proxy configuration', () => {
  it('accepts supported local proxy URLs', () => {
    expect(normalizeGoogleProxyUrl(' http://127.0.0.1:7890/ ')).toBe('http://127.0.0.1:7890')
    expect(normalizeGoogleProxyUrl('socks5://127.0.0.1:1080')).toBe('socks5://127.0.0.1:1080')
    expect(normalizeGoogleProxyUrl('')).toBe('')
  })

  it('rejects unsupported proxy URL schemes', () => {
    expect(() => normalizeGoogleProxyUrl('ftp://127.0.0.1:21')).toThrow('仅支持')
    expect(() => normalizeGoogleProxyUrl('127.0.0.1:7890')).toThrow('格式无效')
  })
})
