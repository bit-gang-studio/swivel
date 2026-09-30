import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ConsoleEntry, EngineId, Viewport } from '../../shared/types'
import { ENGINES, SIZES, engineHint, engineLabel } from './engines'
import { LiveView } from './LiveView'
import { Canvas } from './Canvas'
import { NativeView } from './NativeView'
import { FindBar } from './FindBar'

/** 16px stroke icons, drawn in the current text colour. */
function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
const ICONS = {
  back: 'M19 12H5M12 19l-7-7 7-7',
  forward: 'M5 12h14M12 5l7 7-7 7',
  reload: 'M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  console: 'M4 17l6-5-6-5M12 19h8',
  canvas: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3'
}

const platform = window.swivel.platform

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (/^[a-z]+:/i.test(trimmed)) return trimmed
  if (/^(localhost|127\.0\.0\.1)(:\d+)?/i.test(trimmed)) return `http://${trimmed}`
  return `https://${trimmed}`
}

export function App() {
  const [address, setAddress] = useState('https://example.com')
  const [url, setUrl] = useState('https://example.com')
  const [engine, setEngine] = useState<EngineId>('chromium')
  // 'fill' uses the whole page area at 1:1, like a normal browser. Otherwise an index into SIZES.
  const [size, setSize] = useState<'fill' | number>('fill')
  const [area, setArea] = useState<Viewport | null>(null)
  const areaRef = useRef<HTMLElement>(null)
  const [consoleOpen, setConsoleOpen] = useState(() => {
    try {
      return localStorage.getItem('swivel.console') === 'open'
    } catch {
      return false
    }
  })
  const [unseenErrors, setUnseenErrors] = useState(0)
  const [findOpen, setFindOpen] = useState(false)
  const [findFocus, setFindFocus] = useState(0)
  const addressInput = useRef<HTMLInputElement>(null)
  const [dark, setDark] = useState(false)
  /** Single page, or the canvas: several frames side by side. */
  const [canvas, setCanvas] = useState(false)
  const [logs, setLogs] = useState<ConsoleEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const viewport = size === 'fill' ? area : SIZES[size].viewport
  const engineRef = useRef(engine)
  engineRef.current = engine
  const consoleOpenRef = useRef(consoleOpen)
  consoleOpenRef.current = consoleOpen
  // Like a real browser, never overwrite the address bar while the user is typing in it.
  const editing = useRef(false)

  useEffect(() => {
    const offs = [
      window.swivel.on('console', (entry) => {
        setLogs((l) => [...l.slice(-199), entry])
        if (entry.type === 'error' && !consoleOpenRef.current) setUnseenErrors((n) => n + 1)
      }),
      window.swivel.on('url', (u) => {
        setUrl(u)
        if (!editing.current) setAddress(u)
        setError(null)
      }),
      window.swivel.on('error', setError),
      window.swivel.on('loading', setLoading)
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Measure the page area, for "Fill window". Native engines follow a window resize live, like a
  // real browser; streamed engines (each resize costs a browser round trip) wait for it to settle.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const measure = () => setArea({ width: Math.max(200, Math.floor(el.clientWidth)), height: Math.max(200, Math.floor(el.clientHeight)) })
    measure()
    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      if (window.swivel.nativeEngines.includes(engineRef.current)) measure()
      else timer = setTimeout(measure, 120)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [])

  // Restart the live page whenever the engine, size or colour scheme changes.
  const ready = viewport !== null
  useEffect(() => {
    if (!viewport || canvas) return
    setError(null)
    void window.swivel.start({ engine, url, viewport, colorScheme: dark ? 'dark' : 'light', pixelRatio: window.devicePixelRatio })
    // url is left out on purpose: navigation inside the page must not restart it. Window
    // resizes in "Fill window" resize the page instead (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, size, dark, ready, canvas])

  // The canvas has no start(): dark mode goes to its frames directly.
  useEffect(() => {
    if (canvas) void window.swivel.setColorScheme(dark ? 'dark' : 'light')
  }, [dark, canvas])

  // In "Fill window", follow the window size without reloading the page.
  useEffect(() => {
    if (size === 'fill' && area) void window.swivel.resize(area)
  }, [size, area?.width, area?.height])

  // Menu shortcuts (they work even when a native page view has focus).
  useEffect(() =>
    window.swivel.on('command', (c) => {
      if (c === 'find') {
        setFindOpen(true)
        setFindFocus((n) => n + 1)
      } else if (c === 'focus-address') {
        addressInput.current?.focus()
        addressInput.current?.select()
      } else if (c === 'reload' || c === 'back' || c === 'forward') {
        void window.swivel.history(c)
      } else if (c === 'console') {
        toggleConsoleRef.current()
      }
    })
  , [])

  const toggleConsoleRef = useRef(() => {})
  toggleConsoleRef.current = toggleConsole

  function toggleConsole() {
    const open = !consoleOpen
    setConsoleOpen(open)
    if (open) setUnseenErrors(0)
    try {
      localStorage.setItem('swivel.console', open ? 'open' : 'closed')
    } catch {
      // Storage unavailable; the choice just isn't remembered.
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    editing.current = false
    ;(document.activeElement as HTMLElement | null)?.blur()
    const next = normalizeUrl(address)
    setUrl(next)
    setError(null)
    void window.swivel.navigate(next)
  }

  return (
    <div className={['app', consoleOpen && 'console-open', findOpen && 'find-open'].filter(Boolean).join(' ')}>
      <form className="toolbar" onSubmit={onSubmit}>
        <button type="button" className="icon" aria-label="Back" title="Back" onClick={() => void window.swivel.history('back')}>
          <Icon d={ICONS.back} />
        </button>
        <button type="button" className="icon" aria-label="Forward" title="Forward" onClick={() => void window.swivel.history('forward')}>
          <Icon d={ICONS.forward} />
        </button>
        <button type="button" className="icon" aria-label="Reload" title="Reload" onClick={() => void window.swivel.history('reload')}>
          <Icon d={ICONS.reload} />
        </button>
        <label className="address">
          <span className="sr-only">Address</span>
          <input
            ref={addressInput}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => {
              editing.current = true
              e.target.select()
            }}
            onBlur={() => (editing.current = false)}
            spellCheck={false}
          />
        </label>
        {!canvas && (
          <>
            <div className="segmented" role="group" aria-label="Browser engine">
              {ENGINES.map((id) => (
                <button key={id} type="button" aria-pressed={engine === id} title={engineHint(id, platform)} onClick={() => setEngine(id)}>
                  {engineLabel(id)}
                </button>
              ))}
            </div>
            <label>
              <span className="sr-only">Screen size</span>
              <select className="size" value={String(size)} onChange={(e) => setSize(e.target.value === 'fill' ? 'fill' : Number(e.target.value))}>
                <option value="fill">Fill window</option>
                {SIZES.map((s, i) => (
                  <option key={s.label} value={i}>
                    {s.label} · {s.viewport.width}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <button type="button" className="icon" aria-label="Canvas" title="Canvas: several engines and sizes side by side" aria-pressed={canvas} onClick={() => setCanvas(!canvas)}>
          <Icon d={ICONS.canvas} />
        </button>
        <button
          type="button"
          className="icon"
          aria-label="Clear data"
          title="Clear this window's data: cookies, storage and cache, in every engine"
          onClick={() => {
            setError(null)
            void window.swivel.clearData()
          }}
        >
          <Icon d={ICONS.trash} />
        </button>
        <button type="button" className="icon" aria-label="Dark mode" title="Dark mode" aria-pressed={dark} onClick={() => setDark(!dark)}>
          <Icon d={ICONS.moon} />
        </button>
        <button type="button" className="icon console-toggle" aria-label="Console" title="Console" aria-pressed={consoleOpen} onClick={toggleConsole}>
          <Icon d={ICONS.console} />
          {unseenErrors > 0 && <span className="badge" aria-label={`${unseenErrors} new errors`}>{unseenErrors > 99 ? '99+' : unseenErrors}</span>}
        </button>
        <div className={loading ? 'progress on' : 'progress'} role="progressbar" aria-label="Page loading" aria-busy={loading} />
      </form>

      {findOpen && <FindBar focusToken={findFocus} engine={engine} onClose={() => setFindOpen(false)} />}

      {/* Always mounted: "Fill window" measures it. */}
      <main ref={areaRef} className={canvas ? 'viewport with-canvas' : size === 'fill' ? 'viewport fill' : 'viewport'}>
        {error && <p className="status error">{error}</p>}
        {canvas ? (
          <Canvas />
        ) : (
          viewport &&
          (window.swivel.nativeEngines.includes(engine) ? (
            <NativeView viewport={viewport} engine={engine} />
          ) : (
            <LiveView viewport={viewport} engine={engine} label={engineLabel(engine)} viewKey={engine} send={window.swivel.input} />
          ))
        )}
      </main>

      {consoleOpen && (
        <section className="console" aria-label="Console">
          <h2>Console</h2>
          {logs.length ? (
            <ul>
              {logs.map((entry, i) => (
                <li key={i} className={entry.type}>
                  <span className="tag">{engineLabel(entry.engine)}</span> {entry.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No messages.</p>
          )}
        </section>
      )}
    </div>
  )
}
