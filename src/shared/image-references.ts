export interface ImageReferenceCandidate {
  id: string
}

/**
 * Keeps an explicitly configured reference order, then appends newly connected
 * images in canvas edge order. Missing, duplicate, and over-limit ids are ignored.
 */
export function orderImageReferences<T extends ImageReferenceCandidate>(
  candidates: T[],
  configuredIds: string[] | undefined,
  limit: number,
): T[] {
  if (limit <= 0) return []
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const ordered: T[] = []
  const seen = new Set<string>()
  for (const id of [...(configuredIds ?? []), ...candidates.map((candidate) => candidate.id)]) {
    const candidate = byId.get(id)
    if (!candidate || seen.has(id)) continue
    ordered.push(candidate)
    seen.add(id)
    if (ordered.length === limit) break
  }
  return ordered
}
