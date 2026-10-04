import { app, type BrowserWindow } from 'electron'
import type { EngineId } from '../shared/types'
import { nativeEngines, type EngineHost } from './host'

/**
 * SWIVEL_SELFTEST=1: check each native engine loads a page at the emulated size and colour
 * scheme, without a test runner attached (a runner changes how the debugger behaves).
 * Prints the result and quits.
 */
export async function selfTest(win: BrowserWindow, host: EngineHost): Promise<void> {
  // Reports the width twice: while the page first parses, and after it loads. Only the loaded
  // layout must be right. Chrome on Windows can briefly show a site's first visit at the old zoom.
  const page =
    'data:text/html,' +
    encodeURIComponent(
      "<script>const early = innerWidth; addEventListener('load', () => setTimeout(() => console.log('dark:' + matchMedia('(prefers-color-scheme: dark)').matches + ' width:' + innerWidth + ' early:' + early), 300))</script>"
    )
  const results: string[] = []
  const finish = () => {
    const ok = results.every((r) => r.includes('dark:true width:1280 '))
    for (const r of results) if (ok && !r.endsWith('early:1280')) console.log(`SELFTEST note: brief first-visit reflow (${r})`)
    console.log(`SELFTEST ${ok ? 'PASS' : 'FAIL'} ${results.join(' | ')}`)
    app.exit(ok ? 0 : 1)
  }
  setTimeout(() => {
    results.push('timed out')
    finish()
  }, 60_000)
  // Let the window's UI settle first.
  await new Promise((r) => setTimeout(r, 1500))
  // Scale 0.3125: well below 0.5, where WKWebView's page zoom stops, so clamping shows up.
  await host.setRect({ x: 0, y: 100, width: 400, height: 250 })
  for (const engine of nativeEngines()) {
    const seen = new Promise<string>((resolve) => {
      host.onConsole = (from, text) => from === engine && text.startsWith('dark:') && resolve(text)
      setTimeout(() => resolve('no page output'), 15_000)
    })
    await host.start({ engine: engine as EngineId, url: page + '%3C!--' + engine + '--%3E', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })
    results.push(`${engine} ${await seen}`)
  }
  finish()
}
