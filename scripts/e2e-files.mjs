// Files in and out of pages: a file input gets the file the user picks, and a download is saved
// once to the Downloads folder whichever engines start it.
// Run: npm run build && node scripts/e2e-files.mjs
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { withApp } from './app-window.mjs'

const server = http.createServer((req, res) => {
  if (req.url === '/attachment') {
    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('content-disposition', 'attachment; filename="report.txt"')
    return res.end('hello')
  }
  if (req.url === '/note') {
    res.setHeader('content-type', 'text/plain')
    return res.end('note')
  }
  res.setHeader('content-type', 'text/html')
  res.end(`<!doctype html><body style="margin:0">
<label for=f style="position:fixed;left:0;top:0;width:100%;height:100px;font-size:40px;cursor:pointer">choose a file</label>
<input id=f type=file style="position:fixed;top:120px">
<a id=d href="/note" download="note.txt" style="position:fixed;top:200px">download</a>
<script>
f.onchange = () => console.log('picked:' + f.files[0].name + ':' + f.files[0].size)
console.log('ready')
</script></body>`)
}).listen(0)
const base = `http://127.0.0.1:${server.address().port}`
const ENGINES = [
  ['chromium', 'Blink'],
  ['firefox', 'Gecko'],
  ['webkit', 'WebKit']
]
const WIDTH = 1280

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swivel-files-'))
const downloads = path.join(dir, 'downloads')
fs.mkdirSync(downloads)
const upload = path.join(dir, 'upload.txt')
fs.writeFileSync(upload, 'hello')

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
  /** Wait for a file in the downloads folder with this content. */
  async function saved(name, content, timeout = 20_000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const file = path.join(downloads, name)
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return true
      await win.waitForTimeout(250)
    }
    return false
  }
  const go = async (url) => {
    await win.getByLabel('Address').fill(url)
    await win.getByLabel('Address').press('Enter')
  }
  const run = (engine, js) => app.evaluate((_, { engine, js }) => globalThis.swivelHost.frameView(engine).run(js), { engine, js })

  await app.evaluate(({ app }, { downloads, upload }) => {
    app.setPath('downloads', downloads)
    globalThis.swivelHost.testFiles = [upload]
  }, { downloads, upload })

  const toggle = win.getByRole('button', { name: /^Console/ })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await go(base)
  await win.waitForSelector('.frame')
  await win.getByRole('button', { name: 'Browsers', exact: true }).click()
  for (const [, tag] of ENGINES) expect(`${tag} loads`, await seen(tag, 'ready', 60_000), null)
  // Each frame on its own: a click repeated in a native engine would open a real file picker.
  await win.getByRole('button', { name: 'Sync frames' }).click()
  await win.waitForTimeout(500)

  // A file input, in the engines whose picker Swivel shows (a native engine shows its own).
  const natives = await win.evaluate(() => window.swivel.nativeEngines)
  for (const [engine, tag] of ENGINES) {
    if (natives.includes(engine)) continue
    const box = await win.locator(`.frame[data-engine="${engine}"] canvas.live`).boundingBox()
    await win.mouse.click(box.x + box.width / 2, box.y + 50 * (box.width / WIDTH))
    expect(`${tag}: the file input gets the picked file`, await seen(tag, 'picked:upload.txt:5'), await win.locator('.console').innerText())
  }

  // A link marked as a download, in each engine.
  for (const [engine, tag] of ENGINES) {
    const name = `note-${engine}.txt`
    await run(engine, `d.download = ${JSON.stringify(name)}; d.click()`)
    expect(`${tag}: a download link saves the file`, await saved(name, 'note'), fs.readdirSync(downloads))
  }

  // A page sent as an attachment, opened in every frame: saved once, and every engine is named.
  await go(`${base}/attachment`)
  expect('an attachment is saved', await saved('report.txt', 'hello'), fs.readdirSync(downloads))
  const bar = win.locator('.downloadbar')
  let text = ''
  for (let i = 0; i < 40; i++) {
    text = await bar.innerText().catch(() => '')
    if (/Saved/.test(text) && ENGINES.every(([, tag]) => text.includes(tag))) break
    await win.waitForTimeout(250)
  }
  expect('the bar says it is saved and names every engine', /Saved/.test(text) && ENGINES.every(([, tag]) => text.includes(tag)), text)
  await win.waitForTimeout(2000)
  const copies = fs.readdirSync(downloads).filter((f) => f.startsWith('report'))
  expect('one copy is kept', copies.length === 1, copies)

  if (failed) console.log('console:', await win.locator('.console').innerText())
  return failed ? 1 : 0
}, { exit: false }).then((code) => {
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
  process.exit(code || (failed ? 1 : 0))
})
