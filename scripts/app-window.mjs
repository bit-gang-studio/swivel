// Shared runner for scripts that drive the built app.
// The window is invisible and never takes focus, and the app is always closed cleanly,
// even on errors or timeouts, so no stray Electron processes or crash dialogs are left behind.
import { _electron as electron } from 'playwright'

export async function withApp(fn, { timeoutMs = 240_000, exit = true } = {}) {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, SWIVEL_HIDDEN: '1' }, timeout: 60_000 })
  const proc = app.process() // Unavailable after app.close(), so keep it now.
  let code = 0
  const timer = setTimeout(() => {
    console.error(`Timed out after ${timeoutMs} ms`)
    void shutdown(1)
  }, timeoutMs)
  async function shutdown(exitCode) {
    clearTimeout(timer)
    await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 10000))])
    if (proc.exitCode === null) proc.kill('SIGTERM')
    if (exit || exitCode !== 0) process.exit(exitCode)
    return exitCode
  }
  process.once('SIGINT', () => void shutdown(130))
  process.once('SIGTERM', () => void shutdown(143))
  try {
    // The app's own UI window. Native engine views are windows too, so pick by URL.
    let win
    for (let i = 0; i < 100 && !win; i++) {
      win = app.windows().find((p) => /renderer\/index\.html/.test(p.url()))
      if (!win) await new Promise((r) => setTimeout(r, 100))
    }
    if (!win) throw new Error('App window not found')
    code = (await fn({ app, win })) ?? 0
  } catch (err) {
    console.error(err)
    code = 1
  }
  return shutdown(code)
}
