import { describe, expect, it } from 'vitest'
import { mobileDensity, mobileUserAgent } from './mobile'

const versions = { chromium: '152', firefox: '155', webkit: '18.6' }

describe('mobile browser IDs', () => {
  it('is Chrome for Android in Blink, with "Mobile" on phones only', () => {
    expect(mobileUserAgent('chromium', 'phone', versions)).toMatch(/Android 14; Pixel 8.* Chrome\/152\.0\.0\.0 Mobile Safari\/537\.36$/)
    expect(mobileUserAgent('chromium', 'tablet', versions)).toMatch(/Android.* Chrome\/152\.0\.0\.0 Safari\/537\.36$/)
    expect(mobileUserAgent('chromium', 'tablet', versions)).not.toContain('Mobile')
  })

  it('is Firefox for Android in Gecko', () => {
    expect(mobileUserAgent('firefox', 'phone', versions)).toBe('Mozilla/5.0 (Android 14; Mobile; rv:155.0) Gecko/155.0 Firefox/155.0')
    expect(mobileUserAgent('firefox', 'tablet', versions)).toContain('Android 14; Tablet;')
  })

  it("is iPhone or iPad Safari in WebKit, at the installed Safari's version", () => {
    expect(mobileUserAgent('webkit', 'phone', versions)).toMatch(/^Mozilla\/5\.0 \(iPhone; CPU iPhone OS 18_6 like Mac OS X\).* Version\/18\.6 Mobile\/15E148 Safari\/604\.1$/)
    expect(mobileUserAgent('webkit', 'tablet', versions)).toContain('(iPad; CPU OS 18_6 like Mac OS X)')
  })

  it('gives phones a denser screen than tablets', () => {
    expect(mobileDensity('phone')).toBe(3)
    expect(mobileDensity('tablet')).toBe(2)
  })
})
