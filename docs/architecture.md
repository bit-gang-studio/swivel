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

`src/main/engines.ts` launches Chromium, Firefox and WebKit with `playwright-core`, one browser per engine, reused across requests. Each request gets a fresh browser context with the chosen viewport and colour scheme.

Browsers are not bundled yet. In development they come from `npm run browsers`, which downloads them to Playwright's shared cache. Shipping browsers with the packaged app is an open task.

## Snapshot mode vs live mode

Today the app runs in **snapshot mode**: load the page, take a screenshot, return it with console output.

The goal is **live mode**: a clickable view of every engine. Playwright has no built-in live stream for Firefox or WebKit, so this needs a spike. Options to test:

1. Stream frames. Use CDP screencast for Chromium, and a fast screenshot loop for Firefox and WebKit. Forward mouse and keyboard input with Playwright's input APIs.
2. Use Electron's own Chromium for the Chrome engine as a real, native view, and stream only Firefox and WebKit.

If live mode for Firefox and WebKit is too slow, compare mode falls back to snapshots that refresh on change.

## Naming engines

WebKit is shown as "Safari" only on macOS. On Windows and Linux it is shown as "WebKit". See `engineLabel` in `src/renderer/src/engines.ts`.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds on macOS, Windows and Linux and attaches the installers to a GitHub release. Builds are unsigned until code signing is set up.
