import type { BrowserWindow } from 'electron'
import type { InputEvent, LiveEvents, LiveOptions, ViewRect } from '../shared/types'
import { LiveSession } from './live'
import { NativeChrome } from './native-chrome'

type Emit = <K extends keyof LiveEvents>(event: K, payload: LiveEvents[K]) => void

/** One window's page. Chrome runs natively; Firefox and WebKit are streamed. */
export class EngineHost {
  private native: NativeChrome
  private streamed: LiveSession
  private isNative = false

  /** Test hook: sees console text from any engine. */
  onConsole?: (text: string) => void

  constructor(win: BrowserWindow, emit: Emit) {
    const tap: Emit = (event, payload) => {
      if (event === 'console') this.onConsole?.((payload as LiveEvents['console']).text)
      emit(event, payload)
    }
    this.native = new NativeChrome(win, tap)
    this.streamed = new LiveSession(tap)
  }

  start(opts: LiveOptions): Promise<void> {
    this.isNative = opts.engine === 'chromium'
    if (this.isNative) {
      this.streamed.stop()
      return this.native.start(opts)
    }
    this.native.stop()
    return this.streamed.start(opts)
  }

  navigate(url: string): Promise<void> {
    return this.isNative ? this.native.navigate(url) : this.streamed.navigate(url)
  }

  history(action: 'back' | 'forward' | 'reload'): Promise<void> {
    return this.isNative ? this.native.history(action) : this.streamed.history(action)
  }

  input(e: InputEvent): void {
    if (!this.isNative) this.streamed.input(e)
  }

  setRect(rect: ViewRect): Promise<void> {
    return this.native.setRect(rect)
  }

  destroy(): void {
    this.streamed.stop()
    this.native.destroy()
  }
}
