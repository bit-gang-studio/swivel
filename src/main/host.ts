import type { BrowserWindow } from 'electron'
import type { FindRequest } from '../shared/find'
import type { EngineId, InputEvent, LiveEvents, LiveOptions, ViewRect, Viewport } from '../shared/types'
import { StreamedView } from './live'
import { NativeChrome } from './native-chrome'
import { NativeSafari, webkitAddon } from './native-safari'
import type { Emit, PageView } from './view'

const ENGINES: EngineId[] = ['chromium', 'firefox', 'webkit']

/** Engines drawn natively in the window. Everything else is streamed. */
export function nativeEngines(): EngineId[] {
  return webkitAddon ? ['chromium', 'webkit'] : ['chromium']
}

/** Engines that run in Playwright, for prewarming. */
export function streamedEngines(): EngineId[] {
  return ENGINES.filter((e) => !nativeEngines().includes(e))
}

const sameUrl = (a?: string, b?: string) => !!a && !!b && a.replace(/\/$/, '') === b.replace(/\/$/, '')

/**
 * One window's pages: one live view per engine, all kept loaded and on the same URL, with one
 * shown. The shown view leads: when you navigate inside it, the others follow in the background,
 * so switching engines is instant. Console output comes from every view; everything else the UI
 * sees comes from the shown one.
 */
export class EngineHost {
  private views = new Map<EngineId, PageView>()
  private active?: EngineId
  private settings?: Omit<LiveOptions, 'engine'>
  /** Each view's latest URL, to avoid sending followers where they already are. */
  private urls = new Map<EngineId, string>()
  /** Set while views run a navigation Swivel started; the leader's URL changes then aren't user moves. */
  private broadcasting = false
  private win: BrowserWindow
  private emit: Emit

  /** Test hook: sees console text from any engine. */
  onConsole?: (engine: EngineId, text: string) => void
  /** How many times start() has run. The self-test waits for the UI's first start. */
  starts = 0

  constructor(win: BrowserWindow, emit: Emit) {
    this.win = win
    this.emit = emit
  }

  private view(engine: EngineId): PageView {
    let view = this.views.get(engine)
    if (!view) {
      const emit: Emit = (event, payload) => this.fromView(engine, event, payload)
      view =
        engine === 'chromium'
          ? new NativeChrome(this.win, emit)
          : engine === 'webkit' && webkitAddon
            ? new NativeSafari(this.win, emit, webkitAddon)
            : new StreamedView(engine, emit)
      this.views.set(engine, view)
    }
    return view
  }

  /** Test hook. */
  get(engine: EngineId): PageView | undefined {
    return this.views.get(engine)
  }

  /** Resolvers waiting for an engine's next frame. */
  private frameWaiters = new Map<EngineId, () => void>()

  private nextFrame(engine: EngineId, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        this.frameWaiters.delete(engine)
        resolve()
      }
      this.frameWaiters.set(engine, done)
      setTimeout(done, timeoutMs)
    })
  }

  private fromView<K extends keyof LiveEvents>(engine: EngineId, event: K, payload: LiveEvents[K]): void {
    if (event === 'frame') this.frameWaiters.get(engine)?.()
    if (event === 'console') {
      const entry = payload as LiveEvents['console']
      this.onConsole?.(engine, entry.text)
      return this.emit(event, payload)
    }
    if (event === 'url') this.urls.set(engine, payload as string)
    if (engine !== this.active) return
    if (event === 'loading' && payload === false) this.broadcasting = false
    if (event === 'url' && !this.broadcasting) this.follow(payload as string)
    this.emit(event, payload)
  }

  /** The shown view moved on its own (a link, a form, a script): bring the others along. */
  private follow(url: string): void {
    for (const [engine, view] of this.views) {
      if (engine === this.active || sameUrl(this.urls.get(engine), url)) continue
      this.urls.set(engine, url)
      void view.navigate(url)
    }
  }

  /** Show an engine and apply size and colour scheme to every view, without reloading. */
  async start(opts: LiveOptions): Promise<void> {
    this.starts++
    const { engine, ...settings } = opts
    const first = !this.settings
    this.settings = settings
    this.active = engine
    if (first) this.broadcasting = true
    await Promise.all(ENGINES.map((e) => this.view(e).update({ ...settings, engine: e })))
    const target = this.view(engine)
    if (!nativeEngines().includes(engine)) {
      // A streamed engine draws in the UI, under any native view. Keep the old view up until
      // the new engine's first frame is on screen, so switching doesn't flash an empty area.
      const frame = this.nextFrame(engine, 500)
      target.show()
      await frame
    } else {
      target.show()
    }
    for (const [e, view] of this.views) if (e !== engine) view.hide()
    const url = this.urls.get(engine)
    if (url) this.emit('url', url)
  }

  async resize(viewport: Viewport): Promise<void> {
    if (!this.settings) return
    this.settings = { ...this.settings, viewport }
    await Promise.all([...this.views].map(([e, v]) => v.update({ ...this.settings!, engine: e })))
  }

  /** Typed URLs and back, forward, reload go to every view. */
  async navigate(url: string): Promise<void> {
    if (this.settings) this.settings = { ...this.settings, url }
    this.broadcasting = true
    for (const e of this.views.keys()) this.urls.set(e, url)
    await Promise.all([...this.views.values()].map((v) => v.navigate(url)))
  }

  async history(action: 'back' | 'forward' | 'reload'): Promise<void> {
    this.broadcasting = true
    await Promise.all([...this.views.values()].map((v) => v.history(action)))
  }

  find(req: FindRequest): Promise<void> {
    return this.active ? this.view(this.active).find(req) : Promise.resolve()
  }

  input(e: InputEvent): void {
    if (this.active) this.view(this.active).input(e)
  }

  /** Every native view learns the page area; only the shown one appears there. */
  async setRect(rect: ViewRect): Promise<void> {
    await Promise.all([...this.views.values()].map((v) => v.setRect(rect)))
  }

  destroy(): void {
    for (const view of this.views.values()) view.destroy()
    this.views.clear()
  }
}
