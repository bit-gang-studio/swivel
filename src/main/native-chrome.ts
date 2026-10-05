import { app, WebContentsView, type BrowserWindow } from 'electron'
import type { Credentials, EngineId, InputEvent, LiveOptions, ViewRect } from '../shared/types'
import type { Asker, Emit, PageView } from './view'
import type { FindRequest } from '../shared/find'
import { log } from './log'
import { mobileDensity } from './mobile'


const LEVELS = { debug: 'debug', info: 'log', warning: 'warning', error: 'error' } as const

/**
 * Chrome shown natively: Electron's own Chromium in a view laid over the page area.
 * No streaming, so it is as fast as a real browser. The view fits the page area and device
 * emulation makes the page lay out at the viewport size. Dark mode uses the DevTools protocol.
 */
export class NativeChrome implements PageView {
  readonly engine: EngineId = 'chromium'
  private view?: WebContentsView
  private opts?: LiveOptions
  private rect?: ViewRect
  /** Electron crashes if device emulation is enabled before the view has committed a page. */
  private committed = false
  private blank: Promise<void> = Promise.resolve()
  private active = false
  private win: BrowserWindow
  private emit: Emit

  private partition: string

  private ask: Asker
  /** The sign-in this view last used per site, to tell a refused one from a first request. */
  private triedAuth = new Map<string, Credentials>()

  constructor(win: BrowserWindow, emit: Emit, partition: string, ask: Asker) {
    this.partition = partition
    this.ask = ask
    this.win = win
    this.emit = emit
  }

  private create(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        partition: this.partition, // This window's own storage, in memory only.
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    const wc = view.webContents
    // Identify as plain Chrome: Electron adds "Electron/x" and the app's name, and sites that check
    // the user agent would treat the page differently from real Chrome.
    // Mobile mode: a phone's or tablet's browser ID instead (set before the first page loads).
    wc.setUserAgent(this.opts?.mobile?.userAgent ?? wc.getUserAgent().replace(/\s(?:Electron|swivel)\/\S+/gi, ''))
    wc.on('console-message', (e) => this.emit('console', { engine: 'chromium', type: LEVELS[e.level] ?? 'log', text: e.message.replace(/%c/g, '') }))
    wc.on('did-start-loading', () => this.emit('loading', true))
    wc.on('did-stop-loading', () => this.emit('loading', false))
    wc.on('did-navigate', (_e, url) => {
      if (url === 'about:blank') return
      if (this.opts) this.opts = { ...this.opts, url } // Where it really is, so updates don't reload it.
      this.emit('url', url)
      this.lastScale = undefined // A new page may be a new renderer, which starts without it.
      void this.applyEmulation() // Reapply in case navigation swapped renderer processes.
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return
      if (this.opts) this.opts = { ...this.opts, url }
      this.emit('url', url)
    })
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.emit('error', `${desc} (${url})`) // -3 is an aborted load
    })
    // A browser would show a sign-in box or a certificate warning here; the window asks once
    // for all its views.
    wc.on('login', (event, _details, authInfo, callback) => {
      event.preventDefault()
      // Named like the address bar would: no default port (the other engines name it the same way).
      const site = authInfo.port === 80 || authInfo.port === 443 ? authInfo.host : `${authInfo.host}:${authInfo.port}`
      void this.ask.credentials(site, this.triedAuth.get(site)).then((c) => {
        if (!c) return callback()
        this.triedAuth.set(site, c)
        callback(c.username, c.password)
      })
    })
    wc.on('certificate-error', (event, url, error, _certificate, callback) => {
      event.preventDefault()
      void this.ask.trust(new URL(url).host, error).then(callback)
    })
    wc.on('found-in-page', (_e, r) => this.emit('find', { matches: r.matches, active: r.activeMatchOrdinal }))
    wc.setWindowOpenHandler(({ url }) => {
      void wc.loadURL(url)
      return { action: 'deny' }
    })
    view.setVisible(false) // Until it's placed.
    this.win.contentView.addChildView(view)
    // Commit a blank page first, so emulation (size, dark mode) is in place before real content runs.
    const blank = wc.loadURL('about:blank').catch(() => {})
    this.blank = Promise.race([blank, new Promise<void>((r) => setTimeout(r, 2000))]).then(() => {
      this.committed = true
    })
    return view
  }

  /** The latest update(). Navigation waits for it, so a startup load can't replace a typed URL. */
  private starting: Promise<void> = Promise.resolve()

  update(opts: LiveOptions): Promise<void> {
    // One at a time: a quick size-only update must not finish (and let a navigation through)
    // while an earlier update is still about to load its page.
    this.starting = this.starting.catch(() => {}).then(() => this.open(opts))
    return this.starting
  }

  show(): void {
    this.active = true
    log('blink show', { view: !!this.view, rect: this.rect && this.bounds(this.rect), cut: this.cut })
    this.place()
  }

  hide(): void {
    this.active = false
    this.place()
  }

  input(_e: InputEvent): void {
    // Native: the OS delivers input directly.
  }

  private async open(opts: LiveOptions): Promise<void> {
    const sameUrl = this.opts?.url === opts.url
    // Only the size changed: just the scale, no DevTools round trip.
    if (this.view && this.opts && sameUrl && this.opts.colorScheme === opts.colorScheme) {
      this.opts = opts
      return this.applyScale()
    }
    this.opts = opts
    const view = (this.view ??= this.create())
    this.place()
    log('blink open', opts.url.slice(0, 50), opts.viewport, { rect: this.rect && this.bounds(this.rect), scale: this.scale() })
    await this.blank
    await this.applyEmulation()
    if (!sameUrl || view.webContents.getURL() === 'about:blank') this.load(opts.url)
  }

  private load(url: string): void {
    this.view?.webContents.loadURL(url).catch(() => {}) // failures arrive through did-fail-load
  }

  async navigate(url: string): Promise<void> {
    await this.starting
    if (!this.opts) return
    this.opts = { ...this.opts, url }
    this.load(url)
  }

  async history(action: 'back' | 'forward' | 'reload'): Promise<void> {
    await this.starting
    const wc = this.view?.webContents
    if (!wc) return
    if (action === 'back') wc.navigationHistory.goBack()
    else if (action === 'forward') wc.navigationHistory.goForward()
    else wc.reload()
  }

  /** Chrome's own find: highlights every match, like the real browser. */
  async find(req: FindRequest): Promise<void> {
    const wc = this.view?.webContents
    if (!wc) return
    if (!req.text) {
      wc.stopFindInPage('clearSelection')
      this.emit('find', { matches: 0, active: 0 })
      return
    }
    wc.findInPage(req.text, { forward: !req.backwards, findNext: req.restart })
  }

  /** Where the page area is in the window, in window pixels. Sent by the UI when layout changes. */
  async setRect(rect: ViewRect): Promise<void> {
    if (rect.width < 1 || rect.height < 1) return // Mid-layout; a page can't be 0 pixels wide.
    // Moving (a canvas pan) keeps the scale; a new size only needs the scale reapplied.
    const resized = !this.rect || Math.abs(rect.width - this.rect.width) > 0.5
    const first = !this.rect
    this.rect = rect
    if (!this.view) return
    this.place()
    if (first) await this.applyEmulation()
    else if (resized) this.applyScale()
    this.updateCut()
  }

  /**
   * Partly outside its clip area (a canvas frame under the toolbar)? Electron doesn't clip a
   * view on macOS, so it's swapped for a still image of itself, which the UI clips, until it's
   * fully in view again.
   */
  private cut = false
  /** The still image for this cut is up; the live view can leave the screen. */
  private snapped = false

  /**
   * Put the view where it belongs. A view that isn't to be seen (hidden, cut off, or too small
   * to draw) is parked above the window at its full size, never hidden: a hidden view tells
   * its page the window is 0 pixels wide, and the page lays itself out again for that.
   */
  private place(): void {
    if (!this.view || !this.rect) return
    const b = this.bounds(this.rect)
    const onScreen = this.active && (!this.cut || !this.snapped)
    this.view.setBounds(onScreen ? b : { ...b, y: -(b.height + 2000) })
    this.view.setVisible(true)
  }
  private updateCut(): void {
    const r = this.rect
    const c = r?.clip
    // Only edges inside the window count: the window's own edges already cut native views off.
    const w = this.win.getContentBounds()
    const cut =
      (!!r &&
        !!c &&
        ((c.x > 0.5 && r.x < c.x - 0.5) ||
          (c.y > 0.5 && r.y < c.y - 0.5) ||
          (c.x + c.width < w.width - 0.5 && r.x + r.width > c.x + c.width + 0.5) ||
          (c.y + c.height < w.height - 0.5 && r.y + r.height > c.y + c.height + 0.5)))
    if (cut !== this.cut) {
      log('blink cut', cut, { rect: r && this.bounds(r), clip: c, window: { width: w.width, height: w.height } })
      this.cut = cut
      this.snapped = false
      if (cut) void this.swapForSnapshot()
      else this.emit('snapshot', null)
    }
    this.place()
  }

  private async swapForSnapshot(): Promise<void> {
    // Let a new size or scale paint first, or the image shows the old layout.
    await new Promise((r) => setTimeout(r, 100))
    if (!this.cut) return
    const image = await this.view?.webContents.capturePage().catch(() => undefined)
    if (!this.cut) return
    if (image && !image.isEmpty()) this.emit('snapshot', image.toDataURL())
    this.snapped = true
    this.place()
  }

  private scale(): number {
    return this.rect && this.opts ? this.rect.width / this.opts.viewport.width : 1
  }

  private bounds(rect: ViewRect) {
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  }

  private lastScale?: string

  /**
   * The page lays out at exactly the viewport size and is drawn scaled to fit the view, with
   * Chromium's device emulation (what DevTools' device toolbar uses). It belongs to this view
   * alone: page zoom, used before, is shared by every view of a site in a window, so frames of
   * different sizes overwrote each other's.
   */
  private applyScale(): void {
    const wc = this.view?.webContents
    if (!wc || !this.rect || !this.opts || !this.committed || wc.isDestroyed()) return
    const { width, height } = this.opts.viewport
    const scale = this.scale()
    const mobile = this.opts.mobile
    const key = `${width}x${height}@${scale}${mobile ? ':' + mobile.kind : ''}`
    if (key === this.lastScale) return
    this.lastScale = key
    log('blink scale', key)
    // Mobile mode: the page is laid out as on a phone (its viewport tag is honoured) at the
    // device's screen density.
    wc.enableDeviceEmulation({ screenPosition: mobile ? 'mobile' : 'desktop', screenSize: { width, height }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: mobile ? mobileDensity(mobile.kind) : 0, viewSize: { width, height }, scale })
  }

  private async applyEmulation(): Promise<void> {
    const wc = this.view?.webContents
    if (!wc || !this.opts || !this.committed || wc.isDestroyed()) return
    const { colorScheme } = this.opts

    this.applyScale()

    // Dark mode needs the DevTools protocol. Attaching it while a test runner is connected over
    // remote debugging crashes Electron, so it is skipped then.
    if (!wc.debugger.isAttached() && !app.commandLine.hasSwitch('remote-debugging-port')) {
      try {
        wc.debugger.attach('1.3')
      } catch {
        // Attached elsewhere.
      }
    }
    if (wc.debugger.isAttached() && this.opts.mobile) {
      // Mobile mode: touch input, with the mouse acting as a finger.
      void wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }).catch(() => {})
      void wc.debugger.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }).catch(() => {})
    }
    if (wc.debugger.isAttached()) {
      await Promise.race([
        wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] }).catch(() => {}),
        new Promise((r) => setTimeout(r, 1000))
      ])
    }
  }

  /** Test hook: run script in the page. */
  run(script: string): void {
    void this.view?.webContents.executeJavaScript(script).catch(() => {})
  }

  /** Test hook: input as the OS would send it, at page coordinates (CSS pixels of the page). */
  async testInput(events: Record<string, unknown>[]): Promise<void> {
    const wc = this.view?.webContents
    if (!wc) return
    const scale = this.scale()
    for (const e of events) {
      const event = { ...e }
      if (typeof event.x === 'number' && typeof event.y === 'number') Object.assign(event, { x: Math.round(event.x * scale), y: Math.round(event.y * scale) })
      wc.sendInputEvent(event as unknown as Electron.MouseInputEvent)
      await new Promise((r) => setTimeout(r, 30))
    }
  }

  destroy(): void {
    if (!this.view) return
    this.win.contentView.removeChildView(this.view)
    this.view.webContents.close()
    this.view = undefined
  }
}
