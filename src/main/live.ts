import { join } from 'node:path'
import { app, screen, type BrowserWindow } from 'electron'
import { chromium, firefox, webkit, type BrowserContext, type BrowserType, type Page } from 'playwright-core'
import type { EngineId, Frame, InputEvent, LiveOptions, ViewRect } from '../shared/types'
import type { Emit, PageView } from './view'
import { FrameSource } from './frames'
import { FirefoxWindow, refreshPatchedCode, windowedFirefoxStatus, windowedLaunchOptions } from './firefox-window'
import { findInPage, type FindRequest } from '../shared/find'

const types: Record<EngineId, BrowserType> = { chromium, firefox, webkit }
const contexts = new Map<EngineId, Promise<BrowserContext>>()

/**
 * One persistent context per engine, so logins and site data survive restarts. Each engine has
 * its own profile, like separate browsers. Falls back to a throwaway context if the profile is
 * locked (another Swivel window or instance is using it).
 */
function getContext(engine: EngineId, win?: BrowserWindow): Promise<BrowserContext> {
  let context = contexts.get(engine)
  if (!context && engine === 'firefox' && win && windowedFirefoxStatus() === 'on') {
    const profile = join(app.getPath('userData'), 'profiles', engine)
    refreshPatchedCode(profile)
    const content = win.getContentBounds()
    context = firefox.launchPersistentContext(profile, windowedLaunchOptions({ width: 1280, height: 800 }, { x: content.x, y: content.y + 40 }))
    context.catch(() => contexts.delete(engine))
    contexts.set(engine, context)
  }
  if (!context) {
    const scale = screen.getPrimaryDisplay().scaleFactor
    const options = {
      headless: true,
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: scale,
      // Firefox ignores deviceScaleFactor and renders at 1x (blurry on Retina); this pref makes it
      // render at the screen's real density.
      ...(engine === 'firefox' ? { firefoxUserPrefs: { 'layout.css.devPixelsPerPx': String(scale) } } : {})
    }
    context = types[engine]
      .launchPersistentContext(join(app.getPath('userData'), 'profiles', engine), options)
      .catch(async () => (await types[engine].launch({ headless: true, firefoxUserPrefs: options.firefoxUserPrefs })).newContext(options))
    context.catch(() => contexts.delete(engine))
    contexts.set(engine, context)
  }
  return context
}

/** Start streamed engines in the background so the first switch is fast and warmed up. */
export function prewarmBrowsers(engines: EngineId[]): void {
  for (const engine of engines) {
    if (engine === 'firefox' && windowedFirefoxStatus() === 'on') continue // Launched with its first page.
    void getContext(engine)
      .then(async (context) => {
        const page = await context.newPage()
        const end = Date.now() + 3000
        while (Date.now() < end) await page.screenshot({ type: 'jpeg', quality: 80 })
        await page.close()
      })
      .catch(() => {})
  }
}

export async function closeAllBrowsers(): Promise<void> {
  const all = await Promise.allSettled(contexts.values())
  contexts.clear()
  await Promise.all(all.map((c) => (c.status === 'fulfilled' ? c.value.close().catch(() => {}) : undefined)))
}

/** Resolve with the fallback if a browser call takes too long, so one stuck call never freezes the app. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))])
}

// Long enough for a slow engine right after a page load, short enough that a stuck call can't freeze input.
const INPUT_TIMEOUT = 5000

/** Runs in the page: the cursor the browser would show at a point. */
function pickCursor({ x, y }: { x: number; y: number }): string {
  const el = document.elementFromPoint(x, y)
  if (!el) return 'default'
  let cursor = getComputedStyle(el).cursor
  if (cursor.includes('url(')) cursor = cursor.split(',').pop()!.trim() // Custom images can't cross over; use the fallback.
  if (cursor !== 'auto') return cursor
  if (el.closest('a[href], [role="link"]')) return 'pointer'
  if (el.closest('textarea, [contenteditable=""], [contenteditable="true"], input:not([type=button], [type=submit], [type=reset], [type=checkbox], [type=radio], [type=range], [type=color], [type=file], [type=image])')) return 'text'
  return 'default'
}
const debug = (...args: unknown[]) => process.env.SWIVEL_DEBUG && console.log('[swivel]', ...args)
const message = (err: unknown) => (err instanceof Error ? err.message.split('\n')[0] : String(err))
// Errors from a navigation that a newer one replaced. Not worth showing.
const superseded = (err: unknown) => /interrupted by another navigation|NS_BINDING_ABORTED|Navigation.*aborted|frame was detached|Target.*closed|has been closed/i.test(message(err))

/**
 * A streamed page: runs headless in Playwright, frames are drawn on a canvas in the UI, and
 * mouse/keyboard input is replayed into the page. The page stays alive while hidden.
 */
export class StreamedView implements PageView {
  readonly engine: EngineId
  private page?: Page
  private frames?: FrameSource
  private opts?: LiveOptions
  private loadedUrl?: string
  private visible = false
  private emit: Emit
  /** Resolves once the page exists. Never waits for a page to finish loading. */
  private ready: Promise<void> = Promise.resolve()

  private win?: BrowserWindow
  /** Real-window Firefox on macOS, when available (see firefox-window.ts). */
  private window?: FirefoxWindow
  /** A real window whose mirror failed: kept hidden behind Swivel while the page is streamed. */
  private hiddenWindow?: FirefoxWindow
  private rect?: ViewRect

  constructor(engine: EngineId, emit: Emit, win?: BrowserWindow) {
    this.engine = engine
    this.emit = emit
    this.win = win
  }

  /** Drawn by a native layer rather than frames on the canvas. */
  get drawsNatively(): boolean {
    return this.mirrored
  }

  update(opts: LiveOptions): Promise<void> {
    const previous = this.ready
    this.ready = previous.then(() => this.apply(opts))
    return this.ready
  }

  private async apply(opts: LiveOptions): Promise<void> {
    const sizeChanged = !this.opts || this.opts.viewport.width !== opts.viewport.width || this.opts.viewport.height !== opts.viewport.height
    this.opts = opts
    try {
      const page = this.page ?? (await this.createPage())
      if (sizeChanged) {
        await within(page.setViewportSize(opts.viewport), 3000, undefined)
        await this.frames?.setSize(opts.viewport)
        this.window?.resize(opts.viewport)
        this.chooseRendering()
      }
      await within(page.emulateMedia({ colorScheme: opts.colorScheme }), 3000, undefined)
      if (this.loadedUrl !== opts.url) {
        this.loadedUrl = opts.url
        void this.load(page, () => page.goto(opts.url, { waitUntil: 'load', timeout: 30_000 }))
      }
    } catch (err) {
      this.emit('error', message(err))
    }
  }

  private async createPage(): Promise<Page> {
    const context = await getContext(this.engine, this.win)
    const page = await context.newPage()
    this.page = page
    if (this.engine === 'firefox' && this.win && windowedFirefoxStatus() === 'on' && this.opts) {
      // Real-window mode: close the window Firefox opens at launch, mirror this page's window, and
      // load links that open new windows here instead (a stray window would show on screen).
      for (const other of context.pages()) if (other !== page) await other.close().catch(() => {})
      context.on('page', (popup) => {
        debug(this.engine, 'popup', popup === this.page ? '(our page)' : popup.url())
        if (popup === this.page) return
        void popup.waitForURL(/.*/, { timeout: 5000 }).catch(() => {}).then(() => {
          const url = popup.url()
          void popup.close().catch(() => {})
          if (url && url !== 'about:blank') void this.navigate(url)
        })
      })
      await within(page.setViewportSize(this.opts.viewport), 3000, undefined)
      const window = new FirefoxWindow(this.win, context, page, this.opts.viewport)
      if (this.rect) window.setRect(this.rect)
      if (await window.start()) {
        this.window = window
        window.onFitChange = () => this.chooseRendering()
        if (this.visible) window.show()
        this.chooseRendering()
      } else {
        // No mirror: keep the real window shrunk behind Swivel and stream frames from it.
        window.suspend()
        this.hiddenWindow = window
      }
    }
    page.on('console', (msg) => this.emit('console', { engine: this.engine, type: msg.type(), text: msg.text() }))
    page.on('pageerror', (err) => this.emit('console', { engine: this.engine, type: 'error', text: err.message }))
    page.on('request', (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) this.emit('loading', true)
    })
    page.on('load', () => this.emit('loading', false))
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      debug(this.engine, 'navigated', frame.url().slice(0, 60))
      this.loadedUrl = frame.url()
      this.emit('url', frame.url())
      this.frames?.reset()
      this.frames?.wake()
    })
    if (this.visible) this.startFrames()
    return page
  }

  /** Real window mirrored when the size fits behind Swivel; otherwise stream frames from the same page. */
  private chooseRendering(): void {
    if (!this.window || !this.opts) return
    debug(this.engine, 'rendering', this.window.fits(this.opts.viewport) ? 'mirror' : 'frames (too big to hide)', JSON.stringify(this.opts.viewport))
    if (this.window.fits(this.opts.viewport)) {
      this.window.resume()
      this.frames?.stop()
      this.frames = undefined
    } else {
      this.window.suspend()
      if (this.visible) this.startFrames()
    }
  }

  private get mirrored(): boolean {
    return !!this.window && !!this.opts && this.window.fits(this.opts.viewport)
  }

  private startFrames(): void {
    const page = this.page
    if (!page || !this.opts || this.frames || this.mirrored) return
    const frames = new FrameSource(page, this.engine, this.opts.viewport, (f) => {
      if (frames !== this.frames) return
      this.lastFrame = { engine: this.engine, data: new Uint8Array(f.data), format: f.format, width: f.width, height: f.height }
      this.emit('frame', this.lastFrame)
      // The page changed under the mouse (it loaded, or a hover effect ran), so the cursor may have too.
      if (this.mouseAt.x >= 0) this.probeCursor()
    }, screen.getPrimaryDisplay().scaleFactor)
    this.frames = frames
    void frames.start()
  }

  private lastFrame?: Frame

  /** Stream frames. Hidden views keep their page but send nothing. The last frame is resent at once, so switching back shows the page immediately. */
  show(): void {
    this.visible = true
    this.window?.show()
    if (this.lastFrame && !this.mirrored) this.emit('frame', this.lastFrame)
    this.startFrames()
  }

  hide(): void {
    this.visible = false
    this.window?.hide()
    this.frames?.stop()
    this.frames = undefined
    this.pending = []
    this.mouseAt = { x: -1, y: -1 }
    this.lastCursor = ''
  }

  async setRect(rect: ViewRect): Promise<void> {
    // Streamed frames are drawn by the UI wherever it likes; a mirrored window is placed here.
    this.rect = rect
    this.window?.setRect(rect)
  }

  /** Run a navigation in the background and report real failures. */
  private async load(page: Page, go: () => Promise<unknown>): Promise<void> {
    this.emit('loading', true)
    const started = Date.now()
    try {
      await go()
      debug(this.engine, 'load done', Date.now() - started, 'ms')
    } catch (err) {
      debug(this.engine, 'load failed', message(err))
      if (page === this.page && !superseded(err)) this.emit('error', message(err))
    } finally {
      if (page === this.page) this.emit('loading', false)
    }
  }

  async find(req: FindRequest): Promise<void> {
    await this.ready
    const page = this.page
    if (!page) return
    const result = await within(page.evaluate(findInPage, req), 2000, { matches: 0, active: 0 })
    this.emit('find', result)
    this.frames?.wake()
  }

  async navigate(url: string): Promise<void> {
    debug(this.engine, 'navigate requested', url.slice(0, 60))
    await this.ready
    const page = this.page
    debug(this.engine, 'navigate ready', !!page)
    if (!page || !this.opts) return
    this.opts = { ...this.opts, url }
    this.loadedUrl = url
    void this.load(page, () => page.goto(url, { waitUntil: 'load', timeout: 30_000 }))
  }

  async history(action: 'back' | 'forward' | 'reload'): Promise<void> {
    await this.ready
    const page = this.page
    if (!page) return
    const opts = { waitUntil: 'load' as const, timeout: 30_000 }
    void this.load(page, () => (action === 'back' ? page.goBack(opts) : action === 'forward' ? page.goForward(opts) : page.reload(opts)))
  }

  private pending: InputEvent[] = []
  private draining = false
  private mouseAt = { x: -1, y: -1 }

  /**
   * Input is replayed strictly in order, so a mouse up never lands before its down.
   * While the page is busy, queued moves collapse to the latest one and wheel events
   * add up, so a trackpad or a moving mouse never builds a backlog.
   */
  input(e: InputEvent): void {
    this.frames?.wake()
    const last = this.pending[this.pending.length - 1]
    if (e.kind === 'move' && last?.kind === 'move') this.pending[this.pending.length - 1] = e
    else if (e.kind === 'wheel' && last?.kind === 'wheel') this.pending[this.pending.length - 1] = { ...e, dx: last.dx + e.dx, dy: last.dy + e.dy }
    else this.pending.push(e)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      for (let e = this.pending.shift(); e; e = this.pending.shift()) await within(this.replay(e), INPUT_TIMEOUT, undefined)
    } finally {
      this.draining = false
    }
  }

  private async moveTo(page: Page, x: number, y: number): Promise<void> {
    if (x === this.mouseAt.x && y === this.mouseAt.y) return
    this.mouseAt = { x, y }
    await page.mouse.move(x, y)
    this.probeCursor()
  }

  private cursorTimer?: ReturnType<typeof setTimeout>
  private lastCursor = ''

  /**
   * Streamed pages can't set the app's cursor, so ask the page which cursor applies under the
   * mouse, after it moves or the page changes. Throttled to one call every 100 ms.
   */
  private probeCursor(): void {
    if (this.cursorTimer) return
    this.cursorTimer = setTimeout(async () => {
      this.cursorTimer = undefined
      const page = this.page
      if (!page) return
      const cursor = await within(page.evaluate(pickCursor, this.mouseAt), 1000, null)
      if (cursor === null) return this.probeCursor() // Page busy; try again.
      if (cursor !== this.lastCursor) {
        this.lastCursor = cursor
        this.emit('cursor', cursor)
      }
    }, 100)
  }

  private async replay(e: InputEvent): Promise<void> {
    const page = this.page
    if (!page) return
    switch (e.kind) {
      case 'move':
        return this.moveTo(page, e.x, e.y)
      case 'down':
        debug(this.engine, 'mouse down', e.x, e.y)
        await this.moveTo(page, e.x, e.y)
        if (process.env.SWIVEL_DEBUG) debug(this.engine, 'element at click', await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return el ? el.tagName + '#' + el.id + ' vp ' + innerWidth + 'x' + innerHeight : 'none' }, { x: e.x, y: e.y }).catch((err) => String(err)))
        return page.mouse.down({ button: e.button })
      case 'up':
        await this.moveTo(page, e.x, e.y)
        return page.mouse.up({ button: e.button })
      case 'wheel':
        await this.moveTo(page, e.x, e.y)
        return page.mouse.wheel(e.dx, e.dy)
      case 'keydown':
        return page.keyboard.down(e.key)
      case 'keyup':
        return page.keyboard.up(e.key)
    }
  }

  /** Test hook: run script in the page. */
  run(script: string): void {
    void this.page?.evaluate(script).catch(() => {})
  }

  destroy(): void {
    this.hide()
    this.window?.destroy()
    this.window = undefined
    this.hiddenWindow?.destroy()
    this.hiddenWindow = undefined
    const page = this.page
    this.page = undefined
    void page?.close().catch(() => {})
  }
}
