import { useSyncExternalStore } from 'react'

type CanvasGesture = 'viewport' | 'nodes'
const gestures = new Set<CanvasGesture>()
const listeners = new Set<() => void>()
let interacting = false
let settleTimer: ReturnType<typeof setTimeout> | undefined

function publish(value: boolean) {
  if (interacting === value) return
  interacting = value
  listeners.forEach((listener) => listener())
}

export function beginCanvasInteraction(gesture: CanvasGesture) {
  clearTimeout(settleTimer)
  gestures.add(gesture)
  publish(true)
}

export function endCanvasInteraction(gesture: CanvasGesture) {
  gestures.delete(gesture)
  if (gestures.size) return
  clearTimeout(settleTimer)
  // Let the final transform/paint settle before decoding newly visible media.
  settleTimer = setTimeout(() => publish(false), 180)
}

export function resetCanvasInteraction() {
  clearTimeout(settleTimer)
  gestures.clear()
  publish(false)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useCanvasInteracting() {
  return useSyncExternalStore(subscribe, () => interacting)
}

/** A cancelled/offscreen preview must never resume when a later gesture ends. */
export function waitForCanvasIdle(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Preview cancelled', 'AbortError'))
  if (!interacting) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      listeners.delete(check)
      signal.removeEventListener('abort', abort)
    }
    const check = () => {
      if (interacting) return
      cleanup()
      resolve()
    }
    const abort = () => {
      cleanup()
      reject(new DOMException('Preview cancelled', 'AbortError'))
    }
    listeners.add(check)
    signal.addEventListener('abort', abort, { once: true })
  })
}
