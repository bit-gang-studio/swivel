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

Each window has an `EngineHost` (`src/main/host.ts`) that routes to one of three backends:

| Engine | macOS | Windows, Linux | How |
|---|---|---|---|
| Blink (Chrome) | Native | Native | Electron's own Chromium in a `WebContentsView` (`native-chrome.ts`) |
| WebKit (Safari) | Native | Streamed | Apple's WKWebView via an N-API addon in `native/webkit-view` (`native-safari.ts`) |
| Gecko (Firefox) | Streamed | Streamed | Playwright, frames drawn on a canvas (`live.ts`, `frames.ts`) |

**Native** views are laid over the page area, so they are real-time, like a normal browser. The page lays out at the viewport width and is scaled to fit:

- Chrome: the view fits the page area and zoom sets the layout width. Zoom is per site, so the view starts with the right default zoom and it is reapplied after navigation. On Windows a site's first visit can briefly reflow. Dark mode uses the DevTools protocol, but not while a test runner is attached over remote debugging (that crashes Electron).
- Safari: the WKWebView is full viewport size inside a clipping container whose bounds are the viewport size, so AppKit scales it. Page zoom stops at 0.5, so it isn't used.

A DevTools size override draws at full size outside the view, so it isn't used either.

**Streamed** engines run headless in Playwright at the screen's pixel density, so they're sharp on Retina screens. Chromium-style screencast caps Firefox and WebKit near 25 fps, so they poll screenshots at up to 60 fps, drop duplicates, and slow down when idle. Input is replayed in order, with moves and wheel events coalesced. No browser call can block navigation or input. All engines prewarm at launch.

No embeddable Firefox exists for desktop, so it stays streamed.

## Tests

- `scripts/e2e-live.mjs`: drives the built app in every engine. Click, type, scroll, and leaving a page that never finishes loading.
- `SWIVEL_SELFTEST=1 npx electron .`: checks native engines' size and dark mode with no test runner attached.
- `SWIVEL_VISUAL=<dir> npx electron .`: real screen captures of every engine and size. Page-reported sizes have passed while the picture was wrong, so look at these after any layout change.
- `scripts/bench-live.mjs`, `diag-lag.mjs`, `diag-scroll.mjs`: frame rate and lag.
- The manual "Live view check" workflow runs these on all three OSes. Run app tests in CI rather than locally: they launch Electron windows.

Browsers are not bundled yet. In development they come from `npm run browsers`. `npm run build:native` builds the Safari addon on macOS.

## Naming engines

The UI names engines, not browsers: Blink, Gecko, WebKit. Tooltips say which browsers use each. See `src/renderer/src/engines.ts`.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds on macOS, Windows and Linux and attaches the installers to a GitHub release. Builds are unsigned until code signing is set up.
