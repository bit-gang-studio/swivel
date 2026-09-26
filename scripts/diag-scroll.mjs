// Trackpad scroll lag and real-site loading per engine. Run after npm run build. SHOTS=dir saves screenshots.
import { withApp } from './app-window.mjs'

const PAGE = 'data:text/html,' + encodeURIComponent(`<body style="margin:0;height:20000px;background:linear-gradient(#fff,#000 5000px,#fff 10000px,#000 15000px,#fff)">
<script>console.log('ready');addEventListener('scroll',()=>{ window.last=performance.now() })</script></body>`)
const SITES = (process.env.SITES ?? 'https://github.com,https://www.apple.com,https://developer.mozilla.org/en-US/,https://news.ycombinator.com,https://www.wikipedia.org').split(',')

// Tests use the fixed Desktop size (positions below assume 1280×800) and need the console open.
async function prepare(win) {
  await win.getByLabel('Screen size').selectOption('2')
  const toggle = win.getByRole('button', { name: /^Console/ })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await win.waitForSelector('.console')
}

await withApp(async ({ app, win }) => {
  await prepare(win)
  const addr = win.getByLabel('Address')
  async function go(url) { await addr.fill(url); await addr.press('Enter') }
  async function seen(tag, text, timeout = 60_000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if ((await win.locator('.console').innerText()).split('\n').some((l) => l.startsWith(tag) && l.includes(text))) return true
      await win.waitForTimeout(200)
    }
    return false
  }
  const center = () => win.evaluate(() => { const c = document.querySelector('canvas.live'); return c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data[0] })
  const brightness = () => win.evaluate(() => {
    const c = document.querySelector('canvas.live'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let sum = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { sum += d[i] + d[i + 1] + d[i + 2]; n += 3 } return Math.round(sum / n)
  })

  const rows = []
  for (const name of [/^Chrome$/, /^Firefox$/, /^(Safari|WebKit)$/]) {
    const button = win.getByRole('group', { name: 'Browser engine' }).getByRole('button', { name })
    const tag = await button.innerText()
    await button.click()
    await go(PAGE)
    await seen(tag, 'ready')
    await win.waitForTimeout(1000)
    const box = await win.locator('canvas.live').boundingBox()
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    // 1 second of trackpad scrolling: 120 events of 8px.
    for (let k = 0; k < 120; k++) { await win.mouse.wheel(0, 8); await win.waitForTimeout(8) }
    const tEnd = Date.now()
    let prev = await center(), stableSince = Date.now()
    while (Date.now() - tEnd < 15000) {
      await win.waitForTimeout(20)
      const v = await center()
      if (v !== prev) { prev = v; stableSince = Date.now() }
      if (Date.now() - stableSince > 500) break
    }
    const row = { engine: tag, scrollCatchUpMs: stableSince - tEnd }

    for (const site of SITES) {
      await go(site)
      await win.waitForTimeout(6000)
      const host = new URL(site).hostname.replace('www.', '')
      row[host] = await brightness()
      if (process.env.SHOTS) await win.screenshot({ path: `${process.env.SHOTS}/${tag}-${host}.png` })
    }
    rows.push(row)
  }
  const status = await win.locator('.status').allInnerTexts()
  console.table(rows)
  console.log('last status:', status)
})
