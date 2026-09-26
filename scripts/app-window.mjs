// Shared launcher for scripts that drive the built app.
// Keeps the window hidden and always closes the app cleanly, even on errors or timeouts,
// so no stray Electron processes (or macOS crash dialogs) are left behind.
import { _electron as electron } from 'playwright'

export async function launchApp({ timeoutMs = 240_000 } = {}) {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, SWIVEL_HIDDEN: '1' } })
  const close = async (code) => {
    await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))])
    if (app.process().exitCode === null) app.process().kill('SIGTERM')
    if (code !== undefined) process.exit(code)
  }
  const timer = setTimeout(() => {
    console.error(`Timed out after ${timeoutMs} ms`)
    void close(1)
  }, timeoutMs)
  process.on('SIGINT', () => void close(130))
  process.on('SIGTERM', () => void close(143))
  process.on('uncaughtException', (err) => {
    console.error(err)
    void close(1)
  })
  process.on('unhandledRejection', (err) => {
    console.error(err)
    void close(1)
  })

  // The app's own UI window. Native engine views are windows too, so pick by URL.
  let win
  for (let i = 0; i < 100 && !win; i++) {
    win = app.windows().find((p) => /renderer\/index\.html/.test(p.url()))
    if (!win) await new Promise((r) => setTimeout(r, 100))
  }
  if (!win) throw new Error('App window not found')
  return {
    app,
    win,
    done: async () => {
      clearTimeout(timer)
      await close()
    }
  }
}
