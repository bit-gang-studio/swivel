// Drives the built app: in each engine, click, type and scroll inside the live view.
// Run: npm run build && node scripts/e2e-live.mjs
import { _electron as electron } from 'playwright'

const PAGE = 'data:text/html,' + encodeURIComponent(`<!doctype html>
<body style="margin:0;height:4000px">
<button id=b style="position:fixed;left:0;top:0;width:100%;height:300px;font-size:40px">click me</button>
<input id=i style="position:fixed;left:0;top:320px;width:100%;height:100px;font-size:40px">
<script>
b.onclick=()=>console.log('clicked');
i.oninput=()=>{ if(i.value==='Hi') console.log('typed') };
addEventListener('scroll',()=>{ if(!window.s){window.s=1;console.log('scrolled')} });
</script></body>`)

const app = await electron.launch({ args: ['.'] })
const win = await app.firstWindow()
await win.waitForSelector('canvas.live')
const results = []

for (const label of ['Chrome', 'Firefox', 'Safari']) {
  await win.getByRole('button', { name: label, exact: true }).click()
  await win.waitForTimeout(1500)
  await win.getByLabel('Address').fill(PAGE)
  await win.getByLabel('Address').press('Enter')
  await win.waitForTimeout(1500)
  const canvas = win.locator('canvas.live')
  const box = await canvas.boundingBox()
  await win.mouse.click(box.x + box.width / 2, box.y + 20)
  const s = box.height / 800
  await win.mouse.click(box.x + box.width / 2, box.y + 370 * s)
  await win.keyboard.press('Shift+KeyH')
  await win.keyboard.press('KeyI')
  await win.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8)
  await win.mouse.wheel(0, 600)
  await win.waitForTimeout(1500)
  const text = await win.locator('.console').innerText()
  const tag = label === 'Chrome' ? 'Chrome' : label
  const lines = text.split('\n').filter((l) => l.startsWith(tag))
  results.push({ engine: label, clicked: lines.some((l) => l.includes('clicked')), scrolled: lines.some((l) => l.includes('scrolled')), typed: lines.some((l) => l.includes('typed')) })
}

await win.screenshot({ path: process.env.SHOT ?? 'e2e-live.png' })
await app.close()
console.table(results)
if (results.some((r) => !r.clicked || !r.scrolled || !r.typed)) process.exit(1)
