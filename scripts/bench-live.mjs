// Spike benchmark: live frames and input lag per engine, using page.screencast.
// Run: node scripts/bench-live.mjs
import { chromium, firefox, webkit } from 'playwright-core'
import jpeg from 'jpeg-js'

const [W, H] = (process.env.SIZE ?? '1280x800').split('x').map(Number)
const RUN_MS = 3000
const ANIM = `<body style="margin:0"><div id=b style="width:200px;height:200px;background:red;position:absolute"></div>
<script>let t=0;(function f(){b.style.left=(t++%1000)+'px';requestAnimationFrame(f)})()</script>`
const CLICK = `<style>html,body{margin:0;height:100%;background:#fff}</style><script>document.addEventListener('mousedown',()=>{document.documentElement.style.background='#000';document.body.style.background='#000'})</script>`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isDark = (buf) => { const { data, width } = jpeg.decode(buf, { useTArray: true }); const i = ((data.length / 4 / width / 2 | 0) * width + (width / 2 | 0)) * 4; return data[i] < 60 }

async function bench(name, type) {
  const browser = await type.launch()
  const page = await browser.newPage({ viewport: { width: W, height: H } })

  // 1. Frame rate with a page that animates every frame.
  await page.setContent(ANIM)
  let frames = 0, bytes = 0
  await page.screencast.start({ size: { width: W, height: H }, quality: 70, onFrame: (f) => { frames++; bytes += f.data.length } })
  await sleep(RUN_MS)
  await page.screencast.stop()
  const fps = frames / (RUN_MS / 1000)

  // 2. Idle frames on a static page, then click-to-screen lag.
  await page.setContent(CLICK)
  let idle = 0, clickedAt = 0, lag = -1
  const done = new Promise((resolve) => {
    page.screencast.start({ size: { width: W, height: H }, quality: 70, onFrame: (f) => {
      if (!clickedAt) { idle++; return }
      if (lag < 0 && isDark(f.data)) { lag = performance.now() - clickedAt; resolve() }
    } })
  })
  await sleep(1000)
  const idleFps = idle
  await page.mouse.move(100, 100)
  clickedAt = performance.now()
  await page.mouse.down()
  await Promise.race([done, sleep(3000)])
  await page.screencast.stop()

  await browser.close()
  return { engine: name, screencastFps: +fps.toFixed(1), avgFrameKB: frames ? Math.round(bytes / frames / 1024) : 0, idleFramesPerSec: idleFps, clickLagMs: Math.round(lag) }
}

const rows = []
for (const [n, t] of Object.entries({ chromium, firefox, webkit })) {
  try { rows.push(await bench(n, t)) } catch (e) { rows.push({ engine: n, error: e.message.split('\n')[0] }) }
}
console.log(`platform: ${process.platform} ${process.arch}, size: ${W}x${H}`)
console.table(rows)
