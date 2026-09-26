// Drives the built app: in each engine, click, type and scroll inside the live view.
// Run: npm run build && node scripts/e2e-live.mjs
import { _electron as electron } from 'playwright'

const PAGE = 'data:text/html,' + encodeURIComponent(`<!doctype html>
<body style="margin:0;height:4000px">
<button id=b style="position:fixed;left:0;top:0;width:100%;height:300px;font-size:40px">click me</button>
<input id=i style="position:fixed;left:0;top:320px;width:100%;height:100px;font-size:40px">
<script>
console.log('ready');
b.onclick=()=>console.log('clicked');
i.oninput=()=>{ if(i.value==='Hi') console.log('typed') };
addEventListener('scroll',()=>{ if(!window.s){window.s=1;console.log('scrolled')} });
</script></body>`)

const app = await electron.launch({ args: ['.'] })
app.process().stderr?.on('data', (d) => process.env.DEBUG_APP && process.stderr.write(d))
app.process().stdout?.on('data', (d) => process.env.DEBUG_APP && process.stdout.write(d))
const win = await app.firstWindow()
await win.waitForSelector('canvas.live')

// Poll the console panel for a line from this engine.
async function seen(tag, text, timeout = 20_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const lines = (await win.locator('.console').innerText()).split('\n')
    if (lines.some((l) => l.startsWith(tag) && l.includes(text))) return true
    await win.waitForTimeout(250)
  }
  return false
}

await win.getByLabel('Address').fill(PAGE)
await win.getByLabel('Address').press('Enter')

const results = []
for (const name of [/^Chrome$/, /^Firefox$/, /^(Safari|WebKit)$/]) {
  const button = win.getByRole('group', { name: 'Browser engine' }).getByRole('button', { name })
  const tag = await button.innerText()
  await button.click()
  const ready = await seen(tag, 'ready', 60_000)
  await win.waitForTimeout(500)
  const box = await win.locator('canvas.live').boundingBox()
  const s = box.height / 800
  await win.mouse.click(box.x + box.width / 2, box.y + 20)
  const clicked = await seen(tag, 'clicked')
  await win.mouse.click(box.x + box.width / 2, box.y + 370 * s)
  await win.keyboard.press('Shift+KeyH')
  await win.keyboard.press('KeyI')
  const typed = await seen(tag, 'typed')
  await win.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8)
  await win.mouse.wheel(0, 600)
  const scrolled = await seen(tag, 'scrolled')
  results.push({ engine: tag, ready, clicked, typed, scrolled })
}

if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT })
const failed = results.some((r) => !r.ready || !r.clicked || !r.typed || !r.scrolled)
if (failed) {
  console.log('address:', await win.getByLabel('Address').inputValue())
  console.log('status:', await win.locator('.status').allInnerTexts())
  console.log('console:', await win.locator('.console').innerText())
}
await app.close()
console.table(results)
if (failed) process.exit(1)
