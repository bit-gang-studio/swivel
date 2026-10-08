# Swivel — Product Brief

## 1. What it is
A desktop dev browser. It feels like Chrome, but the browser engine is a switch. Load a page once, then flip between Chrome, Firefox and Safari (WebKit), or see them side by side.

## 2. Who it's for
Web developers checking their own sites, mostly on localhost, before they ship.

## 3. The problem
Checking a site in every browser and screen size means juggling several browsers, device toolbars and guesswork. Safari is hard to test off a Mac. Bugs that only show in one engine get found by users.

## 4. What makes it different
- One window, every engine, same URL
- Chrome and (on Mac) real Safari run natively: as fast as a normal browser
- Console and styles grouped by engine, so "only breaks in Safari" is obvious
- Free, open source and local. No account, no cloud needed

## 5. Business model
- **Free, open source (MIT):** everything that runs locally
- **Maybe later, paid:** real iPhone Safari and Windows Edge on cloud machines, share links for teammates, automatic checks on pull requests, saved snapshot history

## 6. What's unproven
- **Real-time Firefox.** Firefox can't be embedded, so it's streamed at about 45–60 fps. Whether that feels good enough, or we need to pin a real Firefox window, is unproven.
- **Bundling browsers.** A packaged app needs Firefox (and WebKit off Mac) on every OS. Download size and first-run experience are unknown.
- **"Safari" off a Mac.** On Windows and Linux it's Playwright's WebKit, streamed, not real Safari. We label it "WebKit" there.
- **Demand.** Nobody outside the team has used it yet.

**Proven (26 Sep 2026):** native, real-time Chrome on all OSes and real Safari on macOS. Live, clickable Firefox on all OSes.

## 7. Platforms
macOS, Windows and Linux.
