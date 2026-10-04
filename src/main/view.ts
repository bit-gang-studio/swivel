import type { FindRequest } from '../shared/find'
import type { Credentials, EngineId, InputEvent, LiveEvents, LiveOptions, ViewEvents, ViewRect } from '../shared/types'

/** How a view reports. */
export type Emit = <K extends keyof ViewEvents>(event: K, payload: ViewEvents[K]) => void
/** How a window's host reports to its UI. */
export type EmitLive = <K extends keyof LiveEvents>(event: K, payload: LiveEvents[K]) => void

/**
 * Questions a browser would ask the user. A window asks once and every view in it gets the same
 * answer, kept in memory until the window closes or its data is cleared.
 */
export interface Asker {
  /** Username and password for a site (HTTP authentication). tried: the answer this view already used and was refused with. */
  credentials(site: string, tried?: Credentials): Promise<Credentials | null>
  /** Whether to load a site whose HTTPS certificate isn't trusted (common in local development). */
  trust(site: string, problem: string): Promise<boolean>
  /** A page's alert or confirm. Resolves true for OK. */
  dialog(kind: 'alert' | 'confirm' | 'prompt', message: string, engine: EngineId): Promise<boolean>
}

/**
 * One live page in one engine. A window holds several: one per engine in the single-page view
 * (one shown), and one per frame on the canvas (all shown).
 */
export interface PageView {
  readonly engine: EngineId
  /** Apply size and colour scheme without reloading. Loads opts.url if this view isn't there yet. */
  update(opts: LiveOptions): Promise<void>
  show(): void
  hide(): void
  navigate(url: string): Promise<void>
  history(action: 'back' | 'forward' | 'reload'): Promise<void>
  /** Where the page area is in the window, and the area it may draw in. Native views place themselves there. */
  setRect(rect: ViewRect): Promise<void>
  find(req: FindRequest): Promise<void>
  /** Mouse and keyboard input, for views that don't receive it natively. */
  input(e: InputEvent): void
  destroy(): void
}
