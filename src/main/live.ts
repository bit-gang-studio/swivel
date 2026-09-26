import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserType, type Page } from 'playwright-core'
import type { EngineId, InputEvent, LiveEvents, LiveOptions } from '../shared/types'

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

export async function closeAllBrowsers(): Promise<void> {
  const all = await Promise.allSettled(browsers.values())
  browsers.clear()
  await Promise.all(all.map((b) => (b.status === 'fulfilled' ? b.value.close() : undefined)))
}

type Emit = <K extends keyof LiveEvents>(event: K, payload: LiveEvents[K]) => void

/**
 * One live, clickable page. Frames stream out through page.screencast and
 * mouse/keyboard input is replayed into the page.
 */
export class LiveSession {
  private context?: BrowserContext
  private page?: Page
  private opts?: LiveOptions
  private generation = 0

  constructor(private emit: Emit) {}

  async start(opts: LiveOptions): Promise<void> {
    const gen = ++this.generation
    const scrollY = this.opts && this.opts.url === opts.url ? await this.scrollY() : 0
    await this.stop()
    this.opts = opts
    try {
      const browser = await getBrowser(opts.engine)
      if (gen !== this.generation) return
      const context = await browser.newContext({ viewport: opts.viewport, colorScheme: opts.colorScheme })
      const page = await context.newPage()
      this.context = context
      this.page = page

      page.on('console', (msg) => this.emit('console', { engine: opts.engine, type: msg.type(), text: msg.text() }))
      page.on('pageerror', (err) => this.emit('console', { engine: opts.engine, type: 'error', text: err.message }))
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) this.emit('url', frame.url())
      })

      await page.screencast.start({
        size: opts.viewport,
        quality: 80,
        onFrame: (f) => {
          if (gen === this.generation) {
            this.emit('frame', { engine: opts.engine, data: new Uint8Array(f.data), width: f.viewportWidth, height: f.viewportHeight })
          }
        }
      })
      await page.goto(opts.url, { waitUntil: 'load', timeout: 30_000 })
      if (scrollY) await page.evaluate((y) => window.scrollTo(0, y), scrollY)
    } catch (err) {
      if (gen === this.generation) this.emit('error', err instanceof Error ? err.message.split('\n')[0] : String(err))
    }
  }

  async navigate(url: string): Promise<void> {
    if (!this.page || !this.opts) return
    this.opts = { ...this.opts, url }
    try {
      await this.page.goto(url, { waitUntil: 'load', timeout: 30_000 })
    } catch (err) {
      this.emit('error', err instanceof Error ? err.message.split('\n')[0] : String(err))
    }
  }

  private queue: Promise<void> = Promise.resolve()

  /** Input is replayed strictly in order, so a mouse up never lands before its down. */
  input(e: InputEvent): Promise<void> {
    this.queue = this.queue.then(() => this.replay(e))
    return this.queue
  }

  private async replay(e: InputEvent): Promise<void> {
    const page = this.page
    if (!page) return
    try {
      switch (e.kind) {
        case 'move':
          return await page.mouse.move(e.x, e.y)
        case 'down':
          await page.mouse.move(e.x, e.y)
          return await page.mouse.down({ button: e.button })
        case 'up':
          await page.mouse.move(e.x, e.y)
          return await page.mouse.up({ button: e.button })
        case 'wheel':
          await page.mouse.move(e.x, e.y)
          return await page.mouse.wheel(e.dx, e.dy)
        case 'keydown':
          return await page.keyboard.down(e.key)
        case 'keyup':
          return await page.keyboard.up(e.key)
      }
    } catch {
      // Unknown keys or a page mid-navigation; drop the event.
    }
  }

  async history(action: 'back' | 'forward' | 'reload'): Promise<void> {
    const page = this.page
    if (!page) return
    try {
      if (action === 'back') await page.goBack()
      else if (action === 'forward') await page.goForward()
      else await page.reload()
    } catch (err) {
      this.emit('error', err instanceof Error ? err.message.split('\n')[0] : String(err))
    }
  }

  private async scrollY(): Promise<number> {
    try {
      return (await this.page?.evaluate(() => window.scrollY)) ?? 0
    } catch {
      return 0
    }
  }

  async stop(): Promise<void> {
    const context = this.context
    this.context = undefined
    this.page = undefined
    await context?.close().catch(() => {})
  }
}
