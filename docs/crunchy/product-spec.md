# Swivel — Product Spec

**Wireframes:** https://claude.ai/artifact/S7mFx37BUvc54xmde1B46i

## Main toolbar (every screen)
- Back, forward, reload
- Address bar, works with localhost
- Engine switch: Chrome · Firefox · Safari. Shown as "WebKit" on Windows and Linux
- Size picker: Phone 390, Tablet 820, Desktop 1280, custom width
- Dark mode toggle
- Compare button

## 1. Browse
One engine at a time, with dev tools docked at the bottom. Switching engines keeps the URL, scroll position and login.

**Dev tools**
- **Console:** every entry tagged with its engine. Filter by engine.
- **Network:** requests per engine, failures highlighted.
- **Inspect:** click an element in the page to select it.

## 2. Compare
- Grid of chosen engines at one size
- Sync scroll, sync clicks and typing
- "Show differences" against a baseline engine, default Chrome
- Each pane shows its error and difference count
- A list of differences at the bottom. Clicking one jumps to it and opens Inspect

## 3. Sizes
One engine at phone, tablet, desktop and custom widths side by side. Dark mode and sync scroll apply to all.

## 4. Inspect
A table of the selected element's computed styles, one column per engine. "Only show differences" is on by default. Actions: open in editor, copy CSS rule.

## Out of scope for the free app
See the Anti-Roadmap.
