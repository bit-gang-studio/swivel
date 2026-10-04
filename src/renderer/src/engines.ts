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

/**
 * Tooltip: which browsers use the engine, how Swivel runs it here, and which version, numbered
 * as its browser is ("as in Chrome 152"), so it's clear what a page is being tested against.
 */
export function engineHint(engine: EngineId, platform: string, version = ''): string {
  const asIn = (browser: string) => (version ? `, as in ${browser} ${version}` : '')
  if (engine === 'chromium') return `Blink${asIn('Chrome')}: the engine in Chrome, Edge, Opera and Brave (from the Chromium project)`
  if (engine === 'firefox') return `Gecko${asIn('Firefox')}: the engine in Firefox`
  return platform === 'darwin' ? `WebKit${asIn('Safari')}: the engine in Safari (this is Apple's own WebKit)` : `WebKit${asIn('Safari')}: the engine in Safari (Playwright build)`
}

export const ENGINES: EngineId[] = ['chromium', 'firefox', 'webkit']

export const SIZES: { label: string; viewport: Viewport }[] = [
  { label: 'Phone', viewport: { width: 390, height: 844 } },
  { label: 'Tablet', viewport: { width: 820, height: 1180 } },
  { label: 'Desktop', viewport: { width: 1280, height: 800 } }
]
