// Each engine identifies itself like its real browser (Chrome, Firefox, Safari), so sites that
// check the user agent serve the same page they'd serve that browser. In mobile mode each
// identifies as that browser on a tablet (the frames are tablet-wide) and reports touch support.
// Run: npm run build && node scripts/e2e-useragent.mjs
import { withApp } from './app-window.mjs'

const EXPECT = {
  Blink: (ua) => /Chrome\/\d+\.\d+/.test(ua) && /Safari\/537\.36$/.test(ua) && !/Electron|HeadlessChrome|swivel/i.test(ua),
  Gecko: (ua) => /Gecko\/20100101 Firefox\/\d+/.test(ua),
  WebKit: (ua) => /AppleWebKit\/60\d/.test(ua) && /Version\/\d+(\.\d+)* Safari\/60\d/.test(ua)
}
const page = 'data:text/html,' + encodeURIComponent("<script>console.log('ua:' + navigator.userAgent + ' touch:' + ('ontouchstart' in window))</script>")
// Mobile mode, per engine. Touch support is reported where the engine can: not in WebKit on
// macOS, and in Blink only without a test runner attached (the self-test checks that one).
const MOBILE = {
  Blink: (ua) => /Android 14/.test(ua) && /Chrome\/\d+/.test(ua) && !/Electron|swivel/i.test(ua),
  Gecko: (ua) => /Android 14; Tablet;/.test(ua) && /Firefox\/\d+/.test(ua) && / touch:true$/.test(ua),
  WebKit: (ua) => /\(iPad; CPU OS/.test(ua) && /Safari\/60\d/.test(ua)
}

await withApp(async ({ win }) => {
  await win.getByLabel('Address').fill(page)
  await win.getByLabel('Address').press('Enter')
  // The first URL opens the canvas on one engine: switch to a frame per engine.
  await win.getByRole('button', { name: 'Browsers', exact: true }).click()
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
    const pass = !!seen[engine] && ok(seen[engine].replace(/ touch:\w+$/, ''))
    if (!pass) failed = true
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${engine}: ${seen[engine] ?? '(no page output)'}`)
  }

  // Mobile mode on every frame: each reloads with the mobile browser ID.
  const before = (await win.locator('.console').innerText()).split('\n').length
  await win.evaluate(() => document.querySelectorAll('.frame button.mobile').forEach((b) => b.click()))
  const mobile = {}
  const until = Date.now() + 40_000
  while (Date.now() < until && Object.keys(mobile).length < 3) {
    for (const line of (await win.locator('.console').innerText()).split('\n').slice(before))
      for (const e of Object.keys(MOBILE)) if (line.startsWith(e) && line.includes('ua:')) mobile[e] = line.slice(line.indexOf('ua:') + 3)
    await win.waitForTimeout(250)
  }
  for (const [engine, ok] of Object.entries(MOBILE)) {
    const pass = !!mobile[engine] && ok(mobile[engine])
    if (!pass) failed = true
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${engine} in mobile mode: ${mobile[engine] ?? '(no page output)'}`)
  }
  return failed ? 1 : 0
})
