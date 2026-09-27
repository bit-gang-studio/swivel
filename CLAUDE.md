# Swivel

Desktop dev browser. Switch browser engines and screen sizes, and compare them. Electron, React and Playwright. MIT. Must run on macOS, Windows and Linux.

- **Plan and status:** the Swivel board in Crunchy. No status or changelog in this repo.
- **Brief, spec, anti-roadmap:** Crunchy docs.
- **Architecture:** `docs/architecture.md`

## Commands

```bash
npm run dev
npm run typecheck
npm test
npm run browsers   # install Playwright browsers (+ patched Firefox on macOS)
npm run build:native   # macOS: build the native module (Safari view, window mirror)
```

## Rules

- Keep docs absolutely minimal.
- The renderer never imports Playwright or Node. Go through the preload API.
- The UI names engines Chromium, Firefox, WebKit. Use `engineLabel`.
- No OS-specific code paths without a fallback for the other two.
- Don't launch the app on the user's Mac for testing (crash dialogs, stray windows). Run app tests in CI with the "Live view check" workflow.
- Debug experiments in CI must not fail the run (use continue-on-error); failures email the user.
