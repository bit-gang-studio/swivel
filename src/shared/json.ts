/** The JSON viewer: stored values and console answers as a tree, with the engines' values merged. */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonPath = (string | number)[]

const isObject = (v: Json | undefined): v is { [key: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v)
const isContainer = (v: Json | undefined): v is Json[] | { [key: string]: Json } => typeof v === 'object' && v !== null

function parseContainer(text: string): Json | undefined {
  const t = text.trim()
  if (!/^[[{]/.test(t)) return undefined
  try {
    const value = JSON.parse(t) as Json
    return isContainer(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** The header and payload of a JSON Web Token. */
function parseJwt(text: string): Json | undefined {
  const parts = text.trim().split('.')
  if (parts.length !== 3 || !parts[0].startsWith('eyJ')) return undefined
  try {
    const [header, payload] = parts.slice(0, 2).map((part) => {
      const bytes = Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
      return JSON.parse(new TextDecoder().decode(bytes)) as Json
    })
    return isObject(header) && isObject(payload) ? { header, payload } : undefined
  } catch {
    return undefined
  }
}

export interface Decoded {
  kind: 'JSON' | 'JWT'
  value: Json
  /** Text holding a changed value, written the way the original was. None: it can't be edited. */
  encode?: (value: Json) => string
}

/** Text that holds a structure: JSON (as cookies often carry it, URL-encoded too), or a token. */
export function decode(text: string): Decoded | undefined {
  const json = parseContainer(text)
  if (json !== undefined) return { kind: 'JSON', value: json, encode: (v) => JSON.stringify(v) }
  if (/^%(7B|5B)/i.test(text.trim())) {
    try {
      const inner = parseContainer(decodeURIComponent(text))
      if (inner !== undefined) return { kind: 'JSON', value: inner, encode: (v) => encodeURIComponent(JSON.stringify(v)) }
    } catch {
      // Not URL-encoded after all.
    }
  }
  const jwt = parseJwt(text)
  return jwt === undefined ? undefined : { kind: 'JWT', value: jwt }
}

/** A number that reads as a date (Unix seconds or milliseconds, 2000 to 2100): its milliseconds. */
export function timestamp(value: Json): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  if (value >= 946_684_800 && value < 4_102_444_800) return value * 1000
  if (value >= 946_684_800_000 && value < 4_102_444_800_000) return value
  return undefined
}

export function equal(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]))
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && equal(a[k], b[k]))
  }
  return false
}

/** A place in the tree, holding each side's value there (a side is an engine). */
export interface JsonNode {
  path: JsonPath
  /** Each side's value; undefined where a side doesn't have it. */
  values: (Json | undefined)[]
  /** Every side has the same value here. */
  same: boolean
  /** What the sides hold in common: their merged children, or a value each (a leaf). */
  kind: 'object' | 'array' | 'leaf'
  children?: JsonNode[]
  /** Text here holds a structure, shown as its children. Nothing inside it can be edited. */
  decoded?: 'JSON' | 'JWT'
}

/** One tree from every side's value: shared structure once, differences marked. */
export function merge(values: (Json | undefined)[], path: JsonPath = []): JsonNode {
  const present = values.filter((v) => v !== undefined)
  const same = present.length === values.length && present.every((v) => equal(v, present[0]))
  const node = (kind: 'object' | 'array', inner: (Json | undefined)[], decoded?: 'JSON' | 'JWT'): JsonNode => {
    const keys: (string | number)[] = []
    for (const v of inner) {
      if (Array.isArray(v)) for (let i = keys.length; i < v.length; i++) keys.push(i)
      else if (isObject(v)) for (const k of Object.keys(v)) if (!keys.includes(k)) keys.push(k)
    }
    const children = keys.map((k) => merge(inner.map((v) => (v === undefined ? undefined : (v as Record<string | number, Json>)[k])), [...path, k]))
    return { path, values, same, kind, children, decoded }
  }
  if (present.length && present.every(Array.isArray)) return node('array', values)
  if (present.length && present.every(isObject)) return node('object', values)
  if (present.length && present.every((v) => typeof v === 'string')) {
    const inner = values.map((v) => (v === undefined ? undefined : decode(v as string)))
    const first = inner.find((d) => d)
    if (first && inner.every((d, i) => values[i] === undefined || d?.kind === first.kind)) {
      const decodedValues = inner.map((d) => d?.value)
      const shape = decodedValues.filter((v) => v !== undefined)
      if (shape.every(Array.isArray)) return node('array', decodedValues, first.kind)
      if (shape.every(isObject)) return node('object', decodedValues, first.kind)
    }
  }
  return { path, values, same, kind: 'leaf' }
}

/** A path as JavaScript would write it: user.roles[0]["first-name"]. */
export function pathText(path: JsonPath): string {
  return path.map((k, i) => (typeof k === 'number' ? `[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? (i ? `.${k}` : k) : `[${JSON.stringify(k)}]`)).join('')
}

/** A copy of root with the value at path replaced. */
export function setAt(root: Json, path: JsonPath, value: Json): Json {
  if (!path.length) return value
  const [key, ...rest] = path
  if (Array.isArray(root)) return root.map((v, i) => (i === key ? setAt(v, rest, value) : v))
  if (isObject(root)) return Object.fromEntries(Object.entries(root).map(([k, v]) => [k, k === key ? setAt(v, rest, value) : v]))
  return root
}

/** What was typed as a new value: JSON when it is JSON (12, true, null, "text", {…}), else the text itself. */
export function typed(text: string): Json {
  try {
    return JSON.parse(text) as Json
  } catch {
    return text
  }
}

/** Whether a node, or anything under it, has the text in a key or a value. */
export function matches(node: JsonNode, needle: string): boolean {
  if (!needle) return true
  const key = node.path[node.path.length - 1]
  if (key !== undefined && String(key).toLowerCase().includes(needle)) return true
  if (node.children) return node.children.some((c) => matches(c, needle))
  return node.values.some((v) => v !== undefined && (typeof v === 'string' ? v : JSON.stringify(v)).toLowerCase().includes(needle))
}
