import type { BrowserWindow } from 'electron'
import type { EngineId, InputEvent, LiveEvents, LiveOptions, ViewRect, Viewport } from '../shared/types'
import { LiveSession } from './live'
import { NativeChrome } from './native-chrome'
import { NativeSafari, webkitAddon } from './native-safari'

type Emit = <K extends keyof LiveEvents>(event: K, payload: LiveEvents[K]) => void

interface NativeEngine {
  start(opts: LiveOptions): Promise<void>
  navigate(url: string): Promise<void>
  history(action: 'back' | 'forward' | 'reload'): Promise<void>
  setRect(rect: ViewRect): Promise<void>
  resize(viewport: Viewport): Promise<void>
  stop(): void
  destroy(): void
}

/** Engines drawn natively in the window. Everything else is streamed. */
export function nativeEngines(): EngineId[] {
  return webkitAddon ? ['chromium', 'webkit'] : ['chromium']
}

/**
 * One window's page. Chrome runs natively everywhere, Safari natively on macOS,
 * and the rest (Firefox, WebKit on Windows and Linux) are streamed.
 */
export class EngineHost {
  private natives: Partial<Record<EngineId, NativeEngine>> = {}
  private streamed: LiveSession
  private current?: NativeEngine

  /** Test hook: sees console text from any engine. */
  onConsole?: (text: string) => void

  constructor(win: BrowserWindow, emit: Emit) {
    const tap: Emit = (event, payload) => {
      if (event === 'console') this.onConsole?.((payload as LiveEvents['console']).text)
      emit(event, payload)
    }
    this.natives.chromium = new NativeChrome(win, tap)
    if (webkitAddon) this.natives.webkit = new NativeSafari(win, tap, webkitAddon)
    this.streamed = new LiveSession(tap)
  }

  native(engine: EngineId): NativeEngine | undefined {
    return this.natives[engine]
  }

  start(opts: LiveOptions): Promise<void> {
    const next = this.natives[opts.engine]
    for (const n of Object.values(this.natives)) if (n !== next) n.stop()
    this.current = next
    if (next) {
      this.streamed.stop()
      return next.start(opts)
    }
    return this.streamed.start(opts)
  }

  navigate(url: string): Promise<void> {
    return this.current ? this.current.navigate(url) : this.streamed.navigate(url)
  }

  history(action: 'back' | 'forward' | 'reload'): Promise<void> {
    return this.current ? this.current.history(action) : this.streamed.history(action)
  }

  resize(viewport: Viewport): Promise<void> {
    return this.current ? this.current.resize(viewport) : this.streamed.resize(viewport)
  }

  input(e: InputEvent): void {
    if (!this.current) this.streamed.input(e)
  }

  /** Every native engine learns the page area; only the active one shows itself. */
  async setRect(rect: ViewRect): Promise<void> {
    await Promise.all(Object.values(this.natives).map((n) => n.setRect(rect)))
  }

  destroy(): void {
    this.streamed.stop()
    for (const n of Object.values(this.natives)) n.destroy()
  }
}
