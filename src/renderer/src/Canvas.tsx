import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasFrame, EngineId, Viewport } from '../../shared/types'
import { ENGINES, SIZES, engineLabel } from './engines'
import { LiveView } from './LiveView'

/** A frame on the canvas: engine, screen size, and position (canvas units = page pixels). */
interface Placed extends CanvasFrame {
  x: number
  y: number
}

const GAP = 80
const HEADER = 30
const MIN_ZOOM = 0.25 // Chromium can't zoom a page out further.
const MAX_ZOOM = 1

let nextId = 1
const newId = () => `f${nextId++}`

function defaultFrames(): Placed[] {
  const sizes: [EngineId, Viewport][] = [
    ['chromium', SIZES[2].viewport],
    ['firefox', SIZES[1].viewport],
    ['webkit', SIZES[0].viewport]
  ]
  let x = 0
  return sizes.map(([engine, viewport]) => {
    const frame = { id: newId(), engine, viewport, x, y: 0 }
    x += viewport.width + GAP
    return frame
  })
}

/** Zoom and pan that fit every frame in the area. */
function fit(frames: Placed[], area: { width: number; height: number }) {
  const right = Math.max(...frames.map((f) => f.x + f.viewport.width))
  const bottom = Math.max(...frames.map((f) => f.y + f.viewport.height))
  const left = Math.min(...frames.map((f) => f.x))
  const top = Math.min(...frames.map((f) => f.y))
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((area.width - 80) / (right - left), (area.height - 80 - HEADER) / (bottom - top))))
  return {
    zoom,
    panX: (area.width - (right - left) * zoom) / 2 - left * zoom,
    panY: (area.height - (bottom - top) * zoom + HEADER) / 2 - top * zoom
  }
}

/**
 * Canvas: several live pages side by side, like a design tool. Each frame has its own engine and
 * screen size; all show the same URL and share the window's data. Drag the background (or scroll)
 * to pan, pinch or Cmd/Ctrl+scroll to zoom, drag a frame's header to move it, and its corner to
 * resize it.
 */
export function Canvas() {
  const area = useRef<HTMLDivElement>(null)
  const [frames, setFrames] = useState<Placed[]>(defaultFrames)
  const [view, setView] = useState<{ zoom: number; panX: number; panY: number } | null>(null)
  const [areaBox, setAreaBox] = useState<DOMRect | null>(null)

  // Measure the canvas area; fit the frames the first time.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const measure = () => setAreaBox(el.getBoundingClientRect())
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  useEffect(() => {
    if (areaBox && !view) setView(fit(frames, areaBox))
  }, [areaBox, view, frames])

  // The main process only needs to hear when frames, engines or sizes change, not positions.
  const shape = frames.map((f) => `${f.id}:${f.engine}:${f.viewport.width}x${f.viewport.height}`).join(',')
  useEffect(() => {
    void window.swivel.setCanvas(frames.map(({ id, engine, viewport }) => ({ id, engine, viewport })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape])

  const update = useCallback((id: string, change: Partial<Placed>) => setFrames((all) => all.map((f) => (f.id === id ? { ...f, ...change } : f))), [])

  // Pan by dragging the background.
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget || !view) return
    e.currentTarget.setPointerCapture(e.pointerId)
    panStart.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY }
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const s = panStart.current
    if (s && view) setView({ ...view, panX: s.panX + e.clientX - s.x, panY: s.panY + e.clientY - s.y })
  }

  // Scroll pans; pinch (ctrlKey) or Cmd/Ctrl+scroll zooms around the pointer. Over a native page
  // the page itself scrolls; this only sees the background.
  useEffect(() => {
    const el = area.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) => {
        if (!v) return v
        if (!e.ctrlKey && !e.metaKey) return { ...v, panX: v.panX - e.deltaX, panY: v.panY - e.deltaY }
        const r = el.getBoundingClientRect()
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY / 200)))
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        return { zoom, panX: px - ((px - v.panX) / v.zoom) * zoom, panY: py - ((py - v.panY) / v.zoom) * zoom }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function addFrame(engine: EngineId) {
    const right = Math.max(0, ...frames.map((f) => f.x + f.viewport.width + GAP))
    setFrames([...frames, { id: newId(), engine, viewport: SIZES[0].viewport, x: right, y: 0 }])
  }

  return (
    <div
      ref={area}
      className="canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (panStart.current = null)}
    >
      {view &&
        areaBox &&
        frames.map((f) => (
          <Frame
            key={f.id}
            frame={f}
            zoom={view.zoom}
            left={view.panX + f.x * view.zoom}
            top={view.panY + f.y * view.zoom}
            clip={areaBox}
            onChange={(change) => update(f.id, change)}
            onClose={() => setFrames(frames.filter((o) => o.id !== f.id))}
          />
        ))}
      <div className="canvas-tools">
        <select aria-label="Add frame" value="" onChange={(e) => e.target.value && addFrame(e.target.value as EngineId)}>
          <option value="">Add frame…</option>
          {ENGINES.map((e) => (
            <option key={e} value={e}>
              {engineLabel(e)}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => areaBox && setView(fit(frames, areaBox))}>
          Fit
        </button>
        {view && <span className="zoom">{Math.round(view.zoom * 100)}%</span>}
      </div>
    </div>
  )
}

interface FrameProps {
  frame: Placed
  zoom: number
  /** Top-left of the page area inside the canvas element (CSS px). */
  left: number
  top: number
  clip: DOMRect
  onChange: (change: Partial<Placed>) => void
  onClose: () => void
}

function Frame({ frame, zoom, left, top, clip, onChange, onClose }: FrameProps) {
  const body = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [resizing, setResizing] = useState<Viewport | null>(null)
  const key = `canvas:${frame.id}`
  const width = frame.viewport.width * zoom
  const height = frame.viewport.height * zoom
  const native = window.swivel.nativeEngines.includes(frame.engine)

  useEffect(() => window.swivel.on('snapshot', (s) => s.view === key && setSnapshot(s.image)), [key])

  // Tell the main process where the page sits, and the canvas area it's cut off at.
  useLayoutEffect(() => {
    const r = body.current?.getBoundingClientRect()
    if (!r) return
    void window.swivel.setFrameRect(frame.id, {
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
      clip: { x: clip.left, y: clip.top, width: clip.width, height: clip.height }
    })
  }, [frame.id, left, top, width, height, clip.left, clip.top, clip.width, clip.height])

  // Move by dragging the header; resize from the corner (applied on release).
  const drag = useRef<{ x: number; y: number; fx: number; fy: number; vw: number; vh: number; mode: 'move' | 'size' } | null>(null)
  const start = (mode: 'move' | 'size') => (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('select, button') && mode === 'move') return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, fx: frame.x, fy: frame.y, vw: frame.viewport.width, vh: frame.viewport.height, mode }
  }
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x) / zoom
    const dy = (e.clientY - d.y) / zoom
    if (d.mode === 'move') onChange({ x: d.fx + dx, y: d.fy + dy })
    else setResizing({ width: Math.max(240, Math.round(d.vw + dx)), height: Math.max(240, Math.round(d.vh + dy)) })
  }
  const end = () => {
    if (drag.current?.mode === 'size' && resizing) onChange({ viewport: resizing })
    drag.current = null
    setResizing(null)
  }

  const size = SIZES.findIndex((s) => s.viewport.width === frame.viewport.width && s.viewport.height === frame.viewport.height)
  return (
    <div className="frame" style={{ left, top: top - HEADER, width }}>
      <header onPointerDown={start('move')} onPointerMove={move} onPointerUp={end}>
        <select aria-label="Frame engine" value={frame.engine} onChange={(e) => onChange({ engine: e.target.value as EngineId })}>
          {ENGINES.map((e) => (
            <option key={e} value={e}>
              {engineLabel(e)}
            </option>
          ))}
        </select>
        <select
          aria-label="Frame size"
          value={size}
          onChange={(e) => {
            const s = SIZES[Number(e.target.value)]
            if (s) onChange({ viewport: s.viewport })
          }}
        >
          {size < 0 && <option value={-1}>{`${frame.viewport.width} × ${frame.viewport.height}`}</option>}
          {SIZES.map((s, i) => (
            <option key={s.label} value={i}>
              {s.label} · {s.viewport.width}
            </option>
          ))}
        </select>
        <button type="button" aria-label="Close frame" title="Close frame" onClick={onClose}>
          ×
        </button>
      </header>
      <div ref={body} className="frame-body" style={{ width, height }}>
        {!native && (
          <LiveView
            viewport={frame.viewport}
            engine={frame.engine}
            label={engineLabel(frame.engine)}
            viewKey={key}
            send={(e) => window.swivel.frameInput(frame.id, e)}
            reportRect={false}
          />
        )}
        {snapshot && <img className="frame-snapshot" src={snapshot} alt="" />}
      </div>
      {resizing && <div className="frame-resize-outline" style={{ top: HEADER, width: resizing.width * zoom, height: resizing.height * zoom }} />}
      {/* Outside the page's corner: a native page draws over anything inside it. */}
      <div className="frame-handle" title="Resize" onPointerDown={start('size')} onPointerMove={move} onPointerUp={end} style={{ top: HEADER + height, left: width }} />
    </div>
  )
}
