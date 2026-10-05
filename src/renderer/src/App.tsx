import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Canvas, type CanvasHandle } from './Canvas'
import { FindBar } from './FindBar'
import { AuthBar } from './AuthBar'
import { DownloadBar } from './DownloadBar'
import { StoragePanel } from './StoragePanel'
import { BottomPanel } from './BottomPanel'
import { ConsolePanel, type ConsoleItem } from './ConsolePanel'
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
  /** The storage panel, in the console's place (one or the other shows). */
  const [storageOpen, setStorageOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findFocus, setFindFocus] = useState(0)
  const addressInput = useRef<HTMLInputElement>(null)
  const [dark, setDark] = useState(false)
  /** Scroll, click or type in one frame and the others repeat it. */
  const [sync, setSync] = useState(true)
  /** One frame alone, filling the window like a normal browser, rather than the canvas. */
  const [single, setSingle] = useState(false)
  /** The control whose hover label is up (or about to be). */
  const tipped = useRef<Element | null>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideTip = () => {
    clearTimeout(tipTimer.current)
    if (tipped.current) window.swivel.tip(null)
    tipped.current = null
  }
  const canvas = useRef<CanvasHandle>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const [logs, setLogs] = useState<ConsoleItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const consoleOpenRef = useRef(consoleOpen)
  consoleOpenRef.current = consoleOpen
  // Like a real browser, never overwrite the address bar while the user is typing in it.
  const editing = useRef(false)

  useEffect(() => {
    const offs = [
      window.swivel.on('console', (entry) => {
        setLogs((l) => [...l.slice(-499), { kind: 'message', at: Date.now(), ...entry }])
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
    if (open) setStorageOpen(false)
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
    <div
      className="app"
      // Hover labels: shown under the control after a short pause, in a small window of their own
      // (a native page would cover a label drawn here).
      onMouseOver={(e) => {
        const el = (e.target as Element).closest('[data-tip]')
        if (el === tipped.current) return
        hideTip()
        const text = el?.getAttribute('data-tip')
        if (!el || !text) return
        tipped.current = el
        tipTimer.current = setTimeout(() => {
          const r = el.getBoundingClientRect()
          if (tipped.current === el && r.width) window.swivel.tip({ text, x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
        }, 350)
      }}
      onMouseOut={(e) => !e.relatedTarget && hideTip()} // Onto a native page, or out of the window.
      onMouseLeave={hideTip}
      onMouseDown={hideTip}
    >
      <form className="toolbar" onSubmit={onSubmit}>
        <button type="button" className="icon" aria-label="Back" data-tip={`Back (${keys(mac ? 'Mod+[' : 'Alt+Left')})`} onClick={() => void window.swivel.history('back')}>
          <Icon d={ICONS.back} />
        </button>
        <button type="button" className="icon" aria-label="Forward" data-tip={`Forward (${keys(mac ? 'Mod+]' : 'Alt+Right')})`} onClick={() => void window.swivel.history('forward')}>
          <Icon d={ICONS.forward} />
        </button>
        <button type="button" className="icon" aria-label="Reload" data-tip={`Reload every frame (${keys('Mod+R')})`} onClick={() => void window.swivel.history('reload')}>
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
        <button
          type="button"
          className="icon"
          aria-label="Canvas"
          data-tip={`Canvas: every frame side by side. Off: one page fills the window, like a normal browser (${keys('Mod+Enter')})`}
          aria-pressed={!single}
          disabled={!url}
          onClick={() => canvas.current?.command('focus')}
        >
          <Icon d={ICONS.grid} />
        </button>
        <button ref={addButton} type="button" className="icon" aria-label="Add frame" data-tip={`Add a frame: pick a device (${keys('Mod+T')})`} disabled={!url} onClick={addFrame}>
          <Icon d={ICONS.plus} />
        </button>
        <button
          type="button"
          className="icon"
          aria-label="Sync frames"
          data-tip="Sync: scroll, click or type in one frame and the others repeat it"
          aria-pressed={sync}
          onClick={() => {
            setSync(!sync)
            window.swivel.setSync(!sync)
          }}
        >
          <Icon d={ICONS.sync} />
        </button>
        <button type="button" className="icon" aria-label="Dark mode" data-tip={`Dark mode: show pages in their dark colour scheme (${keys('Shift+Mod+D')})`} aria-pressed={dark} onClick={() => setDark(!dark)}>
          <Icon d={ICONS.moon} />
        </button>
        <button type="button" className="icon console-toggle" aria-label="Console" data-tip={`Console: messages and errors from every frame (${keys(mac ? 'Alt+Mod+J' : 'Ctrl+Shift+J')})`} aria-pressed={consoleOpen} onClick={toggleConsole}>
          <Icon d={ICONS.console} />
          {unseenErrors > 0 && <span className="badge" aria-label={`${unseenErrors} new errors`}>{unseenErrors > 99 ? '99+' : unseenErrors}</span>}
        </button>
        <button
          type="button"
          className="icon"
          aria-label="Storage"
          data-tip="Storage: this window's cookies, local storage and session storage, side by side per engine"
          aria-pressed={storageOpen}
          onClick={() => {
            setStorageOpen(!storageOpen)
            if (!storageOpen && consoleOpen) toggleConsole()
          }}
        >
          <Icon d={ICONS.storage} />
        </button>
        <span className="divider" />
        <button
          type="button"
          className="icon danger"
          aria-label="Clear data"
          data-tip="Clear data: wipe this window's cookies, storage and cache in every engine, and reload"
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
      <DownloadBar />
      {findOpen && <FindBar focusToken={findFocus} engine="canvas" onClose={() => setFindOpen(false)} />}

      <main className={url ? 'viewport with-canvas' : 'viewport'}>
        {error && <p className="status error">{error}</p>}
        {url ? (
          <Canvas ref={canvas} url={url} dark={dark} onSingle={setSingle} />
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

      {(consoleOpen || storageOpen) && (
        <BottomPanel
          tab={storageOpen ? 'storage' : 'console'}
          errors={unseenErrors}
          onTab={(tab) => {
            if ((tab === 'console') !== consoleOpen) toggleConsole()
            setStorageOpen(tab === 'storage')
          }}
          onClose={() => {
            if (consoleOpen) toggleConsole()
            setStorageOpen(false)
          }}
        >
          {storageOpen ? (
            <StoragePanel />
          ) : (
            <ConsolePanel
              items={logs}
              onClear={() => setLogs([])}
              onRun={(code, only) => {
                // The line, then each engine's answer when the frames have run it.
                setLogs((l) => [...l.slice(-499), { kind: 'input', at: Date.now(), code }])
                void window.swivel.evaluate(code, only).then((reply) => {
                  if (!reply) return
                  setLogs((l) => [...l.slice(-499), 'syntaxError' in reply ? { kind: 'syntax', at: Date.now(), text: reply.syntaxError } : { kind: 'result', at: Date.now(), results: reply.results }])
                })
              }}
            />
          )}
        </BottomPanel>
      )}
    </div>
  )
}
