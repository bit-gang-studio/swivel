import { describe, expect, it } from 'vitest'
import { engineHint, engineLabel, engineWithBrowser } from './engines'

describe('engine names', () => {
  it("uses the browser engines' own names", () => {
    expect(engineLabel('chromium')).toBe('Blink')
    expect(engineLabel('firefox')).toBe('Gecko')
    expect(engineLabel('webkit')).toBe('WebKit')
  })

  it('names the best-known browser beside each engine in menus', () => {
    expect(engineWithBrowser('chromium')).toBe('Blink (Chrome)')
    expect(engineWithBrowser('firefox')).toBe('Gecko (Firefox)')
    expect(engineWithBrowser('webkit')).toBe('WebKit (Safari)')
  })

  it("only claims Apple's own WebKit on macOS", () => {
    expect(engineHint('webkit', 'darwin')).toContain("Apple's own WebKit")
    expect(engineHint('webkit', 'linux')).toContain('Playwright')
  })

  it('says which browser version the engine matches, when known', () => {
    expect(engineHint('chromium', 'darwin', '152')).toMatch(/^Blink, as in Chrome 152: /)
    expect(engineHint('firefox', 'darwin', '155')).toMatch(/^Gecko, as in Firefox 155: /)
    expect(engineHint('webkit', 'darwin', '18.6')).toMatch(/^WebKit, as in Safari 18\.6: /)
    expect(engineHint('firefox', 'darwin')).toMatch(/^Gecko: /)
  })
})
