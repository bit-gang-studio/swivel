import { createHash } from 'node:crypto'
import type { Page } from 'playwright-core'

// Kept free of TypeScript-only syntax so scripts/bench-live.mjs can import it with Node's type stripping.

export interface RawFrame {
  data: Buffer
  width: number
  height: number
}

const FRAME_MS = 1000 / 60
const IDLE_MS = 100
const IDLE_AFTER = 30 // unchanged frames before slowing down

/**
 * Streams frames from a page until stopped.
 *
 * Chromium: page.screencast, which already runs at 60 fps.
 * Firefox and WebKit: their screencast is capped near 25 fps, but screenshots are fast,
 * so poll screenshots at up to 60 fps, drop duplicates, and slow down while the page is idle.
 */
export class FrameSource {
  private stopped = false
  private unchanged = 0
  private wakeTimer?: () => void

  private page: Page
  private engine: string
  private size: { width: number; height: number }
  private onFrame: (f: RawFrame) => void

  constructor(page: Page, engine: string, size: { width: number; height: number }, onFrame: (f: RawFrame) => void) {
    this.page = page
    this.engine = engine
    this.size = size
    this.onFrame = onFrame
  }

  async start(): Promise<void> {
    if (this.engine === 'chromium') {
      await this.page.screencast.start({
        size: this.size,
        quality: 80,
        onFrame: (f) => {
          if (!this.stopped) this.onFrame({ data: f.data, width: f.viewportWidth, height: f.viewportHeight })
        }
      })
    } else {
      void this.poll()
    }
  }

  /** Call on user input so an idle page goes back to full speed at once. */
  wake(): void {
    this.unchanged = 0
    this.wakeTimer?.()
  }

  stop(): void {
    this.stopped = true
    this.wakeTimer?.()
    if (this.engine === 'chromium') void this.page.screencast.stop().catch(() => {})
  }

  private async poll(): Promise<void> {
    let last = ''
    while (!this.stopped) {
      const started = performance.now()
      try {
        const data = await this.page.screenshot({ type: 'jpeg', quality: 80, scale: 'css', animations: 'allow', caret: 'initial', timeout: 1500 })
        const hash = createHash('md5').update(data).digest('hex')
        if (hash !== last) {
          last = hash
          this.unchanged = 0
          if (!this.stopped) this.onFrame({ data, ...this.size })
        } else {
          this.unchanged++
        }
      } catch {
        // The page is mid-load and can't paint yet, or it closed. Keep the last frame and retry soon.
      }
      const wait = this.unchanged >= IDLE_AFTER ? IDLE_MS : FRAME_MS - (performance.now() - started)
      if (wait > 0) await this.sleep(wait)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms)
      function done() {
        clearTimeout(timer)
        resolve()
      }
      this.wakeTimer = () => {
        this.wakeTimer = undefined
        done()
      }
    })
  }
}
