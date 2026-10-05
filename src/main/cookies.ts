import type { Session } from 'electron'
import type { BrowserContext } from 'playwright-core'

/** A cookie, in the shape every engine can give and take. */
export interface Cookie {
  name: string
  value: string
  /** As the engine reports it: ".example.com" for a domain cookie, "example.com" for a host-only one. */
  domain: string
  path: string
  /** Unix seconds. None: a session cookie. */
  expires?: number
  httpOnly: boolean
  secure: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

/** One engine's cookies for a window. */
export interface CookieStore {
  all(): Promise<Cookie[]>
  set(cookie: Cookie): Promise<void>
  remove(cookie: Cookie): Promise<void>
  /** Call back when the cookies may have changed. Returns how to stop. */
  watch(changed: () => void): () => void
}

const keyOf = (c: Cookie) => `${c.name}\n${c.domain.replace(/^\./, '').toLowerCase()}\n${c.path}`
const urlOf = (c: Cookie) => `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`

/**
 * One window's cookies, kept the same in every engine: sign in on a frame in one engine and the
 * frames in the others are signed in too. Each engine keeps its own cookie store; when one
 * changes, the change is copied to the rest. An engine that joins later (its first frame) starts
 * with what the others have.
 */
export class CookieJar {
  private stores = new Map<string, { store: CookieStore; known: Map<string, string>; stop: () => void }>()
  private cookies = new Map<string, Cookie>()
  /** The store each cookie was first seen in (the others got it by sharing). */
  private origin = new Map<string, string>()
  /** Off: each engine keeps its own cookies, to test how each really handles them. */
  sharing = true
  /** Changes are applied one at a time, in order. */
  private queue: Promise<void> = Promise.resolve()
  private disposed = false

  private run(job: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(job).catch(() => {})
    return this.queue
  }

  /** Add an engine's store: it gets the window's cookies, then is watched for changes. */
  attach(name: string, store: CookieStore): Promise<void> {
    if (this.stores.has(name) || this.disposed) return this.queue
    const entry = { store, known: new Map<string, string>(), stop: () => {} }
    this.stores.set(name, entry)
    return this.run(async () => {
      for (const [key, cookie] of this.cookies) {
        entry.known.set(key, cookie.value)
        await store.set(cookie).catch(() => {})
      }
      await this.pull(name)
      entry.stop = store.watch(() => void this.run(() => this.pull(name)))
    })
  }

  /** Read one engine's cookies and copy what changed to the others. */
  private async pull(name: string): Promise<void> {
    const entry = this.stores.get(name)
    if (!entry || this.disposed) return
    const now = new Map((await entry.store.all()).map((c) => [keyOf(c), c]))
    const changed = [...now].filter(([key, c]) => entry.known.get(key) !== c.value)
    const removed = [...entry.known.keys()].filter((key) => !now.has(key))
    entry.known = new Map([...now].map(([key, c]) => [key, c.value]))
    const others = [...this.stores].filter(([other]) => other !== name).map(([, e]) => e)
    for (const [key, cookie] of changed) {
      this.cookies.set(key, cookie)
      if (!this.origin.has(key)) this.origin.set(key, name)
      if (!this.sharing) continue
      for (const other of others) {
        if (other.known.get(key) === cookie.value) continue
        // Recorded first, so the other store's own change report isn't copied back.
        other.known.set(key, cookie.value)
        await other.store.set(cookie).catch(() => {})
      }
    }
    for (const key of removed) {
      const cookie = this.cookies.get(key)
      // Kept while another engine still has it (sharing off, or not copied yet).
      const elsewhere = others.some((o) => o.known.has(key))
      if (!this.sharing && elsewhere) continue
      this.cookies.delete(key)
      this.origin.delete(key)
      if (!cookie || !this.sharing) continue
      for (const other of others) {
        if (!other.known.has(key)) continue
        other.known.delete(key)
        await other.store.remove(cookie).catch(() => {})
      }
    }
  }

  /**
   * Make sure every engine's latest cookies have reached the others, e.g. before frames follow
   * one to the page a sign-in led to.
   */
  settle(): Promise<void> {
    return this.run(async () => {
      for (const name of [...this.stores.keys()]) await this.pull(name)
    })
  }

  /** Every cookie in the window: its value in each store that has it, and where it came from. */
  async snapshot(): Promise<{ cookie: Cookie; key: string; values: Record<string, string>; from?: string }[]> {
    await this.settle()
    return [...this.cookies].map(([key, cookie]) => {
      const values: Record<string, string> = {}
      for (const [name, entry] of this.stores) {
        const value = entry.known.get(key)
        if (value !== undefined) values[name] = value
      }
      return { cookie, key, values, from: this.origin.get(key) }
    })
  }

  /** Turn sharing on or off. Turning it on copies each cookie to the engines that lack it. */
  setSharing(on: boolean): Promise<void> {
    this.sharing = on
    if (!on) return this.queue
    return this.run(async () => {
      for (const [key, cookie] of this.cookies) {
        for (const entry of this.stores.values()) {
          if (entry.known.get(key) === cookie.value) continue
          entry.known.set(key, cookie.value)
          await entry.store.set(cookie).catch(() => {})
        }
      }
    })
  }

  /** Set a cookie's value in every engine that has it (all of them, when sharing). */
  setValue(key: string, value: string): Promise<void> {
    return this.run(async () => {
      const cookie = this.cookies.get(key)
      if (!cookie) return
      const next = { ...cookie, value }
      this.cookies.set(key, next)
      for (const entry of this.stores.values()) {
        if (!this.sharing && !entry.known.has(key)) continue
        entry.known.set(key, value)
        await entry.store.set(next).catch(() => {})
      }
    })
  }

  /** Remove one cookie (or, with no key, every cookie) from every engine. */
  remove(key?: string): Promise<void> {
    return this.run(async () => {
      for (const [k, cookie] of [...this.cookies]) {
        if (key !== undefined && k !== key) continue
        this.cookies.delete(k)
        this.origin.delete(k)
        for (const entry of this.stores.values()) {
          if (!entry.known.has(k)) continue
          entry.known.delete(k)
          await entry.store.remove(cookie).catch(() => {})
        }
      }
    })
  }

  dispose(): void {
    this.disposed = true
    for (const { stop } of this.stores.values()) stop()
    this.stores.clear()
  }
}

const ELECTRON_SAME_SITE = { Strict: 'strict', Lax: 'lax', None: 'no_restriction' } as const

/** Blink: the window's Electron session. */
export function electronStore(session: Session): CookieStore {
  return {
    async all() {
      return (await session.cookies.get({})).map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain ?? '',
        path: c.path ?? '/',
        expires: c.session ? undefined : c.expirationDate,
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
        sameSite: c.sameSite === 'strict' ? 'Strict' : c.sameSite === 'lax' ? 'Lax' : c.sameSite === 'no_restriction' ? 'None' : undefined
      }))
    },
    set: (c) =>
      session.cookies.set({
        url: urlOf(c),
        name: c.name,
        value: c.value,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        ...(c.domain.startsWith('.') ? { domain: c.domain } : {}), // No domain: a host-only cookie.
        ...(c.expires ? { expirationDate: c.expires } : {}),
        ...(c.sameSite ? { sameSite: ELECTRON_SAME_SITE[c.sameSite] } : {})
      }),
    remove: (c) => session.cookies.remove(urlOf(c), c.name),
    watch(changed) {
      // One report for a burst of changes (a sign-in sets several cookies).
      let timer: ReturnType<typeof setTimeout> | undefined
      const onChange = () => {
        clearTimeout(timer)
        timer = setTimeout(changed, 50)
      }
      session.cookies.on('changed', onChange)
      return () => {
        clearTimeout(timer)
        session.cookies.removeListener('changed', onChange)
      }
    }
  }
}

/** An engine run by Playwright: the window's browser context. It has no change event, so it's checked often. */
export function playwrightStore(context: BrowserContext): CookieStore {
  return {
    async all() {
      return (await context.cookies()).map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires > 0 ? c.expires : undefined,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite
      }))
    },
    set: (c) =>
      context.addCookies([
        {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
          ...(c.expires ? { expires: c.expires } : {}),
          ...(c.sameSite ? { sameSite: c.sameSite } : {})
        }
      ]),
    remove: (c) => context.clearCookies({ name: c.name, domain: c.domain, path: c.path }),
    watch(changed) {
      const timer = setInterval(changed, 1000)
      return () => clearInterval(timer)
    }
  }
}

/** What the native WebKit addon offers for a window's data store (macOS). */
export interface NativeCookies {
  cookies(store: string, done: (json: string) => void): void
  setCookie(store: string, json: string): void
  deleteCookie(store: string, name: string, domain: string, path: string): void
  /** Calls back whenever the store's cookies change; one watcher per store. */
  watchCookies(store: string, changed: () => void): void
  unwatchCookies(store: string): void
}

/** WebKit on macOS: the window's own WKWebsiteDataStore. */
export function nativeWebKitStore(addon: NativeCookies, storeKey: string): CookieStore {
  return {
    all: () =>
      new Promise((resolve) =>
        addon.cookies(storeKey, (json) => {
          try {
            resolve(JSON.parse(json) as Cookie[])
          } catch {
            resolve([])
          }
        })
      ),
    async set(c) {
      addon.setCookie(storeKey, JSON.stringify(c))
    },
    async remove(c) {
      addon.deleteCookie(storeKey, c.name, c.domain, c.path)
    },
    watch(changed) {
      let timer: ReturnType<typeof setTimeout> | undefined
      addon.watchCookies(storeKey, () => {
        clearTimeout(timer)
        timer = setTimeout(changed, 50)
      })
      return () => {
        clearTimeout(timer)
        addon.unwatchCookies(storeKey)
      }
    }
  }
}
