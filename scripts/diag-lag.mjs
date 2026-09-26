// Measures input lag in the built app: stream mouse moves like a user, then click. Run after npm run build.
// and time until the canvas shows the page's reaction.
import { launchApp } from './app-window.mjs'

const PAGE = 'data:text/html,' + encodeURIComponent(`<style>html,body{margin:0;height:100%;background:#fff}</style>
<script>console.log('ready');let on=false;document.addEventListener('mousedown',()=>{on=!on;document.body.style.background=on?'#000':'#fff'})</script>`)

const { app, win, done } = await launchApp()
await win.waitForSelector('canvas.live')
await win.getByLabel('Address').fill(PAGE)
await win.getByLabel('Address').press('Enter')

async function seen(tag, text, timeout = 60_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if ((await win.locator('.console').innerText()).split('\n').some((l) => l.startsWith(tag) && l.includes(text))) return true
    await win.waitForTimeout(200)
  }
  return false
}

// Center pixel brightness of the canvas, read inside the app.
const center = () => win.evaluate(() => {
  const c = document.querySelector('canvas.live'); const ctx = c.getContext('2d')
  return ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[0]
})

const rows = []
for (const name of [/^Chrome$/, /^Firefox$/, /^(Safari|WebKit)$/]) {
  const button = win.getByRole('group', { name: 'Browser engine' }).getByRole('button', { name })
  const tag = await button.innerText()
  await button.click()
  await seen(tag, 'ready')
  await win.waitForTimeout(1000)
  const box = await win.locator('canvas.live').boundingBox()
  const lags = []
  for (let i = 0; i < 6; i++) {
    // A second of mouse movement, like a user, then click.
    for (let k = 0; k < 60; k++) {
      await win.mouse.move(box.x + 100 + ((k * 13) % (box.width - 200)), box.y + 100 + ((k * 7) % (box.height - 200)))
      await win.waitForTimeout(16)
    }
    const before = await center()
    const t0 = Date.now()
    await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    let lag = -1
    while (Date.now() - t0 < 5000) {
      if (Math.abs((await center()) - before) > 100) { lag = Date.now() - t0; break }
      await win.waitForTimeout(5)
    }
    lags.push(lag)
  }
  rows.push({ engine: tag, lagsMs: lags.join(', ') })
}
await done()
console.table(rows)
