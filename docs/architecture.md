# Architecture

## Processes

| Process | Code | Job |
|---|---|---|
| Main | `src/main/` | Electron app lifecycle, windows, and driving browser engines through Playwright |
| Preload | `src/preload/` | Exposes a small, typed `window.swivel` API to the UI over IPC |
| Renderer | `src/renderer/` | React UI: toolbar, viewport, dev tools |
| Shared | `src/shared/` | Types used by all three |

The renderer never touches Playwright directly. It calls `window.swivel.*`, which goes over IPC to the main process.

## Engines and live view

`src/main/live.ts` runs one live page per window. Frames stream out with Playwright's `page.screencast`, and mouse, wheel and key input is replayed into the page in order. One headless browser per engine is reused.

**Decision (spike, Sep 2026):** use screencast for all three engines. No snapshot fallback needed.

Measured frames per second and click-to-screen lag, 1280×800 (`scripts/bench-live.mjs`):

| | Chrome | Firefox | WebKit |
|---|---|---|---|
| Mac (M-series laptop) | 60 fps, 70 ms | 22 fps, 125 ms | 19 fps, 60 ms |
| Linux (CI) | 60 fps, 100 ms | 24 fps, 90 ms | 31 fps, 100 ms |
| Windows (CI) | 60 fps, 135 ms | 11 fps, 180 ms | 19 fps, 120 ms |

Firefox and WebKit are fine for clicking and scrolling but choppy for animations.

Browsers are not bundled yet. In development they come from `npm run browsers`.

`scripts/e2e-live.mjs` drives the built app and checks click, type and scroll in every engine. The manual "Live view check" workflow runs both scripts on all three OSes.

## Naming engines

WebKit is shown as "Safari" only on macOS. On Windows and Linux it is shown as "WebKit". See `engineLabel` in `src/renderer/src/engines.ts`.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds on macOS, Windows and Linux and attaches the installers to a GitHub release. Builds are unsigned until code signing is set up.
