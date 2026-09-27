import { createHash } from 'node:crypto'
import type { Page } from 'playwright-core'

// Kept free of TypeScript-only syntax so scripts/bench-live.mjs can import it with Node's type stripping.

export interface RawFrame {
  data: Buffer
  format: 'png' | 'jpeg'
  width: number
  height: number
}

/** Lossless PNG while it's quick enough (sharp text); high-quality JPEG when a page makes PNG slow. */
const PNG_BUDGET_MS = 25
const PNG_RETRY_MS = 3000
/** Above this per-frame cost, screenshots can't keep up (heavy pages): use the engine's screencast. */
const CAST_AFTER_MS = 35
/** In screencast mode, once no frame has come for this long, send one lossless full-resolution frame. */
const SETTLE_MS = 180

const FRAME_MS = 1000 / 60
const IDLE_MS = 100
const IDLE_AFTER = 30 // unchanged frames before slowing down

/**
 * Streams frames from a page until stopped.
 *
 * Chromium: page.screencast, which already runs at 60 fps.
 * Firefox and WebKit: their screencast is capped near 25 fps, but screenshots are fast,
 * so poll screenshots at up to 60 fps, drop duplicates, and slow down while the page is idle.
 * Frames are lossless PNG when that keeps up, so text stays crisp, and JPEG otherwise.
 * On heavy pages screenshots can't keep up (each forces a fresh render), so it switches to the
 * engine's screencast, which reuses frames already drawn (a steady ~22 fps even at 2x), and sends
 * one lossless frame whenever the page settles. A navigation resets to screenshots.
 */
export class FrameSource {
  private stopped = false
  private unchanged = 0
  private wakeTimer?: () => void

  private page: Page
  private engine: string
  private size: { width: number; height: number }
  private pixelRatio: number
  private onFrame: (f: RawFrame) => void
  private casting = false
  private settleTimer?: ReturnType<typeof setTimeout>

  constructor(page: Page, engine: string, size: { width: number; height: number }, onFrame: (f: RawFrame) => void, pixelRatio = 1) {
    this.page = page
    this.engine = engine
    this.size = size
    this.onFrame = onFrame
    this.pixelRatio = pixelRatio
  }

  /** A new page loaded: its cost is unknown, so go back to screenshots. */
  reset(): void {
    if (!this.casting || this.stopped) return
    this.casting = false
    clearTimeout(this.settleTimer)
    void this.page.screencast.stop().catch(() => {})
    void this.poll()
  }

  private async cast(): Promise<void> {
    this.casting = true
    let lastCast = ''
    const device = { width: Math.round(this.size.width * this.pixelRatio), height: Math.round(this.size.height * this.pixelRatio) }
    await this.page.screencast
      .start({
        size: device,
        quality: 90,
        onFrame: (f) => {
          if (this.stopped || !this.casting) return
          // Firefox's screencast keeps sending frames while nothing changes; skip repeats, so
          // the page counts as settled once the picture actually stops changing.
          const hash = createHash('md5').update(f.data).digest('hex')
          if (hash === lastCast) return
          lastCast = hash
          this.onFrame({ data: f.data, format: 'jpeg', ...this.size })
          clearTimeout(this.settleTimer)
          this.settleTimer = setTimeout(() => void this.settle(), SETTLE_MS)
        }
      })
      .catch(() => {
        this.casting = false
        void this.poll()
      })
  }

  /** The page stopped changing: send one lossless full-resolution frame so text is pixel-sharp. */
  private async settle(): Promise<void> {
    if (this.stopped || !this.casting) return
    try {
      const data = await this.page.screenshot({ type: 'png', scale: 'device', animations: 'allow', caret: 'initial', timeout: 1500 })
      if (!this.stopped && this.casting) this.onFrame({ data, format: 'png', ...this.size })
    } catch {
      // Page busy or navigating; the next frame will do.
    }
  }

  async start(): Promise<void> {
    if (this.engine === 'chromium') {
      await this.page.screencast.start({
        size: this.size,
        quality: 80,
        onFrame: (f) => {
          if (!this.stopped) this.onFrame({ data: f.data, format: 'jpeg', width: f.viewportWidth, height: f.viewportHeight })
        }
      })
    } else {
      void this.poll()
    }
  }

  /** New viewport size: frames come out at this size from now on. */
  async setSize(size: { width: number; height: number }): Promise<void> {
    this.size = size
    this.wake()
    if (this.casting && !this.stopped) {
      await this.page.screencast.stop().catch(() => {})
      await this.cast()
    } else if (this.engine === 'chromium' && !this.stopped) {
      await this.page.screencast.stop().catch(() => {})
      await this.start()
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
    clearTimeout(this.settleTimer)
    if (this.engine === 'chromium' || this.casting) void this.page.screencast.stop().catch(() => {})
  }

  private async poll(): Promise<void> {
    let last = ''
    let format: 'png' | 'jpeg' = 'png'
    let pngCost = 0 // Smoothed milliseconds per PNG frame.
    let jpegSince = 0
    let cost = 0 // Smoothed milliseconds per frame, any format.
    while (!this.stopped && !this.casting) {
      const started = performance.now()
      if (format === 'jpeg' && started - jpegSince > PNG_RETRY_MS) format = 'png' // The page may be lighter now.
      try {
        const data = await this.page.screenshot({
          ...(format === 'png' ? { type: 'png' as const } : { type: 'jpeg' as const, quality: 90 }),
          scale: 'device',
          animations: 'allow',
          caret: 'initial',
          timeout: 1500
        })
        const took = performance.now() - started
        cost = cost ? cost * 0.5 + took * 0.5 : took
        if (cost > CAST_AFTER_MS) {
          // Screenshots can't keep up on this page: switch to the screencast straight away.
          if (!this.stopped) this.onFrame({ data, format: data[0] === 0x89 ? 'png' : 'jpeg', ...this.size })
          void this.cast()
          return
        }
        if (format === 'png') {
          pngCost = pngCost ? pngCost * 0.7 + took * 0.3 : took
          if (pngCost > PNG_BUDGET_MS) {
            format = 'jpeg'
            jpegSince = performance.now()
            pngCost = 0
          }
        }
        const hash = createHash('md5').update(data).digest('hex')
        if (hash !== last) {
          last = hash
          this.unchanged = 0
          const frameFormat = data[0] === 0x89 ? 'png' : 'jpeg'
          if (!this.stopped) this.onFrame({ data, format: frameFormat, ...this.size })
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
