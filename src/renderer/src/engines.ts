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

/**
 * Tooltip for a frame's Mobile badge: what this engine emulates, and what it doesn't. No engine
 * here is a real phone, and the label says so.
 */
export function mobileHint(engine: EngineId, platform: string): string {
  const off = ' Click to turn off.'
  if (engine === 'chromium') return "Mobile mode (emulated): Chrome for Android's browser ID, touch input and a phone's screen density. Not a real phone." + off
  if (engine === 'firefox') return "Mobile mode (emulated): Firefox for Android's browser ID, and touch support. Screen density is not emulated. Not a real phone." + off
  return platform === 'darwin'
    ? "Mobile mode (emulated): iPhone or iPad Safari's browser ID only. Touch and screen density are not emulated. Not a real iPhone." + off
    : "Mobile mode (emulated): iPhone or iPad Safari's browser ID, touch support and a phone's layout. Not a real iPhone." + off
}

export const ENGINES: EngineId[] = ['chromium', 'firefox', 'webkit']

export const SIZES: { label: string; viewport: Viewport }[] = [
  { label: 'Phone', viewport: { width: 390, height: 844 } },
  { label: 'Tablet', viewport: { width: 820, height: 1180 } },
  { label: 'Desktop', viewport: { width: 1280, height: 800 } }
]
