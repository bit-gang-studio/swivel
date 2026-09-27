// Logins survive a restart: set a cookie in every engine, restart the app, check it's still there.
// Run: npm run build && node scripts/e2e-persist.mjs
import http from 'node:http'
import { withApp } from './app-window.mjs'

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html')
  if (req.url === '/set') {
    res.setHeader('set-cookie', 'swivel=kept; Max-Age=3600; Path=/')
    return res.end("<script>console.log('cookie set')</script>")
  }
  res.end("<script>console.log('cookie:' + document.cookie)</script>")
}).listen(0)
const base = `http://127.0.0.1:${server.address().port}`
const ENGINES = ['Chromium', 'Firefox', 'WebKit']

async function visit(win, url, text) {
  await win.getByLabel('Address').fill(url)
  await win.getByLabel('Address').press('Enter')
  const toggle = win.getByRole('button', { name: /^Console/ })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  const seen = {}
  const end = Date.now() + 30_000
  while (Date.now() < end && ENGINES.some((e) => !seen[e])) {
    for (const line of (await win.locator('.console').innerText()).split('\n'))
      for (const e of ENGINES) if (line.startsWith(e) && line.includes(text)) seen[e] = true
    await win.waitForTimeout(250)
  }
  return seen
}

await withApp(async ({ win }) => {
  console.log('set:', JSON.stringify(await visit(win, `${base}/set`, 'cookie set')))
  await win.waitForTimeout(2000)
}, { exit: false })

let failed = false
await withApp(async ({ win }) => {
  const kept = await visit(win, `${base}/check`, 'cookie:swivel=kept')
  console.log('kept after restart:', JSON.stringify(kept))
  failed = ENGINES.some((e) => !kept[e])
  return failed ? 1 : 0
}, { exit: false })
server.close()
process.exit(failed ? 1 : 0)
