// Each window has its own data: a cookie set in one window isn't seen in another, in any engine,
// and Clear data wipes it. Inside a window, a cookie set in one engine reaches the others, and
// the storage panel's data shows it, deletes it, and can stop engines sharing cookies.
// Run: npm run build && node scripts/e2e-isolation.mjs
import http from 'node:http'
import { withApp } from './app-window.mjs'

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html')
  if (req.url === '/set') {
    res.setHeader('set-cookie', 'swivel=kept; Max-Age=3600; Path=/')
    return res.end("<script>console.log('cookie set')</script>")
  }
  res.end(`<script>try { localStorage.setItem('seen', 'yes') } catch {} console.log('cookie${req.url}:' + document.cookie)</script>`)
}).listen(0)
const base = `http://127.0.0.1:${server.address().port}`
// Console lines are tagged by engine name. The Browsers set has one frame per engine.
const ENGINES = ['Blink', 'Gecko', 'WebKit']

/** Which engines logged a console line containing text, within a time limit. */
async function visit(win, url, text, ms = 30_000) {
  await win.getByLabel('Address').fill(url)
  await win.getByLabel('Address').press('Enter')
  // The first URL opens the canvas on one engine: switch to a frame per engine.
  const browsers = win.getByRole('button', { name: 'Browsers', exact: true })
  await browsers.waitFor()
  if ((await browsers.getAttribute('aria-pressed')) !== 'true') await browsers.click()
  const toggle = win.getByRole('button', { name: /^Console/ })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  const seen = {}
  const end = Date.now() + ms
  while (Date.now() < end && ENGINES.some((e) => !seen[e])) {
    for (const line of (await win.locator('.console').innerText()).split('\n'))
      for (const e of ENGINES) if (line.startsWith(e) && line.includes(text)) seen[e] = true
    await win.waitForTimeout(250)
  }
  return seen
}

let failed = false
const check = (label, seen, want) => {
  const bad = ENGINES.filter((e) => !!seen[e] !== want)
  console.log(`${label}: ${bad.length ? 'FAIL ' + bad.join(', ') : 'ok'} ${JSON.stringify(seen)}`)
  if (bad.length) failed = true
}

await withApp(async ({ app, win }) => {
  check('set in window 1', await visit(win, `${base}/set`, 'cookie set'), true)
  check('window 1 has it', await visit(win, `${base}/one`, 'cookie/one:swivel=kept'), true)

  // One sign-in for every engine: a cookie that only Blink sets reaches Gecko and WebKit.
  await app.evaluate(() => globalThis.swivelHost.frameView('chromium').run("document.cookie = 'only=blink; path=/; max-age=3600'"))
  await win.waitForTimeout(2500)
  check('cookie set in Blink reaches every engine', await visit(win, `${base}/shared`, 'only=blink'), true)

  // The storage panel's view of the window: the cookie in every engine, where it came from, and
  // what the page put in local storage.
  const IDS = ['chromium', 'firefox', 'webkit']
  const storage = () => win.evaluate(() => window.swivel.storage())
  const act = (action) => win.evaluate((a) => window.swivel.storageAction(a), action)
  const expect = (label, ok, detail) => {
    console.log(`${label}: ${ok ? 'ok' : 'FAIL ' + JSON.stringify(detail)}`)
    if (!ok) failed = true
  }
  let snap = await storage()
  const only = snap.cookies.find((c) => c.name === 'only')
  expect('storage lists the cookie in every engine, set by Blink', !!only && IDS.every((e) => only.values[e] === 'blink') && only.from === 'chromium', only)
  const seenItem = snap.items.find((i) => i.area === 'local' && i.key === 'seen')
  expect('storage lists local storage in every engine', !!seenItem && IDS.every((e) => seenItem.values[e] === 'yes'), seenItem ?? snap.items)

  // Deleting a cookie removes it from every engine.
  await act({ type: 'delete-cookie', key: only.key })
  check('a deleted cookie is still sent by an engine', await visit(win, `${base}/deleted`, 'only=blink', 6000), false)

  // Sharing off: a cookie set in Blink stays in Blink. Back on: the others get it.
  await act({ type: 'share', on: false })
  await app.evaluate(() => globalThis.swivelHost.frameView('chromium').run("document.cookie = 'solo=1; path=/; max-age=3600'"))
  await win.waitForTimeout(2500)
  snap = await storage()
  let solo = snap.cookies.find((c) => c.name === 'solo')
  expect('sharing off: the cookie stays in Blink', !!solo && solo.values.chromium === '1' && solo.values.firefox === undefined && solo.values.webkit === undefined && snap.sharing === false, solo)
  await act({ type: 'share', on: true })
  await win.waitForTimeout(1500)
  snap = await storage()
  solo = snap.cookies.find((c) => c.name === 'solo')
  expect('sharing back on: every engine has it', !!solo && IDS.every((e) => solo.values[e] === '1'), solo)

  const before = app.windows().length
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'File').submenu.items.find((i) => i.label === 'New Window').click())
  let second
  for (let i = 0; i < 100 && !second; i++) {
    second = app.windows().find((p) => p !== win && /renderer\/index\.html/.test(p.url()))
    if (!second) await new Promise((r) => setTimeout(r, 100))
  }
  if (!second) throw new Error(`Second window not found (${before} windows before)`)
  await second.waitForLoadState()
  check('window 2 loads', await visit(second, `${base}/two`, 'cookie/two:'), true)
  check('window 2 sees window 1 cookie', await visit(second, `${base}/two-b`, 'swivel=kept', 8000), false)

  await win.getByRole('button', { name: 'Clear data' }).click()
  await win.waitForTimeout(3000)
  check('window 1 after clear loads', await visit(win, `${base}/cleared`, 'cookie/cleared:'), true)
  check('window 1 after clear still has cookie', await visit(win, `${base}/cleared-b`, 'cookie/cleared-b:swivel=kept', 8000), false)
  return failed ? 1 : 0
}, { exit: false }).then((code) => {
  server.close()
  process.exit(code || (failed ? 1 : 0))
})
