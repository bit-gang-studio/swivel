import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeAllBrowsers, prewarmBrowsers } from './live'
import { EngineHost, engineVersions, nativeEngines, streamedEngines } from './host'
import { selfTest } from './selftest'
import { hideTip, showTip } from './tooltip'
import { clickTest } from './clicktest'
import { visualCheck } from './visual'
import { installMenu } from './menu'
import { windowedFirefoxStatus } from './firefox-window'
import type { FindRequest } from '../shared/find'
import type { StorageAction } from '../shared/storage'
import type { CanvasFrame, Credentials, EngineId, InputEvent, LiveOptions, ViewRect, Viewport } from '../shared/types'

// Electron's own security warnings would show up in the console of every page viewed in Chrome.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

const here = fileURLToPath(new URL('.', import.meta.url))
const sessions = new Map<number, EngineHost>()

function createWindow(): BrowserWindow {
  // New windows cascade from the focused one, like other browsers.
  const from = BrowserWindow.getFocusedWindow()?.getBounds()
  const win = new BrowserWindow({
    width: from?.width ?? 1400,
    height: from?.height ?? 900,
    ...(from ? { x: from.x + 30, y: from.y + 30 } : {}),
    minWidth: 900,
    minHeight: 600,
    title: 'Swivel',
    // Test runs use an invisible window that never takes focus, so they don't disturb the desktop.
    // It must still be shown: hidden windows don't deliver input to native views.
    show: !process.env.SWIVEL_HIDDEN,
    ...(process.env.SWIVEL_HIDDEN ? { opacity: 0, focusable: false, skipTaskbar: true } : {}),
    webPreferences: {
      backgroundThrottling: !process.env.SWIVEL_HIDDEN,
      preload: join(here, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
  })

  if (process.env.SWIVEL_HIDDEN) win.showInactive()
  const id = win.webContents.id
  // Each window has its own data (cookies, storage, cache), shared with no other window.
  const host = new EngineHost(win, (event, payload) => {
    if (!win.isDestroyed()) win.webContents.send(`swivel:${event}`, payload)
  })
  sessions.set(id, host)
  // Test runs reach the host from Playwright's main-process evaluate.
  if (process.env.SWIVEL_HIDDEN && sessions.size === 1) (globalThis as { swivelHost?: EngineHost }).swivelHost = host
  if (process.env.SWIVEL_CLICKTEST && sessions.size === 1) win.webContents.once('did-finish-load', () => void clickTest(win, host))
  if (process.env.SWIVEL_SELFTEST && sessions.size === 1) win.webContents.once('did-finish-load', () => void selfTest(win, host))
  const visualDir = process.env.SWIVEL_VISUAL
  if (visualDir && sessions.size === 1) win.webContents.once('did-finish-load', () => void visualCheck(win, visualDir, createWindow))
  win.on('close', () => {
    sessions.get(id)?.destroy()
    sessions.delete(id)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(here, '../renderer/index.html'))
  }
  return win
}

ipcMain.handle('swivel:start', (e, opts: LiveOptions) => sessions.get(e.sender.id)?.start(opts))
ipcMain.handle('swivel:navigate', (e, url: string) => sessions.get(e.sender.id)?.navigate(url))
ipcMain.handle('swivel:history', (e, action: 'back' | 'forward' | 'reload') => sessions.get(e.sender.id)?.history(action))
ipcMain.on('swivel:native-engines', (e) => (e.returnValue = nativeEngines()))
ipcMain.on('swivel:engine-versions', (e) => (e.returnValue = engineVersions()))
ipcMain.handle('swivel:find', (e, req: FindRequest) => sessions.get(e.sender.id)?.find(req))
ipcMain.handle('swivel:resize', (e, viewport: Viewport) => sessions.get(e.sender.id)?.resize(viewport))
ipcMain.handle('swivel:rect', (e, rect: ViewRect) => sessions.get(e.sender.id)?.setRect(rect))
ipcMain.handle('swivel:canvas', (e, frames: CanvasFrame[], page: { url: string; colorScheme: 'light' | 'dark' }) => sessions.get(e.sender.id)?.setCanvas(frames, page))
ipcMain.handle('swivel:frame-rect', (e, id: string, rect: ViewRect) => sessions.get(e.sender.id)?.setFrameRect(id, rect))
ipcMain.on('swivel:frame-input', (e, id: string, input: InputEvent) => sessions.get(e.sender.id)?.frameInput(id, input))
ipcMain.on('swivel:frame-visible', (e, id: string, visible: boolean) => sessions.get(e.sender.id)?.setFrameVisible(id, visible))
// Hover labels (not in test runs: nobody hovers, and an extra window only gets in the way).
ipcMain.on('swivel:tip', (e, tip: { text: string; x: number; top: number; bottom: number } | null) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || process.env.SWIVEL_HIDDEN) return
  if (tip) void showTip(win, tip.text, tip)
  else hideTip(win)
})
ipcMain.handle('swivel:evaluate', (e, code: string, only?: EngineId) => sessions.get(e.sender.id)?.evaluate(code, only))
ipcMain.handle('swivel:storage', (e) => sessions.get(e.sender.id)?.storage())
ipcMain.handle('swivel:storage-action', (e, action: StorageAction) => sessions.get(e.sender.id)?.storageAction(action))
ipcMain.on('swivel:sync', (e, on: boolean) => {
  const host = sessions.get(e.sender.id)
  if (host) host.syncOn = on
})
ipcMain.on('swivel:frame-select', (e, id: string | undefined) => {
  const host = sessions.get(e.sender.id)
  if (host) host.selectedFrame = id
})
// A native menu: it draws above native page views, which a menu in the UI can't.
ipcMain.handle('swivel:pick', (e, items: { id?: string; label: string; group?: boolean }[], at: { x: number; y: number }) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return null
  return new Promise<string | null>((resolve) => {
    let picked: string | null = null
    const menu = Menu.buildFromTemplate(
      items.map((item) =>
        item.label === '-' ? { type: 'separator' as const } : { label: item.label, enabled: !item.group, click: () => (picked = item.id ?? null) }
      )
    )
    // The click handler runs after the menu closes on some platforms: answer on the next tick.
    menu.popup({ window: win, x: Math.round(at.x), y: Math.round(at.y), callback: () => setTimeout(() => resolve(picked), 0) })
  })
})
ipcMain.on('swivel:show-download', (e, id: number) => sessions.get(e.sender.id)?.showDownload(id))
ipcMain.on('swivel:auth-answer', (e, id: number, credentials: Credentials | null) => sessions.get(e.sender.id)?.answerAuth(id, credentials))
ipcMain.handle('swivel:color-scheme', (e, scheme: 'light' | 'dark') => sessions.get(e.sender.id)?.setColorScheme(scheme))
ipcMain.handle('swivel:clear-data', (e) => sessions.get(e.sender.id)?.clearData())
ipcMain.on('swivel:input', (e, input: InputEvent) => sessions.get(e.sender.id)?.input(input))

app.whenReady().then(() => {
  console.log(`Swivel: Firefox mode ${windowedFirefoxStatus()}`)
  installMenu(createWindow)
  createWindow()
  prewarmBrowsers(streamedEngines())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Close engines before quitting, so no browser process is left behind.
let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  // Stop mirrors and close pages first, then the browsers: closing Firefox under a live window
  // capture can crash it.
  for (const host of sessions.values()) host.destroy()
  sessions.clear()
  void Promise.race([closeAllBrowsers(), new Promise((r) => setTimeout(r, 5000))]).then(() => app.quit())
})
