import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeAllBrowsers, prewarmBrowsers } from './live'
import { EngineHost, nativeEngines } from './host'
import { selfTest } from './selftest'
import { visualCheck } from './visual'
import type { InputEvent, LiveOptions, ViewRect } from '../shared/types'

// Electron's own security warnings would show up in the console of every page viewed in Chrome.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

const here = fileURLToPath(new URL('.', import.meta.url))
const sessions = new Map<number, EngineHost>()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
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
  const host = new EngineHost(win, (event, payload) => {
    if (!win.isDestroyed()) win.webContents.send(`swivel:${event}`, payload)
  })
  sessions.set(id, host)
  // Test runs reach the host from Playwright's main-process evaluate.
  if (process.env.SWIVEL_HIDDEN) (globalThis as { swivelHost?: EngineHost }).swivelHost = host
  if (process.env.SWIVEL_SELFTEST) win.webContents.once('did-finish-load', () => void selfTest(win, host))
  const visualDir = process.env.SWIVEL_VISUAL
  if (visualDir) win.webContents.once('did-finish-load', () => void visualCheck(win, visualDir))
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
}

ipcMain.handle('swivel:start', (e, opts: LiveOptions) => sessions.get(e.sender.id)?.start(opts))
ipcMain.handle('swivel:navigate', (e, url: string) => sessions.get(e.sender.id)?.navigate(url))
ipcMain.handle('swivel:history', (e, action: 'back' | 'forward' | 'reload') => sessions.get(e.sender.id)?.history(action))
ipcMain.on('swivel:native-engines', (e) => (e.returnValue = nativeEngines()))
ipcMain.handle('swivel:rect', (e, rect: ViewRect) => sessions.get(e.sender.id)?.setRect(rect))
ipcMain.on('swivel:input', (e, input: InputEvent) => sessions.get(e.sender.id)?.input(input))

app.whenReady().then(() => {
  createWindow()
  prewarmBrowsers()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void closeAllBrowsers()
})
