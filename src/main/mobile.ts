import type { EngineId, MobileKind } from '../shared/types'

/**
 * The browser ID (user agent) a phone or tablet running this engine sends: Chrome for Android for
 * Blink, Firefox for Android for Gecko, and iPhone or iPad Safari for WebKit. Sites that choose
 * their mobile version by browser ID then serve it. versions: engineVersions().
 */
export function mobileUserAgent(engine: EngineId, kind: MobileKind, versions: Record<EngineId, string>): string {
  if (engine === 'chromium') {
    const chrome = `Chrome/${versions.chromium || '152'}.0.0.0`
    return kind === 'phone'
      ? `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Mobile Safari/537.36`
      : `Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Safari/537.36`
  }
  if (engine === 'firefox') {
    const v = `${versions.firefox || '155'}.0`
    return `Mozilla/5.0 (Android 14; ${kind === 'phone' ? 'Mobile' : 'Tablet'}; rv:${v}) Gecko/${v} Firefox/${v}`
  }
  const safari = versions.webkit || '18.6'
  const os = safari.split('.').slice(0, 2).join('_')
  return kind === 'phone'
    ? `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safari} Mobile/15E148 Safari/604.1`
    : `Mozilla/5.0 (iPad; CPU OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safari} Mobile/15E148 Safari/604.1`
}

/** A phone's or tablet's screen density, for engines that can emulate it. */
export const mobileDensity = (kind: MobileKind) => (kind === 'phone' ? 3 : 2)
