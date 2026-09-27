// Drives the built app: in each engine, click, type and scroll inside the live view.
// Run: npm run build && node scripts/e2e-live.mjs
import http from 'node:http'
import { withApp } from './app-window.mjs'

// Local pages: one whose stylesheet never arrives (it never finishes loading), and a second page
// to follow a link to.
const slow = http.createServer((req, res) => {
  if (req.url === '/hang.css') return
  res.setHeader('content-type', 'text/html')
  if (req.url === '/p2') return res.end("<script>console.log('page2')</script><h1>page 2</h1>")
  res.end('<link rel=stylesheet href=/hang.css><h1>slow</h1>')
}).listen(0)
const SLOW = `http://127.0.0.1:${slow.address().port}/`

const PAGE = 'data:text/html,' + encodeURIComponent(`<!doctype html>
<body style="margin:0;height:4000px">
<button id=b style="position:fixed;left:0;top:0;width:100%;height:300px;font-size:40px;cursor:pointer">click me</button>
<input id=i style="position:fixed;left:0;top:320px;width:100%;height:100px;font-size:40px">
<a id=l href="${SLOW}p2" style="position:fixed;left:0;top:450px;width:100%;height:100px;font-size:40px;display:block">next page</a>
<script>
console.log('ready');
b.onclick=()=>console.log('clicked');
i.oninput=()=>{ if(i.value==='Hi') console.log('typed') };
addEventListener('scroll',()=>{ if(!window.s){window.s=1;console.log('scrolled')} });
</script></body>`)

// Tests use the fixed Desktop size (positions below assume 1280×800) and need the console open.
async function prepare(win) {
  await win.getByLabel('Screen size').selectOption('2')
  const toggle = win.getByRole('button', { name: /^Console/ })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await win.waitForSelector('.console')
}

await withApp(async ({ app, win }) => {
  await prepare(win)
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
  for (const name of [/^Chromium$/, /^Firefox$/, /^WebKit$/]) {
    const button = win.getByRole('group', { name: 'Browser engine' }).getByRole('button', { name })
    const tag = await button.innerText()
    await button.click()
    const ready = await seen(tag, 'ready', 60_000)
    await win.waitForTimeout(500)
    let clicked, typed, scrolled
    let pointer = true // Native engines show the cursor themselves.
    const natives = await win.evaluate(() => window.swivel.nativeEngines)
    if (tag === 'WebKit' && natives.includes('webkit')) {
      // Safari is a native WKWebView: input goes straight to it from macOS. Drive the page with
      // script and check its console reaches Swivel.
      const run = (js) => app.evaluate((_, js) => globalThis.swivelHost.get('webkit').run(js), js)
      const width = await new Promise((resolve) => {
        run("console.log('width:' + innerWidth)")
        const t = setInterval(async () => {
          const line = (await win.locator('.console').innerText()).split('\n').find((l) => l.startsWith('WebKit') && l.includes('width:'))
          if (line) {
            clearInterval(t)
            resolve(Number(line.split('width:')[1]))
          }
        }, 250)
      })
      if (width !== 1280) console.log(`WebKit innerWidth is ${width}, expected 1280`)
      await run("document.getElementById('b').click()")
      clicked = await seen(tag, 'clicked')
      await run("const i = document.getElementById('i'); i.value = 'Hi'; i.dispatchEvent(new Event('input'))")
      typed = await seen(tag, 'typed')
      await run('window.scrollBy(0, 600)')
      scrolled = await seen(tag, 'scrolled')
    } else if (tag === 'Chromium') {
      // Chrome is a native view: real input goes straight to it, so inject input through
      // Electron and check its console reaches Swivel.
      const width = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.executeJavaScript('innerWidth')
      )
      if (width !== 1280) console.log(`Chromium innerWidth is ${width}, expected 1280`)
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
      await win.mouse.move(box.x + box.width / 2, box.y + 30)
      let cursor = ''
      for (let i = 0; i < 20 && cursor !== 'pointer'; i++) {
        await win.waitForTimeout(150)
        cursor = await win.locator('canvas.live').evaluate((c) => c.style.cursor)
      }
      if (cursor !== 'pointer') console.log(`${tag} cursor over button is "${cursor}", expected pointer`)
      pointer = cursor === 'pointer'
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

    // Find in page: open it the way the menu shortcut does, search, expect exactly one match.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('swivel:command', 'find'))
    await win.getByPlaceholder('Find in page').fill('click me')
    let count = ''
    for (let i = 0; i < 20 && count !== '1/1'; i++) {
      await win.waitForTimeout(150)
      count = await win.locator('.find-count').innerText()
    }
    if (count !== '1/1') console.log(`${tag} find shows "${count}", expected 1/1`)
    const found = count === '1/1'
    await win.getByPlaceholder('Find in page').press('Escape')

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

    results.push({ engine: tag, ready, clicked, typed, scrolled, pointer, found, leftSlowPageMs: escapeMs })
  }

  // Sync: click a link in Firefox (streamed on every OS); the other engines must follow.
  await win.getByRole('group', { name: 'Browser engine' }).getByRole('button', { name: /^Firefox$/ }).click()
  await win.getByLabel('Address').fill(PAGE.replace("console.log('ready')", "console.log('ready-sync')"))
  await win.getByLabel('Address').press('Enter')
  await seen('Firefox', 'ready-sync', 30_000)
  await win.waitForTimeout(1000)
  const box = await win.locator('canvas.live').boundingBox()
  await win.mouse.click(box.x + box.width / 2, box.y + 500 * (box.height / 800))
  if (process.env.SWIVEL_DEBUG) console.log('sync click at canvas', JSON.stringify(box))
  const followed = {}
  for (const engine of ['Firefox', 'Chromium', 'WebKit']) followed[engine] = await seen(engine, 'page2', 20_000)
  console.log('followed link:', JSON.stringify(followed))
  const syncFailed = Object.values(followed).some((ok) => !ok)

  if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT })
  const failed = syncFailed || results.some((r) => !r.ready || !r.clicked || !r.typed || !r.scrolled || !r.pointer || !r.found || r.leftSlowPageMs < 0)
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
