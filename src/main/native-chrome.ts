import { app, WebContentsView, type BrowserWindow } from 'electron'
import type { EngineId, InputEvent, LiveOptions, ViewRect } from '../shared/types'
import type { Emit, PageView } from './view'
import type { FindRequest } from '../shared/find'


const LEVELS = { debug: 'debug', info: 'log', warning: 'warning', error: 'error' } as const

/**
 * Chrome shown natively: Electron's own Chromium in a view laid over the page area.
 * No streaming, so it is as fast as a real browser. The view fits the page area and zoom makes
 * the page lay out at the viewport width. Dark mode uses the DevTools protocol.
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

  constructor(win: BrowserWindow, emit: Emit, partition: string) {
    this.partition = partition
    this.win = win
    this.emit = emit
  }

  private create(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        partition: this.partition, // The Swivel profile's own storage; logins survive restarts.
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Zoom is stored per site. This default means a site visited for the first time already
        // starts at the right scale, instead of reflowing once the zoom is reapplied.
        zoomFactor: this.scale()
      }
    })
    const wc = view.webContents
    // Identify as plain Chrome: Electron adds "Electron/x" and the app's name, and sites that check
    // the user agent would treat the page differently from real Chrome.
    wc.setUserAgent(wc.getUserAgent().replace(/\s(?:Electron|swivel)\/\S+/gi, ''))
    wc.on('console-message', (e) => this.emit('console', { engine: 'chromium', type: LEVELS[e.level] ?? 'log', text: e.message.replace(/%c/g, '') }))
    wc.on('did-start-loading', () => this.emit('loading', true))
    wc.on('did-stop-loading', () => this.emit('loading', false))
    wc.on('did-navigate', (_e, url) => {
      if (url === 'about:blank') return
      if (this.opts) this.opts = { ...this.opts, url } // Where it really is, so updates don't reload it.
      this.emit('url', url)
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
    wc.on('found-in-page', (_e, r) => this.emit('find', { matches: r.matches, active: r.activeMatchOrdinal }))
    wc.setWindowOpenHandler(({ url }) => {
      void wc.loadURL(url)
      return { action: 'deny' }
    })
    view.setVisible(false)
    this.win.contentView.addChildView(view)
    if (this.rect) view.setBounds(this.bounds(this.rect))
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
    if (this.view && this.rect && !this.cut) this.view.setVisible(true)
  }

  hide(): void {
    this.active = false
    this.view?.setVisible(false)
  }

  input(_e: InputEvent): void {
    // Native: the OS delivers input directly.
  }

  private async open(opts: LiveOptions): Promise<void> {
    const sameUrl = this.opts?.url === opts.url
    // Only the size changed (a window resize): just the zoom, no DevTools round trip.
    if (this.view && this.opts && sameUrl && this.opts.colorScheme === opts.colorScheme) {
      this.opts = opts
      return this.applyZoom()
    }
    this.opts = opts
    const view = (this.view ??= this.create())
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
    // Moving (a canvas pan) keeps the scale; a new size only needs the zoom reapplied.
    const resized = !this.rect || Math.abs(rect.width - this.rect.width) > 0.5
    const first = !this.rect
    this.rect = rect
    if (!this.view) return
    this.view.setBounds(this.bounds(rect))
    if (first) await this.applyEmulation()
    else if (resized) this.applyZoom()
    this.updateCut()
  }

  /**
   * Partly outside its clip area (a canvas frame under the toolbar)? A Chromium view can't be cut
   * off on macOS (Electron doesn't clip it), so it's swapped for a still image of itself, which
   * the UI clips, until it's fully in view again.
   */
  private cut = false

  private updateCut(): void {
    const r = this.rect
    const c = r?.clip
    // Only edges inside the window count: the window's own edges already cut native views off.
    const w = this.win.getContentBounds()
    const cut =
      !!r &&
      !!c &&
      ((c.x > 0.5 && r.x < c.x - 0.5) ||
        (c.y > 0.5 && r.y < c.y - 0.5) ||
        (c.x + c.width < w.width - 0.5 && r.x + r.width > c.x + c.width + 0.5) ||
        (c.y + c.height < w.height - 0.5 && r.y + r.height > c.y + c.height + 0.5))
    if (cut !== this.cut) {
      this.cut = cut
      if (cut) void this.swapForSnapshot()
      else this.emit('snapshot', null)
    }
    if (!cut && this.opts && this.active) this.view?.setVisible(true)
  }

  private async swapForSnapshot(): Promise<void> {
    // Let a new size or zoom paint first, or the image shows the old layout.
    await new Promise((r) => setTimeout(r, 100))
    if (!this.cut) return
    const image = await this.view?.webContents.capturePage().catch(() => undefined)
    if (!this.cut) return
    this.emit('snapshot', image && !image.isEmpty() ? image.toDataURL() : null)
    this.view?.setVisible(false)
  }

  private scale(): number {
    return this.rect && this.opts ? this.rect.width / this.opts.viewport.width : 1
  }

  private bounds(rect: ViewRect) {
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  }

  private applyZoom(): void {
    const wc = this.view?.webContents
    if (!wc || !this.rect || !this.committed || wc.isDestroyed()) return
    // Within a rounding error of 1 (window and page sizes arrive separately): stay at 1, so a
    // resize doesn't flicker the zoom.
    const scale = this.scale()
    wc.setZoomFactor(Math.abs(scale - 1) < 0.01 ? 1 : scale)
  }

  private async applyEmulation(): Promise<void> {
    const wc = this.view?.webContents
    if (!wc || !this.opts || !this.committed || wc.isDestroyed()) return
    const { colorScheme } = this.opts

    // The view is sized to fit the page area; zoom makes the page lay out at the viewport width.
    // (A DevTools size override draws at full size and spills outside the view, so it's not used.)
    // Zoom is per origin, so this is reapplied after every navigation.
    this.applyZoom()

    // Dark mode needs the DevTools protocol. Attaching it while a test runner is connected over
    // remote debugging crashes Electron, so it is skipped then.
    if (!wc.debugger.isAttached() && !app.commandLine.hasSwitch('remote-debugging-port')) {
      try {
        wc.debugger.attach('1.3')
      } catch {
        // Attached elsewhere.
      }
    }
    if (wc.debugger.isAttached()) {
      await Promise.race([
        wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] }).catch(() => {}),
        new Promise((r) => setTimeout(r, 1000))
      ])
    }
  }

  destroy(): void {
    if (!this.view) return
    this.win.contentView.removeChildView(this.view)
    this.view.webContents.close()
    this.view = undefined
  }
}
