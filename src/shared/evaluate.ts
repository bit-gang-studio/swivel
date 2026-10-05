import type { EngineId } from './types'

/**
 * The console prompt: a line of JavaScript run in the window's frames, with each engine's answer
 * shown side by side. Pages answer through the console, the one channel every engine gives Swivel.
 */
export const EVAL_PREFIX = '​swivel-eval:'

/** One engine's answer to a line. */
export interface EvalResult {
  engine: EngineId
  /** False: the line threw, and text is the error. */
  ok: boolean
  /** What kind of value came back: 'string', 'number', 'object', 'array', 'element', 'function', 'undefined'… */
  type: string
  /** The value, written out. */
  text: string
}

export type EvalReply = { results: EvalResult[] } | { syntaxError: string }

export interface PageEval {
  id: number
  ok: boolean
  type: string
  text: string
}

/** Runs in the page. Self-contained: it is sent as source text. */
async function run(prefix: string, id: number, line: () => unknown): Promise<void> {
  const typeOf = (v: unknown): string => {
    if (v === null) return 'null'
    if (Array.isArray(v)) return 'array'
    if (typeof Element !== 'undefined' && v instanceof Element) return 'element'
    if (v instanceof Error) return 'error'
    return typeof v
  }
  const write = (v: unknown): string => {
    const type = typeOf(v)
    if (type === 'undefined') return 'undefined'
    if (type === 'string') return JSON.stringify(v)
    if (type === 'function') return `ƒ ${(v as { name?: string }).name || '(anonymous)'}()`
    if (type === 'symbol' || type === 'bigint') return String(v) + (type === 'bigint' ? 'n' : '')
    if (type === 'element') return (v as Element).outerHTML.replace(/>[\s\S]*$/, '>').slice(0, 300)
    if (type === 'error') return `${(v as Error).name}: ${(v as Error).message}`
    if (type !== 'object' && type !== 'array') return String(v)
    // Objects and arrays as JSON, with what JSON can't hold named rather than dropped.
    const seen = new WeakSet<object>()
    try {
      const json = JSON.stringify(
        typeof NodeList !== 'undefined' && (v instanceof NodeList || v instanceof HTMLCollection) ? Array.from(v as ArrayLike<unknown>) : v,
        (_key, value: unknown) => {
          if (typeof value === 'function') return `ƒ ${(value as { name?: string }).name || '(anonymous)'}()`
          if (typeof value === 'undefined') return '[undefined]'
          if (typeof value === 'bigint') return String(value) + 'n'
          if (typeof Element !== 'undefined' && value instanceof Element) return value.outerHTML.replace(/>[\s\S]*$/, '>').slice(0, 120)
          if (value !== null && typeof value === 'object') {
            if (seen.has(value)) return '[circular]'
            seen.add(value)
            if (value instanceof Map) return { 'Map': Array.from(value.entries()) }
            if (value instanceof Set) return { 'Set': Array.from(value.values()) }
          }
          return value
        },
        2
      )
      return json === undefined ? String(v) : json.length > 20000 ? json.slice(0, 20000) + '\n… (cut)' : json
    } catch {
      return Object.prototype.toString.call(v)
    }
  }
  let reply: { ok: boolean; type: string; text: string }
  try {
    const value = await line()
    reply = { ok: true, type: typeOf(value), text: write(value) }
  } catch (err) {
    reply = { ok: false, type: 'error', text: err instanceof Error ? `${err.name}: ${err.message}` : `Uncaught ${write(err)}` }
  }
  console.log(prefix + JSON.stringify({ id, ...reply }))
}

/**
 * Script that runs a line in a page and reports its value. The line is part of the script itself
 * (as DevTools does), not handed to eval(), which a page's security policy can forbid.
 * body: the line as the body of a function that returns its value (see parseLine in the main process).
 */
export function evalScript(id: number, body: string): string {
  return `(${run.toString()})(${JSON.stringify(EVAL_PREFIX)}, ${id}, async () => {\n${body}\n})`
}
