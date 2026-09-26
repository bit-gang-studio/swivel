import { app, WebContentsView, type BrowserWindow } from 'electron'
import type { LiveEvents, LiveOptions, ViewRect } from '../shared/types'

type Emit = <K extends keyof LiveEvents>(event: K, payload: LiveEvents[K]) => void

const LEVELS = { debug: 'debug', info: 'log', warning: 'warning', error: 'error' } as const

/**
 * Chrome shown natively: Electron's own Chromium in a view laid over the page area.
 * No streaming, so it is as fast as a real browser. Viewport size, scaling and dark
 * mode use the DevTools protocol (Electron's device emulation under test runners).
 */
export class NativeChrome {
  private view?: WebContentsView
  private opts?: LiveOptions
  private rect?: ViewRect
  /** Electron crashes if device emulation is enabled before the view has committed a page. */
  private committed = false
  private blank: Promise<void> = Promise.resolve()
  private win: BrowserWindow
  private emit: Emit

  constructor(win: BrowserWindow, emit: Emit) {
    this.win = win
    this.emit = emit
  }

  private create(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: { partition: 'swivel-chrome', sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    const wc = view.webContents
    wc.on('console-message', (e) => this.emit('console', { engine: 'chromium', type: LEVELS[e.level] ?? 'log', text: e.message }))
    wc.on('did-start-loading', () => this.emit('loading', true))
    wc.on('did-stop-loading', () => this.emit('loading', false))
    wc.on('did-navigate', (_e, url) => {
      if (url === 'about:blank') return
      this.emit('url', url)
      void this.applyEmulation() // Reapply in case navigation swapped renderer processes.
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => isMainFrame && this.emit('url', url))
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.emit('error', `${desc} (${url})`) // -3 is an aborted load
    })
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

  async start(opts: LiveOptions): Promise<void> {
    const view = (this.view ??= this.create())
    const sameUrl = this.opts?.url === opts.url
    this.opts = opts
    await this.blank
    await this.applyEmulation()
    view.setVisible(!!this.rect)
    if (!sameUrl || view.webContents.getURL() === 'about:blank') this.load(opts.url)
  }

  private load(url: string): void {
    this.view?.webContents.loadURL(url).catch(() => {}) // failures arrive through did-fail-load
  }

  async navigate(url: string): Promise<void> {
    if (!this.opts) return
    this.opts = { ...this.opts, url }
    await this.blank
    this.load(url)
  }

  async history(action: 'back' | 'forward' | 'reload'): Promise<void> {
    const wc = this.view?.webContents
    if (!wc) return
    if (action === 'back') wc.navigationHistory.goBack()
    else if (action === 'forward') wc.navigationHistory.goForward()
    else wc.reload()
  }

  /** Where the page area is in the window, in window pixels. Sent by the UI when layout changes. */
  async setRect(rect: ViewRect): Promise<void> {
    this.rect = rect
    if (!this.view) return
    this.view.setBounds(this.bounds(rect))
    await this.applyEmulation()
    if (this.opts) this.view.setVisible(true)
  }

  private bounds(rect: ViewRect) {
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  }

  private async applyEmulation(): Promise<void> {
    const wc = this.view?.webContents
    if (!wc || !this.opts || !this.committed || wc.isDestroyed()) return
    const { viewport, colorScheme } = this.opts
    const scale = this.rect ? this.rect.width / viewport.width : 1
    const mobile = viewport.width < 600

    // Prefer the DevTools protocol: its overrides survive navigations, so pages never see the
    // wrong size or colour scheme, even for a moment. Attaching it while a test runner is
    // connected over remote debugging crashes Electron, so tests use Electron's emulation.
    if (!wc.debugger.isAttached() && !app.commandLine.hasSwitch('remote-debugging-port')) {
      try {
        wc.debugger.attach('1.3')
      } catch {
        // Attached elsewhere.
      }
    }
    if (wc.debugger.isAttached()) {
      const send = (method: string, params: object) =>
        Promise.race([wc.debugger.sendCommand(method, params).catch(() => {}), new Promise((r) => setTimeout(r, 1000))])
      await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 0, mobile, scale })
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] })
    } else {
      wc.enableDeviceEmulation({
        screenPosition: mobile ? 'mobile' : 'desktop',
        screenSize: viewport,
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 0,
        viewSize: viewport,
        scale
      })
    }
  }

  /** Hide without unloading, so switching back is instant. */
  stop(): void {
    this.view?.setVisible(false)
  }

  destroy(): void {
    if (!this.view) return
    this.win.contentView.removeChildView(this.view)
    this.view.webContents.close()
    this.view = undefined
  }
}
