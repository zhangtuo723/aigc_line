import { useEffect, useState, type RefObject } from 'react'

const targets = new Map<Element, (visible: boolean) => void>()
let observer: IntersectionObserver | undefined

/** Share one observer across previews; node shells can remain mounted offscreen. */
export function useNearCanvasViewport(ref: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState<boolean | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) targets.get(entry.target)?.(entry.isIntersecting)
    }, { rootMargin: '160px' })
    targets.set(element, setVisible)
    observer.observe(element)
    return () => {
      targets.delete(element)
      observer?.unobserve(element)
      if (!targets.size) { observer?.disconnect(); observer = undefined }
    }
  }, [ref])
  return visible
}
