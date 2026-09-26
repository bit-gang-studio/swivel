export type EngineId = 'chromium' | 'firefox' | 'webkit'

export interface Viewport {
  width: number
  height: number
}

export interface LiveOptions {
  engine: EngineId
  url: string
  viewport: Viewport
  colorScheme: 'light' | 'dark'
  /** Screen pixel density, so streamed frames are sharp on Retina and HiDPI screens. */
  pixelRatio?: number
}

export interface ConsoleEntry {
  engine: EngineId
  type: string
  text: string
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

export interface LiveEvents {
  frame: Frame
  console: ConsoleEntry
  url: string
  error: string
  loading: boolean
  /** CSS cursor for the point under the mouse, for streamed engines. */
  cursor: string
  /** Find-in-page progress. */
  find: { matches: number; active: number }
  /** A menu command, such as 'find' or 'focus-address'. */
  command: string
}

/** The page area's position in the window, in CSS pixels of the app window. */
export interface ViewRect {
  x: number
  y: number
  width: number
  height: number
}
