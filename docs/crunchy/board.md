# Swivel — Build board

Exported from Crunchy on 8 Oct 2026, when the project was abandoned. Cards are as they stood on the board, in column order. All were assigned to Christopher Mabbs unless noted. `[x]` and `[ ]` are each card's acceptance criteria.

**Project description (as Crunchy showed it, cut short there):** Swivel — a free, open source desktop dev browser (MIT). Switch between Chrome, Firefox and Safari/WebKit and between screen sizes, compare engines side by side, with simple dev tools. Electron + React + Playwright, runs on macOS, Windows and Linux. Repo: bit-gang-studio/swivel. A paid cloud tier…

Other docs: [Product Brief](product-brief.md), [Product Spec](product-spec.md), [Anti-Roadmap](anti-roadmap.md).

## Where the code stood when the board was last updated

The board is behind the code. Merged into `main` after its last update:

- Console prompt and JSON viewer (both cards still sit in Review).
- From "File uploads, downloads, permissions and login popups": file uploads and downloads in every engine; sign-in popups as their own window in Blink, one at a time per window. Not built: popups in Gecko and WebKit; camera, microphone, location and notification prompts.
- Never checked by a person: a real Google (or other) popup sign-in through to the end.

---

## To Do

### File uploads, downloads, permissions and login popups
Size L · created 1 Oct 2026

More places a browser asks the user something and Swivel has nowhere to show it. In order of how often they block dev work:

1. File uploads (`<input type="file">`): Gecko opens its picker off-screen, WebKit does nothing.
2. Login popups ("Sign in with Google"): Swivel loads popups in the same frame, which breaks logins that need a separate window.
3. Downloads: not handled.
4. Camera, microphone, location, notifications: no permission prompt, so they silently fail.

Also note: bot protection (Cloudflare and similar) can block the Playwright-driven engines on live sites.

### Fix flaky CI checks
Size S · created 28 Sep 2026 · updated 1 Oct 2026

**Clear-data failure: cause found, fix written (not yet through CI).** After Clear data the shown view's load made the others "follow" to the URL they were already loading; Playwright's WebKit breaks on two loads at once. Still open: the Firefox pointer-cursor check on Windows (e2e-live) fails now and then. Find the timing cause, don't just add waits.

### Real-time Firefox: embed or pin a real Firefox window
Size L · created 26 Sep 2026 · updated 28 Sep 2026

**Mac done 28 Sep 2026.** Firefox runs as a real window from Swivel's patched copy, parked off-screen (borderless, click-through, out of Mission Control and the Dock), and mirrored into Swivel with ScreenCaptureKit. It renders on the GPU at full display rate and 2x density. Nothing can pop up or peek out. Needs Screen Recording permission; without it Firefox is streamed.

**Left:** Windows (embed the real window with SetParent) and Linux X11 (reparent). Both still stream today.

- [x] Decision recorded in docs/architecture.md
- [x] Real-window Firefox on macOS
- [ ] Feels like a real browser on the user's Mac
- [ ] Windows and Linux

### Browser basics: address history and auto-reload
Size M · created 26 Sep 2026 · updated 1 Oct 2026

Back, forward, reload, find and the address bar are done. Left: address bar history and suggestions, and auto-reload for localhost when files change. Tabs are dropped: a window is one project, and Cmd+N opens another.

- [ ] The address bar suggests URLs used before
- [ ] A localhost page reloads in every frame when its files change

### Dev tools: network and element picker
Size L · created 26 Sep 2026 · updated 5 Oct 2026

The console is done: messages from every frame, tagged by engine, with level, engine and text filters. Left: a network tab showing failed requests per engine, and an element picker that feeds the Inspect view.

- [ ] Console can filter by engine
- [ ] Network tab lists requests and highlights failures per engine
- [ ] Clicking an element in the page selects it

### Difference overlay against a baseline engine
Size M · created 26 Sep 2026

Wireframe 2. Use pixelmatch to compare each engine to the chosen baseline. Outline changed areas and list them; clicking one jumps to it and opens Inspect.

- [ ] Changed areas are outlined in each non-baseline pane
- [ ] A list of differences jumps to each one

### Inspect: compare an element's styles across engines
Size L · created 26 Sep 2026

Wireframe 4. Table of computed styles with one column per engine. Option to show only rows that differ. Copy CSS rule.

- [ ] Selected element shows computed styles for every engine
- [ ] 'Only show differences' hides matching rows

### Ship Playwright browsers with the packaged app
Size M · created 26 Sep 2026

Today browsers come from `npm run browsers` into Playwright's shared cache. A packaged app must either bundle them or download them on first run with a progress screen. Needs to work on all three OSes.

Only Firefox (and WebKit on Windows and Linux) need Playwright browsers now. Chrome uses Electron's Chromium, and Safari on macOS uses the system WKWebView. The macOS build must also include the Safari addon (native/webkit-view).

- [ ] A fresh install on Mac, Windows and Linux can load a page in all three engines
- [ ] First-run download or bundle size is documented

### Code signing for macOS and Windows
Size M · created 26 Sep 2026

Releases are unsigned today, so macOS Gatekeeper and Windows SmartScreen will warn users. Needs an Apple Developer account for signing and notarization, and a Windows signing certificate. Add secrets to the release workflow.

- [ ] macOS build is signed and notarized
- [ ] Windows installer is signed

### First public release (v0.1)
Size S · created 26 Sep 2026

Tag v0.1.0 once the spike, bundled browsers and browse view are done. Update README with screenshots and install steps.

- [ ] Installers for Mac, Windows and Linux on the GitHub release
- [ ] README has screenshots and install steps

### Connect the swivel repo to Crunchy
Size XS · created 26 Sep 2026

Crunchy's GitHub connection doesn't include bit-gang-studio/swivel yet, so the repo couldn't be linked to this project. Grant the Crunchy GitHub app access to the repo in Integrations, then scope it to the Swivel project.

- [ ] swivel shows in Crunchy's connected repos
- [ ] Repo is scoped to the Swivel project

### Idea: design reference library over MCP (separate product)
Unassigned · no size · created 30 Sep 2026 · updated 1 Oct 2026

Christo's idea, parked 1 Oct 2026. Not part of Swivel.

A library of designs and design guides gathered from across the web. Users connect it over MCP, and an AI fetches real references and style frameworks to apply good styling to whatever is being built.

Open questions before it's worth building: copying other sites' designs raises copyright and terms-of-service problems (open-source design systems and published guidelines are safe; scraped sites are not); and whether it beats existing references.

Better home: BGS Planning (unstarted concepts).

---

## In Progress

Empty.

---

## Review

### Firefox smoothness: match Chromium and WebKit
Size M · created 28 Sep 2026 · updated 5 Oct 2026

**Merged into `main`; waiting for Christo to try it on his 120 Hz screen.** Firefox's scroll path waited a frame plus a compositor flush before every wheel step; Swivel's Firefox now scrolls at once (24 ms to 16 ms to first scroll, measured). Also: Firefox windows can be narrower than 500 points (phone and tablet frames were blank on a 1x external monitor). Still to do if it's not smooth enough: log the mirror's frame rate during scrolling.

- [ ] Scroll-time frame rates logged for Firefox and the mirror
- [ ] Firefox scrolling feels as smooth as Chromium on a 120 Hz Mac

### Browser prompts: sign-in, certificates, page dialogs
Size M · created 1 Oct 2026 · updated 5 Oct 2026

**Merged into `main`; nobody has tried it yet.** A window asks once and every frame gets the answer; kept in memory, forgotten with Clear data.

- Password-protected sites (.htaccess, HTTP auth): a sign-in bar under the toolbar.
- Untrusted HTTPS certificates (self-signed, https://localhost): a "Proceed Anyway" dialog.
- alert, confirm, prompt: real dialogs in Gecko and WebKit (Blink already had them).

Tested by script: Firefox's parts. Not run in the app by a test or a person: the Blink and WebKit paths, the sign-in bar, the dialogs. To try: open a password-protected staging site, or any https://localhost site with a self-signed certificate.

- [ ] One sign-in unlocks a protected site in every frame
- [ ] A self-signed https site loads in every frame after Proceed Anyway
- [ ] alert and confirm show in all three engines

### One sign-in for every engine in a window
Size M · created 1 Oct 2026 · updated 5 Oct 2026

**Merged into `main`; green in CI. Waiting for Christo to try a real login.** Each window has one cookie jar that watches all three engines. When a cookie changes in one, it's copied to the others (HttpOnly ones too); sign-out copies as well. An engine whose first frame opens later starts with the window's cookies. When frames follow a navigation, the leader's cookies land first. Other windows share nothing; Clear data starts a fresh jar. The Storage panel has the switch to turn sharing off, and tags copied cookies.

Checked in CI on all three OSes: a cookie set in Blink reaches Gecko and WebKit; with sharing off it stays in Blink. Not checked: a real site's login.

Not included: local storage and session storage (some sites keep login tokens there).

- [ ] Sign in on one frame: frames in the other engines are signed in after a reload
- [ ] Clear data still wipes every engine
- [ ] Other windows still share nothing

### Console prompt: run JavaScript in every engine at once
Size M · created 5 Oct 2026

A line to type JavaScript into at the bottom of the console, like Chrome's, with one thing Chrome can't do: it runs in every frame and shows each engine's answer side by side, with the ones that differ marked.

- Type an expression, press Enter: a result row with a column per engine (Blink, Gecko, WebKit).
- Errors show per engine too (one engine throwing where the others don't is the interesting case).
- Up and down arrows recall earlier lines.
- A choice of where it runs: every frame, or one engine.

Also here, to bring console messages closer to Chrome's:
- The file and line a message came from.
- A count on a message repeated in a row, instead of repeating the line.

How: each view can already run script; results come back the way storage reports do.

- [ ] An expression typed once shows a result per engine, side by side
- [ ] A result or error that differs between engines is marked
- [ ] Arrow keys recall earlier lines
- [ ] Messages show their file and line, and repeats are counted

### JSON viewer: read stored and logged data properly
Size M · created 5 Oct 2026

Christo's ask: a nice viewer for JSON, better than Chrome's. Much of what sites keep in local storage, session storage and cookies is JSON squeezed onto one line, and Chrome shows it as a long string.

One viewer, used everywhere a value is shown:
- Storage panel: opening a row whose value is JSON shows it as a tree (keys, nested objects and arrays to fold and unfold), not a string.
- Console prompt results and logged objects: the same tree.
- Across engines: the trees side by side, with the keys that differ marked, so "the same JSON except one field" is obvious.

Good-viewer basics: fold and unfold, coloured types, copy a value or its path, search within it, and show what a value really is (a timestamp as a date; a JWT's contents decoded; a URL-encoded or base64 value decoded on request).
Editing: change one field and save, rather than retyping the whole string.

Do after the console prompt: its results are the second place this viewer is needed.

- [ ] A JSON value in storage opens as a foldable tree
- [ ] The same value across engines shows which keys differ
- [ ] Copy a value or its path; search within the tree
- [ ] One field can be edited and saved to every engine

---

## Done

### Scaffold repo: Electron + React + Playwright, CI, release workflow
Size M · created 26 Sep 2026 · completed 26 Sep 2026

Done 26 Sep 2026. Repo: https://github.com/bit-gang-studio/swivel

Snapshot mode works: load a URL in Chromium, Firefox or WebKit at phone, tablet or desktop size, light or dark, and see the screenshot plus console tagged by engine. CI builds on macOS, Windows and Linux. Pushing a v* tag builds unsigned installers into a GitHub release. MIT license, README, docs/architecture.md and CLAUDE.md are in the repo.

### Spike: live, clickable Firefox and WebKit views
Size L · created 26 Sep 2026 · completed 26 Sep 2026

**Done 26 Sep 2026.** Decision: live view uses Playwright 1.63's `page.screencast` for all three engines. No snapshot fallback needed. Numbers are in docs/architecture.md.

- Chrome streams at 60 fps. Firefox and WebKit run at about 11–31 fps: fine for clicking and scrolling, choppy for animations.
- Click, type and scroll are verified in the real app on Mac, Windows and Linux (manual "Live view check" workflow).
- Found and fixed along the way: inputs arriving out of order, and navigation dropped during startup.

- [x] Firefox and WebKit pages scroll and click inside Swivel
- [x] Frame rate and input lag measured on Mac, Windows and Linux
- [x] Live vs snapshot decision written in docs/architecture.md

### Raise Firefox and WebKit live view to ~60 fps
Size M · created 26 Sep 2026 · completed 28 Sep 2026

**Done 26 Sep 2026.** Their Playwright screencast caps near 25 fps. Firefox and WebKit now poll fast screenshots instead: up to 60 fps, duplicates dropped, 10 fps when idle. All engines prewarm at launch.

At desktop size: 58–62 fps on Mac and Linux, 41–51 fps on the Windows CI machine, which has no GPU. Numbers are in docs/architecture.md.

Also fixed: the address bar was overwritten while you typed.

### Real-time Chrome and Safari: native views instead of streaming
Size L · created 26 Sep 2026 · completed 28 Sep 2026

**Done 26 Sep 2026.** Chrome now runs natively everywhere: Electron's own Chromium in a view over the page area. Safari runs natively on macOS: Apple's WKWebView, the real Safari engine, through a small addon in native/webkit-view. Both are real-time like a normal browser, lay out at the chosen viewport size, support dark mode, and forward console output. Safari's Web Inspector can attach.

Firefox, and WebKit on Windows and Linux, stay streamed.

Also fixed: input backlog from trackpad scrolling (2 s down to about 30 ms), and pages that never showed while a slow page loaded. Tests run in CI on all three OSes.

### Fix native views drawing over the console; add real screenshot checks
Size M · created 26 Sep 2026 · completed 28 Sep 2026

**Done 26 Sep 2026.** Chrome's DevTools size override drew the page at full size over the console. Chrome now scales with zoom. Safari scales by container bounds; four methods were compared with screenshots. Also: cursors for streamed engines, Electron warnings removed from the console, and a typed URL no longer gets replaced by the startup page.

New visual check (SWIVEL_VISUAL) takes real screen captures of every engine and size in CI, because page-reported sizes passed while the picture was wrong. Known issue: Chrome on Windows can briefly reflow on a site's first visit.

### Browser polish: fill window, slim toolbar, find, shortcuts, sharp Firefox
Size L · created 26 Sep 2026 · completed 28 Sep 2026

**Done 27 Sep 2026.** Fill window is the default size. The console is hidden behind a toolbar button. The toolbar is Chrome-sized. Engines are named Chromium, Firefox, WebKit. Find in page (Cmd/Ctrl+F) and menu shortcuts work in every engine. Streamed engines render at screen pixel density, send lossless PNG when it keeps up, and display at exact pixels. Verified with screenshots and app tests on all three OSes.

### Keep all engines live and in sync; persistent logins per engine
Size L · created 26 Sep 2026 · completed 27 Sep 2026

**Done 27 Sep 2026.** All three engines stay loaded and follow the shown one, so switching is instant. Page views are independent instances, ready for a multi-view canvas later. The console shows every engine at once. Each engine has a persistent profile. Tested on all three OSes: following a link, and a cookie surviving a restart.

Not done (optional, later): copying a login from one engine to the others.

- [x] Switching engines shows the same page instantly, no reload
- [x] Navigating in one engine loads the same URL in the others
- [x] Logins survive an app restart, per engine

### Canvas: engines and sizes side by side in one window
Size L · created 30 Sep 2026 · completed 1 Oct 2026

**Done 30 Sep 2026.** Grid button in the toolbar. Frames pan, zoom (25–100%), move and resize; each picks its engine and size; all share the window's URL and data. WebKit and the Firefox mirror clip natively at the canvas edge; Chromium shows a still image while cut off by the toolbar (Electron can't clip it on macOS). Also: per-window data with Clear data, and Safari/Chrome user agents checked in CI.

### Multiple windows, each running every engine
Size L · created 28 Sep 2026 · completed 28 Sep 2026

Go/no-go for the project. File → New Window (Cmd/Ctrl+N) opens another Swivel window with its own Chromium, Firefox and WebKit views. Each window navigates on its own. Engines share one profile per engine, so logins carry across windows. On macOS each Firefox page gets its own parked, mirrored window.

- [x] Two or more Swivel windows, each switching engines on its own
- [x] Two Firefox windows live at once, both mirrored and clickable, no stray windows
- [x] Closing a window cleans up only its pages
- [x] Checked in CI with screenshots

### Sizes view: one engine, many screens
Size M · created 26 Sep 2026 · completed 1 Oct 2026

**Covered by the canvas, 1 Oct 2026.** The "Responsive" set shows one engine at desktop, laptop, tablet and phone sizes side by side, with dark mode. Sync scroll is its own card.

- [ ] Preset and custom widths render side by side
- [ ] Dark mode toggle applies to all sizes

### Update CI tests for the canvas-only UI
Size M · created 1 Oct 2026 · completed 4 Oct 2026

**Done 4 Oct 2026.** The app test, isolation test, user agent test, real-click test, self-test and screenshot check all drive the canvas now, with the names Blink, Gecko and WebKit. All pass on macOS, Windows and Linux (run 37184868434, branch `smooth`).

The rewritten tests found four real bugs, all fixed:
- A hidden Blink frame laid its page out at zero width (now parked above the window instead).
- Blink frames on the same site overwrote each other's zoom (now scaled with device emulation, which also removed the 25% zoom floor).
- Scrolling inside a Gecko frame also panned the whole canvas.
- A URL typed at startup could be replaced by the start page.

- [ ] e2e-live, e2e-isolation, e2e-useragent, the click test and the screenshot check pass on all three OSes

### Sync scrolling, clicks and typing across frames
Size L · created 26 Sep 2026 · completed 4 Oct 2026

**Built 4 Oct 2026 on the `sync` branch, green in CI on all three OSes, waiting for Christo's check.** Scroll, click or type in one frame and the others repeat it. A toolbar button turns it off; on by default.

- Scroll: by how far down the page (a fraction), since each layout has its own height.
- Click: on the same element. Links and form submits are left to the clicked frame; the others follow where it goes.
- Typing: the field's value is copied.

How: a small script in every page reports what the user does, through the console; the host repeats it in the other frames.

Limits: only the page's own scrolling syncs, not scrollable panels inside it; elements in shadow DOM aren't matched. Later: an error count on each frame's header.

- [x] Scrolling one frame scrolls the others to the same place
- [x] Clicks and typing repeat in the other frames
- [x] Toolbar toggle turns sync off and on

### One page filling the window, like a normal browser
Size S · created 4 Oct 2026 · completed 5 Oct 2026

**Done 5 Oct 2026, merged into `main` (f2ab454), green in CI on all three OSes.**

- A Canvas toggle in the toolbar (grid icon): on shows every frame; off shows one page alone, filling the window like a normal browser and following its size.
- "Fill window" in the bottom bar switches to the frame's own size instead.
- A frame's focus icon, double-clicking its header, and Cmd/Ctrl+Enter do the same.
- Back on the canvas the frame returns to its own size.

Also in this merge: the Add frame menu starts with "New frame in…" an engine, then sizes by device; and Duplicate frame (header button, Cmd/Ctrl+D).

- [x] CI green on macOS, Windows and Linux
- [x] Christo has tried the toolbar toggle and the page fills the window
- [x] Merged into main

### Mobile mode: phone and tablet frames act like the device
Size M · created 5 Oct 2026 · completed 5 Oct 2026

**Built 5 Oct 2026 on the `mobile-mode` branch, green in CI on all three OSes, waiting for Christo's check.**

Phone and tablet devices in the Add frame menu start in mobile mode; any frame can turn it on. A blue Mobile badge on the frame's header shows whenever it's on, says in its hover label what this engine emulates and doesn't, and turns it off. Turning it on or off gives the frame a new page.

What each engine does (all labelled "emulated", "not a real phone"):
- Blink: Chrome for Android's browser ID, touch input (the mouse acts as a finger), a phone's layout rules, and the device's screen density. Uses the DevTools commands Chrome's device toolbar uses.
- Gecko: Firefox for Android's browser ID, and touch support.
- WebKit on macOS: iPhone or iPad Safari's browser ID only.
- WebKit on Windows and Linux: browser ID, touch support and a phone's layout.

Checked in CI: every engine's mobile browser ID; Blink's touch and density (self-test); a screenshot of a mobile Blink frame showing Wikipedia's mobile site inside its frame.

Also fixed here: a frame that changed engine or mobile mode got a new page that was never placed (invisible, zero size).

Limits: Gecko and WebKit mobile frames keep their cookies in step with the window (the cookie jar) but have their own local storage. A frame's size and engine are never locked.

- [x] A Blink phone frame gets a site's mobile version and takes touch events
- [x] A visible Mobile badge on the frame turns it off and on
- [x] What each engine can and can't emulate is stated in the UI

### Storage panel: see and manage a window's data
Size L · created 1 Oct 2026 · completed 5 Oct 2026

**Done 5 Oct 2026, merged into `main`, green in CI on all three OSes.**

A Storage button in the toolbar opens the bottom panel on its Storage tab.
- Kinds down the left: cookies, local storage, session storage, databases and caches, with counts and how many rows differ between engines.
- A column per engine; rows that differ are marked. Filter by name or site; "Differences only".
- Click a row to read its values in full; click a value to edit it in every engine; × deletes it everywhere.
- "Share sign-in across engines" (on by default). Off: each engine keeps its own cookies. Cookies an engine got by sharing are tagged "copied".
- Clear cookies, and Clear storage.

The bottom panel was rebuilt with it: drag its top edge to resize (the height is remembered); Console and Storage are tabs; the console has level, engine and text filters, Clear, and a time on hover.

Limits: local and session storage are read from the pages that are open, so only their sites show; session storage is per frame (each engine's first frame is shown); IndexedDB and cache contents can't be browsed; there's no clear-by-site yet.

- [x] Cookies and local storage listed for the window, per engine
- [x] A row can be edited or deleted, and the page sees the change
- [ ] Clear by type or by site

### Canvas-only UI: sets, typed sizes, device menu, focus mode
Size L · created 1 Oct 2026 · completed 5 Oct 2026

**Done: merged into `main` and green in CI; Christo has been using it since 4 Oct 2026.** Wireframe: https://claude.ai/artifact/8BeSEcCUpxzpKcj1EjbRnZ

- The canvas is the whole app. A new window starts empty.
- Sets in a bar under the canvas: Responsive (Blink at 1440, 1280, 820, 390), Browsers (Blink, Gecko, WebKit at 1280), and saved sets.
- Sizes: type width × height, or drag an edge or corner; widths snap to 390, 768, 1024, 1280, 1440. Rotate swaps them.
- Add frame (Cmd+T): "New frame in…" an engine, then devices. Duplicate (Cmd+D).
- One page filling the window (toolbar toggle, Cmd+Enter).
- Zoom 10–100%.
- Engines named Blink (Chrome), Gecko (Firefox), WebKit (Safari). Hover labels with shortcuts on every button.

- [x] Responsive and Browsers sets both load their pages
- [x] Typing and dragging a size both work, with snapping
- [x] Adding a device and focus mode work
- [x] Committed and green in CI
