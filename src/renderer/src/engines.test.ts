import { describe, expect, it } from 'vitest'
import { engineLabel } from './engines'

describe('engineLabel', () => {
  it('calls WebKit "Safari" only on macOS', () => {
    expect(engineLabel('webkit', 'darwin')).toBe('Safari')
    expect(engineLabel('webkit', 'win32')).toBe('WebKit')
    expect(engineLabel('webkit', 'linux')).toBe('WebKit')
  })

  it('names Chrome and Firefox the same everywhere', () => {
    expect(engineLabel('chromium', 'linux')).toBe('Chrome')
    expect(engineLabel('firefox', 'win32')).toBe('Firefox')
  })
})
