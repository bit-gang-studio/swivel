# Swivel

Desktop dev browser: switch between browser engines and screen sizes, compare them, with simple dev tools. Electron + React + Playwright. Free and open source (MIT), must run on macOS, Windows and Linux.

## Where things live

- **Plan and status:** the Swivel project board in Crunchy. There is no roadmap or status doc in this repo.
- **Product brief, spec and anti-roadmap:** Crunchy docs on the Swivel project.
- **Wireframes:** https://claude.ai/artifact/S7mFx37BUvc54xmde1B46i
- **Architecture:** `docs/architecture.md`

## Commands

```bash
npm run dev         # run the app
npm run typecheck
npm test
npm run browsers    # install Playwright's browsers
```

## Conventions

- The renderer never imports Playwright or Node APIs. Add a method to the preload API and handle it in the main process.
- Shared types go in `src/shared/types.ts`.
- Never show WebKit as "Safari" outside macOS. Use `engineLabel`.
- Keep it cross-platform: no shell scripts or OS-specific paths in app code. CI builds on all three OSes.
- Do not add a status or changelog section to this file. The board is the status.
