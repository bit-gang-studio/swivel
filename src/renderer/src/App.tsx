import { useState, type FormEvent } from 'react'
import type { CaptureResult, EngineId } from '../../shared/types'
import { ENGINES, SIZES, engineLabel } from './engines'

const platform = window.swivel?.platform ?? 'darwin'

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^(localhost|127\.0\.0\.1)(:\d+)?/i.test(trimmed)) return `http://${trimmed}`
  return `https://${trimmed}`
}

export function App() {
  const [address, setAddress] = useState('localhost:3000')
  const [engine, setEngine] = useState<EngineId>('chromium')
  const [sizeIndex, setSizeIndex] = useState(2)
  const [dark, setDark] = useState(false)
  const [result, setResult] = useState<CaptureResult | null>(null)
  const [loading, setLoading] = useState(false)

  async function load(nextEngine = engine, nextSize = sizeIndex, nextDark = dark) {
    setLoading(true)
    const res = await window.swivel.capture({
      engine: nextEngine,
      url: normalizeUrl(address),
      viewport: SIZES[nextSize].viewport,
      colorScheme: nextDark ? 'dark' : 'light'
    })
    setResult(res)
    setLoading(false)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void load()
  }

  return (
    <div className="app">
      <form className="toolbar" onSubmit={onSubmit}>
        <button type="button" aria-label="Reload" onClick={() => void load()}>⟳</button>
        <label className="address">
          <span className="sr-only">Address</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} />
        </label>
        <div className="segmented" role="group" aria-label="Browser engine">
          {ENGINES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={engine === id}
              onClick={() => {
                setEngine(id)
                void load(id)
              }}
            >
              {engineLabel(id, platform)}
            </button>
          ))}
        </div>
        <label>
          <span className="sr-only">Screen size</span>
          <select
            value={sizeIndex}
            onChange={(e) => {
              const i = Number(e.target.value)
              setSizeIndex(i)
              void load(engine, i)
            }}
          >
            {SIZES.map((s, i) => (
              <option key={s.label} value={i}>
                {s.label} · {s.viewport.width}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={dark}
            onChange={(e) => {
              setDark(e.target.checked)
              void load(engine, sizeIndex, e.target.checked)
            }}
          />
          Dark
        </label>
      </form>

      <main className="viewport">
        {loading && <p className="status">Loading in {engineLabel(engine, platform)}…</p>}
        {!loading && result?.error && <p className="status error">{result.error}</p>}
        {!loading && result?.image && <img src={result.image} alt={`Page rendered in ${engineLabel(result.engine, platform)}`} />}
        {!loading && !result && <p className="status">Enter a URL and press Enter.</p>}
      </main>

      <section className="console" aria-label="Console">
        <h2>Console</h2>
        {result?.console.length ? (
          <ul>
            {result.console.map((entry, i) => (
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
