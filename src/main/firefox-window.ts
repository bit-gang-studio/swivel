import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { app, screen, type BrowserWindow } from 'electron'
import { firefox, type BrowserContext, type Page } from 'playwright-core'
import type { ViewRect, Viewport } from '../shared/types'
import { webkitAddon } from './native-safari'
import { jugglerSession } from './frames'

/**
 * Real-window Firefox on macOS: a borderless, click-through Firefox window (from Swivel's patched
 * copy, see scripts/patch-firefox.mjs) is parked off-screen, and ScreenCaptureKit mirrors it into
 * Swivel's page area. Off-screen, it can't pop up, peek out, or need to follow Swivel around. It renders on the GPU at the display's refresh rate, like a normal browser.
 * Input still goes through Swivel's page area and Playwright. Needs the Screen Recording
 * permission; without it Firefox is streamed as before.
 */

interface MirrorAddon {
  screenCaptureAccess(): boolean
  requestScreenCaptureAccess(): boolean
  mirrorCreate(parent: Buffer, pid: number, x: number, y: number, width: number, height: number, cb: (err: string | null, id: number | null) => void): void
  mirrorSetFrame(id: number, x: number, y: number, w: number, h: number): void
  mirrorResizeSource(id: number, w: number, h: number): void
  mirrorSetHidden(id: number, hidden: boolean): void
  mirrorDestroy(id: number): void
  mirrorFrames(id: number): number
  windowNumber(handle: Buffer): number
  windowFrames(pid: number): { x: number; y: number; width: number; height: number; onScreen: boolean; layer: number }[]
}

/**
 * Diagnostics for the real Firefox window, always written to Swivel's log folder
 * (~/Library/Logs/swivel/firefox-window.log), since placement depends on the user's screen setup.
 */
let logFile: string | undefined
const debugLog = (...args: unknown[]) => {
  const line = `${new Date().toISOString()} ${args.map(String).join(' ')}`
  if (process.env.SWIVEL_DEBUG) console.log('[swivel] firefox', line)
  try {
    if (!logFile) {
      mkdirSync(app.getPath('logs'), { recursive: true })
      logFile = join(app.getPath('logs'), 'firefox-window.log')
      writeFileSync(logFile, '')
    }
    appendFileSync(logFile, line + '\n')
  } catch {
    // Logging is best effort.
  }
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

/**
 * Firefox caches its compiled internal code (including Playwright's Juggler, which Swivel patches)
 * in the profile's startupCache and keeps using it while the build ID is unchanged. After the patch
 * changes, clear that cache, or the old patch keeps running.
 */
export function refreshPatchedCode(profileDir: string): void {
  const exe = patchedFirefox()
  if (!exe) return
  const resources = join(dirname(dirname(exe)), 'Resources')
  const marker = readdirSync(resources).find((f) => f.startsWith('swivel-patch-')) ?? ''
  const stamp = join(profileDir, 'swivel-patch')
  let seen = ''
  try {
    seen = readFileSync(stamp, 'utf8')
  } catch {
    // First run with this profile.
  }
  if (seen === marker) return
  rmSync(join(profileDir, 'startupCache'), { recursive: true, force: true })
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(stamp, marker)
  debugLog('cleared Firefox startup cache for', marker)
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

/** Just past the right edge of every display (screen points): nobody sees a window there. */
export function parkingSpot(): { x: number; y: number } {
  const displays = screen.getAllDisplays().map((d) => d.bounds)
  return { x: Math.max(...displays.map((b) => b.x + b.width)) + 100, y: Math.min(...displays.map((b) => b.y)) }
}

/** Launch options for the windowed Firefox context. `at` is where its window first opens. */
export function windowedLaunchOptions(viewport: Viewport, at: { x: number; y: number }) {
  return {
    headless: false,
    executablePath: patchedFirefox()!,
    viewport,
    firefoxUserPrefs: { 'swivel.chromeless': true, 'swivel.windowX': Math.round(at.x), 'swivel.windowY': Math.round(at.y) },
    // -foreground makes Firefox a regular app (Dock icon); -silent skips its default startup window.
    ignoreDefaultArgs: ['-foreground'],
    args: ['-silent']
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
  private watchdog?: ReturnType<typeof setInterval>
  /** Where the window should be (screen points), to notice macOS moving it (e.g. window tiling). */
  private expected?: { x: number; y: number; width: number; height: number }

  constructor(win: BrowserWindow, context: BrowserContext, page: Page, viewport: Viewport) {
    this.win = win
    this.context = context
    this.page = page
    this.viewport = viewport
    const on = (event: string, fn: () => void) => {
      this.win.on(event as 'move', fn)
      this.listeners.push([event, fn])
    }
    on('resized', () => this.onFitChange?.())
  }

  /** Find and mirror the Firefox window. Retries while macOS lists the new window. */
  async start(): Promise<boolean> {
    await this.place()
    this.startWatchdog()
    if (!(await this.connect())) return false
    debugLog('mirroring', JSON.stringify({ viewport: this.viewport, at: this.at }))
    this.layout()
    return true
  }

  /** Start capturing the Firefox window. Retries while macOS lists the new window. */
  private async connect(): Promise<boolean> {
    const pid = firefoxPid(this.context)
    if (!mirror || !pid) {
      console.log('Swivel: Firefox window mirror unavailable (no process id); streaming instead')
      return false
    }
    let lastError = ''
    for (let attempt = 0; attempt < 30 && this.id === undefined; attempt++) {
      this.id = await new Promise<number | undefined>((resolve) =>
        mirror.mirrorCreate(this.win.getNativeWindowHandle(), pid, this.at.x, this.at.y, this.viewport.width, this.viewport.height, (err, id) => {
          if (err) lastError = err
          resolve(err ? undefined : (id ?? undefined))
        })
      )
      if (this.id === undefined) await new Promise((r) => setTimeout(r, 150))
    }
    if (this.id === undefined) {
      debugLog('mirror failed', lastError)
      console.log(`Swivel: couldn't mirror the Firefox window (${lastError}); streaming instead`)
      return false
    }
    return true
  }

  /** Keep the Firefox window parked off-screen, at the page's size. */
  private async place(): Promise<void> {
    if (this.win.isDestroyed()) return
    this.placing = true
    try {
      await this.placeNow()
    } finally {
      this.placing = false
    }
  }

  private async placeNow(): Promise<void> {
    const session = jugglerSession(this.page)
    const { x, y } = parkingSpot()
    await session?.send('Page.setWindowSize', { width: this.viewport.width, height: this.viewport.height }).catch(() => {})
    this.expected = { x, y, width: this.viewport.width, height: this.viewport.height }
    const at = await session?.send('Page.moveWindow', { x, y }).catch((err: unknown) => String(err))
    if (at && typeof at === 'object' && 'x' in at) this.at = at as { x: number; y: number }
    // Firefox's move keeps part of the window on screen, so the patch moves it natively too
    // (parkX). Firefox also resets its window behaviors when it shows a window: keep it
    // click-through and out of Mission Control.
    const tweaks = await session?.send('Page.nativeTweaks', { parkX: x }).catch((err: unknown) => ({ result: String(err) }))
    const pid = firefoxPid(this.context)
    // Where macOS really has it, for finding the window to mirror.
    const real = pid ? mirror?.windowFrames(pid).find((f) => f.layer === 0 && f.x >= x - 2 && f.width === this.viewport.width) : undefined
    if (real) this.at = { x: real.x, y: real.y }
    debugLog('placed', JSON.stringify({ tweaks: (tweaks as { result?: string } | undefined)?.result }), JSON.stringify({ asked: { x, y }, firefoxSays: at, viewport: this.viewport, macOS: pid ? mirror?.windowFrames(pid) : null }))
  }

  /**
   * macOS can move another app's window on its own (window tiling arranges the "next" window into
   * the other half of the screen), and Swivel isn't told. Check where it really is and put it
   * back behind the page area if it drifted.
   */
  private startWatchdog(): void {
    const pid = firefoxPid(this.context)
    if (!pid || !mirror) return
    this.watchdog = setInterval(() => {
      if (!this.expected || this.placing) return
      if (++this.ticks % 4 === 0) void jugglerSession(this.page)?.send('Page.nativeTweaks', { parkX: this.expected.x }).catch(() => {})
      const frames = mirror.windowFrames(pid).filter((f) => f.layer === 0 && f.onScreen)
      const e = this.expected
      // Mission Control and App Exposé show windows scaled down; that's not a real move.
      const fullSize = frames.filter((f) => Math.abs(f.width - e.width) <= 2 && Math.abs(f.height - e.height) <= 2)
      // Only off-screen matters; the height on screen doesn't.
      const inPlace = fullSize.some((f) => f.x >= e.x - 2)
      if (!inPlace && fullSize.length) {
        debugLog('drifted', JSON.stringify({ expected: e, macOS: frames }))
        void this.place()
      }
    }, 500)
    // Frame rate diagnostics while shown: what Firefox renders vs what the mirror delivers.
    let lastFrames = -1
    this.statsTimer = setInterval(async () => {
      if (!this.visible || this.id === undefined || !mirror) return
      const frames = mirror.mirrorFrames(this.id)
      const mirrorFps = lastFrames >= 0 ? (frames - lastFrames) / 5 : -1
      lastFrames = frames
      const raf = await this.page
        .evaluate(() => new Promise<number>((r) => { let n = 0; const s = performance.now(); const t = () => { n++; performance.now() - s < 1000 ? requestAnimationFrame(t) : r(n) }; requestAnimationFrame(t) }))
        .catch(() => -1)
      debugLog('fps', JSON.stringify({ firefoxRaf: raf, mirrorDelivered: mirrorFps, display: screen.getDisplayMatching(this.win.getBounds()).displayFrequency }))
    }, 5000)
  }

  private statsTimer?: ReturnType<typeof setInterval>

  private placing = false
  private ticks = 0

  /** Where the window actually is (screen points), for finding it to mirror. */
  private at = { x: 0, y: 0 }

  /** Off-screen, any size fits. */
  fits(_viewport: Viewport = this.viewport): boolean {
    return true
  }

  /** No mirror: the page is streamed from the parked window instead. */
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
    clearInterval(this.watchdog)
    clearInterval(this.statsTimer)
    for (const [event, fn] of this.listeners) this.win.removeListener(event as 'move', fn)
    if (this.id !== undefined) mirror?.mirrorDestroy(this.id)
    this.id = undefined
  }
}
