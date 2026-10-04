import { app, type BrowserWindow } from 'electron'
import type { EngineId } from '../shared/types'
import type { EngineHost } from './host'
import { webkitAddon } from './native-safari'

/**
 * SWIVEL_CLICKTEST=1 (macOS): real clicks, sent through the window and hit-tested by macOS like a
 * user's (test runners click inside the page and skip that). Checks the bar under the canvas,
 * every frame's page, and the toolbar. Prints the result and quits.
 */
export async function clickTest(win: BrowserWindow, host: EngineHost): Promise<void> {
  const addon = webkitAddon as { clickAt?: (h: Buffer, x: number, y: number) => void } | null
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const results: string[] = []
  let failed = false
  const check = (label: string, ok: boolean) => {
    results.push(`${ok ? 'ok' : 'FAIL'} ${label}${ok ? '' : ' ' + JSON.stringify(Object.fromEntries(Object.entries(host.viewUrls).map(([k, u]) => [k, u.slice(0, 30)])))}`)
    if (!ok) failed = true
  }
  const finish = () => {
    console.log(`CLICKTEST ${failed ? 'FAIL' : 'PASS'}\n${results.join('\n')}`)
    app.exit(failed ? 1 : 0)
  }
  setTimeout(() => {
    results.push('timed out')
    failed = true
    finish()
  }, 150_000)
  if (!addon?.clickAt) {
    console.log('CLICKTEST skipped: macOS only')
    return app.exit(0)
  }
  // Small enough for CI screens, and active: an inactive window's first click only activates it.
  win.setBounds({ x: 0, y: 0, width: 1400, height: 900 })
  win.focus()
  app.focus({ steal: true })
  const click = (x: number, y: number) => addon.clickAt!(win.getNativeWindowHandle(), x, y)
  const ui = (js: string) => win.webContents.executeJavaScript(js)
  /** Whether an engine logs "clicked" within a time limit after fn runs. */
  const clicked = async (engine: EngineId, fn: () => void) => {
    const seen = new Promise<boolean>((resolve) => {
      host.onConsole = (from, text) => from === engine && text.startsWith('clicked') && resolve(true)
      setTimeout(() => resolve(false), 8000)
    })
    fn()
    return seen
  }

  // The whole page is one button that logs when clicked.
  const page = 'data:text/html,' + encodeURIComponent("<body style='margin:0'><button style='width:100vw;height:100vh' onclick=\"console.log('clicked')\">Click</button></body>")
  await sleep(1500)
  await ui(`(() => {
    const input = document.querySelector('.address input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(page)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.form.requestSubmit()
  })()`)
  await sleep(4000)

  // The first URL opened the canvas. The bar under it, over native views: a real click on the
  // Browsers set swaps the frames for one per engine.
  const browsers = (await ui(`(() => { const b = [...document.querySelectorAll('.sets button')].find((b) => b.textContent.trim() === 'Browsers'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)) as { x: number; y: number }
  click(browsers.x, browsers.y)
  await sleep(12000)
  check('canvas bar (Browsers set)', await ui(`document.querySelector('.sets button[aria-pressed="true"]')?.textContent.trim() === 'Browsers'`))

  // Every frame's page.
  const frames = (await ui(`[...document.querySelectorAll('.frame')].map((f) => {
    const r = f.querySelector('.frame-body').getBoundingClientRect()
    return { engine: f.dataset.engine, x: r.left + Math.min(r.width / 2, 100), y: r.top + Math.min(r.height / 2, 100), visible: r.right < innerWidth && r.bottom < innerHeight }
  })`)) as { engine: EngineId; x: number; y: number; visible: boolean }[]
  check('three frames', frames.length === 3)
  for (const f of frames) {
    if (!f.visible) continue // Off the window's edge on a small screen.
    check(`${f.engine} frame`, await clicked(f.engine, () => click(f.x, f.y)))
  }

  // The toolbar, over native views: a real click on Dark mode presses it.
  const dark = (await ui(`(() => { const r = document.querySelector('button[aria-label="Dark mode"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)) as { x: number; y: number }
  click(dark.x, dark.y)
  await sleep(1000)
  check('toolbar (Dark mode button)', await ui(`document.querySelector('button[aria-label="Dark mode"]').getAttribute('aria-pressed') === 'true'`))
  finish()
}
