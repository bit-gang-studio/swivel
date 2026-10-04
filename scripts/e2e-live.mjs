// Drives the built app: on the canvas, with one frame per engine, click, type, scroll and find in
// each frame, leave a page that never finishes loading, and follow a link from one frame.
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
<button id=b style="position:fixed;left:0;top:0;width:100%;height:100px;font-size:40px;cursor:pointer">click me</button>
<input id=i style="position:fixed;left:0;top:120px;width:100%;height:60px;font-size:30px">
<a id=l href="${SLOW}p2" style="position:fixed;left:0;top:200px;width:100%;height:60px;font-size:30px;display:block">next page</a>
<script>
console.log('ready');
b.onclick=()=>console.log('clicked');
i.oninput=()=>{ if(i.value==='Hi') console.log('typed') };
addEventListener('scroll',()=>{ if(!window.s){window.s=1;console.log('scrolled')} });
</script></body>`)

// The Browsers set: one frame per engine, each 1280 wide. Console lines are tagged by engine name.
const ENGINES = [
  ['chromium', 'Blink'],
  ['firefox', 'Gecko'],
  ['webkit', 'WebKit']
]
const WIDTH = 1280

await withApp(async ({ app, win }) => {
  const go = async (url) => {
    await win.getByLabel('Address').fill(url)
    await win.getByLabel('Address').press('Enter')
  }
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
  /** Run script in the first frame of an engine. */
  const run = (engine, js) => app.evaluate((_, { engine, js }) => globalThis.swivelHost.frameView(engine).run(js), { engine, js })
  /** The page area of an engine's frame, on screen. */
  const frameBox = (engine) => win.locator(`.frame[data-engine="${engine}"] .frame-body`).boundingBox()

  const toggle = win.getByRole('button', { name: /^Console/ })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click() // Its state is remembered.
  await win.waitForSelector('.console')

  // A new window is empty; the first URL opens the canvas.
  await go(PAGE)
  await win.waitForSelector('.frame')
  await win.getByRole('button', { name: 'Browsers', exact: true }).click()
  await win.waitForSelector('.frame[data-engine="webkit"]')
  const natives = await win.evaluate(() => window.swivel.nativeEngines)

  const results = []
  for (const [engine, tag] of ENGINES) {
    const ready = await seen(tag, 'ready', 60_000)
    await win.waitForTimeout(500)
    let clicked, typed, scrolled
    let pointer = true // Native engines show the cursor themselves.

    // Every frame lays its page out at its own width, whatever the canvas zoom.
    await run(engine, "console.log('width:' + innerWidth)")
    let width = NaN
    for (let i = 0; i < 40 && Number.isNaN(width); i++) {
      const line = (await win.locator('.console').innerText()).split('\n').find((l) => l.startsWith(tag) && l.includes('width:'))
      if (line) width = Number(line.split('width:')[1])
      else await win.waitForTimeout(250)
    }
    const sized = Math.abs(width - WIDTH) <= 1
    if (!sized) console.log(`${tag} innerWidth is ${width}, expected ${WIDTH}`)

    if (engine === 'chromium') {
      // A native view: real input goes straight to it, so inject input through Electron, the way
      // the OS does, at page coordinates.
      const send = (events) => app.evaluate((_, events) => globalThis.swivelHost.frameView('chromium').testInput(events), events)
      await send([{ type: 'mouseDown', x: 400, y: 20, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: 400, y: 20, button: 'left', clickCount: 1 }])
      clicked = await seen(tag, 'clicked')
      await send([
        { type: 'mouseDown', x: 400, y: 150, button: 'left', clickCount: 1 },
        { type: 'mouseUp', x: 400, y: 150, button: 'left', clickCount: 1 },
        { type: 'char', keyCode: 'H' },
        { type: 'char', keyCode: 'i' }
      ])
      typed = await seen(tag, 'typed')
      await send([{ type: 'mouseWheel', x: 400, y: 300, deltaX: 0, deltaY: -600 }])
      scrolled = await seen(tag, 'scrolled')
    } else if (natives.includes(engine)) {
      // WebKit on macOS is a native view too: macOS delivers input to it (the real-click test
      // covers that). Drive the page with script and check its console reaches Swivel.
      await run(engine, "document.getElementById('b').click()")
      clicked = await seen(tag, 'clicked')
      await run(engine, "const i = document.getElementById('i'); i.value = 'Hi'; i.dispatchEvent(new Event('input'))")
      typed = await seen(tag, 'typed')
      await run(engine, 'window.scrollBy(0, 600)')
      scrolled = await seen(tag, 'scrolled')
    } else {
      // Input goes through Swivel: the frame's own canvas takes the mouse and keyboard.
      const canvas = win.locator(`.frame[data-engine="${engine}"] canvas.live`)
      const box = await canvas.boundingBox()
      const s = box.width / WIDTH
      await win.mouse.move(box.x + box.width / 2, box.y + 30 * s)
      let cursor = ''
      for (let i = 0; i < 20 && cursor !== 'pointer'; i++) {
        await win.waitForTimeout(150)
        cursor = await canvas.evaluate((c) => c.style.cursor)
      }
      if (cursor !== 'pointer') console.log(`${tag} cursor over button is "${cursor}", expected pointer`)
      pointer = cursor === 'pointer'
      await win.mouse.click(box.x + box.width / 2, box.y + 20 * s)
      clicked = await seen(tag, 'clicked')
      await win.mouse.click(box.x + box.width / 2, box.y + 150 * s)
      await win.keyboard.press('Shift+KeyH')
      await win.keyboard.press('KeyI')
      typed = await seen(tag, 'typed')
      await win.mouse.move(box.x + box.width / 2, box.y + 300 * s)
      await win.mouse.wheel(0, 600)
      scrolled = await seen(tag, 'scrolled')
    }

    // Find in page searches the selected frame: open it the way the menu shortcut does, search,
    // expect exactly one match.
    const id = await win.locator(`.frame[data-engine="${engine}"]`).getAttribute('data-frame')
    await win.evaluate((id) => window.swivel.selectFrame(id), id)
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

    results.push({ engine: tag, ready, sized, clicked, typed, scrolled, pointer, found })
  }

  // Navigating away from a page that is still loading must not wait for it, in any frame.
  await go(SLOW)
  await win.waitForTimeout(1000)
  const t0 = Date.now()
  await go(PAGE.replace("console.log('ready')", "console.log('ready-after-slow')"))
  for (const r of results) r.leftSlowPageMs = (await seen(r.engine, 'ready-after-slow', 10_000)) ? Date.now() - t0 : -1

  // Follow: click a link in the Gecko frame (input goes through Swivel on every OS); the other
  // frames must go there too.
  await win.waitForTimeout(1000)
  const box = await frameBox('firefox')
  await win.mouse.click(box.x + box.width / 2, box.y + 230 * (box.width / WIDTH))
  const followed = {}
  for (const [, tag] of ENGINES) followed[tag] = await seen(tag, 'page2', 20_000)
  console.log('followed link:', JSON.stringify(followed))
  const followFailed = Object.values(followed).some((ok) => !ok)

  if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT })
  const failed = followFailed || results.some((r) => !r.ready || !r.sized || !r.clicked || !r.typed || !r.scrolled || !r.pointer || !r.found || r.leftSlowPageMs < 0)
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
