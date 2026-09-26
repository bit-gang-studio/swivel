import { describe, expect, it } from 'vitest'
import { engineHint, engineLabel } from './engines'

describe('engine names', () => {
  it('uses Playwright-style engine names', () => {
    expect(engineLabel('chromium')).toBe('Chromium')
    expect(engineLabel('firefox')).toBe('Firefox')
    expect(engineLabel('webkit')).toBe('WebKit')
  })

  it('only claims real Safari WebKit on macOS', () => {
    expect(engineHint('webkit', 'darwin')).toContain('real Safari')
    expect(engineHint('webkit', 'linux')).toContain('Playwright')
  })
})
