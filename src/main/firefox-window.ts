import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { firefox, type BrowserContext, type Page } from 'playwright-core'
import type { ViewRect, Viewport } from '../shared/types'
import { webkitAddon } from './native-safari'
import { jugglerSession } from './frames'

/**
 * Real-window Firefox on macOS: a borderless Firefox window (from Swivel's patched copy, see
 * scripts/patch-firefox.mjs) sits behind Swivel's page area, and ScreenCaptureKit mirrors it into
 * a layer on top. It renders on the GPU at the display's refresh rate, like a normal browser.
 * Input still goes through Swivel's page area and Playwright. Needs the Screen Recording
 * permission; without it Firefox is streamed as before.
 */

interface MirrorAddon {
  screenCaptureAccess(): boolean
  requestScreenCaptureAccess(): boolean
  mirrorCreate(parent: Buffer, pid: number, width: number, height: number, cb: (err: string | null, id: number | null) => void): void
  mirrorSetFrame(id: number, x: number, y: number, w: number, h: number): void
  mirrorResizeSource(id: number, w: number, h: number): void
  mirrorSetHidden(id: number, hidden: boolean): void
  mirrorDestroy(id: number): void
}

const addon = webkitAddon as unknown as Partial<MirrorAddon> | null
const mirror: MirrorAddon | null = addon && typeof addon.mirrorCreate === 'function' ? (addon as MirrorAddon) : null

/** Path to Swivel's patched Firefox, if it's installed. */
function patchedFirefox(): string | null {
  if (process.platform !== 'darwin') return null
  const source = dirname(dirname(dirname(firefox.executablePath())))
  const revision = source.match(/firefox-(\d+)/)?.[1]
  if (!revision) return null
  const exe = join(homedir(), 'Library/Caches/swivel', `firefox-window-${revision}`, 'Nightly.app/Contents/MacOS/firefox')
  return existsSync(exe) ? exe : null
}

export type WindowedStatus = 'on' | 'needs-permission' | 'not-installed' | 'unsupported'

export function windowedFirefoxStatus(): WindowedStatus {
  if (process.platform !== 'darwin' || !mirror) return 'unsupported'
  if (!patchedFirefox()) return 'not-installed'
  if (!mirror.screenCaptureAccess()) return 'needs-permission'
  return process.env.SWIVEL_STREAM_FIREFOX ? 'unsupported' : 'on'
}

export function requestScreenRecording(): void {
  mirror?.requestScreenCaptureAccess()
}

/** Launch options for the windowed Firefox context. */
export function windowedLaunchOptions(viewport: Viewport) {
  return {
    headless: false,
    executablePath: patchedFirefox()!,
    viewport,
    firefoxUserPrefs: { 'swivel.chromeless': true }
  }
}

function firefoxPid(context: BrowserContext): number | undefined {
  try {
    const c = context as unknown as { _connection: { toImpl: (x: unknown) => { _browser?: { options?: { browserProcess?: { process?: { pid?: number } } } } } } }
    return c._connection.toImpl(context)._browser?.options?.browserProcess?.process?.pid
  } catch {
    return undefined
  }
}

export class FirefoxWindow {
  private win: BrowserWindow
  private page: Page
  private context: BrowserContext
  private viewport: Viewport
  private rect?: ViewRect
  private id?: number
  private visible = false
  /** Shrunk to fit behind Swivel because the size is too big (the page is streamed meanwhile). */
  private suspended = false
  private listeners: [string, () => void][] = []
  /** Called when the Swivel window resizes, since that can change whether the page fits. */
  onFitChange?: () => void

  constructor(win: BrowserWindow, context: BrowserContext, page: Page, viewport: Viewport) {
    this.win = win
    this.context = context
    this.page = page
    this.viewport = viewport
    const on = (event: string, fn: () => void) => {
      this.win.on(event as 'move', fn)
      this.listeners.push([event, fn])
    }
    on('move', () => this.place())
    on('resize', () => {
      void this.place()
      this.onFitChange?.()
    })
    on('minimize', () => this.minimize(true))
    on('hide', () => this.minimize(true))
    on('restore', () => this.minimize(false))
    on('show', () => this.minimize(false))
  }

  /** Find and mirror the Firefox window. Retries while macOS lists the new window. */
  async start(): Promise<boolean> {
    const pid = firefoxPid(this.context)
    if (!mirror || !pid) return false
    await this.place()
    for (let attempt = 0; attempt < 20 && this.id === undefined; attempt++) {
      this.id = await new Promise<number | undefined>((resolve) =>
        mirror.mirrorCreate(this.win.getNativeWindowHandle(), pid, this.viewport.width, this.viewport.height, (err, id) => resolve(err ? undefined : (id ?? undefined)))
      )
      if (this.id === undefined) await new Promise((r) => setTimeout(r, 150))
    }
    if (this.id === undefined) return false
    this.layout()
    // Launching Firefox can bring it forward; put Swivel back on top so it covers the window.
    this.win.focus()
    if (process.platform === 'darwin') app.focus({ steal: true })
    return true
  }

  /** Keep the Firefox window directly behind the page area, so it's always covered by Swivel. */
  private async place(): Promise<void> {
    const content = this.win.getContentBounds()
    const session = jugglerSession(this.page)
    if (this.suspended) {
      // Shrunk to Swivel's content area, directly behind it.
      await session?.send('Page.setWindowSize', { width: content.width, height: content.height }).catch(() => {})
      await session?.send('Page.moveWindow', { x: content.x, y: content.y }).catch(() => {})
      return
    }
    await session?.send('Page.setWindowSize', { width: this.viewport.width, height: this.viewport.height }).catch(() => {})
    const box = this.rect ?? { x: 0, y: 0, width: content.width, height: content.height }
    const x = Math.round(content.x + box.x + box.width / 2 - this.viewport.width / 2)
    const y = Math.round(content.y + box.y + box.height / 2 - this.viewport.height / 2)
    await session?.send('Page.moveWindow', { x, y }).catch(() => {})
  }

  private minimize(minimized: boolean): void {
    void jugglerSession(this.page)?.send('Page.setWindowMinimized', { minimized }).catch(() => {})
    if (!minimized) void this.place()
  }

  /**
   * Whether the real window can hide behind Swivel at this size. It must fit inside Swivel's
   * window (otherwise its edges would show) — always true for Fill window.
   */
  fits(viewport: Viewport = this.viewport): boolean {
    const content = this.win.getContentBounds()
    return viewport.width <= content.width && viewport.height <= content.height
  }

  /**
   * Too big to hide: shrink the real window to fit behind Swivel while the page keeps its full
   * viewport. The page is streamed from it meanwhile. (Minimizing would stop input.)
   */
  suspend(): void {
    if (this.suspended) return
    this.suspended = true
    this.layout()
    void this.place()
  }

  resume(): void {
    if (!this.suspended) return
    this.suspended = false
    void this.place()
    this.layout()
  }

  private layout(): void {
    if (this.id === undefined || !mirror) return
    if (this.rect) mirror.mirrorSetFrame(this.id, this.rect.x, this.rect.y, this.rect.width, this.rect.height)
    mirror.mirrorSetHidden(this.id, !this.visible || !this.rect || this.suspended)
  }

  setRect(rect: ViewRect): void {
    this.rect = rect
    this.layout()
    void this.place()
  }

  resize(viewport: Viewport): void {
    this.viewport = viewport
    if (this.id !== undefined) mirror?.mirrorResizeSource(this.id, viewport.width, viewport.height)
    void this.place()
  }

  show(): void {
    this.visible = true
    this.layout()
  }

  hide(): void {
    this.visible = false
    this.layout()
  }

  destroy(): void {
    for (const [event, fn] of this.listeners) this.win.removeListener(event as 'move', fn)
    if (this.id !== undefined) mirror?.mirrorDestroy(this.id)
    this.id = undefined
  }
}
