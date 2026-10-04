import type { EngineId, Viewport } from '../../shared/types'

const NAMES: Record<EngineId, string> = { chromium: 'Blink', firefox: 'Gecko', webkit: 'WebKit' }
const BROWSERS: Record<EngineId, string> = { chromium: 'Chrome', firefox: 'Firefox', webkit: 'Safari' }

/** The browser engines' own names: Blink (Chrome, Edge), Gecko (Firefox), WebKit (Safari). */
export function engineLabel(engine: EngineId): string {
  return NAMES[engine]
}

/** An engine with its best-known browser, for menus: "Blink (Chrome)". */
export function engineWithBrowser(engine: EngineId): string {
  return `${NAMES[engine]} (${BROWSERS[engine]})`
}

/** Tooltip: which browsers use the engine, and how Swivel runs it here. */
export function engineHint(engine: EngineId, platform: string): string {
  if (engine === 'chromium') return 'Blink: the engine in Chrome, Edge, Opera and Brave (from the Chromium project)'
  if (engine === 'firefox') return 'Gecko: the engine in Firefox'
  return platform === 'darwin' ? "WebKit: the engine in Safari (this is Apple's own WebKit)" : 'WebKit: the engine in Safari (Playwright build)'
}

export const ENGINES: EngineId[] = ['chromium', 'firefox', 'webkit']

export const SIZES: { label: string; viewport: Viewport }[] = [
  { label: 'Phone', viewport: { width: 390, height: 844 } },
  { label: 'Tablet', viewport: { width: 820, height: 1180 } },
  { label: 'Desktop', viewport: { width: 1280, height: 800 } }
]
