import type { EngineId } from './types'

/** What a window's engines have stored, for the storage panel. */
export interface StorageSnapshot {
  /** Engines that have a frame in the window, in display order. */
  engines: EngineId[]
  /** Whether cookies are kept the same in every engine (sign in once, signed in everywhere). */
  sharing: boolean
  cookies: StoredCookie[]
  items: StoredItem[]
  /** Per engine: bytes its sites use, and the names of their databases and caches. */
  usage: Partial<Record<EngineId, { bytes: number; databases: string[]; caches: string[] }>>
}

export interface StoredCookie {
  /** Identifies the cookie: name, domain and path. */
  key: string
  name: string
  domain: string
  path: string
  httpOnly: boolean
  secure: boolean
  /** Unix seconds; none for a session cookie. */
  expires?: number
  /** Its value in each engine that has it. */
  values: Partial<Record<EngineId, string>>
  /** The engine that set it; the others got it by sharing. */
  from?: EngineId
}

export interface StoredItem {
  origin: string
  area: 'local' | 'session'
  key: string
  values: Partial<Record<EngineId, string>>
}

export type StorageAction =
  | { type: 'share'; on: boolean }
  | { type: 'delete-cookie'; key: string }
  | { type: 'set-cookie'; key: string; value: string }
  | { type: 'clear-cookies' }
  | { type: 'delete-item'; origin: string; area: 'local' | 'session'; key: string }
  | { type: 'set-item'; origin: string; area: 'local' | 'session'; key: string; value: string }
  | { type: 'clear-items' }

/** Pages report their storage through the console, the one channel every engine gives Swivel. */
export const STORAGE_PREFIX = '​swivel-storage:'

export interface PageStorage {
  id: number
  origin: string
  local: [string, string][]
  session: [string, string][]
  bytes: number
  databases: string[]
  caches: string[]
}

/** Runs in the page. Self-contained: it is sent as source text. */
async function report(prefix: string, id: number): Promise<void> {
  const dump = (area: () => Storage): [string, string][] => {
    const out: [string, string][] = []
    try {
      const s = area()
      for (let i = 0; i < s.length && i < 500; i++) {
        const key = s.key(i)
        if (key !== null) out.push([key, String(s.getItem(key)).slice(0, 2000)])
      }
    } catch {
      // No storage here (a data: page, or storage blocked).
    }
    return out
  }
  let bytes = 0
  let databases: string[] = []
  let cacheNames: string[] = []
  try {
    bytes = (await navigator.storage.estimate()).usage ?? 0
  } catch {
    // Not available in this engine or page.
  }
  try {
    databases = (await indexedDB.databases()).map((d) => d.name ?? '')
  } catch {
    // Not available in this engine or page.
  }
  try {
    cacheNames = await caches.keys()
  } catch {
    // Not available in this engine or page.
  }
  console.log(prefix + JSON.stringify({ id, origin: location.origin, local: dump(() => localStorage), session: dump(() => sessionStorage), bytes, databases, caches: cacheNames }))
}

/** Script that makes a page report its storage, tagged with a request id. */
export const storageReportScript = (id: number) => `(${report.toString()})(${JSON.stringify(STORAGE_PREFIX)}, ${id})`

/** Script that sets (value given) or removes an item, or clears both areas (no key), on pages of one origin (or any, with none). */
export function storageEditScript(edit: { origin?: string; area?: 'local' | 'session'; key?: string; value?: string }): string {
  return `(() => { try {
    const e = ${JSON.stringify(edit)};
    if (e.origin && location.origin !== e.origin) return;
    if (e.key === undefined) { localStorage.clear(); sessionStorage.clear(); return }
    const s = e.area === 'session' ? sessionStorage : localStorage;
    if (e.value === undefined) s.removeItem(e.key); else s.setItem(e.key, e.value);
  } catch {} })()`
}
