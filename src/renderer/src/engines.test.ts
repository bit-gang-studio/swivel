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
})
