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
}

export interface ConsoleEntry {
  engine: EngineId
  type: string
  text: string
}

export interface Frame {
  engine: EngineId
  /** JPEG bytes. */
  data: Uint8Array
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
}
