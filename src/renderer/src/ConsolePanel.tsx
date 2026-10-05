import { useEffect, useRef, useState } from 'react'
import type { ConsoleEntry, EngineId } from '../../shared/types'
import { ENGINES, engineLabel } from './engines'

export interface LogEntry extends ConsoleEntry {
  /** When it arrived (ms since epoch). */
  at: number
}

type Level = 'all' | 'error' | 'warning' | 'log'
const LEVELS: [Level, string][] = [
  ['all', 'All'],
  ['error', 'Errors'],
  ['warning', 'Warnings'],
  ['log', 'Logs']
]
const levelOf = (type: string): Exclude<Level, 'all'> => (type === 'error' ? 'error' : type === 'warning' || type === 'warn' ? 'warning' : 'log')
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour12: false })

/**
 * Messages and errors from every frame, tagged by engine. Filter by level, by engine, or by
 * text; hover a line for when it arrived.
 */
export function ConsolePanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const [level, setLevel] = useState<Level>('all')
  const [hidden, setHidden] = useState<EngineId[]>([])
  const [text, setText] = useState('')
  const list = useRef<HTMLDivElement>(null)
  /** Follow new lines while scrolled to the end, like a terminal. */
  const pinned = useRef(true)

  const needle = text.trim().toLowerCase()
  const shown = logs.filter((l) => (level === 'all' || levelOf(l.type) === level) && !hidden.includes(l.engine) && (!needle || l.text.toLowerCase().includes(needle)))
  const count = (lv: Exclude<Level, 'all'>) => logs.filter((l) => levelOf(l.type) === lv).length

  useEffect(() => {
    const el = list.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [shown.length])

  return (
    <div className="console-panel">
      <div className="panel-tools">
        <div className="chips" role="group" aria-label="Level">
          {LEVELS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={level === value} onClick={() => setLevel(value)}>
              {label}
              {value !== 'all' && <span className="count">{count(value)}</span>}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Engines">
          {ENGINES.map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={!hidden.includes(e)}
              data-tip={hidden.includes(e) ? `Show messages from ${engineLabel(e)}` : `Hide messages from ${engineLabel(e)}`}
              onClick={() => setHidden(hidden.includes(e) ? hidden.filter((h) => h !== e) : [...hidden, e])}
            >
              <span className={`dot ${e}`} aria-hidden="true" />
              {engineLabel(e)}
            </button>
          ))}
        </div>
        <input type="search" aria-label="Filter messages" placeholder="Filter" value={text} onChange={(e) => setText(e.target.value)} />
        <span className="spacer" />
        <span className="muted">{shown.length === logs.length ? `${logs.length} messages` : `${shown.length} of ${logs.length}`}</span>
        <button type="button" className="plain" data-tip="Clear the console" disabled={!logs.length} onClick={onClear}>
          Clear
        </button>
      </div>
      <div
        ref={list}
        className="console"
        role="log"
        aria-label="Console"
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {shown.length ? (
          <ul>
            {shown.map((entry, i) => (
              <li key={i} className={levelOf(entry.type)} data-tip={time(entry.at)}>
                <span className={`tag ${entry.engine}`}>{engineLabel(entry.engine)}</span> {entry.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">{logs.length ? 'No messages match.' : 'No messages.'}</p>
        )}
      </div>
    </div>
  )
}
