export type EngineId = 'chromium' | 'firefox' | 'webkit'

export interface Viewport {
  width: number
  height: number
}

/** Mobile mode: a frame acts like a phone or a tablet, as far as its engine can (emulated). */
export type MobileKind = 'phone' | 'tablet'

export interface LiveOptions {
  engine: EngineId
  url: string
  viewport: Viewport
  colorScheme: 'light' | 'dark'
  /** Set when the view is made; a view never changes it. userAgent: the browser ID to send. */
  mobile?: { kind: MobileKind; userAgent: string }
  /** Screen pixel density, so streamed frames are sharp on Retina and HiDPI screens. */
  pixelRatio?: number
}

export interface ConsoleEntry {
  engine: EngineId
  type: string
  text: string
  /** Where it was logged from: file name and line ("app.js:42"), when the engine says. */
  source?: string
}

export interface Frame {
  engine: EngineId
  /** Image bytes, PNG or JPEG. */
  data: Uint8Array
  format: 'png' | 'jpeg'
  width: number
  height: number
}

export type InputEvent =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'down' | 'up'; x: number; y: number; button: 'left' | 'middle' | 'right' }
  | { kind: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { kind: 'keydown' | 'keyup'; key: string }

/** What a page view reports. */
export interface ViewEvents {
  frame: Frame
  console: ConsoleEntry
  url: string
  error: string
  loading: boolean
  /** CSS cursor for the point under the mouse, for streamed engines. */
  cursor: string
  /** Find-in-page progress. */
  find: { matches: number; active: number }
  /** A still image (PNG data URL) to show while a native view can't be (cut off), or null. */
  snapshot: string | null
}

/**
 * What the UI hears. Events for one view carry its key: the engine in the single-page view, or
 * the frame id on the canvas.
 */
export interface LiveEvents extends Omit<ViewEvents, 'frame' | 'cursor' | 'snapshot'> {
  frame: Frame & { view: string }
  cursor: { view: string; cursor: string }
  snapshot: { view: string; image: string | null }
  /** A menu command, such as 'find' or 'focus-address'. */
  command: string
  /** A site wants a username and password (HTTP authentication). Answer with answerAuth(id). */
  auth: { id: number; site: string; retry: boolean }
}

export interface Credentials {
  username: string
  password: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where a page sits in the window, in CSS pixels of the app window. clip: the area it may draw
 * in (a canvas frame can be partly outside the canvas).
 */
export interface ViewRect extends Rect {
  clip?: Rect
}

/** A page on the canvas: its engine and screen size. */
export interface CanvasFrame {
  id: string
  engine: EngineId
  viewport: Viewport
  mobile?: MobileKind
}

