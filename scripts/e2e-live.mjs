// Drives the built app: on the canvas, with one frame per engine, click, type, scroll and find in
// each frame, leave a page that never finishes loading, repeat one frame's scroll, click and
// typing in the others (sync), and follow a link from one frame.
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
  // Input the way the OS sends it to the Blink frame (a native view), at page coordinates.
  const blinkInput = (events) => app.evaluate((_, events) => globalThis.swivelHost.frameView('chromium').testInput(events), events)
  // Sync off while each frame's own input is checked, or one frame's input would pass for all.
  const sync = win.getByRole('button', { name: 'Sync frames' })
  await sync.click()

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
      const send = blinkInput
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

  // One page filling the window, like a normal browser: the toolbar's Canvas toggle shows the
  // first frame alone at the window's size, and puts it back at its own size after.
  const canvasToggle = win.locator('.toolbar button[aria-label="Canvas"]') // Not the bar's own "Canvas" button, shown while one page fills the window.
  await canvasToggle.click()
  await win.waitForTimeout(1500)
  const areaWidth = await win.evaluate(() => Math.floor(document.querySelector('.canvas').clientWidth))
  await run('chromium', "console.log('fill-width:' + innerWidth)")
  const filled = await seen('Blink', `fill-width:${areaWidth}`, 5000)
  await canvasToggle.click()
  await win.waitForTimeout(1500)
  await run('chromium', "console.log('restored-width:' + innerWidth)")
  const restored = await seen('Blink', `restored-width:${WIDTH}`, 5000)
  if (!filled || !restored) console.log(`single page: filled the window (${areaWidth} wide) ${filled}, back to ${WIDTH} wide ${restored}`)

  // Sync: a click, typing and a scroll in the Blink frame are repeated in the other frames.
  await sync.click()
  const marked = PAGE.replace("console.log('ready')", "console.log('sync-ready')").replaceAll("'clicked'", "'sync-clicked'").replaceAll("'typed'", "'sync-typed'")
  await go(marked)
  for (const [, tag] of ENGINES) await seen(tag, 'sync-ready', 20_000)
  await win.waitForTimeout(1000)
  await blinkInput([{ type: 'mouseDown', x: 400, y: 20, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: 400, y: 20, button: 'left', clickCount: 1 }])
  await blinkInput([
    { type: 'mouseDown', x: 400, y: 150, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x: 400, y: 150, button: 'left', clickCount: 1 },
    { type: 'char', keyCode: 'H' },
    { type: 'char', keyCode: 'i' }
  ])
  await blinkInput([{ type: 'mouseWheel', x: 400, y: 300, deltaX: 0, deltaY: -600 }])
  await win.waitForTimeout(1500)
  for (const [engine] of ENGINES) await run(engine, "console.log('sync-scrolled:' + (scrollY > 0))")
  for (const r of results) {
    r.synced = (await seen(r.engine, 'sync-clicked')) && (await seen(r.engine, 'sync-typed')) && (await seen(r.engine, 'sync-scrolled:true', 5000))
    if (!r.synced) console.log(`${r.engine} did not repeat the Blink frame's click, typing and scroll`)
  }

  // The console prompt: a line runs in every engine, and answers that differ are marked.
  const ask = (code) => win.evaluate((code) => window.swivel.evaluate(code), code)
  const answers = async (code) => ((await ask(code)).results ?? []).map((r) => `${r.ok}:${r.text}`).join(' ')
  const prompt = win.getByLabel('Run JavaScript')
  await prompt.fill('1 + 1')
  await prompt.press('Enter')
  const same = await win.locator('.console li.result:not(.differs) .value', { hasText: /^2$/ }).waitFor({ timeout: 10_000 }).then(() => true, () => false)
  await prompt.fill('navigator.userAgent.includes("Firefox")')
  await prompt.press('Enter')
  const marks = await win.locator('.console li.result.differs').waitFor({ timeout: 10_000 }).then(() => true, () => false)
  // An object comes back as a tree; a field the engines disagree on is marked in it.
  await prompt.fill('({ a: 1, gecko: navigator.userAgent.includes("Firefox") })')
  await prompt.press('Enter')
  const tree = await win.locator('.console li.result.differs .json-row.differs', { hasText: 'gecko' }).waitFor({ timeout: 10_000 }).then(() => true, () => false)
  await prompt.fill('navigator.userAgent.includes("Firefox")')
  await prompt.press('Enter')
  await prompt.press('ArrowUp')
  const recalled = (await prompt.inputValue()) === 'navigator.userAgent.includes("Firefox")'
  await prompt.fill('')
  const checks = {
    same,
    marks,
    tree,
    recalled,
    differ: (await answers('navigator.userAgent.includes("Firefox")')) === 'true:false true:true true:false',
    statements: (await answers('const x = 2; x * 3')) === 'true:6 true:6 true:6',
    awaits: (await answers('await Promise.resolve(5)')) === 'true:5 true:5 true:5',
    throws: (await ask('nope.nope')).results?.every((r) => !r.ok && /nope/.test(r.text)) === true,
    oneEngine: (await win.evaluate(() => window.swivel.evaluate('1', 'firefox'))).results?.map((r) => r.engine).join() === 'firefox',
    syntax: 'syntaxError' in (await ask('1 +'))
  }
  console.log('console prompt:', JSON.stringify(checks))
  const promptFailed = Object.values(checks).some((ok) => !ok)

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
  const failed = followFailed || promptFailed || !filled || !restored || results.some((r) => !r.ready || !r.sized || !r.clicked || !r.typed || !r.scrolled || !r.pointer || !r.found || !r.synced || r.leftSlowPageMs < 0)
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
