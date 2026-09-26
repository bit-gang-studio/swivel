# Swivel

A desktop dev browser for checking your site across browser engines and screen sizes.

Swivel feels like a normal browser, but the engine is a switch. Load a page once, then flip between Chrome, Firefox and Safari, or view them side by side.

> **Status:** early development.

## Features

**Working now**
- Live, clickable pages in Chromium, Firefox and WebKit, powered by [Playwright](https://playwright.dev)
- Phone, tablet and desktop sizes
- Light and dark mode
- Console messages tagged by engine

**Planned**
- Compare mode: engines side by side with synced scrolling and clicks
- Highlighted differences between engines
- Inspect: compare an element's styles across engines

## Platforms

Swivel runs on macOS, Windows and Linux.

On macOS the WebKit engine is labelled **Safari**. On Windows and Linux it is labelled **WebKit**, because it is Playwright's WebKit build rather than real Safari.

## Develop

Requires Node 22 or newer.

```bash
npm install
npm run browsers   # download Chromium, Firefox and WebKit for Playwright
npm run dev
```

Other scripts:

```bash
npm run typecheck
npm test
npm run dist       # package for your current OS into release/
```

## Contributing

Issues and pull requests are welcome. See [docs/architecture.md](docs/architecture.md) for how the app is put together.

## License

[MIT](LICENSE)
