export type EngineId = 'chromium' | 'firefox' | 'webkit'

export interface Viewport {
  width: number
  height: number
}

export interface CaptureRequest {
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

export interface CaptureResult {
  engine: EngineId
  /** PNG screenshot as a data URL. */
  image: string
  console: ConsoleEntry[]
  error?: string
}
