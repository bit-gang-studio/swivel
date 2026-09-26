// Drives the built app: in each engine, click, type and scroll inside the live view.
// Run: npm run build && node scripts/e2e-live.mjs
import http from 'node:http'
import { withApp } from './app-window.mjs'

// A page whose stylesheet never arrives, so it never finishes loading.
const slow = http.createServer((req, res) => {
  if (req.url === '/hang.css') return
  res.setHeader('content-type', 'text/html')
  res.end('<link rel=stylesheet href=/hang.css><h1>slow</h1>')
}).listen(0)
const SLOW = `http://127.0.0.1:${slow.address().port}/`

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

await withApp(async ({ app, win }) => {
  await win.waitForSelector('.native-box')

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
    let clicked, typed, scrolled
    if (tag === 'Chrome') {
      // Chrome is a native view: real input goes straight to it, so inject input through
      // Electron and check its console reaches Swivel.
      const page = app.windows().find((p) => p !== win && p.url().startsWith('data:'))
      const width = await page.evaluate(() => innerWidth)
      if (width !== 1280) console.log(`Chrome innerWidth is ${width}, expected 1280`)
      // Inject input the way the OS does, through Electron, in view coordinates.
      const send = (events) =>
        app.evaluate(async ({ BrowserWindow }, events) => {
          const view = BrowserWindow.getAllWindows()[0].contentView.children[0]
          const scale = view.getBounds().width / 1280
          for (const e of events) {
            const ev = { ...e }
            if ('x' in ev) Object.assign(ev, { x: Math.round(ev.x * scale), y: Math.round(ev.y * scale) })
            view.webContents.sendInputEvent(ev)
            await new Promise((r) => setTimeout(r, 30))
          }
        }, events)
      await send([{ type: 'mouseDown', x: 640, y: 20, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: 640, y: 20, button: 'left', clickCount: 1 }])
      clicked = await seen(tag, 'clicked')
      await send([
        { type: 'mouseDown', x: 640, y: 370, button: 'left', clickCount: 1 },
        { type: 'mouseUp', x: 640, y: 370, button: 'left', clickCount: 1 },
        { type: 'char', keyCode: 'H' },
        { type: 'char', keyCode: 'i' }
      ])
      typed = await seen(tag, 'typed')
      await send([{ type: 'mouseWheel', x: 640, y: 600, deltaX: 0, deltaY: -600 }])
      scrolled = await seen(tag, 'scrolled')
    } else {
      // Streamed engines: input goes through Swivel's canvas.
      const box = await win.locator('canvas.live').boundingBox()
      const s = box.height / 800
      await win.mouse.click(box.x + box.width / 2, box.y + 20)
      clicked = await seen(tag, 'clicked')
      await win.mouse.click(box.x + box.width / 2, box.y + 370 * s)
      await win.keyboard.press('Shift+KeyH')
      await win.keyboard.press('KeyI')
      typed = await seen(tag, 'typed')
      await win.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8)
      await win.mouse.wheel(0, 600)
      scrolled = await seen(tag, 'scrolled')
    }

    // Navigating away from a page that is still loading must not wait for it.
    await win.getByLabel('Address').fill(SLOW)
    await win.getByLabel('Address').press('Enter')
    await win.waitForTimeout(1000)
    const marker = `ready-${results.length}`
    const t0 = Date.now()
    await win.getByLabel('Address').fill(PAGE.replace("console.log('ready')", `console.log('${marker}')`))
    await win.getByLabel('Address').press('Enter')
    const escaped = await seen(tag, marker, 10_000)
    const escapeMs = escaped ? Date.now() - t0 : -1

    results.push({ engine: tag, ready, clicked, typed, scrolled, leftSlowPageMs: escapeMs })
  }

  if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT })
  const failed = results.some((r) => !r.ready || !r.clicked || !r.typed || !r.scrolled || r.leftSlowPageMs < 0)
  if (failed) {
    console.log('address:', await win.getByLabel('Address').inputValue())
    console.log('status:', await win.locator('.status').allInnerTexts())
    console.log('console:', await win.locator('.console').innerText())
  }
  slow.closeAllConnections()
  slow.close()
  console.table(results)
  return failed ? 1 : 0
})
