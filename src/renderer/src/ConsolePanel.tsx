import { useEffect, useRef, useState } from 'react'
import type { ConsoleEntry, EngineId } from '../../shared/types'
import type { EvalResult } from '../../shared/evaluate'
import type { Json } from '../../shared/json'
import { ENGINES, engineLabel } from './engines'
import { JsonTree } from './JsonTree'

/** A line in the console: a page's message, a line typed at the prompt, or the engines' answers to one. */
export type ConsoleItem =
  | ({ kind: 'message'; at: number } & ConsoleEntry)
  | { kind: 'input'; at: number; code: string }
  | { kind: 'result'; at: number; results: EvalResult[] }
  | { kind: 'syntax'; at: number; text: string }

type Level = 'all' | 'error' | 'warning' | 'log'
const LEVELS: [Level, string][] = [
  ['all', 'All'],
  ['error', 'Errors'],
  ['warning', 'Warnings'],
  ['log', 'Logs']
]
const levelOf = (type: string): Exclude<Level, 'all'> => (type === 'error' ? 'error' : type === 'warning' || type === 'warn' ? 'warning' : 'log')
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour12: false })
const HISTORY = 'swivel.console-history'

function savedHistory(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY) ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((l): l is string => typeof l === 'string') : []
  } catch {
    return []
  }
}

/** Whether the engines gave different answers (or some threw and some didn't). */
const disagree = (results: EvalResult[]) => new Set(results.map((r) => `${r.ok}\n${r.text}`)).size > 1

/** An object or array an engine answered with, to show as a tree. */
function structure(result: EvalResult): Json | undefined {
  if (!result.ok || (result.type !== 'object' && result.type !== 'array')) return undefined
  try {
    return JSON.parse(result.text) as Json
  } catch {
    return undefined // Too long to send whole.
  }
}

/**
 * Messages and errors from every frame, tagged by engine, and a prompt: a line of JavaScript
 * typed there runs in every frame, and each engine's answer is shown, marked when they differ.
 * Filter by level, by engine, or by text; hover a line for when it arrived.
 */
export function ConsolePanel({ items, onClear, onRun }: { items: ConsoleItem[]; onClear: () => void; onRun: (code: string, only?: EngineId) => void }) {
  const [level, setLevel] = useState<Level>('all')
  const [hidden, setHidden] = useState<EngineId[]>([])
  const [text, setText] = useState('')
  const [code, setCode] = useState('')
  /** Where the prompt runs: every engine, or one. */
  const [only, setOnly] = useState<EngineId | ''>('')
  const history = useRef<string[]>(savedHistory())
  /** How far back in history the prompt is showing (0: the line being typed). */
  const back = useRef(0)
  const draft = useRef('')
  const list = useRef<HTMLDivElement>(null)
  /** Follow new lines while scrolled to the end, like a terminal. */
  const pinned = useRef(true)

  const messages = items.filter((i) => i.kind === 'message')
  const needle = text.trim().toLowerCase()
  const visible = items.filter((i) => {
    if (i.kind !== 'message') return level === 'all' || level === 'log'
    return (level === 'all' || levelOf(i.type) === level) && !hidden.includes(i.engine) && (!needle || i.text.toLowerCase().includes(needle))
  })
  // The same message several times in a row is one line with a count, as in a browser's console.
  const shown: { item: ConsoleItem; count: number }[] = []
  for (const item of visible) {
    const last = shown[shown.length - 1]
    if (last && item.kind === 'message' && last.item.kind === 'message' && last.item.engine === item.engine && last.item.type === item.type && last.item.text === item.text && last.item.source === item.source) last.count++
    else shown.push({ item, count: 1 })
  }
  const count = (lv: Exclude<Level, 'all'>) => messages.filter((l) => l.kind === 'message' && levelOf(l.type) === lv).length

  useEffect(() => {
    const el = list.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [items.length])

  function run() {
    const line = code.trim()
    if (!line) return
    history.current = [...history.current.filter((h) => h !== line), line].slice(-100)
    try {
      localStorage.setItem(HISTORY, JSON.stringify(history.current))
    } catch {
      // Storage unavailable; history just isn't remembered.
    }
    back.current = 0
    pinned.current = true
    setCode('')
    onRun(line, only || undefined)
  }

  /** Up and down recall earlier lines, like a terminal. */
  function recall(step: number) {
    const lines = history.current
    const next = Math.min(Math.max(back.current + step, 0), lines.length)
    if (next === back.current) return
    if (back.current === 0) draft.current = code
    back.current = next
    setCode(next === 0 ? draft.current : lines[lines.length - next])
  }

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
        <span className="muted">{visible.length === items.length ? `${messages.length} messages` : `${visible.length} of ${items.length}`}</span>
        <button type="button" className="plain" data-tip="Clear the console" disabled={!items.length} onClick={onClear}>
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
            {shown.map(({ item, count: repeats }, i) => {
              if (item.kind === 'message')
                return (
                  // The source is drawn by CSS from data-source, so a line's text is the message alone.
                  <li key={i} className={levelOf(item.type)} data-tip={time(item.at)} data-source={item.source}>
                    <span className={`tag ${item.engine}`}>{engineLabel(item.engine)}</span>{' '}
                    {repeats > 1 && (
                      <>
                        <span className="repeat" data-tip={`Logged ${repeats} times in a row`}>
                          {repeats}
                        </span>{' '}
                      </>
                    )}
                    {item.text}
                  </li>
                )
              if (item.kind === 'input')
                return (
                  <li key={i} className="input" data-tip={time(item.at)}>
                    <span className="mark" aria-hidden="true">
                      &gt;
                    </span>{' '}
                    {item.code}
                  </li>
                )
              if (item.kind === 'syntax')
                return (
                  <li key={i} className="error" data-tip={time(item.at)}>
                    <span className="mark" aria-hidden="true">
                      ×
                    </span>{' '}
                    {item.text}
                  </li>
                )
              // The engines' answers: one line when they agree, one each (marked) when they don't.
              if (!item.results.length)
                return (
                  <li key={i} className="result">
                    <span className="mark" aria-hidden="true">
                      &lt;
                    </span>{' '}
                    No frames to run it in.
                  </li>
                )
              const trees = item.results.map(structure)
              const asTree = trees.every((t) => t !== undefined)
              if (!disagree(item.results))
                return (
                  <li key={i} className={item.results[0].ok ? 'result' : 'result error'} data-tip={time(item.at)}>
                    <span className="mark" aria-hidden="true">
                      &lt;
                    </span>{' '}
                    <span className="same" data-tip={`The same in ${item.results.map((r) => engineLabel(r.engine)).join(', ')}`}>
                      {item.results.map((r) => (
                        <span key={r.engine} className={`dot ${r.engine}`} />
                      ))}
                    </span>{' '}
                    {asTree ? <JsonTree sides={[{ value: trees[0] }]} /> : <span className={`value ${item.results[0].type}`}>{item.results[0].text}</span>}
                  </li>
                )
              return (
                <li key={i} className="result differs" data-tip={asTree ? undefined : 'The engines gave different answers'}>
                  {asTree && <JsonTree sides={item.results.map((r, n) => ({ engine: r.engine, value: trees[n] }))} />}
                  {!asTree && item.results.map((r) => (
                    <div key={r.engine} className={r.ok ? undefined : 'error'}>
                      <span className={`tag ${r.engine}`}>{engineLabel(r.engine)}</span> <span className={`value ${r.type}`}>{r.text}</span>
                    </div>
                  ))}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="empty">{items.length ? 'No messages match.' : 'No messages. Type JavaScript below to run it in every engine.'}</p>
        )}
      </div>
      <form
        className="prompt"
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          run()
        }}
      >
        <span className="mark" aria-hidden="true">
          &gt;
        </span>
        <input
          aria-label="Run JavaScript"
          placeholder="Run JavaScript in every engine"
          spellCheck={false}
          autoComplete="off"
          value={code}
          onChange={(e) => {
            back.current = 0
            setCode(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              recall(1)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              recall(-1)
            }
          }}
        />
        <select aria-label="Where to run it" data-tip="Where the line runs: every frame, or one engine's frames" value={only} onChange={(e) => setOnly(e.target.value as EngineId | '')}>
          <option value="">Every engine</option>
          {ENGINES.map((e) => (
            <option key={e} value={e}>
              {engineLabel(e)} only
            </option>
          ))}
        </select>
      </form>
    </div>
  )
}
