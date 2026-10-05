import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { dialog, session, type BrowserWindow } from 'electron'
import type { FindRequest } from '../shared/find'
import type { CanvasFrame, Credentials, EngineId, InputEvent, LiveOptions, ViewEvents, ViewRect, Viewport } from '../shared/types'
import { StreamedView, releaseContexts } from './live'
import { NativeChrome } from './native-chrome'
import { NativeSafari, webkitAddon } from './native-safari'
import type { BrowserContext } from 'playwright-core'
import type { Asker, Emit, EmitLive, PageView } from './view'
import { log } from './log'
import { mobileUserAgent } from './mobile'
import { EVAL_PREFIX, evalScript, type EvalReply, type EvalResult, type PageEval } from '../shared/evaluate'
import { parseLine } from './parse-line'
import { STORAGE_PREFIX, storageEditScript, storageReportScript, type PageStorage, type StorageAction, type StorageSnapshot, type StoredItem } from '../shared/storage'
import { SYNC_PREFIX, syncApplyScript, syncInstallScript, type SyncMessage } from '../shared/sync'
import { CookieJar, electronStore, nativeWebKitStore, playwrightStore, type NativeCookies } from './cookies'

const ENGINES: EngineId[] = ['chromium', 'firefox', 'webkit']

/** Engines drawn natively in the window. Everything else is streamed. */
export function nativeEngines(): EngineId[] {
  return webkitAddon ? ['chromium', 'webkit'] : ['chromium']
}

/**
 * The version of each engine Swivel runs, as its browser numbers it (Chrome 152, Firefox 155,
 * Safari 18.6), for the UI to show what a page is being tested against.
 */
let knownVersions: Record<EngineId, string> | undefined

export function engineVersions(): Record<EngineId, string> {
  return (knownVersions ??= readEngineVersions())
}

/** Read once: it asks macOS for Safari's version. */
function readEngineVersions(): Record<EngineId, string> {
  const versions: Record<EngineId, string> = { chromium: process.versions.chrome?.split('.')[0] ?? '', firefox: '', webkit: '' }
  try {
    const require = createRequire(import.meta.url)
    const file = join(dirname(require.resolve('playwright-core/package.json')), 'browsers.json')
    const browsers = (JSON.parse(readFileSync(file, 'utf8')) as { browsers: { name: string; browserVersion?: string }[] }).browsers
    const of = (name: string) => browsers.find((b) => b.name === name)?.browserVersion ?? ''
    versions.firefox = of('firefox').replace(/\.0$/, '')
    versions.webkit = of('webkit')
  } catch {
    // Unknown: the UI just leaves the number out.
  }
  // WebKit on macOS is Apple's own, the one the installed Safari uses.
  if (webkitAddon) {
    try {
      versions.webkit = execFileSync('/usr/bin/defaults', ['read', '/Applications/Safari.app/Contents/Info', 'CFBundleShortVersionString'], { encoding: 'utf8', timeout: 2000 }).trim()
    } catch {
      versions.webkit = ''
    }
  }
  return versions
}

/** Engines that run in Playwright, for prewarming. */
export function streamedEngines(): EngineId[] {
  return ENGINES.filter((e) => !nativeEngines().includes(e))
}

const sameUrl = (a?: string, b?: string) => !!a && !!b && a.replace(/\/$/, '') === b.replace(/\/$/, '')
const canvasKey = (id: string) => `canvas:${id}`
const LABEL: Record<EngineId, string> = { chromium: 'Blink (Chrome)', firefox: 'Gecko (Firefox)', webkit: 'WebKit (Safari)' }
let nextAsk = 1

/**
 * One window's pages, all on the same URL and the window's own data.
 * - Single-page view: one live view per engine (keyed by engine), one shown. The others stay
 *   loaded, so switching engines is instant.
 * - Canvas: one live view per frame (keyed canvas:<id>), all shown at their own engine and size.
 * The shown views lead: when one navigates on its own, every other view follows. Console output
 * comes from every view.
 */
export class EngineHost {
  private views = new Map<string, PageView>()
  private canvas?: Map<string, CanvasFrame>
  private active?: EngineId
  private settings?: Omit<LiveOptions, 'engine'>
  /** Each view's latest URL, to avoid sending followers where they already are. */
  private urls = new Map<string, string>()
  /** Set while views run a navigation Swivel started; URL changes then aren't user moves. */
  private broadcasting = false
  private win: BrowserWindow
  private emit: EmitLive
  /**
   * This window's data (cookies, storage, cache) in every engine, shared with no other window and
   * kept in memory only: it's gone when the window closes.
   */
  private storageId = randomUUID()
  private rect?: ViewRect

  /** Test hook: sees console text from any engine. */
  onConsole?: (engine: EngineId, text: string) => void

  constructor(win: BrowserWindow, emit: EmitLive) {
    this.win = win
    this.emit = emit
    this.jar = this.newJar()
  }

  /** The window's cookies, kept the same in every engine (sign in once, signed in everywhere). */
  private jar: CookieJar

  private newJar(): CookieJar {
    const jar = new CookieJar()
    void jar.attach('chromium', electronStore(session.fromPartition(`swivel-${this.storageId}`)))
    // WebKit on macOS has its own store; Playwright's engines join when their first frame opens.
    const native = webkitAddon as unknown as Partial<NativeCookies> | null
    if (native?.cookies && native.watchCookies) void jar.attach('webkit', nativeWebKitStore(native as NativeCookies, this.storageId))
    return jar
  }

  // Answers the user gave this window: asked once, shared by every view, forgotten with its data.
  private credentials = new Map<string, Promise<Credentials | null>>()
  private credentialValues = new Map<string, Credentials>()
  private authWaiting = new Map<number, (c: Credentials | null) => void>()
  private trusted = new Map<string, Promise<boolean>>()
  /** Test runs have nobody to answer: questions are declined. */
  private unattended = !!process.env.SWIVEL_HIDDEN

  private asker: Asker = {
    credentials: (site, tried) => {
      const known = this.credentials.get(site)
      // A view that was refused with the stored answer needs a new one; anyone else reuses it.
      if (known && !(tried && this.credentialValues.get(site) === tried)) return known
      if (this.unattended) return Promise.resolve(null)
      const id = nextAsk++
      const answer = new Promise<Credentials | null>((resolve) => {
        this.authWaiting.set(id, resolve)
        this.emit('auth', { id, site, retry: !!tried })
      }).then((c) => {
        if (c) this.credentialValues.set(site, c)
        else this.credentials.delete(site) // Cancelled: ask again next time.
        return c
      })
      this.credentials.set(site, answer)
      return answer
    },
    trust: (site, problem) => {
      const known = this.trusted.get(site)
      if (known) return known
      if (this.unattended || this.win.isDestroyed()) return Promise.resolve(false)
      const answer = dialog
        .showMessageBox(this.win, {
          type: 'warning',
          message: `The certificate for ${site} isn't trusted`,
          detail: `${problem}\n\nThis is normal for local development sites with self-signed certificates. Proceed only if you know this site.`,
          buttons: ['Cancel', 'Proceed Anyway'],
          defaultId: 0,
          cancelId: 0
        })
        .then((r) => {
          if (r.response !== 1) this.trusted.delete(site) // Declined: ask again next time.
          return r.response === 1
        })
      this.trusted.set(site, answer)
      return answer
    },
    dialog: async (kind, message, engine) => {
      if (this.unattended || this.win.isDestroyed()) return false
      const r = await dialog.showMessageBox(this.win, {
        message: message || ' ',
        detail: `From the page, in ${LABEL[engine]}.`,
        buttons: kind === 'alert' ? ['OK'] : ['Cancel', 'OK'],
        defaultId: kind === 'alert' ? 0 : 1,
        cancelId: 0
      })
      return kind === 'alert' || r.response === 1
    }
  }

  /** The UI's answer to an 'auth' question. */
  answerAuth(id: number, credentials: Credentials | null): void {
    this.authWaiting.get(id)?.(credentials)
    this.authWaiting.delete(id)
  }

  /** Wipe this window's data: every view is rebuilt on fresh storage, on the same page. */
  clearData(): Promise<void> {
    this.credentials.clear()
    this.credentialValues.clear()
    this.trusted.clear()
    const url = this.currentUrl()
    const frames = this.canvas ? [...this.canvas.values()] : undefined
    this.destroy()
    this.urls.clear()
    this.storageId = randomUUID()
    this.jar = this.newJar()
    const { settings, active } = this
    if (settings && url) this.settings = { ...settings, url }
    this.clearing = frames && this.settings ? this.setCanvas(frames, this.settings) : settings && active ? this.start({ ...this.settings!, engine: active }) : Promise.resolve()
    return this.clearing
  }

  /** A clear in progress: navigation waits for it, so the old page can't win. */
  private clearing: Promise<void> = Promise.resolve()

  private currentUrl(): string | undefined {
    for (const key of this.shownKeys()) if (this.urls.get(key)) return this.urls.get(key)
    return this.settings?.url
  }

  /** Keys of the views on screen: every canvas frame, or the active engine. */
  private shownKeys(): string[] {
    if (this.canvas) return [...this.canvas.keys()].map(canvasKey)
    return this.active ? [this.active] : []
  }

  private makeView(key: string, engine: EngineId): PageView {
    const emit: Emit = (event, payload) => this.fromView(key, engine, event, payload)
    const view =
      engine === 'chromium'
        ? new NativeChrome(this.win, emit, `swivel-${this.storageId}`, this.asker)
        : engine === 'webkit' && webkitAddon
          ? new NativeSafari(this.win, emit, webkitAddon, this.storageId, this.asker)
          : new StreamedView(engine, emit, this.storageId, this.asker, this.win, (context: BrowserContext, name: string) => this.jar.attach(name, playwrightStore(context)))
    this.views.set(key, view)
    return view
  }

  private view(engine: EngineId): PageView {
    const view = this.views.get(engine) ?? this.makeView(engine, engine)
    if (this.rect && !this.canvas) void view.setRect(this.rect)
    return view
  }

  /** Test hook: each view's latest URL. */
  get viewUrls(): Record<string, string> {
    return Object.fromEntries(this.urls)
  }

  /** Test hook: where the single-page view's page sits. */
  get pageRect(): ViewRect | undefined {
    return this.rect
  }

  /** Test hook: the single-page view for an engine. */
  get(engine: EngineId): PageView | undefined {
    return this.views.get(engine)
  }

  /** Test hook: the first canvas frame's view for an engine. */
  frameView(engine: EngineId): PageView | undefined {
    for (const [id, frame] of this.canvas ?? []) if (frame.engine === engine) return this.views.get(canvasKey(id))
    return undefined
  }

  /** Resolvers waiting for a view's next frame. */
  private frameWaiters = new Map<string, () => void>()

  private nextFrame(key: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        this.frameWaiters.delete(key)
        resolve()
      }
      this.frameWaiters.set(key, done)
      setTimeout(done, timeoutMs)
    })
  }

  private fromView<K extends keyof ViewEvents>(key: string, engine: EngineId, event: K, payload: ViewEvents[K]): void {
    if (event === 'console') {
      const entry = payload as ViewEvents['console']
      if (entry.text.startsWith(SYNC_PREFIX)) return this.sync(key, entry.text.slice(SYNC_PREFIX.length))
      if (entry.text.startsWith(STORAGE_PREFIX)) return this.storageReported(engine, entry.text.slice(STORAGE_PREFIX.length))
      if (entry.text.startsWith(EVAL_PREFIX)) return this.evalReported(key, entry.text.slice(EVAL_PREFIX.length))
      this.onConsole?.(engine, entry.text)
      return this.emit('console', entry)
    }
    if (event === 'url') this.urls.set(key, payload as string)
    // Every page gets the sync script, again after each load.
    if (event === 'url' || (event === 'loading' && payload === false)) this.views.get(key)?.run(syncInstallScript)
    if (event === 'url' || event === 'error') log('view', key, engine, event, String(payload).slice(0, 120))
    // Per-view events go to the UI with the view's key; the UI shows them where that view is.
    if (event === 'frame') {
      this.frameWaiters.get(key)?.()
      return this.emit('frame', { ...(payload as ViewEvents['frame']), view: key })
    }
    if (event === 'cursor') return this.emit('cursor', { view: key, cursor: payload as string })
    if (event === 'snapshot') return this.emit('snapshot', { view: key, image: payload as string | null })
    if (!this.shownKeys().includes(key)) return
    if (event === 'loading' && payload === false) this.broadcasting = false
    if (event === 'url' && !this.broadcasting) this.follow(key, payload as string)
    this.emit(event as 'url', payload as string)
  }

  /** Frames' answers to console prompt lines in progress, by request id. */
  private evals = new Map<number, { answers: Map<string, PageEval>; done: () => void; wanted: number }>()

  private evalReported(key: string, json: string): void {
    try {
      const answer = JSON.parse(json) as PageEval
      const request = this.evals.get(answer.id)
      if (!request) return
      request.answers.set(key, answer)
      if (request.answers.size >= request.wanted) request.done()
    } catch {
      // Not an answer.
    }
  }

  /**
   * The console prompt: run a line of JavaScript in every frame (or one engine's frames) and give
   * each engine's answer. Every frame runs it, so a line that changes the page changes them all;
   * an engine's first frame speaks for it.
   */
  async evaluate(code: string, only?: EngineId): Promise<EvalReply> {
    const parsed = parseLine(code)
    if ('syntaxError' in parsed) return parsed
    const frames = [...this.views].filter(([key, view]) => key.startsWith('canvas:') && (!only || view.engine === only))
    const id = nextAsk++
    const answers = new Map<string, PageEval>()
    await new Promise<void>((resolve) => {
      // A line can wait on the network; give it a few seconds, then show what has answered.
      const timer = setTimeout(resolve, 5000)
      this.evals.set(id, { answers, wanted: frames.length, done: () => (clearTimeout(timer), resolve()) })
      const script = evalScript(id, parsed.body)
      for (const [, view] of frames) view.run(script)
      if (!frames.length) resolve()
    })
    this.evals.delete(id)
    const results: EvalResult[] = []
    for (const engine of ENGINES) {
      const first = frames.find(([key, view]) => view.engine === engine && answers.has(key))
      const any = frames.some(([, view]) => view.engine === engine)
      if (first) {
        const { ok, type, text } = answers.get(first[0])!
        results.push({ engine, ok, type, text })
      } else if (any) results.push({ engine, ok: false, type: 'error', text: 'No answer (the page is busy, or still loading).' })
    }
    return { results }
  }

  /** Pages' storage reports for the request in progress, by engine. */
  private storageReports?: { id: number; pages: { engine: EngineId; page: PageStorage }[] }

  private storageReported(engine: EngineId, json: string): void {
    try {
      const page = JSON.parse(json) as PageStorage
      if (this.storageReports?.id === page.id) this.storageReports.pages.push({ engine, page })
    } catch {
      // Not a report.
    }
  }

  /** A cookie store's engine: mobile mode has its own store per engine ("firefox-phone"). */
  private static engineOf = (store: string) => store.split('-')[0] as EngineId

  /**
   * What the window's engines have stored: cookies (from the jar), and local and session storage
   * and sizes (each frame's page reports its own).
   */
  async storage(): Promise<StorageSnapshot> {
    const id = nextAsk++
    const reports = (this.storageReports = { id, pages: [] as { engine: EngineId; page: PageStorage }[] })
    const frames = [...this.views].filter(([key]) => key.startsWith('canvas:'))
    for (const [, view] of frames) view.run(storageReportScript(id))
    const [cookies] = await Promise.all([
      this.jar.snapshot(),
      // Until every frame has answered, or a short wait (a page can be busy, or have no storage).
      new Promise<void>((resolve) => {
        const started = Date.now()
        const timer = setInterval(() => {
          if (reports.pages.length < frames.length && Date.now() - started < 700) return
          clearInterval(timer)
          resolve()
        }, 30)
      })
    ])
    const engines = ENGINES.filter((e) => frames.some(([, v]) => v.engine === e))
    const items = new Map<string, StoredItem>()
    const usage: StorageSnapshot['usage'] = {}
    for (const { engine, page } of reports.pages) {
      // The first frame of an engine speaks for it: its frames share their storage.
      if (usage[engine]) continue
      usage[engine] = { bytes: page.bytes, databases: page.databases, caches: page.caches }
      for (const area of ['local', 'session'] as const) {
        for (const [key, value] of page[area]) {
          const itemKey = `${area}\n${page.origin}\n${key}`
          const item = items.get(itemKey) ?? { origin: page.origin, area, key, values: {} }
          item.values[engine] = value
          items.set(itemKey, item)
        }
      }
    }
    return {
      engines,
      sharing: this.jar.sharing,
      cookies: cookies.map(({ cookie, key, values, from }) => {
        const byEngine: Partial<Record<EngineId, string>> = {}
        for (const [store, value] of Object.entries(values)) byEngine[EngineHost.engineOf(store)] ??= value
        return { key, name: cookie.name, domain: cookie.domain, path: cookie.path, httpOnly: cookie.httpOnly, secure: cookie.secure, expires: cookie.expires, values: byEngine, from: from ? EngineHost.engineOf(from) : undefined }
      }),
      items: [...items.values()],
      usage
    }
  }

  /** A change made in the storage panel, applied in every engine. */
  async storageAction(action: StorageAction): Promise<void> {
    const everyFrame = (script: string) => {
      for (const [key, view] of this.views) if (key.startsWith('canvas:')) view.run(script)
    }
    if (action.type === 'share') await this.jar.setSharing(action.on)
    else if (action.type === 'delete-cookie') await this.jar.remove(action.key)
    else if (action.type === 'set-cookie') await this.jar.setValue(action.key, action.value)
    else if (action.type === 'clear-cookies') await this.jar.remove()
    else if (action.type === 'delete-item') everyFrame(storageEditScript({ origin: action.origin, area: action.area, key: action.key }))
    else if (action.type === 'set-item') everyFrame(storageEditScript({ origin: action.origin, area: action.area, key: action.key, value: action.value }))
    else if (action.type === 'clear-items') everyFrame(storageEditScript({}))
  }

  /** Whether a scroll, click or typing in one frame is repeated in the others. */
  syncOn = true

  /** A frame reports what the user did in its page: repeat it in the other frames. */
  private sync(from: string, json: string): void {
    if (!this.syncOn || !this.canvas) return
    let message: SyncMessage
    try {
      message = JSON.parse(json) as SyncMessage
    } catch {
      return
    }
    const script = syncApplyScript(message)
    for (const [key, view] of this.views) if (key !== from && key.startsWith('canvas:')) view.run(script)
  }

  /** A shown view moved on its own (a link, a form, a script): bring every other view along. */
  private follow(from: string, url: string): void {
    if (this.settings) this.settings = { ...this.settings, url }
    const followers = [...this.views].filter(([key]) => key !== from && !sameUrl(this.urls.get(key), url))
    for (const [key] of followers) this.urls.set(key, url)
    // The move may come from a sign-in: its cookies reach the other engines first, or they'd
    // load the page signed out.
    void this.jar.settle().then(() => {
      for (const [key, view] of followers) if (this.views.get(key) === view) void view.navigate(url)
    })
  }

  /** Single-page view: show an engine and apply size and colour scheme to every view, without reloading. */
  async start(opts: LiveOptions): Promise<void> {
    const { engine, ...settings } = opts
    const first = !this.settings
    this.settings = settings
    this.leaveCanvas()
    this.active = engine
    if (first) this.broadcasting = true
    // Views are headed to this URL now: a "follow" there would start a second load of the same
    // page (Playwright's WebKit breaks on that).
    for (const e of ENGINES) this.urls.set(e, this.settings.url)
    // The shown engine first; the others load in the background, so it never waits for them.
    for (const e of ENGINES) if (e !== engine) void this.view(e).update({ ...this.settings!, engine: e })
    const target = this.view(engine)
    await target.update({ ...this.settings!, engine })
    const drawsNatively = nativeEngines().includes(engine) || (target as { drawsNatively?: boolean }).drawsNatively
    if (!drawsNatively) {
      // A streamed engine draws in the UI, under any native view. Keep the old view up until
      // the new engine's first frame is on screen, so switching doesn't flash an empty area.
      const frame = this.nextFrame(engine, 500)
      target.show()
      await frame
    } else {
      target.show()
    }
    for (const e of ENGINES) if (e !== engine) this.views.get(e)?.hide()
    const url = this.urls.get(engine)
    if (url) this.emit('url', url)
  }

  /**
   * Canvas: show these frames, all at once, each at its own engine and size. Frames that already
   * exist keep their page; the single-page views are hidden meanwhile.
   */
  async setCanvas(frames: CanvasFrame[], page: { url: string; colorScheme: 'light' | 'dark' }): Promise<void> {
    // The canvas can be the first thing a window shows; frames bring their own sizes.
    this.settings ??= { ...page, viewport: { width: 1280, height: 800 } }
    const url = this.currentUrl() ?? this.settings.url
    log('canvas', frames.map((f) => `${f.id}:${f.engine}:${f.viewport.width}x${f.viewport.height}`).join(' '), 'url', url)
    this.settings = { ...this.settings, url }
    if (!this.canvas) for (const e of ENGINES) this.views.get(e)?.hide()
    const next = new Map(frames.map((f) => [f.id, f]))
    const before = this.canvas
    for (const id of before?.keys() ?? []) {
      if (next.has(id)) continue
      this.dropView(canvasKey(id))
      this.frameRects.delete(id)
    }
    this.canvas = next
    await Promise.all(
      frames.map(async (f) => {
        const key = canvasKey(f.id)
        // A frame that hasn't changed is left alone (one frame resizing must not disturb the rest).
        const was = before?.get(f.id)
        if (was && this.views.has(key) && was.engine === f.engine && was.mobile === f.mobile && was.viewport.width === f.viewport.width && was.viewport.height === f.viewport.height) return
        // A new engine, or mobile mode on or off (a different browser ID): a new page.
        if (this.views.get(key)?.engine !== f.engine || (was && was.mobile !== f.mobile)) this.dropView(key)
        if (!this.urls.has(key)) this.urls.set(key, url)
        let view = this.views.get(key)
        if (!view) {
          view = this.makeView(key, f.engine)
          const rect = this.frameRects.get(f.id)
          if (rect) void view.setRect(rect)
        }
        try {
          await view.update({ ...this.settings!, url: this.urls.get(key) ?? url, engine: f.engine, viewport: f.viewport, mobile: this.mobileFor(f) })
        } catch (err) {
          log('frame', f.id, f.engine, 'update failed', String(err))
        }
        if (!this.hiddenFrames.has(f.id)) view.show()
        log('frame', f.id, f.engine, this.hiddenFrames.has(f.id) ? 'ready (hidden)' : 'shown')
      })
    )
  }

  private versions = engineVersions()

  private mobileFor(f: CanvasFrame): LiveOptions['mobile'] {
    return f.mobile ? { kind: f.mobile, userAgent: mobileUserAgent(f.engine, f.mobile, this.versions) } : undefined
  }

  /** Where a canvas frame's page sits, and the canvas area it's cut off at. */
  async setFrameRect(id: string, rect: ViewRect): Promise<void> {
    const view = this.views.get(canvasKey(id))
    this.frameRects.set(id, rect)
    if (!this.placed.has(id) || !view) {
      this.placed.add(id)
      log('frame', id, view ? 'first rect' : 'rect for a frame with no view', { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) })
    }
    await view?.setRect(rect)
  }

  /** Focus mode shows one frame; the others keep running, hidden. */
  setFrameVisible(id: string, visible: boolean): void {
    if (visible) this.hiddenFrames.delete(id)
    else this.hiddenFrames.add(id)
    const view = this.views.get(canvasKey(id))
    if (visible) view?.show()
    else view?.hide()
  }

  private hiddenFrames = new Set<string>()
  /**
   * Where each frame sits. The UI only says so when a frame moves, so a new page for a frame
   * that's already there (another engine, or mobile mode) is placed from this.
   */
  private frameRects = new Map<string, ViewRect>()
  /** Frames that have been told where they sit (logged once each). */
  private placed = new Set<string>()
  /** The frame the user last picked: find-in-page searches it. */
  selectedFrame?: string

  frameInput(id: string, e: InputEvent): void {
    this.views.get(canvasKey(id))?.input(e)
  }

  /** Back to the single-page view: the canvas frames close. */
  private leaveCanvas(): void {
    if (!this.canvas) return
    for (const id of this.canvas.keys()) this.dropView(canvasKey(id))
    this.canvas = undefined
  }

  private dropView(key: string): void {
    this.views.get(key)?.destroy()
    this.views.delete(key)
    this.urls.delete(key)
  }

  /** "Fill window" resizes: the shown view follows at once; hidden ones catch up when it settles. */
  async resize(viewport: Viewport): Promise<void> {
    if (!this.settings) return
    this.settings = { ...this.settings, viewport }
    const update = (e: EngineId) => this.views.get(e)?.update({ ...this.settings!, engine: e })
    clearTimeout(this.resizeLater)
    this.resizeLater = setTimeout(() => ENGINES.forEach((e) => e !== this.active && void update(e)), 400)
    if (this.active) await update(this.active)
  }

  private resizeLater?: ReturnType<typeof setTimeout>

  /** Dark mode for every view (the canvas has no start() to carry it). */
  async setColorScheme(colorScheme: 'light' | 'dark'): Promise<void> {
    if (!this.settings) return
    this.settings = { ...this.settings, colorScheme }
    const url = this.currentUrl()
    await Promise.all(
      [...this.views].map(([key, v]) => {
        const f = key.startsWith('canvas:') ? this.canvas?.get(key.slice(7)) : undefined
        return v.update({ ...this.settings!, url: this.urls.get(key) ?? url ?? this.settings!.url, engine: v.engine, ...(f ? { viewport: f.viewport, mobile: this.mobileFor(f) } : {}) })
      })
    )
  }

  /** Typed URLs and back, forward, reload go to every view. */
  async navigate(url: string): Promise<void> {
    await this.clearing
    if (this.settings) this.settings = { ...this.settings, url }
    this.broadcasting = true
    for (const key of this.views.keys()) this.urls.set(key, url)
    await Promise.all([...this.views.values()].map((v) => v.navigate(url)))
  }

  async history(action: 'back' | 'forward' | 'reload'): Promise<void> {
    await this.clearing
    this.broadcasting = true
    await Promise.all([...this.views.values()].map((v) => v.history(action)))
  }

  find(req: FindRequest): Promise<void> {
    const picked = this.selectedFrame && canvasKey(this.selectedFrame)
    const key = picked && this.views.has(picked) ? picked : this.shownKeys()[0]
    const view = key ? this.views.get(key) : undefined
    return view ? view.find(req) : Promise.resolve()
  }

  input(e: InputEvent): void {
    if (this.active && !this.canvas) this.views.get(this.active)?.input(e)
  }

  /** Every single-page view learns the page area; only the shown one appears there. */
  async setRect(rect: ViewRect): Promise<void> {
    this.rect = rect
    await Promise.all(ENGINES.map((e) => this.views.get(e)?.setRect(rect)))
  }

  /** Close every view and drop this window's data. */
  destroy(): void {
    clearTimeout(this.resizeLater)
    this.jar.dispose()
    for (const view of this.views.values()) view.destroy()
    this.views.clear()
    this.canvas = undefined
    const id = this.storageId
    const chrome = session.fromPartition(`swivel-${id}`)
    void chrome.clearStorageData().catch(() => {})
    void chrome.clearCache().catch(() => {})
    webkitAddon?.releaseStore?.(id)
    void releaseContexts(id)
  }
}
