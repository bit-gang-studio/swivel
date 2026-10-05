import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Icon, ICONS } from './icons'

export type PanelTab = 'console' | 'storage'

const KEY = 'swivel.panel-height'
const MIN = 140

function savedHeight(): number {
  try {
    const n = Number(localStorage.getItem(KEY))
    return Number.isFinite(n) && n >= MIN ? n : 300
  } catch {
    return 300
  }
}

/**
 * The panel under the canvas: Console and Storage as tabs. Drag its top edge to resize it; the
 * height is remembered.
 */
export function BottomPanel({ tab, onTab, onClose, errors, children }: { tab: PanelTab; onTab: (tab: PanelTab) => void; onClose: () => void; errors: number; children: ReactNode }) {
  const [height, setHeight] = useState(savedHeight)
  const drag = useRef<{ y: number; height: number } | null>(null)
  // Leave room for the toolbar and at least a strip of canvas.
  const clamp = (h: number) => Math.round(Math.min(Math.max(h, MIN), window.innerHeight - 160))

  useEffect(() => {
    const onResize = () => setHeight((h) => clamp(h))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, height }
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) setHeight(clamp(drag.current.height + drag.current.y - e.clientY))
  }
  const end = () => {
    if (!drag.current) return
    drag.current = null
    try {
      localStorage.setItem(KEY, String(height))
    } catch {
      // Storage unavailable; the height just isn't remembered.
    }
  }

  return (
    <section className="panel" style={{ height: clamp(height) }} aria-label="Panel">
      <div className="panel-resize" role="separator" aria-orientation="horizontal" aria-label="Resize panel" data-tip="Drag to resize" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
      <header className="panel-tabs">
        <div role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'console'} onClick={() => onTab('console')}>
            Console
            {errors > 0 && tab !== 'console' && <span className="badge">{errors > 99 ? '99+' : errors}</span>}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'storage'} onClick={() => onTab('storage')}>
            Storage
          </button>
        </div>
        <span className="spacer" />
        <button type="button" className="close" aria-label="Close panel" data-tip="Close the panel" onClick={onClose}>
          <Icon d={ICONS.close} size={14} />
        </button>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}
