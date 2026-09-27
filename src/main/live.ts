import { join } from 'node:path'
import { app, screen } from 'electron'
import { chromium, firefox, webkit, type BrowserContext, type BrowserType, type Page } from 'playwright-core'
import type { EngineId, InputEvent, LiveOptions, ViewRect } from '../shared/types'
import type { Emit, PageView } from './view'
import { FrameSource } from './frames'
import { findInPage, type FindRequest } from '../shared/find'

const types: Record<EngineId, BrowserType> = { chromium, firefox, webkit }
const contexts = new Map<EngineId, Promise<BrowserContext>>()

/**
 * One persistent context per engine, so logins and site data survive restarts. Each engine has
 * its own profile, like separate browsers. Falls back to a throwaway context if the profile is
 * locked (another Swivel window or instance is using it).
 */
function getContext(engine: EngineId): Promise<BrowserContext> {
  let context = contexts.get(engine)
  if (!context) {
    const options = { headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: screen.getPrimaryDisplay().scaleFactor }
    context = types[engine]
      .launchPersistentContext(join(app.getPath('userData'), 'profiles', engine), options)
      .catch(async () => (await types[engine].launch({ headless: true })).newContext(options))
    context.catch(() => contexts.delete(engine))
    contexts.set(engine, context)
  }
  return context
}

/** Start streamed engines in the background so the first switch is fast and warmed up. */
export function prewarmBrowsers(engines: EngineId[]): void {
  for (const engine of engines) {
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

  constructor(engine: EngineId, emit: Emit) {
    this.engine = engine
    this.emit = emit
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
    const context = await getContext(this.engine)
    const page = await context.newPage()
    this.page = page
    page.on('console', (msg) => this.emit('console', { engine: this.engine, type: msg.type(), text: msg.text() }))
    page.on('pageerror', (err) => this.emit('console', { engine: this.engine, type: 'error', text: err.message }))
    page.on('request', (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) this.emit('loading', true)
    })
    page.on('load', () => this.emit('loading', false))
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      this.loadedUrl = frame.url()
      this.emit('url', frame.url())
      this.frames?.wake()
    })
    if (this.visible) this.startFrames()
    return page
  }

  private startFrames(): void {
    const page = this.page
    if (!page || !this.opts || this.frames) return
    const frames = new FrameSource(page, this.engine, this.opts.viewport, (f) => {
      if (frames !== this.frames) return
      this.emit('frame', { engine: this.engine, data: new Uint8Array(f.data), format: f.format, width: f.width, height: f.height })
      // The page changed under the mouse (it loaded, or a hover effect ran), so the cursor may have too.
      if (this.mouseAt.x >= 0) this.probeCursor()
    })
    this.frames = frames
    void frames.start()
  }

  /** Stream frames. Hidden views keep their page but send nothing. */
  show(): void {
    this.visible = true
    this.startFrames()
  }

  hide(): void {
    this.visible = false
    this.frames?.stop()
    this.frames = undefined
    this.pending = []
    this.mouseAt = { x: -1, y: -1 }
    this.lastCursor = ''
  }

  async setRect(_rect: ViewRect): Promise<void> {
    // Streamed frames are drawn by the UI wherever it likes.
  }

  /** Run a navigation in the background and report real failures. */
  private async load(page: Page, go: () => Promise<unknown>): Promise<void> {
    this.emit('loading', true)
    try {
      await go()
    } catch (err) {
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
    await this.ready
    const page = this.page
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
        await this.moveTo(page, e.x, e.y)
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
    const page = this.page
    this.page = undefined
    void page?.close().catch(() => {})
  }
}
