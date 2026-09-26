import type { EngineId, Viewport } from '../../shared/types'

/** WebKit is only "Safari" on macOS. Elsewhere it is Playwright's WebKit build, so we say so. */
export function engineLabel(engine: EngineId, platform: string): string {
  if (engine === 'chromium') return 'Chrome'
  if (engine === 'firefox') return 'Firefox'
  return platform === 'darwin' ? 'Safari' : 'WebKit'
}

export const ENGINES: EngineId[] = ['chromium', 'firefox', 'webkit']

export const SIZES: { label: string; viewport: Viewport }[] = [
  { label: 'Phone', viewport: { width: 390, height: 844 } },
  { label: 'Tablet', viewport: { width: 820, height: 1180 } },
  { label: 'Desktop', viewport: { width: 1280, height: 800 } }
]
