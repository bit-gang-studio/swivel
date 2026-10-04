import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ConsoleEntry } from '../../shared/types'
import { engineLabel } from './engines'
import { Canvas, type CanvasHandle } from './Canvas'
import { FindBar } from './FindBar'
import { AuthBar } from './AuthBar'
import { Icon, ICONS } from './icons'

const mac = window.swivel.platform === 'darwin'
/** A shortcut as shown in a hover label. */
const keys = (k: string) => (mac ? k.replace('Mod+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥') : k.replace('Mod+', 'Ctrl+'))
const START_URLS = ['localhost:3000', 'localhost:5173', 'localhost:8080']

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (/^[a-z]+:/i.test(trimmed)) return trimmed
  if (/^(localhost|127\.0\.0\.1)(:\d+)?/i.test(trimmed)) return `http://${trimmed}`
  return `https://${trimmed}`
}

export function App() {
  // A new window starts empty: nothing loads until a URL is entered.
  const [address, setAddress] = useState('')
  const [url, setUrl] = useState('')
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
  const canvas = useRef<CanvasHandle>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const [logs, setLogs] = useState<ConsoleEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
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

  // Dark mode goes to every frame.
  useEffect(() => {
    if (url) void window.swivel.setColorScheme(dark ? 'dark' : 'light')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark])

  function addFrame() {
    const r = addButton.current?.getBoundingClientRect()
    if (r) canvas.current?.addFrame({ x: r.left, y: r.bottom + 4 })
  }
  const addFrameRef = useRef(addFrame)
  addFrameRef.current = addFrame

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
      } else if (c === 'dark') {
        setDark((d) => !d)
      } else if (c === 'add-frame') {
        addFrameRef.current()
      } else {
        canvas.current?.command(c)
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

  function go(to: string) {
    const next = normalizeUrl(to)
    setAddress(next)
    setUrl(next)
    setError(null)
    void window.swivel.navigate(next)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    editing.current = false
    ;(document.activeElement as HTMLElement | null)?.blur()
    if (address.trim()) go(address)
  }

  return (
    <div className="app">
      <form className="toolbar" onSubmit={onSubmit}>
        <button type="button" className="icon" aria-label="Back" title={`Back (${keys(mac ? 'Mod+[' : 'Alt+Left')})`} onClick={() => void window.swivel.history('back')}>
          <Icon d={ICONS.back} />
        </button>
        <button type="button" className="icon" aria-label="Forward" title={`Forward (${keys(mac ? 'Mod+]' : 'Alt+Right')})`} onClick={() => void window.swivel.history('forward')}>
          <Icon d={ICONS.forward} />
        </button>
        <button type="button" className="icon" aria-label="Reload" title={`Reload every frame (${keys('Mod+R')})`} onClick={() => void window.swivel.history('reload')}>
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
            autoFocus
            placeholder="Enter a URL"
          />
        </label>
        <button ref={addButton} type="button" className="icon" aria-label="Add frame" title={`Add a frame: pick a device (${keys('Mod+T')})`} disabled={!url} onClick={addFrame}>
          <Icon d={ICONS.plus} />
        </button>
        <button type="button" className="icon" aria-label="Dark mode" title={`Dark mode: show pages in their dark colour scheme (${keys('Shift+Mod+D')})`} aria-pressed={dark} onClick={() => setDark(!dark)}>
          <Icon d={ICONS.moon} />
        </button>
        <button type="button" className="icon console-toggle" aria-label="Console" title={`Console: messages and errors from every frame (${keys(mac ? 'Alt+Mod+J' : 'Ctrl+Shift+J')})`} aria-pressed={consoleOpen} onClick={toggleConsole}>
          <Icon d={ICONS.console} />
          {unseenErrors > 0 && <span className="badge" aria-label={`${unseenErrors} new errors`}>{unseenErrors > 99 ? '99+' : unseenErrors}</span>}
        </button>
        <span className="divider" />
        <button
          type="button"
          className="icon danger"
          aria-label="Clear data"
          title="Clear data: wipe this window's cookies, storage and cache in every engine, and reload"
          disabled={!url}
          onClick={() => {
            setError(null)
            void window.swivel.clearData()
          }}
        >
          <Icon d={ICONS.trash} />
        </button>
        <div className={loading ? 'progress on' : 'progress'} role="progressbar" aria-label="Page loading" aria-busy={loading} />
      </form>

      <AuthBar />
      {findOpen && <FindBar focusToken={findFocus} engine="canvas" onClose={() => setFindOpen(false)} />}

      <main className={url ? 'viewport with-canvas' : 'viewport'}>
        {error && <p className="status error">{error}</p>}
        {url ? (
          <Canvas ref={canvas} url={url} dark={dark} />
        ) : (
          <div className="start">
            <p className="start-hint">Enter a URL to start</p>
            <div className="start-urls">
              {START_URLS.map((u) => (
                <button key={u} type="button" onClick={() => go(u)}>
                  {u}
                </button>
              ))}
            </div>
            <p className="start-note">Opens in the Responsive set: Chromium at desktop, laptop, tablet and phone sizes.</p>
          </div>
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
