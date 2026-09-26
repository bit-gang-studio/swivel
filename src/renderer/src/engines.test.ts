import { describe, expect, it } from 'vitest'
import { engineHint, engineLabel } from './engines'

describe('engine names', () => {
  it('uses engine names, not browser names', () => {
    expect(engineLabel('chromium')).toBe('Blink')
    expect(engineLabel('firefox')).toBe('Gecko')
    expect(engineLabel('webkit')).toBe('WebKit')
  })

  it('only claims real Safari WebKit on macOS', () => {
    expect(engineHint('webkit', 'darwin')).toContain('real Safari')
    expect(engineHint('webkit', 'linux')).toContain('Playwright')
  })
})
