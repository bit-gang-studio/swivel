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
npm run browsers   # install Playwright browsers
```

## Rules

- Keep docs absolutely minimal.
- The renderer never imports Playwright or Node. Go through the preload API.
- Only call WebKit "Safari" on macOS. Use `engineLabel`.
- No OS-specific code paths without a fallback for the other two.
