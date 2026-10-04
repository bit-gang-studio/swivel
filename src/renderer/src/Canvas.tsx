import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasFrame, EngineId, Viewport } from '../../shared/types'
import { BUILT_IN_SETS, DEVICES, SNAP_WIDTHS, loadSets, saveSets, type FrameSet } from './devices'
import { ENGINES, engineHint, engineLabel, engineWithBrowser } from './engines'
import { Icon, ICONS } from './icons'
import { LiveView } from './LiveView'

/** A frame on the canvas: engine, screen size, and position (canvas units = page pixels). */
interface Placed extends CanvasFrame {
  x: number
  y: number
}

interface View {
  zoom: number
  panX: number
  panY: number
}

const GAP = 80
const HEADER = 30
const MIN_ZOOM = 0.1
const MAX_ZOOM = 1
const MIN_SIZE = 240
const MAX_SIZE = 3840
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
const clampSize = (n: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)))

let nextId = 1
const newId = () => `f${nextId++}`

/** Frames side by side in a row, tops aligned. */
function inRow(frames: { engine: EngineId; viewport: Viewport; id?: string }[]): Placed[] {
  let x = 0
  return frames.map((f) => {
    const placed = { id: f.id ?? newId(), engine: f.engine, viewport: f.viewport, x, y: 0 }
    x += f.viewport.width + GAP
    return placed
  })
}

/** Zoom and pan that fit these frames in the area. */
function fit(frames: Placed[], area: { width: number; height: number }): View {
  if (!frames.length) return { zoom: 1, panX: 0, panY: 0 }
  const right = Math.max(...frames.map((f) => f.x + f.viewport.width))
  const bottom = Math.max(...frames.map((f) => f.y + f.viewport.height))
  const left = Math.min(...frames.map((f) => f.x))
  const top = Math.min(...frames.map((f) => f.y))
  const zoom = clampZoom(Math.min((area.width - 64) / (right - left), (area.height - 64 - HEADER) / (bottom - top)))
  return {
    zoom,
    panX: (area.width - (right - left) * zoom) / 2 - left * zoom,
    panY: (area.height - (bottom - top) * zoom + HEADER) / 2 - top * zoom
  }
}

export interface CanvasHandle {
  /** Open the device menu at a point in the window, and add what's picked. */
  addFrame(at: { x: number; y: number }): void
  /** A menu command: 'fit', 'zoom-100' or 'focus'. */
  command(c: string): void
}

/**
 * The canvas: live pages side by side, like a design tool. Each frame has its own engine and
 * screen size; all show the same URL and share the window's data.
 * - Pan: drag the background or scroll. Zoom: pinch or Cmd/Ctrl+scroll.
 * - A frame: drag its header to move it, its edges or corner to resize it (widths snap to common
 *   breakpoints), or type a size. Double-click the header to focus it; the others keep running.
 * - Sets: saved groups of frames (engines and sizes), switched from the bar below.
 */
export const Canvas = forwardRef<CanvasHandle, { url: string; dark: boolean }>(function Canvas({ url, dark }, ref) {
  const area = useRef<HTMLDivElement>(null)
  const [frames, setFrames] = useState<Placed[]>(() => inRow(BUILT_IN_SETS[0].frames))
  /** The set the frames came from, until they're changed. */
  const [setName, setSetName] = useState<string | null>(BUILT_IN_SETS[0].name)
  const [userSets, setUserSets] = useState<FrameSet[]>(loadSets)
  const [view, setView] = useState<View | null>(null)
  const [areaBox, setAreaBox] = useState<DOMRect | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)

  // Measure the canvas area; fit the frames whenever there's no view yet.
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
    void window.swivel.setCanvas(
      frames.map(({ id, engine, viewport }) => ({ id, engine, viewport })),
      { url, colorScheme: dark ? 'dark' : 'light' }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape])

  // Focus mode shows one frame; the others keep running, hidden.
  const focusedFrame = focused ? frames.find((f) => f.id === focused) : undefined
  useEffect(() => {
    for (const f of frames) window.swivel.setFrameVisible(f.id, !focusedFrame || f.id === focusedFrame.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedFrame?.id, shape])
  useEffect(() => window.swivel.selectFrame(focusedFrame?.id ?? selected ?? undefined), [focusedFrame?.id, selected])

  const change = useCallback((id: string, c: Partial<Placed>) => {
    setFrames((all) => all.map((f) => (f.id === id ? { ...f, ...c } : f)))
    if (c.engine || c.viewport) setSetName(null)
  }, [])

  function applySet(set: FrameSet) {
    setFrames(inRow(set.frames))
    setSetName(set.name)
    setSelected(null)
    setFocused(null)
    setView(null)
  }

  function saveSet(name: string) {
    const trimmed = name.trim()
    setNaming(null)
    if (!trimmed || BUILT_IN_SETS.some((s) => s.name === trimmed)) return
    const set = { name: trimmed, frames: frames.map(({ engine, viewport }) => ({ engine, viewport })) }
    const next = [...userSets.filter((s) => s.name !== trimmed), set]
    setUserSets(next)
    saveSets(next)
    setSetName(trimmed)
  }

  function deleteSet(name: string) {
    const next = userSets.filter((s) => s.name !== name)
    setUserSets(next)
    saveSets(next)
    if (setName === name) setSetName(null)
  }

  function tidy() {
    const row = inRow(frames)
    setFrames(row)
    if (areaBox) setView(fit(row, areaBox))
  }

  async function addFrame(at: { x: number; y: number }) {
    const items: { id?: string; label: string; group?: boolean }[] = []
    for (const group of ['Phones', 'Tablets', 'Computers'] as const) {
      if (items.length) items.push({ label: '-' })
      items.push({ label: group, group: true })
      DEVICES.forEach((d, i) => d.group === group && items.push({ id: String(i), label: `${d.name}    ${d.viewport.width} × ${d.viewport.height}  ·  ${engineLabel(d.engine)}` }))
    }
    const picked = await window.swivel.pick(items, at)
    const device = picked === null ? undefined : DEVICES[Number(picked)]
    if (!device) return
    const right = Math.max(0, ...frames.map((f) => f.x + f.viewport.width + GAP))
    const frame = { id: newId(), engine: device.engine, viewport: device.viewport, x: right, y: Math.min(0, ...frames.map((f) => f.y)) }
    const next = [...frames, frame]
    setFrames(next)
    setSetName(null)
    setSelected(frame.id)
    setFocused(null)
    if (areaBox) setView(fit(next, areaBox))
  }

  function zoomTo(zoom: number) {
    if (!areaBox || !view) return
    const z = clampZoom(zoom)
    const px = areaBox.width / 2
    const py = areaBox.height / 2
    setView({ zoom: z, panX: px - ((px - view.panX) / view.zoom) * z, panY: py - ((py - view.panY) / view.zoom) * z })
  }

  function toggleFocus(id?: string) {
    if (focused) return setFocused(null)
    const target = id ?? selected ?? frames[0]?.id
    if (target) {
      setSelected(target)
      setFocused(target)
    }
  }

  function stepFocus(by: number) {
    const i = frames.findIndex((f) => f.id === focused)
    const next = frames[(i + by + frames.length) % frames.length]
    if (next) {
      setSelected(next.id)
      setFocused(next.id)
    }
  }

  useImperativeHandle(ref, () => ({
    addFrame: (at) => void addFrame(at),
    command(c) {
      if (c === 'fit' && areaBox) {
        setFocused(null)
        setView(fit(frames, areaBox))
      } else if (c === 'zoom-100') zoomTo(1)
      else if (c === 'focus') toggleFocus()
    }
  }))

  // Esc leaves focus mode (when the app's own UI has the keyboard; a page keeps its own Esc).
  useEffect(() => {
    if (!focused) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFocused(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused])

  // Pan by dragging the background.
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget || !view || focusedFrame) return
    setSelected(null)
    e.currentTarget.setPointerCapture(e.pointerId)
    panStart.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY }
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const s = panStart.current
    if (s && view) setView({ ...view, panX: s.panX + e.clientX - s.x, panY: s.panY + e.clientY - s.y })
  }

  // Scroll pans; pinch (ctrlKey) or Cmd/Ctrl+scroll zooms around the pointer. Over a page, the
  // page itself scrolls.
  const inFocus = !!focusedFrame
  useEffect(() => {
    const el = area.current
    if (!el || inFocus) return
    const onWheel = (e: WheelEvent) => {
      // Inside a frame's page the scroll belongs to the page, not the canvas.
      if ((e.target as Element).closest?.('.frame-body')) return
      e.preventDefault()
      setView((v) => {
        if (!v) return v
        if (!e.ctrlKey && !e.metaKey) return { ...v, panX: v.panX - e.deltaX, panY: v.panY - e.deltaY }
        const r = el.getBoundingClientRect()
        const zoom = clampZoom(v.zoom * Math.exp(-e.deltaY / 200))
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        return { zoom, panX: px - ((px - v.panX) / v.zoom) * zoom, panY: py - ((py - v.panY) / v.zoom) * zoom }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [inFocus])

  // In focus mode the one frame is fitted to the area (at most 100%).
  const shown = focusedFrame && areaBox ? fit([focusedFrame], areaBox) : view
  const visible = focusedFrame ? [focusedFrame] : frames
  const sets = [...BUILT_IN_SETS, ...userSets]

  return (
    <div className="canvas-wrap">
      <div ref={area} className={focusedFrame ? 'canvas focus' : 'canvas'} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => (panStart.current = null)}>
        {shown &&
          areaBox &&
          visible.map((f) => (
            <Frame
              key={f.id}
              frame={f}
              zoom={shown.zoom}
              left={shown.panX + f.x * shown.zoom}
              top={shown.panY + f.y * shown.zoom}
              clip={areaBox}
              selected={selected === f.id}
              onSelect={() => setSelected(f.id)}
              onChange={(c) => change(f.id, c)}
              onFocus={() => toggleFocus(f.id)}
              onClose={() => {
                setFrames(frames.filter((o) => o.id !== f.id))
                setSetName(null)
                setFocused(null)
              }}
            />
          ))}
        {!frames.length && <p className="start-hint">No frames. Add one with + in the toolbar, or pick a set below.</p>}
      </div>

      <div className="canvas-bar">
        {focusedFrame ? (
          <>
            <button type="button" className="pill" title="Back to the canvas (Esc, or Cmd/Ctrl+Enter)" onClick={() => setFocused(null)}>
              <Icon d={ICONS.grid} size={13} /> Canvas
            </button>
            <span className="muted">
              Frame {frames.indexOf(focusedFrame) + 1} of {frames.length}
            </span>
            <button type="button" className="pill round" aria-label="Previous frame" title="Previous frame" onClick={() => stepFocus(-1)}>
              <Icon d={ICONS.back} size={13} />
            </button>
            <button type="button" className="pill round" aria-label="Next frame" title="Next frame" onClick={() => stepFocus(1)}>
              <Icon d={ICONS.forward} size={13} />
            </button>
          </>
        ) : (
          <div className="sets" role="group" aria-label="Frame sets">
            {sets.map((s) => (
              <span key={s.name} className="set">
                <button type="button" aria-pressed={setName === s.name} title={`${s.name}: ${s.frames.map((f) => `${engineLabel(f.engine)} ${f.viewport.width}`).join(', ')}`} onClick={() => applySet(s)}>
                  {s.name}
                </button>
                {!s.builtIn && (
                  <button type="button" className="remove" aria-label={`Delete set ${s.name}`} title={`Delete the set "${s.name}"`} onClick={() => deleteSet(s.name)}>
                    ×
                  </button>
                )}
              </span>
            ))}
            {naming === null ? (
              <button type="button" className="save" title="Save these frames (engines and sizes) as a set" disabled={!frames.length} onClick={() => setNaming('')}>
                Save set…
              </button>
            ) : (
              <input
                autoFocus
                aria-label="Set name"
                placeholder="Set name"
                value={naming}
                onChange={(e) => setNaming(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveSet(naming)
                  else if (e.key === 'Escape') setNaming(null)
                }}
                onBlur={() => setNaming(null)}
              />
            )}
          </div>
        )}
        <span className="spacer" />
        {shown && !focusedFrame && (
          <div className="zoomer" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomTo(shown.zoom - 0.1)}>
              −
            </button>
            <span className="zoom">{Math.round(shown.zoom * 100)}%</span>
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomTo(shown.zoom + 0.1)}>
              +
            </button>
            <button type="button" title="Fit every frame in the window (Cmd/Ctrl+0)" onClick={() => areaBox && setView(fit(frames, areaBox))}>
              Fit
            </button>
            <button type="button" title="Line the frames up in a row" onClick={tidy}>
              Tidy
            </button>
          </div>
        )}
        {shown && focusedFrame && <span className="zoom">{Math.round(shown.zoom * 100)}%</span>}
      </div>
    </div>
  )
})

interface FrameProps {
  frame: Placed
  zoom: number
  /** Top-left of the page area inside the canvas element (CSS px). */
  left: number
  top: number
  clip: DOMRect
  selected: boolean
  onSelect: () => void
  onChange: (change: Partial<Placed>) => void
  onFocus: () => void
  onClose: () => void
}

type Drag = { x: number; y: number; fx: number; fy: number; vw: number; vh: number; mode: 'move' | 'e' | 's' | 'se' }

function Frame({ frame, zoom, left, top, clip, selected, onSelect, onChange, onFocus, onClose }: FrameProps) {
  const body = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  /** The size being dragged to; applied on release. */
  const [resizing, setResizing] = useState<(Viewport & { snapped: boolean }) | null>(null)
  /** The size being typed. */
  const [typing, setTyping] = useState<{ width: string; height: string } | null>(null)
  const key = `canvas:${frame.id}`
  const width = frame.viewport.width * zoom
  const height = frame.viewport.height * zoom
  const native = window.swivel.nativeEngines.includes(frame.engine)

  useEffect(() => window.swivel.on('snapshot', (s) => s.view === key && setSnapshot(s.image)), [key])

  // Tell the main process where the page sits, and the canvas area it's cut off at.
  useLayoutEffect(() => {
    const r = body.current?.getBoundingClientRect()
    if (!r || r.width < 1 || r.height < 1) return
    void window.swivel.setFrameRect(frame.id, {
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
      clip: { x: clip.left, y: clip.top, width: clip.width, height: clip.height }
    })
  }, [frame.id, left, top, width, height, clip.left, clip.top, clip.width, clip.height])

  // Move by dragging the header; resize from the right edge, bottom edge or corner.
  const drag = useRef<Drag | null>(null)
  const start = (mode: Drag['mode']) => (e: ReactPointerEvent<HTMLElement>) => {
    if (mode === 'move' && (e.target as HTMLElement).closest('select, button, input')) return
    e.stopPropagation()
    onSelect()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, fx: frame.x, fy: frame.y, vw: frame.viewport.width, vh: frame.viewport.height, mode }
  }
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x) / zoom
    const dy = (e.clientY - d.y) / zoom
    if (d.mode === 'move') return onChange({ x: d.fx + dx, y: d.fy + dy })
    let w = d.mode === 's' ? d.vw : clampSize(d.vw + dx)
    const h = d.mode === 'e' ? d.vh : clampSize(d.vh + dy)
    // Snap the width to a common breakpoint when the edge is within a few screen pixels of it.
    const snap = d.mode === 's' ? undefined : SNAP_WIDTHS.find((s) => Math.abs(s - w) * zoom < 8)
    if (snap) w = snap
    setResizing({ width: w, height: h, snapped: !!snap })
  }
  const end = () => {
    if (drag.current && drag.current.mode !== 'move' && resizing) onChange({ viewport: { width: resizing.width, height: resizing.height } })
    drag.current = null
    setResizing(null)
  }

  const commitTyped = () => {
    if (!typing) return
    const w = Number(typing.width)
    const h = Number(typing.height)
    setTyping(null)
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) onChange({ viewport: { width: clampSize(w), height: clampSize(h) } })
  }
  const sizeKeys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitTyped()
    else if (e.key === 'Escape') setTyping(null)
  }

  const size = resizing ?? frame.viewport
  return (
    <div className={selected ? 'frame selected' : 'frame'} data-frame={frame.id} data-engine={frame.engine} style={{ left, top: top - HEADER, width: Math.max(width, 150) }}>
      <header onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onDoubleClick={(e) => !(e.target as HTMLElement).closest('select, button, input') && onFocus()}>
        <select aria-label="Frame engine" title={engineHint(frame.engine, window.swivel.platform, window.swivel.engineVersions[frame.engine])} value={frame.engine} onChange={(e) => onChange({ engine: e.target.value as EngineId })}>
          {ENGINES.map((e) => (
            <option key={e} value={e}>
              {engineWithBrowser(e)}
            </option>
          ))}
        </select>
        {typing ? (
          <span className="size-edit" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && commitTyped()}>
            <input autoFocus aria-label="Width" inputMode="numeric" value={typing.width} onFocus={(e) => e.target.select()} onChange={(e) => setTyping({ ...typing, width: e.target.value.replace(/\D/g, '') })} onKeyDown={sizeKeys} />
            ×
            <input aria-label="Height" inputMode="numeric" value={typing.height} onFocus={(e) => e.target.select()} onChange={(e) => setTyping({ ...typing, height: e.target.value.replace(/\D/g, '') })} onKeyDown={sizeKeys} />
          </span>
        ) : (
          <button type="button" className={resizing?.snapped ? 'size snapped' : 'size'} title="Type a size (width × height)" onClick={() => setTyping({ width: String(frame.viewport.width), height: String(frame.viewport.height) })}>
            {size.width} × {size.height}
          </button>
        )}
        <span className="spacer" />
        <button type="button" aria-label="Rotate" title="Rotate: swap width and height" onClick={() => onChange({ viewport: { width: frame.viewport.height, height: frame.viewport.width } })}>
          <Icon d={ICONS.rotate} size={13} />
        </button>
        <button type="button" aria-label="Focus frame" title="Focus: fill the window with this frame (double-click the header, or Cmd/Ctrl+Enter)" onClick={onFocus}>
          <Icon d={ICONS.focus} size={13} />
        </button>
        <button type="button" aria-label="Close frame" title="Close frame" onClick={onClose}>
          <Icon d={ICONS.close} size={13} />
        </button>
      </header>
      <div ref={body} className="frame-body" style={{ width, height }}>
        {!native && (
          <LiveView viewport={frame.viewport} engine={frame.engine} label={engineLabel(frame.engine)} viewKey={key} send={(e) => window.swivel.frameInput(frame.id, e)} reportRect={false} />
        )}
        {snapshot && <img className="frame-snapshot" src={snapshot} alt="" />}
      </div>
      {resizing && <div className={resizing.snapped ? 'frame-resize-outline snapped' : 'frame-resize-outline'} style={{ top: HEADER, width: resizing.width * zoom, height: resizing.height * zoom }} />}
      {/* Handles sit just outside the page: a native page draws over anything inside it. */}
      <div className="frame-edge e" title="Drag to change the width" onPointerDown={start('e')} onPointerMove={move} onPointerUp={end} style={{ top: HEADER, left: width, height }} />
      <div className="frame-edge s" title="Drag to change the height" onPointerDown={start('s')} onPointerMove={move} onPointerUp={end} style={{ top: HEADER + height, left: 0, width }} />
      <div className="frame-handle" title="Drag to resize" onPointerDown={start('se')} onPointerMove={move} onPointerUp={end} style={{ top: HEADER + height, left: width }} />
    </div>
  )
}
