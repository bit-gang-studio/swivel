# Architecture

## Processes

| Process | Code | Job |
|---|---|---|
| Main | `src/main/` | Electron app lifecycle, windows, and driving browser engines through Playwright |
| Preload | `src/preload/` | Exposes a small, typed `window.swivel` API to the UI over IPC |
| Renderer | `src/renderer/` | React UI: toolbar, viewport, dev tools |
| Shared | `src/shared/` | Types used by all three |

The renderer never touches Playwright directly. It calls `window.swivel.*`, which goes over IPC to the main process.

## Engines

Each window has an `EngineHost` (`src/main/host.ts`) holding one live `PageView` (`view.ts`) per canvas frame. The canvas (`src/renderer/src/Canvas.tsx`) is the whole UI: frames side by side, each with its own engine and screen size, all on the same URL. When one frame navigates on its own, the others follow. Typed URLs, back, forward and reload go to every frame; size and dark mode apply without reloading. Frames pan, zoom (10–100%), move and resize; sets (`devices.ts`) are saved groups of frames. Native pages draw over the app's own UI, so every control sits outside a page, and menus are native. Each window has its own data (cookies, storage, cache) in every engine, in memory only and shared with no other window: a Chromium partition, a WebKit data store, and a Playwright context per engine. Clear data rebuilds the window's views on fresh storage; closing the window drops it. A window asks the questions a browser would (a site's username and password, an untrusted certificate, a page's alert or confirm) once, and every frame gets the answer. Cookies are kept the same in every engine by a per-window jar (`cookies.ts`), so signing in on one frame signs in the rest; other storage is not copied. What each frame was asked to do is logged to `swivel.log` in the app's log folder.

Backends:

| Engine | macOS | Windows, Linux | How |
|---|---|---|---|
| Chromium | Native | Native | Electron's own Chromium in a `WebContentsView` (`native-chrome.ts`) |
| WebKit | Native | Streamed | Apple's WKWebView via an N-API addon in `native/webkit-view` (`native-safari.ts`) |
| Firefox | Real window, mirrored | Streamed | Mac: `firefox-window.ts`. Elsewhere: Playwright frames on a canvas (`live.ts`, `frames.ts`) |

**Native** views are laid over the page area, so they are real-time, like a normal browser. The page lays out at the viewport width and is scaled to fit:

- Chrome: the view fits the page area, and device emulation (what DevTools' device toolbar uses) lays the page out at the frame's size and draws it scaled. Page zoom isn't used: it's shared by every view of a site in a window. A view that isn't to be seen is parked above the window, never hidden: a hidden view tells its page the window is 0 pixels wide. Dark mode uses the DevTools protocol, but not while a test runner is attached over remote debugging (that crashes Electron). A frame cut off by the app's own UI shows a still image of itself instead: Electron can't clip a view on macOS.
- Safari: the WKWebView is full viewport size inside a clipping container whose bounds are the viewport size, so AppKit scales it. Page zoom stops at 0.5, so it isn't used.

A DevTools size override draws at full size outside the view, so it isn't used either.

**Streamed** engines run headless in Playwright at the screen's pixel density, so they're sharp on Retina screens. Chromium-style screencast caps Firefox and WebKit near 25 fps, so they poll screenshots at up to 60 fps, drop duplicates, and slow down when idle. Input is replayed in order, with moves and wheel events coalesced. No browser call can block navigation or input. All engines prewarm at launch.

**Real-window Firefox (macOS).** No embeddable Firefox exists, so Swivel runs a real, borderless Firefox window from its own patched copy (`scripts/patch-firefox.mjs`: Juggler gains move/resize/minimize commands, borderless windows with no browser UI, no Dock icon). The window is parked off-screen, borderless (macOS keeps part of titled windows on screen) and click-through, with Firefox deaf to occlusion so it keeps rendering at full speed. A native layer mirrors it with ScreenCaptureKit (`native/webkit-view/mirror.mm`), so it renders on the GPU at the display's refresh rate. The page renders at Swivel's display density even though the parked window is 1x. Input still goes through the page area and Playwright. Needs the Screen Recording permission (in dev, for your terminal app); without it Firefox is streamed. Placement and frame-rate diagnostics go to `~/Library/Logs/swivel/firefox-window.log`. `SWIVEL_STREAM_FIREFOX=1` forces streaming.

Streamed Firefox calls Firefox's own screenshot command directly (Playwright's waits cost ~33 ms a frame) and sends a lossless frame when the page settles. Its screencast crops above 1x, so it's only used at 1x.

## Tests

- `scripts/e2e-live.mjs`: on the canvas with one frame per engine: click, type, scroll, find, leave a page that never finishes loading, and follow a link from one frame.
- `scripts/e2e-useragent.mjs`: each engine's user agent matches its real browser (sites serve different pages by it).
- `scripts/e2e-isolation.mjs`: each window's data is separate in every engine, and Clear data wipes it.
- `SWIVEL_SELFTEST=1 npx electron .`: checks native engines' size and dark mode with no test runner attached.
- `SWIVEL_VISUAL=<dir> npx electron .`: real screen captures of every engine and size. Page-reported sizes have passed while the picture was wrong, so look at these after any layout change.
- `scripts/bench-live.mjs`, `diag-lag.mjs`, `diag-scroll.mjs`: frame rate and lag.
- The manual "Live view check" workflow runs these on all three OSes. Run app tests in CI rather than locally: they launch Electron windows.

Browsers are not bundled yet. In development they come from `npm run browsers`, which also makes the patched Firefox copy on macOS. `npm run build:native` builds the native module (Safari view, window mirror) on macOS. `SWIVEL_DEBUG=1` logs Firefox navigation, rendering mode and clicks.

## Naming engines

The UI names engines Chromium, Firefox and WebKit, as Playwright does. Tooltips say which browsers use each. See `src/renderer/src/engines.ts`.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds on macOS, Windows and Linux and attaches the installers to a GitHub release. Builds are unsigned until code signing is set up.
