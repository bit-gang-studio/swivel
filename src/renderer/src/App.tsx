import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ConsoleEntry, EngineId } from '../../shared/types'
import { ENGINES, SIZES, engineLabel } from './engines'
import { LiveView } from './LiveView'
import { NativeView } from './NativeView'

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
  const [sizeIndex, setSizeIndex] = useState(2)
  const [dark, setDark] = useState(false)
  const [logs, setLogs] = useState<ConsoleEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const viewport = SIZES[sizeIndex].viewport
  // Like a real browser, never overwrite the address bar while the user is typing in it.
  const editing = useRef(false)

  useEffect(() => {
    const offs = [
      window.swivel.on('console', (entry) => setLogs((l) => [...l.slice(-199), entry])),
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

  // Restart the live page whenever the engine, size or colour scheme changes.
  useEffect(() => {
    setError(null)
    void window.swivel.start({ engine, url, viewport, colorScheme: dark ? 'dark' : 'light' })
    // url is left out on purpose: navigation inside the page must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, sizeIndex, dark])

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
    <div className="app">
      <form className="toolbar" onSubmit={onSubmit}>
        <button type="button" aria-label="Back" onClick={() => void window.swivel.history('back')}>←</button>
        <button type="button" aria-label="Forward" onClick={() => void window.swivel.history('forward')}>→</button>
        <button type="button" aria-label="Reload" onClick={() => void window.swivel.history('reload')}>⟳</button>
        <label className="address">
          <span className="sr-only">Address</span>
          <input
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
        <div className="segmented" role="group" aria-label="Browser engine">
          {ENGINES.map((id) => (
            <button key={id} type="button" aria-pressed={engine === id} onClick={() => setEngine(id)}>
              {engineLabel(id, platform)}
            </button>
          ))}
        </div>
        <label>
          <span className="sr-only">Screen size</span>
          <select value={sizeIndex} onChange={(e) => setSizeIndex(Number(e.target.value))}>
            {SIZES.map((s, i) => (
              <option key={s.label} value={i}>
                {s.label} · {s.viewport.width}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
          Dark
        </label>
        <div className={loading ? 'progress on' : 'progress'} role="progressbar" aria-label="Page loading" aria-busy={loading} />
      </form>

      <main className="viewport">
        {error && <p className="status error">{error}</p>}
        {engine === 'chromium' ? (
          <NativeView viewport={viewport} />
        ) : (
          <LiveView viewport={viewport} engine={engine} label={engineLabel(engine, platform)} />
        )}
      </main>

      <section className="console" aria-label="Console">
        <h2>Console</h2>
        {logs.length ? (
          <ul>
            {logs.map((entry, i) => (
              <li key={i} className={entry.type}>
                <span className="tag">{engineLabel(entry.engine, platform)}</span> {entry.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No messages.</p>
        )}
      </section>
    </div>
  )
}
