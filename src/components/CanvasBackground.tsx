import { memo, useLayoutEffect, useRef } from 'react'
import { useStoreApi } from '@xyflow/react'

/** Keep the world-aligned dots without changing an SVG pattern's layout on every pointer event. */
export const CanvasBackground = memo(function CanvasBackground() {
  const store = useStoreApi()
  const element = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    let frame = 0
    let previous: readonly number[] = []
    const paint = () => {
      frame = 0
      const transform = store.getState().transform
      const [x, y, zoom] = transform
      const style = element.current!.style
      const gap = 18 * zoom
      if (previous[2] !== zoom) {
        style.backgroundSize = `${gap}px ${gap}px`
        const radius = zoom / 2
        style.backgroundImage = `radial-gradient(circle, rgba(255,255,255,0.16) ${radius}px, transparent ${radius}px)`
      }
      style.backgroundPosition = `${x % gap - gap / 2}px ${y % gap - gap / 2}px`
      previous = transform
    }
    paint()
    const unsubscribe = store.subscribe((state) => {
      if (frame || state.transform === previous) return
      if (state.transform.every((value, index) => value === previous[index])) return
      frame = requestAnimationFrame(paint)
    })
    return () => { unsubscribe(); cancelAnimationFrame(frame) }
  }, [store])

  return <div ref={element} aria-hidden="true" data-testid="rf__background" className="react-flow__background react-flow__container" />
})
