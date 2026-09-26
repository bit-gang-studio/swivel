import { app, type BrowserWindow } from 'electron'
import type { EngineId } from '../shared/types'
import { nativeEngines, type EngineHost } from './host'

/**
 * SWIVEL_SELFTEST=1: check each native engine loads a page at the emulated size and colour
 * scheme, without a test runner attached (a runner changes how the debugger behaves).
 * Prints the result and quits.
 */
export async function selfTest(win: BrowserWindow, host: EngineHost): Promise<void> {
  const page = 'data:text/html,' + encodeURIComponent("<script>console.log('dark:' + matchMedia('(prefers-color-scheme: dark)').matches + ' width:' + innerWidth)</script>")
  const results: string[] = []
  const finish = () => {
    const ok = results.every((r) => r.endsWith('dark:true width:1280'))
    console.log(`SELFTEST ${ok ? 'PASS' : 'FAIL'} ${results.join(' | ')}`)
    app.exit(ok ? 0 : 1)
  }
  setTimeout(() => {
    results.push('timed out')
    finish()
  }, 60_000)
  // Let the UI's own first page start first, so it doesn't override these.
  await new Promise((r) => setTimeout(r, 3000))
  await host.setRect({ x: 0, y: 100, width: 640, height: 400 })
  for (const engine of nativeEngines()) {
    const seen = new Promise<string>((resolve) => {
      host.onConsole = (text) => text.startsWith('dark:') && resolve(text)
      setTimeout(() => resolve('no page output'), 15_000)
    })
    await host.start({ engine: engine as EngineId, url: page + '%3C!--' + engine + '--%3E', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })
    results.push(`${engine} ${await seen}`)
  }
  finish()
}
