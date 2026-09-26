// Benchmark: frames per second and click-to-screen lag per engine, using the app's FrameSource.
// Run: node --experimental-strip-types scripts/bench-live.mjs   (SIZE=390x844 to change size)
import { chromium, firefox, webkit } from 'playwright-core'
import jpeg from 'jpeg-js'
import { FrameSource } from '../src/main/frames.ts'

const [W, H] = (process.env.SIZE ?? '1280x800').split('x').map(Number)
const RUN_MS = 3000
const ANIM = `<body style="margin:0"><div id=b style="width:200px;height:200px;background:red;position:absolute"></div>
<script>let t=0;(function f(){b.style.left=(t++%1000)+'px';requestAnimationFrame(f)})()</script>`
const CLICK = `<style>html,body{margin:0;height:100%;background:#fff}</style><script>document.addEventListener('mousedown',()=>{document.documentElement.style.background='#000';document.body.style.background='#000'})</script>`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isDark = (buf) => { const { data, width, height } = jpeg.decode(buf, { useTArray: true }); return data[((height >> 1) * width + (width >> 1)) * 4] < 60 }

async function bench(name, type) {
  const browser = await type.launch()
  const page = await browser.newPage({ viewport: { width: W, height: H } })
  const size = { width: W, height: H }

  // 1. Frames per second on a page that animates every frame.
  await page.setContent(ANIM)
  let frames = 0
  let src = new FrameSource(page, name, size, () => frames++)
  await src.start()
  await sleep(RUN_MS)
  src.stop()
  await sleep(200)

  // 2. Idle frames on a static page, then click-to-screen lag.
  await page.setContent(CLICK)
  let idle = 0, clickedAt = 0, lag = -1, resolve
  const done = new Promise((r) => (resolve = r))
  src = new FrameSource(page, name, size, (f) => {
    if (!clickedAt) return idle++
    if (lag < 0 && isDark(f.data)) { lag = performance.now() - clickedAt; resolve() }
  })
  await src.start()
  await sleep(2000)
  const idleFrames = idle
  await page.mouse.move(W / 2, H / 2)
  clickedAt = performance.now()
  src.wake()
  await page.mouse.down()
  await Promise.race([done, sleep(3000)])
  src.stop()

  await browser.close()
  return { engine: name, fps: +(frames / (RUN_MS / 1000)).toFixed(1), idleFramesIn2s: idleFrames, clickLagMs: Math.round(lag) }
}

const rows = []
for (const [n, t] of Object.entries({ chromium, firefox, webkit })) {
  try { rows.push(await bench(n, t)) } catch (e) { rows.push({ engine: n, error: e.message.split('\n')[0] }) }
}
console.log(`platform: ${process.platform} ${process.arch}, size: ${W}x${H}`)
console.table(rows)
