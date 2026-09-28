// Each window has its own data: a cookie set in one window isn't seen in another, in any engine,
// and Clear data wipes it.
// Run: npm run build && node scripts/e2e-isolation.mjs
import http from 'node:http'
import { withApp } from './app-window.mjs'

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html')
  if (req.url === '/set') {
    res.setHeader('set-cookie', 'swivel=kept; Max-Age=3600; Path=/')
    return res.end("<script>console.log('cookie set')</script>")
  }
  res.end(`<script>console.log('cookie${req.url}:' + document.cookie)</script>`)
}).listen(0)
const base = `http://127.0.0.1:${server.address().port}`
const ENGINES = ['Chromium', 'Firefox', 'WebKit']

/** Which engines logged a console line containing text, within a time limit. */
async function visit(win, url, text, ms = 30_000) {
  await win.getByLabel('Address').fill(url)
  await win.getByLabel('Address').press('Enter')
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
