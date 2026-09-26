import { app, type BrowserWindow } from 'electron'
import type { EngineHost } from './host'

/**
 * SWIVEL_SELFTEST=1: check native Chrome with dark mode, without a test runner attached
 * (a runner changes how the debugger behaves). Prints the result and quits.
 */
export async function selfTest(win: BrowserWindow, host: EngineHost): Promise<void> {
  const page = `data:text/html,<script>console.log('dark:' + matchMedia('(prefers-color-scheme: dark)').matches + ' width:' + innerWidth)</script>`
  const done = (ok: boolean, msg: string) => {
    console.log(`SELFTEST ${ok ? 'PASS' : 'FAIL'} ${msg}`)
    app.exit(ok ? 0 : 1)
  }
  setTimeout(() => done(false, 'timed out'), 30_000)
  await host.setRect({ x: 0, y: 100, width: 640, height: 400 })
  host.onConsole = (text) => {
    if (text.startsWith('dark:')) done(text === 'dark:true width:1280', text)
  }
  await host.start({ engine: 'chromium', url: page, viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })
}
