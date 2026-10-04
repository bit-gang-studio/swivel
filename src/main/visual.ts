import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, screen, type BrowserWindow } from 'electron'

const run = promisify(execFile)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * SWIVEL_VISUAL=<dir>: drive the real UI through its sets, frames and focus mode, and save real
 * screenshots of the screen (native views can't be captured from inside the app).
 * No test runner is attached, so this runs exactly the code path users get. CI uploads the
 * images for a person (or Claude) to look at. Then quits.
 */
export async function visualCheck(win: BrowserWindow, dir: string, newWindow: () => BrowserWindow): Promise<void> {
  mkdirSync(dir, { recursive: true })
  const ui = (js: string, w = win) => w.webContents.executeJavaScript(js)
  const go = (url: string, w = win) =>
    ui(`(() => {
      const input = document.querySelector('.address input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(url)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.form.requestSubmit()
    })()`, w)
  const shot = async (name: string) => {
    const file = join(dir, `${name}.png`)
    try {
      if (process.platform === 'darwin') await run('screencapture', ['-x', file])
      else if (process.platform === 'linux') await run('import', ['-window', 'root', file])
      console.log(`VISUAL saved ${file}`)
    } catch (err) {
      console.log(`VISUAL could not capture ${name}: ${err}`)
    }
  }

  // As big as the screen allows, so every frame of a set can be seen in a shot.
  const area = screen.getPrimaryDisplay().workArea
  const full = { x: area.x, y: area.y, width: Math.min(1400, area.width), height: Math.min(900, area.height) }
  win.setBounds(full)
  const set = (name: string, w = win) => ui(`[...document.querySelectorAll('.sets button')].find((b) => b.textContent.trim() === '${name}')?.click()`, w)
  const wheel = (dx: number, dy: number, ctrl = false) =>
    ui(`(() => { const c = document.querySelector('.canvas'); const r = c.getBoundingClientRect(); c.dispatchEvent(new WheelEvent('wheel', { deltaX: ${dx}, deltaY: ${dy}, ctrlKey: ${ctrl}, clientX: r.left + 20, clientY: r.top + 20, bubbles: true, cancelable: true })) })()`)

  // A new window: empty, nothing loading, nothing flashing up.
  await sleep(2000)
  await shot('start')

  // The first URL opens the Responsive set: one engine at four sizes.
  await go(process.env.SWIVEL_VISUAL_URL ?? 'https://en.wikipedia.org/wiki/Oscar_Piastri')
  await sleep(10000)
  await shot('responsive')

  // The Browsers set: Blink, Gecko and WebKit side by side (a real Firefox window starts; it
  // must not show anywhere).
  await set('Browsers')
  for (const t of [1, 2, 3]) {
    await sleep(1000)
    await shot(`browsers-starting-${t}s`)
  }
  await sleep(10000)
  await shot('browsers')

  // Panned partly under the toolbar, each frame must be cut off at the canvas edge, never drawn
  // over the toolbar.
  await wheel(0, 120)
  await sleep(3000)
  await shot('canvas-panned')
  await wheel(0, -120)
  // Zoomed in, then far out: every frame stays live and sharp.
  await wheel(0, -150, true)
  await sleep(4000)
  await shot('canvas-zoomed-in')
  await wheel(0, 400, true)
  await sleep(4000)
  await shot('canvas-zoomed-out')
  await ui(`[...document.querySelectorAll('.canvas-bar button')].find((b) => b.textContent.trim() === 'Fit')?.click()`)
  await sleep(3000)

  // Focus mode: one frame fills the window; the others keep running, hidden.
  for (const engine of ['chromium', 'firefox', 'webkit']) {
    await ui(`document.querySelector('.frame[data-engine="${engine}"] button[aria-label="Focus frame"]')?.click()`)
    await sleep(4000)
    await shot(`focus-${engine}`)
    await ui(`[...document.querySelectorAll('.canvas-bar button')].find((b) => b.textContent.includes('Canvas'))?.click()`)
    await sleep(1500)
  }

  // Find bar, across the frames.
  win.webContents.send('swivel:command', 'find')
  await sleep(500)
  await ui(`(() => {
    const input = document.querySelector('.findbar input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Piastri')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(3000)
  await shot('find')
  await ui(`document.querySelector('.findbar button[aria-label="Close find"]')?.click()`)

  // Google serves old fallback pages to browsers it doesn't recognise: each engine must get the
  // same page its real browser does.
  await go('https://www.google.com/')
  await sleep(8000)
  await shot('google')
  await go(process.env.SWIVEL_VISUAL_URL ?? 'https://en.wikipedia.org/wiki/Oscar_Piastri')
  await sleep(6000)

  // Mission Control shows every window; the parked Firefox window must not be among them.
  if (process.platform === 'darwin') {
    await run('open', ['-a', 'Mission Control']).catch(() => {})
    await sleep(2500)
    await shot('mission-control')
    await run('open', ['-a', 'Mission Control']).catch(() => {})
    await sleep(1500)
  }
  // Minimize and restore Swivel: the Firefox window must not appear, and its mirror must come back.
  win.minimize()
  await sleep(2500)
  await shot('swivel-minimized')
  win.restore()
  await sleep(3500)
  await shot('swivel-restored')
  // Move Swivel: the mirror follows, and no real Firefox window shows anywhere.
  win.setBounds({ x: area.x + 80, y: area.y + 60, width: full.width - 160, height: full.height - 120 })
  await sleep(3000)
  await shot('swivel-moved')
  if (process.platform === 'darwin') {
    // Firefox processes the Dock may show: every one must be background or UI element only.
    const { stdout } = await run('lsappinfo', ['list']).catch(() => ({ stdout: '' }))
    const nightly = stdout.split(/\n(?=\s*\d+\) ")/).filter((a) => /Nightly|firefox|plugin-container/i.test(a))
    console.log(`VISUAL firefox apps: ${nightly.length}`)
    for (const a of nightly) console.log(`VISUAL ${a.match(/"[^"]*"/)?.[0]} ${a.match(/type="[^"]*"/)?.[0] ?? a.match(/Foreground|UIElement|BackgroundOnly/)?.[0] ?? ''}`)
  }
  // Two windows, each with its own frames and data.
  win.setBounds({ x: area.x, y: area.y, width: Math.max(900, Math.floor(full.width / 2)), height: full.height })
  const second = newWindow()
  await new Promise<void>((r) => second.webContents.once('did-finish-load', () => r()))
  second.setBounds({ x: area.x + 60, y: area.y + 60, width: Math.max(900, Math.floor(full.width / 2)), height: full.height - 60 })
  await sleep(2000)
  await go('https://en.wikipedia.org/wiki/Lando_Norris', second)
  await sleep(3000)
  await set('Browsers', second)
  await sleep(12000)
  await shot('two-windows')
  second.close()
  await sleep(2000)
  await shot('second-window-closed')
  app.exit(0)
}
