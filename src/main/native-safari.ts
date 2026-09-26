import { createRequire } from 'node:module'
import type { BrowserWindow } from 'electron'
import type { LiveEvents, LiveOptions, ViewRect, Viewport } from '../shared/types'

type Emit = <K extends keyof LiveEvents>(event: K, payload: LiveEvents[K]) => void

interface Addon {
  create(parent: Buffer, onEvent: (type: string, a: string, b: string) => void): number
  setFrame(id: number, x: number, y: number, w: number, h: number, vw: number, vh: number): void
  load(id: number, url: string): void
  history(id: number, action: string): void
  setHidden(id: number, hidden: boolean): void
  setDark(id: number, dark: boolean): void
  evaluate(id: number, script: string): void
  destroy(id: number): void
}

/** The WKWebView addon. Null off macOS or if it didn't build; Safari is then streamed. */
export const webkitAddon: Addon | null = (() => {
  try {
    return createRequire(import.meta.url)('swivel-webkit-view') as Addon | null
  } catch {
    return null
  }
})()

/**
 * Safari shown natively on macOS: Apple's WKWebView, the engine Safari itself uses, placed in
 * the window over the page area. Real-time, and it is real Safari rather than Playwright's WebKit.
 */
export class NativeSafari {
  private id?: number
  private opts?: LiveOptions
  private rect?: ViewRect
  private win: BrowserWindow
  private emit: Emit
  private addon: Addon
  private active = false

  constructor(win: BrowserWindow, emit: Emit, addon: Addon) {
    this.win = win
    this.emit = emit
    this.addon = addon
  }

  private create(): number {
    return this.addon.create(this.win.getNativeWindowHandle(), (type, a, b) => {
      if (type === 'console') this.emit('console', { engine: 'webkit', type: a, text: b })
      else if (type === 'loading') this.emit('loading', a === '1')
      else if (type === 'url') this.emit('url', a)
      else if (type === 'error') this.emit('error', a)
    })
  }

  async start(opts: LiveOptions): Promise<void> {
    const id = (this.id ??= this.create())
    const sameUrl = this.opts?.url === opts.url
    this.opts = opts
    this.active = true
    this.addon.setDark(id, opts.colorScheme === 'dark')
    this.layout()
    if (!sameUrl) this.addon.load(id, opts.url)
  }

  async navigate(url: string): Promise<void> {
    if (this.id === undefined || !this.opts) return
    this.opts = { ...this.opts, url }
    this.addon.load(this.id, url)
  }

  async history(action: 'back' | 'forward' | 'reload'): Promise<void> {
    if (this.id !== undefined) this.addon.history(this.id, action)
  }

  async resize(viewport: Viewport): Promise<void> {
    if (!this.opts) return
    this.opts = { ...this.opts, viewport }
    this.layout()
  }

  async setRect(rect: ViewRect): Promise<void> {
    this.rect = rect
    this.layout()
  }

  private layout(): void {
    if (this.id === undefined || !this.opts || !this.rect) return
    const { x, y, width, height } = this.rect
    this.addon.setFrame(this.id, x, y, width, height, this.opts.viewport.width, this.opts.viewport.height)
    this.addon.setHidden(this.id, !this.active)
  }

  /** Test hook. */
  evaluate(script: string): void {
    if (this.id !== undefined) this.addon.evaluate(this.id, script)
  }

  stop(): void {
    this.active = false
    if (this.id !== undefined) this.addon.setHidden(this.id, true)
  }

  destroy(): void {
    if (this.id === undefined) return
    this.addon.destroy(this.id)
    this.id = undefined
  }
}
