import type { FindRequest } from '../shared/find'
import type { EngineId, InputEvent, LiveEvents, LiveOptions, ViewRect } from '../shared/types'

export type Emit = <K extends keyof LiveEvents>(event: K, payload: LiveEvents[K]) => void

/**
 * One live page in one engine. A window can hold several: today one per engine, with one shown;
 * later a canvas of engines and sizes side by side.
 */
export interface PageView {
  readonly engine: EngineId
  /** Apply size and colour scheme without reloading. Loads opts.url if this view isn't there yet. */
  update(opts: LiveOptions): Promise<void>
  show(): void
  hide(): void
  navigate(url: string): Promise<void>
  history(action: 'back' | 'forward' | 'reload'): Promise<void>
  /** Where the page area is in the window. Native views place themselves there. */
  setRect(rect: ViewRect): Promise<void>
  find(req: FindRequest): Promise<void>
  /** Mouse and keyboard input, for views that don't receive it natively. */
  input(e: InputEvent): void
  destroy(): void
}
