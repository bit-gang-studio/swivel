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
    this.starting = this.open(opts)
    return this.starting
  }

  show(): void {
    this.active = true
    if (this.view && this.rect) this.view.setVisible(true)
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
    this.opts = opts
    const view = (this.view ??= this.create())
    this.active = true
    await this.blank
    await this.applyEmulation()
    if (!sameUrl || view.webContents.getURL() === 'about:blank') this.load(opts.url)
  }

  private load(url: string): void {
    this.view?.webContents.loadURL(url).catch(() => {}) // failures arrive through did-fail-load
  }

  async navigate(url: string): Promise<void> {
    if (!this.opts) return
    await this.starting
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
    this.rect = rect
    if (!this.view) return
    this.view.setBounds(this.bounds(rect))
    await this.applyEmulation()
    if (this.opts && this.active) this.view.setVisible(true)
  }

  private scale(): number {
    return this.rect && this.opts ? this.rect.width / this.opts.viewport.width : 1
  }

  private bounds(rect: ViewRect) {
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  }

  private async applyEmulation(): Promise<void> {
    const wc = this.view?.webContents
    if (!wc || !this.opts || !this.committed || wc.isDestroyed()) return
    const { colorScheme } = this.opts

    // The view is sized to fit the page area; zoom makes the page lay out at the viewport width.
    // (A DevTools size override draws at full size and spills outside the view, so it's not used.)
    // Zoom is per origin, so this is reapplied after every navigation.
    if (this.rect) wc.setZoomFactor(this.scale())

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
