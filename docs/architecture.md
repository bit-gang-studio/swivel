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

Each window has an `EngineHost` (`src/main/host.ts`) holding one live `PageView` (`view.ts`) per engine, all kept loaded and on the same URL. One is shown and leads: when it navigates on its own, the others follow in the background. Typed URLs, back, forward and reload go to every view; size and dark mode apply without reloading. Views are independent instances, so a window can later show several at once. Each engine has its own persistent profile (logins survive restarts), closed and flushed before quit.

Backends:

| Engine | macOS | Windows, Linux | How |
|---|---|---|---|
| Chromium | Native | Native | Electron's own Chromium in a `WebContentsView` (`native-chrome.ts`) |
| WebKit | Native | Streamed | Apple's WKWebView via an N-API addon in `native/webkit-view` (`native-safari.ts`) |
| Firefox | Real window, mirrored | Streamed | Mac: `firefox-window.ts`. Elsewhere: Playwright frames on a canvas (`live.ts`, `frames.ts`) |

**Native** views are laid over the page area, so they are real-time, like a normal browser. The page lays out at the viewport width and is scaled to fit:

- Chrome: the view fits the page area and zoom sets the layout width. Zoom is per site, so the view starts with the right default zoom and it is reapplied after navigation. On Windows a site's first visit can briefly reflow. Dark mode uses the DevTools protocol, but not while a test runner is attached over remote debugging (that crashes Electron).
- Safari: the WKWebView is full viewport size inside a clipping container whose bounds are the viewport size, so AppKit scales it. Page zoom stops at 0.5, so it isn't used.

A DevTools size override draws at full size outside the view, so it isn't used either.

**Streamed** engines run headless in Playwright at the screen's pixel density, so they're sharp on Retina screens. Chromium-style screencast caps Firefox and WebKit near 25 fps, so they poll screenshots at up to 60 fps, drop duplicates, and slow down when idle. Input is replayed in order, with moves and wheel events coalesced. No browser call can block navigation or input. All engines prewarm at launch.

**Real-window Firefox (macOS).** No embeddable Firefox exists, so Swivel runs a real, borderless Firefox window from its own patched copy (`scripts/patch-firefox.mjs`: Juggler gains move/resize/minimize commands, borderless windows with no browser UI, no Dock icon). The window is parked off-screen, borderless (macOS keeps part of titled windows on screen) and click-through, with Firefox deaf to occlusion so it keeps rendering at full speed. A native layer mirrors it with ScreenCaptureKit (`native/webkit-view/mirror.mm`), so it renders on the GPU at the display's refresh rate. The page renders at Swivel's display density even though the parked window is 1x. Input still goes through the page area and Playwright. Needs the Screen Recording permission (in dev, for your terminal app); without it Firefox is streamed. Firefox caches its compiled internal code in the profile (`startupCache`), so Swivel clears it whenever the patch changes; otherwise an old patch keeps running. Placement and frame-rate diagnostics go to `~/Library/Logs/swivel/firefox-window.log`. `SWIVEL_STREAM_FIREFOX=1` forces streaming.

Streamed Firefox calls Firefox's own screenshot command directly (Playwright's waits cost ~33 ms a frame) and sends a lossless frame when the page settles. Its screencast crops above 1x, so it's only used at 1x.

## Tests

- `scripts/e2e-live.mjs`: drives the built app in every engine. Click, type, scroll, cursor, find, leaving a page that never finishes loading, and other engines following a link.
- `scripts/e2e-persist.mjs`: a cookie survives an app restart in every engine.
- `SWIVEL_SELFTEST=1 npx electron .`: checks native engines' size and dark mode with no test runner attached.
- `SWIVEL_VISUAL=<dir> npx electron .`: real screen captures of every engine and size. Page-reported sizes have passed while the picture was wrong, so look at these after any layout change.
- `scripts/bench-live.mjs`, `diag-lag.mjs`, `diag-scroll.mjs`: frame rate and lag.
- The manual "Live view check" workflow runs these on all three OSes. Run app tests in CI rather than locally: they launch Electron windows.

Browsers are not bundled yet. In development they come from `npm run browsers`, which also makes the patched Firefox copy on macOS. `npm run build:native` builds the native module (Safari view, window mirror) on macOS. `SWIVEL_DEBUG=1` logs Firefox navigation, rendering mode and clicks.

## Naming engines

The UI names engines Chromium, Firefox and WebKit, as Playwright does. Tooltips say which browsers use each. See `src/renderer/src/engines.ts`.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds on macOS, Windows and Linux and attaches the installers to a GitHub release. Builds are unsigned until code signing is set up.
