import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeAllBrowsers, prewarmBrowsers } from './live'
import { EngineHost } from './host'
import type { InputEvent, LiveOptions, ViewRect } from '../shared/types'

const here = fileURLToPath(new URL('.', import.meta.url))
const sessions = new Map<number, EngineHost>()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Swivel',
    // Test runs keep the window hidden so they don't pop up on the desktop.
    show: !process.env.SWIVEL_HIDDEN,
    webPreferences: {
      backgroundThrottling: !process.env.SWIVEL_HIDDEN,
      preload: join(here, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
  })

  const id = win.webContents.id
  sessions.set(
    id,
    new EngineHost(win, (event, payload) => {
      if (!win.isDestroyed()) win.webContents.send(`swivel:${event}`, payload)
    })
  )
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
