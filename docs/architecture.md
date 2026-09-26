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

`src/main/live.ts` runs one live page per window and replays mouse, wheel and key input in order. `src/main/frames.ts` streams frames:

- **Chromium:** `page.screencast`, which runs at 60 fps.
- **Firefox and WebKit:** their screencast is capped near 25 fps, but screenshots are fast. So we poll screenshots at up to 60 fps, drop duplicates, slow to 10 fps while idle, and wake on input or navigation.

All engines start at launch and warm up, because Firefox on Windows is slow for its first few seconds.

Frames per second and click lag at 1280×800, from `scripts/bench-live.mjs` (Sep 2026):

| | Chrome | Firefox | WebKit |
|---|---|---|---|
| Mac (M-series laptop) | 60 fps, 80 ms | 59 fps, 50 ms | 58 fps, 50 ms |
| Linux (CI) | 60 fps, 100 ms | 58 fps, 57 ms | 62 fps, 56 ms |
| Windows (CI, no GPU) | 60 fps, 180 ms | 51 fps, 116 ms | 41 fps, 99 ms |

`scripts/e2e-live.mjs` drives the built app and checks click, type and scroll in every engine. The manual "Live view check" workflow runs both scripts on all three OSes.

Browsers are not bundled yet. In development they come from `npm run browsers`.

## Naming engines

WebKit is shown as "Safari" only on macOS. On Windows and Linux it is shown as "WebKit". See `engineLabel` in `src/renderer/src/engines.ts`.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds on macOS, Windows and Linux and attaches the installers to a GitHub release. Builds are unsigned until code signing is set up.
