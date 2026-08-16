import type { ImageAspectRatio } from './ipc.types'

export interface MediaDimensions {
  width: number
  height: number
}

/** Standard 2K still-image output dimensions. */
export const imageDimensionsFor = (ratio: ImageAspectRatio): MediaDimensions => {
  if (ratio === '1:1') return { width: 2048, height: 2048 }
  if (ratio === '4:3') return { width: 2048, height: 1536 }
  return { width: 2048, height: 1152 }
}

/** Seedream 5.0 Pro official 2K reference dimensions. */
export const seedreamImageDimensionsFor = (ratio: ImageAspectRatio): MediaDimensions => {
  if (ratio === '1:1') return { width: 2048, height: 2048 }
  if (ratio === '4:3') return { width: 2368, height: 1776 }
  return { width: 2816, height: 1584 }
}

/** MiniMax H3 1024-class video dimensions. */
export const videoDimensionsFor = (ratio: ImageAspectRatio): MediaDimensions => {
  if (ratio === '1:1') return { width: 1024, height: 1024 }
  if (ratio === '4:3') return { width: 1024, height: 768 }
  return { width: 1024, height: 576 }
}
