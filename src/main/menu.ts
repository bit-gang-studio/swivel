import { BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from 'electron'
import { requestScreenRecording, windowedFirefoxStatus } from './firefox-window'

/**
 * App menu. Shortcuts live here, not in the page UI, so they work even when a native engine
 * view has keyboard focus. Commands go to the focused window's UI as 'command' events.
 */
export function installMenu(newWindow: () => void): void {
  const send = (command: string) => () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return
    win.webContents.focus() // Take focus back from a native page view, e.g. for the find bar.
    win.webContents.send('swivel:command', command)
  }
  const mac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => newWindow() },
        { label: 'Add Frame…', accelerator: 'CmdOrCtrl+T', click: send('add-frame') },
        { label: 'Duplicate Frame', accelerator: 'CmdOrCtrl+D', click: send('duplicate') },
        { type: 'separator' },
        { role: mac ? 'close' : 'quit' }
      ]
    },
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
        { label: 'Zoom to Fit', accelerator: 'CmdOrCtrl+0', click: send('fit') },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+1', click: send('zoom-100') },
        { label: 'Focus Frame / Back to Canvas', accelerator: 'CmdOrCtrl+Return', click: send('focus') },
        { type: 'separator' },
        { label: 'Toggle Dark Mode', accelerator: 'Shift+CmdOrCtrl+D', click: send('dark') },
        { label: 'Toggle Console', accelerator: mac ? 'Alt+Cmd+J' : 'Ctrl+Shift+J', click: send('console') },
        { type: 'separator' },
        ...(windowedFirefoxStatus() === 'needs-permission'
          ? [
              {
                label: 'Enable Smooth Firefox…',
                click: () => {
                  requestScreenRecording()
                  void dialog.showMessageBox({
                    message: 'Allow Screen Recording for Swivel',
                    detail:
                      'Firefox runs as a real window that Swivel mirrors, which needs the Screen Recording permission. Turn it on in System Settings › Privacy & Security › Screen Recording, then restart Swivel.'
                  })
                }
              }
            ]
          : []),
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
