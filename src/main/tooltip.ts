import { BrowserWindow } from 'electron'

/**
 * Hover labels. Native pages draw over the app's own UI, so a label drawn in the UI could be
 * covered by one; each app window has a tiny window of its own for the label, which sits above
 * everything in it. It never takes focus or the mouse.
 */
const tips = new WeakMap<BrowserWindow, { win: BrowserWindow; ready: Promise<void>; request: number }>()

const PAGE =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    `<!doctype html><body style="margin:0;background:transparent;overflow:hidden"><div id="tip" style="display:inline-block;margin:2px;padding:5px 10px;border-radius:6px;background:#1c1c1a;color:#fff;font:12px system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25)"></div></body>`
  )

function tipFor(owner: BrowserWindow) {
  let tip = tips.get(owner)
  if (!tip) {
    const win = new BrowserWindow({
      parent: owner,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      focusable: false,
      hasShadow: false,
      skipTaskbar: true,
      width: 10,
      height: 10,
      webPreferences: { sandbox: true }
    })
    win.setIgnoreMouseEvents(true)
    tip = { win, ready: win.loadURL(PAGE).catch(() => {}), request: 0 }
    tips.set(owner, tip)
    owner.once('closed', () => !win.isDestroyed() && win.destroy())
  }
  return tip
}

/**
 * Show a label for a control. x: the control's centre; top and bottom: its edges (CSS pixels of
 * the owner's page). The label goes under the control, or above it when there's no room below.
 */
export async function showTip(owner: BrowserWindow, text: string, at: { x: number; top: number; bottom: number }): Promise<void> {
  if (owner.isDestroyed()) return
  const tip = tipFor(owner)
  const request = ++tip.request
  await tip.ready
  if (tip.win.isDestroyed()) return
  const size = (await tip.win.webContents
    .executeJavaScript(`(() => { const t = document.getElementById('tip'); t.textContent = ${JSON.stringify(text)}; const r = t.getBoundingClientRect(); return { width: Math.ceil(r.width) + 4, height: Math.ceil(r.height) + 4 } })()`)
    .catch(() => null)) as { width: number; height: number } | null
  if (!size || request !== tip.request || owner.isDestroyed() || tip.win.isDestroyed()) return
  const content = owner.getContentBounds()
  const below = at.bottom + 6 + size.height <= content.height
  const x = Math.round(Math.min(Math.max(content.x + at.x - size.width / 2, content.x + 4), content.x + content.width - size.width - 4))
  const y = Math.round(content.y + (below ? at.bottom + 6 : at.top - 6 - size.height))
  tip.win.setBounds({ x, y, width: size.width, height: size.height })
  tip.win.showInactive()
}

export function hideTip(owner: BrowserWindow): void {
  const tip = tips.get(owner)
  if (!tip) return
  tip.request++
  if (!tip.win.isDestroyed()) tip.win.hide()
}
