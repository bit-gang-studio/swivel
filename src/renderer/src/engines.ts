import type { EngineId, Viewport } from '../../shared/types'

const NAMES: Record<EngineId, string> = { chromium: 'Blink', firefox: 'Gecko', webkit: 'WebKit' }

/** Engines are named for themselves, not a browser: Blink, Gecko, WebKit. */
export function engineLabel(engine: EngineId): string {
  return NAMES[engine]
}

/** Tooltip: which browsers use the engine, and how Swivel runs it here. */
export function engineHint(engine: EngineId, platform: string): string {
  if (engine === 'chromium') return 'Blink: the engine in Chrome, Edge and Opera'
  if (engine === 'firefox') return 'Gecko: the engine in Firefox'
  return platform === 'darwin' ? 'WebKit: the engine in Safari (this is real Safari WebKit)' : 'WebKit: the engine in Safari (Playwright build)'
}

export const ENGINES: EngineId[] = ['chromium', 'firefox', 'webkit']

export const SIZES: { label: string; viewport: Viewport }[] = [
  { label: 'Phone', viewport: { width: 390, height: 844 } },
  { label: 'Tablet', viewport: { width: 820, height: 1180 } },
  { label: 'Desktop', viewport: { width: 1280, height: 800 } }
]
