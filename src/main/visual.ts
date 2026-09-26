import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, type BrowserWindow } from 'electron'

const run = promisify(execFile)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * SWIVEL_VISUAL=<dir>: drive the real UI through every engine and size, and save real
 * screenshots of the screen (native views can't be captured from inside the app).
 * No test runner is attached, so this runs exactly the code path users get. CI uploads the
 * images for a person (or Claude) to look at. Then quits.
 */
export async function visualCheck(win: BrowserWindow, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  const ui = (js: string) => win.webContents.executeJavaScript(js)
  const click = (label: string) =>
    ui(`[...document.querySelectorAll('button')].find((b) => /^(${label})$/.test(b.textContent.trim()))?.click()`)
  const size = (value: string) =>
    ui(`(() => { const s = document.querySelector('select'); s.value = '${value}'; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  const go = (url: string) =>
    ui(`(() => {
      const input = document.querySelector('.address input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(url)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.form.requestSubmit()
    })()`)
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

  win.setBounds({ x: 0, y: 0, width: 1400, height: 900 })
  await sleep(3000)
  await go(process.env.SWIVEL_VISUAL_URL ?? 'https://en.wikipedia.org/wiki/Oscar_Piastri')
  await sleep(6000)
  await shot('default')
  // Resize the window in "Fill window": the page should follow without reloading.
  win.setBounds({ x: 0, y: 0, width: 1000, height: 700 })
  await sleep(3000)
  await shot('default-resized')
  win.setBounds({ x: 0, y: 0, width: 1400, height: 900 })
  await sleep(2000)
  for (const [engine, label] of [['chromium', 'Chromium'], ['firefox', 'Firefox'], ['webkit', 'WebKit']]) {
    await click(label)
    for (const [value, name] of [['fill', 'fill'], ['2', 'desktop'], ['0', 'phone']] as const) {
      await size(value)
      await sleep(5000)
      await shot(`${engine}-${name}`)
    }
    await size('fill')
  }
  app.exit(0)
}
