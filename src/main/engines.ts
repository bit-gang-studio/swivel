import { chromium, firefox, webkit, type Browser, type BrowserType } from 'playwright-core'
import type { CaptureRequest, CaptureResult, ConsoleEntry, EngineId } from '../shared/types'

const types: Record<EngineId, BrowserType> = { chromium, firefox, webkit }
const running = new Map<EngineId, Promise<Browser>>()

/** Launch each engine once and reuse it. */
function getBrowser(engine: EngineId): Promise<Browser> {
  let browser = running.get(engine)
  if (!browser) {
    browser = types[engine].launch({ headless: true })
    browser.catch(() => running.delete(engine))
    running.set(engine, browser)
  }
  return browser
}

/**
 * Snapshot mode: load a URL in one engine and return a screenshot plus console output.
 * The live, clickable view is the open spike; see docs/architecture.md.
 */
export async function capture(req: CaptureRequest): Promise<CaptureResult> {
  const logs: ConsoleEntry[] = []
  try {
    const browser = await getBrowser(req.engine)
    const context = await browser.newContext({ viewport: req.viewport, colorScheme: req.colorScheme })
    try {
      const page = await context.newPage()
      page.on('console', (msg) => logs.push({ engine: req.engine, type: msg.type(), text: msg.text() }))
      page.on('pageerror', (err) => logs.push({ engine: req.engine, type: 'error', text: err.message }))
      await page.goto(req.url, { waitUntil: 'load', timeout: 30_000 })
      const png = await page.screenshot({ type: 'png' })
      return { engine: req.engine, image: `data:image/png;base64,${png.toString('base64')}`, console: logs }
    } finally {
      await context.close()
    }
  } catch (err) {
    return { engine: req.engine, image: '', console: logs, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function closeAll(): Promise<void> {
  const browsers = await Promise.allSettled(running.values())
  running.clear()
  await Promise.all(browsers.map((b) => (b.status === 'fulfilled' ? b.value.close() : undefined)))
}
