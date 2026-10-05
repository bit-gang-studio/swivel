// A sign-in popup: a page in the Blink frame opens a popup window, the popup sets a cookie, tells
// the page that opened it and closes itself. The page hears it, stays where it was, and the
// other engines get the cookie and reload.
// Run: npm run build && node scripts/e2e-popup.mjs
import http from 'node:http'
import { withApp } from './app-window.mjs'

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html')
  if (req.url === '/signin') {
    res.setHeader('set-cookie', 'token=abc; Max-Age=3600; Path=/')
    return res.end("<title>Sign in</title><script>setTimeout(() => { opener.postMessage('signed-in', '*'); close() }, 1500)</script>")
  }
  res.end(`<!doctype html><body style="margin:0">
<button id=b style="position:fixed;left:0;top:0;width:100%;height:100px;font-size:40px">Sign in</button>
<script>
b.onclick = () => window.open('/signin', 'signin', 'width=420,height=520')
addEventListener('message', (e) => console.log('heard:' + e.data + ' at:' + location.pathname))
console.log('ready cookie:[' + document.cookie + ']')
</script></body>`)
}).listen(0)
const base = `http://127.0.0.1:${server.address().port}`
const TAGS = ['Blink', 'Gecko', 'WebKit']

let failed = false
const expect = (label, ok, detail) => {
  console.log(`${label}: ${ok ? 'ok' : 'FAIL ' + JSON.stringify(detail)}`)
  if (!ok) failed = true
}

await withApp(async ({ app, win }) => {
  async function seen(tag, text, timeout = 20_000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const lines = (await win.locator('.console').innerText()).split('\n')
      if (lines.some((l) => l.startsWith(tag) && l.includes(text))) return true
      await win.waitForTimeout(250)
    }
    return false
  }
  const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()))

  const toggle = win.getByRole('button', { name: /^Console/ })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await win.getByLabel('Address').fill(`${base}/app`)
  await win.getByLabel('Address').press('Enter')
  await win.waitForSelector('.frame')
  await win.getByRole('button', { name: 'Browsers', exact: true }).click()
  for (const tag of TAGS) expect(`${tag} loads signed out`, await seen(tag, 'ready cookie:[]', 60_000), null)
  await win.waitForTimeout(1000)
  const before = (await windows()).length

  // A real click in the Blink frame (a popup needs one). Sync repeats it in the other frames.
  await app.evaluate(() =>
    globalThis.swivelHost.frameView('chromium').testInput([
      { type: 'mouseDown', x: 400, y: 20, button: 'left', clickCount: 1 },
      { type: 'mouseUp', x: 400, y: 20, button: 'left', clickCount: 1 }
    ])
  )
  let titles = []
  for (let i = 0; i < 40 && !titles.some((t) => /Sign in/.test(t)); i++) {
    titles = await windows()
    await win.waitForTimeout(100)
  }
  expect('the popup opens as its own window, titled with its site', titles.some((t) => t.includes('127.0.0.1') && t.includes('Sign in')), titles)
  expect('the page that opened it hears from it, and has not moved', await seen('Blink', 'heard:signed-in at:/app'), await win.locator('.console').innerText())
  for (let i = 0; i < 40 && (await windows()).length > before; i++) await win.waitForTimeout(100)
  expect('the popup closes itself', (await windows()).length === before, await windows())
  // The other engines get the cookie and reload, signed in, still on the same page.
  for (const tag of TAGS.slice(1)) expect(`${tag} reloads signed in`, await seen(tag, 'ready cookie:[token=abc]'), await win.locator('.console').innerText())
  expect('no frame went to the sign-in page', (await win.getByLabel('Address').inputValue()).endsWith('/app'), await win.getByLabel('Address').inputValue())

  // Several Blink frames (the Responsive set), and the click repeated in each: still one popup.
  await win.getByRole('button', { name: 'Responsive', exact: true }).click()
  await win.waitForTimeout(4000)
  await app.evaluate(() =>
    globalThis.swivelHost.frameView('chromium').testInput([
      { type: 'mouseDown', x: 200, y: 20, button: 'left', clickCount: 1 },
      { type: 'mouseUp', x: 200, y: 20, button: 'left', clickCount: 1 }
    ])
  )
  let most = 0
  for (let i = 0; i < 12; i++) {
    most = Math.max(most, (await windows()).length - before)
    await win.waitForTimeout(100)
  }
  expect('four Blink frames open one popup between them', most === 1, most)
  for (let i = 0; i < 60 && (await windows()).length > before; i++) await win.waitForTimeout(100)
  expect('and it closes', (await windows()).length === before, await windows())
  return failed ? 1 : 0
}, { exit: false }).then((code) => {
  server.close()
  process.exit(code || (failed ? 1 : 0))
})
