import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * App menu. Shortcuts live here, not in the page UI, so they work even when a native engine
 * view has keyboard focus. Commands go to the focused window's UI as 'command' events.
 */
export function installMenu(): void {
  const send = (command: string) => () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return
    win.webContents.focus() // Take focus back from a native page view, e.g. for the find bar.
    win.webContents.send('swivel:command', command)
  }
  const mac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: send('find') },
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: send('find-next') },
        { label: 'Find Previous', accelerator: 'Shift+CmdOrCtrl+G', click: send('find-previous') },
        { type: 'separator' },
        { label: 'Open Location', accelerator: 'CmdOrCtrl+L', click: send('focus-address') },
        { label: 'Reload Page', accelerator: 'CmdOrCtrl+R', click: send('reload') },
        { label: 'Back', accelerator: mac ? 'Cmd+[' : 'Alt+Left', click: send('back') },
        { label: 'Forward', accelerator: mac ? 'Cmd+]' : 'Alt+Right', click: send('forward') },
        { type: 'separator' },
        { label: 'Toggle Console', accelerator: mac ? 'Alt+Cmd+J' : 'Ctrl+Shift+J', click: send('console') },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
