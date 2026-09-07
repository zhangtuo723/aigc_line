type Flusher = { flush: () => Promise<void>; priority: number }
const flushers = new Set<Flusher>()
let barrierDepth = 0
let previouslyInert = false
/** Blocks new UI edits while a navigation/close transaction drains all drafts. */
export function beginEditBarrier(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (barrierDepth++ === 0) { previouslyInert = document.body.inert; document.body.inert = true }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--barrierDepth === 0) document.body.inert = previouslyInert
  }
}

/** Editors commit their drafts before the enclosing canvas writes its snapshot. */
export function registerEditFlusher(flush: () => Promise<void>, priority = 100): () => void {
  const entry = { flush, priority }
  flushers.add(entry)
  return () => { flushers.delete(entry) }
}

export async function flushPendingEdits(): Promise<void> {
  for (const entry of [...flushers].sort((a, b) => a.priority - b.priority)) await entry.flush()
}
