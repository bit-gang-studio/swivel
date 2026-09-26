import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { EngineId, Viewport } from '../../shared/types'

const BUTTONS = ['left', 'middle', 'right'] as const

/** Draws streamed frames and sends mouse, wheel and key input back to the engine. */
export function LiveView({ viewport, label, engine }: { viewport: Viewport; label: string; engine: EngineId }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // Which engine painted the frame on screen. Until the chosen engine sends a frame, the old one is faded.
  const [shownEngine, setShownEngine] = useState<EngineId | null>(null)
  const [cursor, setCursor] = useState('default')
  useEffect(() => window.swivel.on('cursor', setCursor), [])

  // Display size in exact CSS pixels. At scale 1 each frame pixel lands on a screen pixel;
  // letting CSS shrink the canvas to fit resampled it very slightly and softened text.
  const area = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const fit = () => {
      const scale = Math.min(1, el.clientWidth / viewport.width, el.clientHeight / viewport.height)
      setBox({ width: Math.floor(viewport.width * scale), height: Math.floor(viewport.height * scale) })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [viewport.width, viewport.height])
  const pendingMove = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let drawing = false
    let next: Blob | null = null
    const draw = async () => {
      if (!next || drawing) return
      drawing = true
      const blob = next
      next = null
      try {
        const bitmap = await createImageBitmap(blob)
        const ctx = canvas.current?.getContext('2d')
        if (ctx && canvas.current) {
          canvas.current.width = bitmap.width
          canvas.current.height = bitmap.height
          ctx.drawImage(bitmap, 0, 0)
        }
        bitmap.close()
      } finally {
        drawing = false
        void draw()
      }
    }
    return window.swivel.on('frame', (frame) => {
      setShownEngine(frame.engine)
      next = new Blob([frame.data as Uint8Array<ArrayBuffer>], { type: `image/${frame.format}` })
      void draw()
    })
  }, [])

  // Map a mouse position on the scaled canvas to page CSS pixels.
  function point(e: MouseEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const scale = Math.min(rect.width / viewport.width, rect.height / viewport.height)
    const left = rect.left + (rect.width - viewport.width * scale) / 2
    const top = rect.top + (rect.height - viewport.height * scale) / 2
    return {
      x: Math.round((e.clientX - left) / scale),
      y: Math.round((e.clientY - top) / scale)
    }
  }

  function onMove(e: MouseEvent<HTMLCanvasElement>) {
    const first = !pendingMove.current
    pendingMove.current = point(e)
    if (first) {
      requestAnimationFrame(() => {
        if (pendingMove.current) window.swivel.input({ kind: 'move', ...pendingMove.current })
        pendingMove.current = null
      })
    }
  }

  function onKey(e: KeyboardEvent<HTMLCanvasElement>, kind: 'keydown' | 'keyup') {
    if (e.metaKey) return // Leave app shortcuts alone.
    e.preventDefault()
    window.swivel.input({ kind, key: e.key === ' ' ? 'Space' : e.key })
  }

  return (
    <div ref={area} className="live-area">
    <canvas
      ref={canvas}
      className={shownEngine === engine ? 'live' : 'live stale'}
      style={{ cursor, width: box.width, height: box.height }}
      tabIndex={0}
      aria-label={`Live page in ${label}`}
      width={viewport.width}
      height={viewport.height}
      onMouseMove={onMove}
      onMouseDown={(e) => {
        e.currentTarget.focus()
        window.swivel.input({ kind: 'down', ...point(e), button: BUTTONS[e.button] ?? 'left' })
      }}
      onMouseUp={(e) => window.swivel.input({ kind: 'up', ...point(e), button: BUTTONS[e.button] ?? 'left' })}
      onWheel={(e) => window.swivel.input({ kind: 'wheel', ...point(e), dx: e.deltaX, dy: e.deltaY })}
      onKeyDown={(e) => onKey(e, 'keydown')}
      onKeyUp={(e) => onKey(e, 'keyup')}
      onContextMenu={(e) => e.preventDefault()}
    />
    </div>
  )
}
