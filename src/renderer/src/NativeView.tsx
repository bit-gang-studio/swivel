import { useLayoutEffect, useRef, useState } from 'react'
import type { EngineId, Viewport } from '../../shared/types'

/**
 * A placeholder for a natively drawn engine. It works out where the page should sit
 * (fitted and centred like the streamed view) and tells the main process, which lays
 * the native view exactly over it.
 */
export function NativeView({ viewport, engine }: { viewport: Viewport; engine: EngineId }) {
  const area = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const fit = () => {
      const scale = Math.min(1, el.clientWidth / viewport.width, el.clientHeight / viewport.height)
      const width = Math.floor(viewport.width * scale)
      const height = Math.floor(viewport.height * scale)
      setBox({ width, height })
      const r = el.getBoundingClientRect()
      void window.swivel.setRect({
        x: r.left + (el.clientWidth - width) / 2,
        y: r.top + (el.clientHeight - height) / 2,
        width,
        height
      })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    window.addEventListener('resize', fit)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
    }
    // Resend when the engine changes too, so the newly active native view is placed.
  }, [viewport.width, viewport.height, engine])

  return (
    <div ref={area} className="native-area">
      <div className="native-box" style={{ width: box.width, height: box.height }} />
    </div>
  )
}
