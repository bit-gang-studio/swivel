import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserType, type Page } from 'playwright-core'
import type { EngineId, InputEvent, LiveEvents, LiveOptions } from '../shared/types'
import { FrameSource } from './frames'

const types: Record<EngineId, BrowserType> = { chromium, firefox, webkit }
const browsers = new Map<EngineId, Promise<Browser>>()

function getBrowser(engine: EngineId): Promise<Browser> {
  let browser = browsers.get(engine)
  if (!browser) {
    browser = types[engine].launch({ headless: true })
    browser.catch(() => browsers.delete(engine))
    browsers.set(engine, browser)
  }
  return browser
}

/** Start every engine in the background so the first switch is fast and warmed up. */
export function prewarmBrowsers(): void {
  for (const engine of Object.keys(types) as EngineId[]) {
    void getBrowser(engine)
      .then(async (browser) => {
        const page = await browser.newPage()
        const end = Date.now() + 3000
        while (Date.now() < end) await page.screenshot({ type: 'jpeg', quality: 80 })
        await page.close()
      })
      .catch(() => {})
  }
}

export async function closeAllBrowsers(): Promise<void> {
  const all = await Promise.allSettled(browsers.values())
  browsers.clear()
  await Promise.all(all.map((b) => (b.status === 'fulfilled' ? b.value.close() : undefined)))
}

type Emit = <K extends keyof LiveEvents>(event: K, payload: LiveEvents[K]) => void

/** Resolve with the fallback if a browser call takes too long, so one stuck call never freezes the app. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))])
}

const INPUT_TIMEOUT = 1000
const message = (err: unknown) => (err instanceof Error ? err.message.split('\n')[0] : String(err))
// Errors from a navigation that a newer one replaced. Not worth showing.
const superseded = (err: unknown) => /interrupted by another navigation|NS_BINDING_ABORTED|Navigation.*aborted|frame was detached|Target.*closed|has been closed/i.test(message(err))

/**
 * One live, clickable page. Frames stream out through FrameSource and
 * mouse/keyboard input is replayed into the page.
 */
export class LiveSession {
  private context?: BrowserContext
  private page?: Page
  private frames?: FrameSource
  private opts?: LiveOptions
  private generation = 0
  private emit: Emit
  /** Resolves once the current page exists. Never waits for a page to finish loading. */
  private ready: Promise<void> = Promise.resolve()

  constructor(emit: Emit) {
    this.emit = emit
  }

  start(opts: LiveOptions): Promise<void> {
    this.ready = this.open(opts)
    return this.ready
  }

  private async open(opts: LiveOptions): Promise<void> {
    const gen = ++this.generation
    const scrollY = this.opts && this.opts.url === opts.url && this.page ? await within(this.page.evaluate(() => window.scrollY), 300, 0) : 0
    this.stop()
    this.opts = opts
    try {
      const browser = await getBrowser(opts.engine)
      if (gen !== this.generation) return
      const context = await browser.newContext({ viewport: opts.viewport, colorScheme: opts.colorScheme })
      if (gen !== this.generation) return void context.close().catch(() => {})
      const page = await context.newPage()
      this.context = context
      this.page = page

      page.on('console', (msg) => this.emit('console', { engine: opts.engine, type: msg.type(), text: msg.text() }))
      page.on('pageerror', (err) => this.emit('console', { engine: opts.engine, type: 'error', text: err.message }))
      page.on('request', (req) => {
        if (req.isNavigationRequest() && req.frame() === page.mainFrame()) this.emit('loading', true)
      })
      page.on('load', () => this.emit('loading', false))
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) this.emit('url', frame.url())
        this.frames?.wake()
      })

      this.frames = new FrameSource(page, opts.engine, opts.viewport, (f) => {
        if (gen === this.generation) this.emit('frame', { engine: opts.engine, data: new Uint8Array(f.data), width: f.width, height: f.height })
      })
      await this.frames.start()
      void this.load(page, () => page.goto(opts.url, { waitUntil: 'load', timeout: 30_000 })).then(async () => {
        if (scrollY && gen === this.generation) await within(page.evaluate((y) => window.scrollTo(0, y), scrollY), 1000, undefined)
      })
    } catch (err) {
      if (gen === this.generation) this.emit('error', message(err))
    }
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

  async navigate(url: string): Promise<void> {
    await this.ready
    const page = this.page
    if (!page || !this.opts) return
    this.opts = { ...this.opts, url }
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

  /** Close the current page without waiting, so switching engines is instant. */
  stop(): void {
    this.frames?.stop()
    this.frames = undefined
    this.pending = []
    this.mouseAt = { x: -1, y: -1 }
    const context = this.context
    this.context = undefined
    this.page = undefined
    void context?.close().catch(() => {})
  }
}
