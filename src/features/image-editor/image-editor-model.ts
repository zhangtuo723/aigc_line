export const BOARD_SOURCE_ELEMENT_PREFIX = 'image-editor-element-'
export const BOARD_SOURCE_FILE_PREFIX = 'image-editor-source-'
export const BOARD_MAX_EXPORT_SIDE = 8192
export const BOARD_MAX_EXPORT_PIXELS = 16 * 1024 * 1024

/** Bound allocation before Excalidraw creates its raster canvas. */
export function boardExportSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('所选素材的尺寸无效')
  const scale = Math.min(1, BOARD_MAX_EXPORT_SIDE / Math.max(width, height), Math.sqrt(BOARD_MAX_EXPORT_PIXELS / (width * height)))
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale }
}

type BoardElement = { id: string; type: string; isDeleted?: boolean; fileId?: string | null; status?: string }

/** Preserve drawing and each connected image's transform, even if its file fails. */
export function mergeBoardSources<T extends BoardElement>(existing: readonly T[], sources: readonly T[]): T[] {
  const byId = new Map(sources.map((element) => [element.id, element]))
  const restored = new Set<string>()
  const elements: T[] = []
  for (const element of existing) {
    if (element.id.startsWith(BOARD_SOURCE_ELEMENT_PREFIX)) {
      const source = byId.get(element.id)
      if (!source || element.type !== 'image') continue
      restored.add(element.id)
      elements.push({ ...element, fileId: source.fileId, status: source.status, isDeleted: false })
    } else if (element.type !== 'image') {
      elements.push(element)
    }
  }
  return [...elements, ...sources.filter((source) => !restored.has(source.id))]
}

/** Only two full image decodes may coexist. Every failure remains item-local. */
export async function loadBoardItems<T, R>(items: readonly T[], load: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      signal?.throwIfAborted()
      const index = cursor++
      try { results[index] = { status: 'fulfilled', value: await load(items[index], index) } }
      catch (reason) { results[index] = { status: 'rejected', reason } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, worker))
  signal?.throwIfAborted()
  return results
}
