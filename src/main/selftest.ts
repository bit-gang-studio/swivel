import { readFileSync } from 'node:fs'
import { app, type BrowserWindow } from 'electron'
import type { EngineHost } from './host'
import { nativeEngines } from './host'
import { logFile } from './log'

/**
 * SWIVEL_SELFTEST=1: check that frames in the native engines lay their page out at the frame's own
 * width, whatever size they're drawn at, and in the chosen colour scheme. Driven through the UI
 * like a person would, without a test runner attached (a runner changes how the debugger
 * behaves). Prints the result and quits.
 */
export async function selfTest(win: BrowserWindow, host: EngineHost): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const ui = (js: string) => win.webContents.executeJavaScript(js)
  // Each page reports its width while it first parses, and again after it loads. Only the loaded
  // layout must be right: Chromium on Windows can briefly show a site's first visit at the old zoom.
  const page =
    'data:text/html,' +
    encodeURIComponent(
      "<script>const early = innerWidth; addEventListener('load', () => setTimeout(() => { console.log('dark:' + matchMedia('(prefers-color-scheme: dark)').matches + ' width:' + innerWidth + ' early:' + early); console.log('mobile: android:' + /Android/.test(navigator.userAgent) + ' touch:' + ('ontouchstart' in window) + ' density:' + devicePixelRatio) }, 300))</script>"
    )
  const reports: { engine: string; text: string }[] = []
  host.onConsole = (engine, text) => (text.startsWith('dark:') || text.startsWith('mobile:')) && reports.push({ engine, text })
  /** Wait until every width has been reported by the engine, in dark mode. */
  const expect = async (engine: string, widths: number[]) => {
    const missing = () => widths.filter((w) => !reports.some((r) => r.engine === engine && r.text.includes(`dark:true width:${w} `)))
    for (let i = 0; i < 80 && missing().length; i++) await sleep(250)
    return missing()
  }
  let done = false
  const finish = (problems: string[]) => {
    if (done) return
    done = true
    console.log(`SELFTEST ${problems.length ? 'FAIL ' + problems.join(' | ') : 'PASS'}`)
    console.log(reports.map((r) => `${r.engine} ${r.text}`).join('\n'))
    const diagnostics = logFile()
    if (problems.length && diagnostics) console.log(readFileSync(diagnostics, 'utf8'))
    app.exit(problems.length ? 1 : 0)
  }
  setTimeout(() => finish(['timed out']), 90_000)

  await sleep(1500) // Let the window's UI settle.
  await ui(`document.querySelector('button[aria-label="Dark mode"]').click()`)
  await ui(`(() => {
    const input = document.querySelector('.address input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(page)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.form.requestSubmit()
  })()`)

  const problems: string[] = []
  // The Responsive set: Blink at four widths, drawn much smaller than that.
  const blink = await expect('chromium', [1440, 1280, 820, 390])
  if (blink.length) problems.push(`chromium frames missing widths ${blink.join(', ')}`)

  // The Browsers set: a frame per engine, 1280 wide.
  await ui(`[...document.querySelectorAll('.sets button')].find((b) => b.textContent.trim() === 'Browsers').click()`)
  for (const engine of nativeEngines()) {
    if (engine === 'chromium') continue // Checked above.
    const missing = await expect(engine, [1280])
    if (missing.length) problems.push(`${engine} frame missing width 1280`)
  }

  // Mobile mode on the Blink frame (a tablet, at this width): Chrome for Android's browser ID,
  // touch input, and a tablet's screen density.
  await ui(`document.querySelector('.frame[data-engine="chromium"] button.mobile').click()`)
  const wanted = 'mobile: android:true touch:true density:2'
  for (let i = 0; i < 80 && !reports.some((r) => r.engine === 'chromium' && r.text === wanted); i++) await sleep(250)
  if (!reports.some((r) => r.engine === 'chromium' && r.text === wanted)) problems.push(`chromium mobile mode: expected "${wanted}"`)
  finish(problems)
}
