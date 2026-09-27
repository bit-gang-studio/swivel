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
const MARKER = 'swivel-patch-v10'
const SWIVEL_NATIVE_TWEAKS = `
// Swivel: native window tweaks, run from inside Firefox (js-ctypes, Objective-C runtime).
// - Accessory app: no Dock icon or app switcher entry. Firefox makes itself a regular app at
//   startup and whenever a window is shown, overriding LSUIElement.
// - Transient windows: left out of Mission Control and App Exposé (the window is hidden behind
//   Swivel, but those views show every window).
function swivelNativeTweaks() {
  try {
    const { ctypes } = ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
    const objc = ctypes.open('/usr/lib/libobjc.A.dylib');
    const id = ctypes.voidptr_t;
    const getClass = objc.declare('objc_getClass', ctypes.default_abi, id, ctypes.char.ptr);
    const sel = objc.declare('sel_registerName', ctypes.default_abi, id, ctypes.char.ptr);
    const send = objc.declare('objc_msgSend', ctypes.default_abi, id, id, id);
    const sendIndex = objc.declare('objc_msgSend', ctypes.default_abi, id, id, id, ctypes.unsigned_long);
    const sendCount = objc.declare('objc_msgSend', ctypes.default_abi, ctypes.unsigned_long, id, id);
    const sendLong = objc.declare('objc_msgSend', ctypes.default_abi, ctypes.bool, id, id, ctypes.long);
    const sendVoidULong = objc.declare('objc_msgSend', ctypes.default_abi, ctypes.void_t, id, id, ctypes.unsigned_long);
    const sendGetULong = objc.declare('objc_msgSend', ctypes.default_abi, ctypes.unsigned_long, id, id);
    const app = send(getClass('NSApplication'), sel('sharedApplication'));
    sendLong(app, sel('setActivationPolicy:'), 1); // NSApplicationActivationPolicyAccessory
    const windows = send(app, sel('windows'));
    const count = sendCount(windows, sel('count'));
    const behaviors = [];
    for (let i = 0; i < count; i++) {
      const w = sendIndex(windows, sel('objectAtIndex:'), i);
      // Transient (1 << 3) | IgnoresCycle (1 << 6), keeping any other flags Firefox set
      // (except Managed (1 << 2), which conflicts with Transient).
      const current = Number(sendGetULong(w, sel('collectionBehavior')));
      sendVoidULong(w, sel('setCollectionBehavior:'), (current & ~(1 << 2)) | (1 << 3) | (1 << 6));
      behaviors.push(Number(sendGetULong(w, sel('collectionBehavior'))));
    }
    objc.close();
    return { windows: Number(count), behaviors };
  } catch (e) {
    return { error: String(e) };
  }
}
`
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
    // Showing a window makes Firefox a regular app again (Dock icon); switch it back.
    if (visible) swivelNativeTweaks();
  }

  async ['Page.nativeTweaks']() {
    return { result: JSON.stringify(swivelNativeTweaks()) };
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
    'nativeTweaks': {
      params: {},
      returns: { result: t.String },
    },
    'setZoom': {`)
patch(`${juggler}/TargetRegistry.js`, '    const features = "chrome,dialog=no,all";', `    // Swivel: borderless windows with no browser UI, placed behind Swivel and captured.
    const chromeless = Services.prefs.getBoolPref("swivel.chromeless", false);
    const at = chromeless ? ",screenX=" + Services.prefs.getIntPref("swivel.windowX", 0) + ",screenY=" + Services.prefs.getIntPref("swivel.windowY", 0) : "";
    const features = chromeless ? "chrome,dialog=no,all,titlebar=no,toolbar=no,menubar=no,location=no,status=no" + at : "chrome,dialog=no,all";`)
patch(`${juggler}/TargetRegistry.js`, `    await waitForWindowReady(window);
    if (window.gBrowser.browsers.length !== 1)`, `    await waitForWindowReady(window);
    if (chromeless) {
      const toolbox = window.document.getElementById('navigator-toolbox');
      if (toolbox) toolbox.collapsed = true;
      swivelNativeTweaks();
    }
    if (window.gBrowser.browsers.length !== 1)`)

patch(`${juggler}/TargetRegistry.js`, `    Services.wm.addListener({ onOpenWindow, onCloseWindow });`, `    // Swivel: drop the Dock icon as soon as Juggler starts, not only when a window opens.
    if (Services.prefs.getBoolPref("swivel.chromeless", false)) swivelNativeTweaks();
    Services.wm.addListener({ onOpenWindow, onCloseWindow });`)

for (const file of [`${juggler}/protocol/PageHandler.js`, `${juggler}/TargetRegistry.js`]) {
  writeFileSync(join(work, file), readFileSync(join(work, file), 'utf8') + SWIVEL_NATIVE_TWEAKS)
}

rmSync(join(res, 'omni.ja'))
run('zip', ['-qr9XD', join(res, 'omni.ja'), '.'], { cwd: work })
rmSync(work, { recursive: true, force: true })
run('plutil', ['-replace', 'LSUIElement', '-bool', 'true', join(dest, 'Contents/Info.plist')])
writeFileSync(join(res, MARKER), '')
run('codesign', ['--force', '--deep', '--sign', '-', dest])
console.log(`Swivel Firefox ready: ${dest}`)
