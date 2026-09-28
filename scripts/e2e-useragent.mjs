// Each engine identifies itself like its real browser (Chrome, Firefox, Safari), so sites that
// check the user agent serve the same page they'd serve that browser.
// Run: npm run build && node scripts/e2e-useragent.mjs
import { withApp } from './app-window.mjs'

const EXPECT = {
  Chromium: (ua) => /Chrome\/\d+\.\d+/.test(ua) && /Safari\/537\.36$/.test(ua) && !/Electron|HeadlessChrome|swivel/i.test(ua),
  Firefox: (ua) => /Gecko\/20100101 Firefox\/\d+/.test(ua),
  WebKit: (ua) => /AppleWebKit\/60\d/.test(ua) && /Version\/\d+(\.\d+)* Safari\/60\d/.test(ua)
}
const page = 'data:text/html,' + encodeURIComponent("<script>console.log('ua:' + navigator.userAgent)</script>")

await withApp(async ({ win }) => {
  await win.getByLabel('Address').fill(page)
  await win.getByLabel('Address').press('Enter')
  const toggle = win.getByRole('button', { name: /^Console/ })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click() // Its state is remembered.
  const seen = {}
  const end = Date.now() + 30_000
  while (Date.now() < end && Object.keys(seen).length < 3) {
    for (const line of (await win.locator('.console').innerText()).split('\n'))
      for (const e of Object.keys(EXPECT)) if (line.startsWith(e) && line.includes('ua:')) seen[e] = line.slice(line.indexOf('ua:') + 3)
    await win.waitForTimeout(250)
  }
  let failed = false
  for (const [engine, ok] of Object.entries(EXPECT)) {
    const pass = !!seen[engine] && ok(seen[engine])
    if (!pass) failed = true
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${engine}: ${seen[engine] ?? '(no page output)'}`)
  }
  return failed ? 1 : 0
})
