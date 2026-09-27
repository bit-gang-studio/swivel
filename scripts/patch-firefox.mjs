// macOS: makes Swivel's own copy of Playwright's Firefox for real-window rendering.
//  - copied, never patched in place (Playwright's cache is shared with other projects)
//  - Juggler gains Page.moveWindow and Page.setWindowMinimized
//  - with the swivel.chromeless pref, windows are borderless with no browser UI
//  - no Dock icon (LSUIElement), then re-signed ad hoc
// Run: node scripts/patch-firefox.mjs   (npm run browsers runs it)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { firefox } from 'playwright-core'

if (process.platform !== 'darwin') process.exit(0)

const exe = firefox.executablePath() // .../firefox-NNNN/firefox/Nightly.app/Contents/MacOS/firefox
const source = dirname(dirname(dirname(exe)))
const revision = source.match(/firefox-(\d+)/)?.[1] ?? 'unknown'
const dest = join(homedir(), 'Library/Caches/swivel', `firefox-window-${revision}`, 'Nightly.app')
const MARKER = 'swivel-patch-v5'
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString()

if (!existsSync(exe)) {
  console.error('Playwright Firefox not installed. Run: npx playwright install firefox')
  process.exit(1)
}
if (existsSync(join(dest, 'Contents/Resources', MARKER))) {
  console.log(`Swivel Firefox already patched: ${dest}`)
  process.exit(0)
}

rmSync(dirname(dest), { recursive: true, force: true })
mkdirSync(dirname(dest), { recursive: true })
run('ditto', [source, dest])

const res = join(dest, 'Contents/Resources')
const work = mkdtempSync(join(tmpdir(), 'swivel-omni-'))
run('unzip', ['-q', join(res, 'omni.ja'), '-d', work])

const patch = (file, find, replace) => {
  const path = join(work, file)
  const text = readFileSync(path, 'utf8')
  if (!text.includes(find)) throw new Error(`Juggler changed; can't patch ${file}`)
  writeFileSync(path, text.replace(find, replace))
}
const juggler = 'chrome/juggler/content'
patch(`${juggler}/protocol/PageHandler.js`, "  async ['Page.setZoom']({zoom}) {", `  async ['Page.moveWindow']({x, y}) {
    const win = this._pageTarget._window;
    win.moveTo(x, y);
    return { x: win.screenX, y: win.screenY };
  }

  async ['Page.setWindowMinimized']({minimized}) {
    const win = this._pageTarget._window;
    if (minimized) win.minimize(); else win.restore();
  }

  async ['Page.setWindowVisible']({visible}) {
    // Hides the window entirely (no Dock thumbnail, unlike minimizing) or shows it again.
    const win = this._pageTarget._window;
    win.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).visibility = visible;
  }

  async ['Page.setWindowSize']({width, height}) {
    // Resizes the window only; the page keeps its viewport size (the browser stack scrolls).
    this._pageTarget._window.resizeTo(width, height);
  }

  async ['Page.setZoom']({zoom}) {`)
patch(`${juggler}/protocol/Protocol.js`, "    'setZoom': {", `    'moveWindow': {
      params: { x: t.Number, y: t.Number },
      returns: { x: t.Number, y: t.Number },
    },
    'setWindowMinimized': {
      params: { minimized: t.Boolean },
    },
    'setWindowSize': {
      params: { width: t.Number, height: t.Number },
    },
    'setWindowVisible': {
      params: { visible: t.Boolean },
    },
    'setZoom': {`)
patch(`${juggler}/TargetRegistry.js`, '    const features = "chrome,dialog=no,all";', `    // Swivel: borderless windows with no browser UI, placed behind Swivel and captured.
    const chromeless = Services.prefs.getBoolPref("swivel.chromeless", false);
    const features = chromeless ? "chrome,dialog=no,all,titlebar=no,toolbar=no,menubar=no,location=no,status=no" : "chrome,dialog=no,all";`)
patch(`${juggler}/TargetRegistry.js`, `      if (!domWindow.gBrowser)
        return;
      const tabContainer = domWindow.gBrowser.tabContainer;`, `      if (!domWindow.gBrowser)
        return;
      // Swivel: keep every browser window hidden until Swivel has placed it (no flashes).
      if (Services.prefs.getBoolPref("swivel.chromeless", false))
        domWindow.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).visibility = false;
      const tabContainer = domWindow.gBrowser.tabContainer;`)
patch(`${juggler}/TargetRegistry.js`, `    await waitForWindowReady(window);
    if (window.gBrowser.browsers.length !== 1)`, `    await waitForWindowReady(window);
    if (chromeless) {
      window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).visibility = false;
      const toolbox = window.document.getElementById('navigator-toolbox');
      if (toolbox) toolbox.collapsed = true;
      // No Dock icon or app switcher entry: make Firefox an accessory app. Firefox turns itself
      // into a regular app at startup, overriding LSUIElement, so this runs from inside it.
      try {
        const { ctypes } = ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
        const objc = ctypes.open('/usr/lib/libobjc.A.dylib');
        const id = ctypes.voidptr_t;
        const getClass = objc.declare('objc_getClass', ctypes.default_abi, id, ctypes.char.ptr);
        const sel = objc.declare('sel_registerName', ctypes.default_abi, id, ctypes.char.ptr);
        const send = objc.declare('objc_msgSend', ctypes.default_abi, id, id, id);
        const sendLong = objc.declare('objc_msgSend', ctypes.default_abi, ctypes.bool, id, id, ctypes.long);
        const app = send(getClass('NSApplication'), sel('sharedApplication'));
        sendLong(app, sel('setActivationPolicy:'), 1); // NSApplicationActivationPolicyAccessory
        objc.close();
      } catch (e) {
        dump('swivel: could not hide Dock icon: ' + e + String.fromCharCode(10));
      }
    }
    if (window.gBrowser.browsers.length !== 1)`)

rmSync(join(res, 'omni.ja'))
run('zip', ['-qr9XD', join(res, 'omni.ja'), '.'], { cwd: work })
rmSync(work, { recursive: true, force: true })
run('plutil', ['-replace', 'LSUIElement', '-bool', 'true', join(dest, 'Contents/Info.plist')])
writeFileSync(join(res, MARKER), '')
run('codesign', ['--force', '--deep', '--sign', '-', dest])
console.log(`Swivel Firefox ready: ${dest}`)
