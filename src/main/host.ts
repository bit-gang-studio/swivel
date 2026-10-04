import { randomUUID } from 'node:crypto'
import { session, type BrowserWindow } from 'electron'
import type { FindRequest } from '../shared/find'
import type { CanvasFrame, EngineId, InputEvent, LiveOptions, ViewEvents, ViewRect, Viewport } from '../shared/types'
import { StreamedView, releaseContexts } from './live'
import { NativeChrome } from './native-chrome'
import { NativeSafari, webkitAddon } from './native-safari'
import type { Emit, EmitLive, PageView } from './view'
import { log } from './log'

const ENGINES: EngineId[] = ['chromium', 'firefox', 'webkit']

/** Engines drawn natively in the window. Everything else is streamed. */
export function nativeEngines(): EngineId[] {
  return webkitAddon ? ['chromium', 'webkit'] : ['chromium']
}

/** Engines that run in Playwright, for prewarming. */
export function streamedEngines(): EngineId[] {
  return ENGINES.filter((e) => !nativeEngines().includes(e))
}

const sameUrl = (a?: string, b?: string) => !!a && !!b && a.replace(/\/$/, '') === b.replace(/\/$/, '')
const canvasKey = (id: string) => `canvas:${id}`
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
  }

  /** Wipe this window's data: every view is rebuilt on fresh storage, on the same page. */
  clearData(): Promise<void> {
    const url = this.currentUrl()
    const frames = this.canvas ? [...this.canvas.values()] : undefined
    this.destroy()
    this.urls.clear()
    this.storageId = randomUUID()
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
        ? new NativeChrome(this.win, emit, `swivel-${this.storageId}`)
        : engine === 'webkit' && webkitAddon
          ? new NativeSafari(this.win, emit, webkitAddon, this.storageId)
          : new StreamedView(engine, emit, this.storageId, this.win)
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

  /** Test hook. */
  get(engine: EngineId): PageView | undefined {
    return this.views.get(engine)
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
      this.onConsole?.(engine, entry.text)
      return this.emit('console', entry)
    }
    if (event === 'url') this.urls.set(key, payload as string)
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

  /** A shown view moved on its own (a link, a form, a script): bring every other view along. */
  private follow(from: string, url: string): void {
    if (this.settings) this.settings = { ...this.settings, url }
    for (const [key, view] of this.views) {
      if (key === from || sameUrl(this.urls.get(key), url)) continue
      this.urls.set(key, url)
      void view.navigate(url)
    }
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
    for (const id of this.canvas?.keys() ?? []) if (!next.has(id)) this.dropView(canvasKey(id))
    this.canvas = next
    await Promise.all(
      frames.map(async (f) => {
        const key = canvasKey(f.id)
        if (this.views.get(key)?.engine !== f.engine) this.dropView(key) // Engine changed: a new page.
        if (!this.urls.has(key)) this.urls.set(key, url)
        const view = this.views.get(key) ?? this.makeView(key, f.engine)
        try {
          await view.update({ ...this.settings!, url: this.urls.get(key) ?? url, engine: f.engine, viewport: f.viewport })
        } catch (err) {
          log('frame', f.id, f.engine, 'update failed', String(err))
        }
        if (!this.hiddenFrames.has(f.id)) view.show()
        log('frame', f.id, f.engine, this.hiddenFrames.has(f.id) ? 'ready (hidden)' : 'shown')
      })
    )
  }

  /** Where a canvas frame's page sits, and the canvas area it's cut off at. */
  async setFrameRect(id: string, rect: ViewRect): Promise<void> {
    const view = this.views.get(canvasKey(id))
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
        return v.update({ ...this.settings!, url: this.urls.get(key) ?? url ?? this.settings!.url, engine: v.engine, ...(f ? { viewport: f.viewport } : {}) })
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
