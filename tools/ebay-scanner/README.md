# Optional eBay helper for the standalone app

Run npm install and npm start in this folder. The web app runs on port 8788; this helper uses 8787. For a custom web origin, set ALLOWED_ORIGINS to an exact comma-separated origin list before starting. The helper creates its own local .profile browser directory, which is ignored by Git. Never commit it or browser.json.

Original helper usage notes follow.

# SEARCHDOG eBay Scanner

Reads eBay listing pages on this PC and feeds them to the Price Lookup page, so you don't have
to Ctrl+A / Ctrl+C two tabs by hand.

## Browser

Any Chromium browser already on your PC works — Chrome, Edge, Brave, Opera or Vivaldi. One is
picked automatically, preferring Chrome, and **Edge is the safety net because Windows always has
it**. Chrome, Edge and Brave were each tested against eBay and all three returned HTTP 200.

Firefox is not an option: Playwright can only drive its own patched build, not the Firefox you
already have installed, so it would mean a download.

Change it from the Price Lookup page, or set `SCANNER_BROWSER=msedge`, or edit `browser.json`.
Each browser keeps a separate profile, so switching never loses an eBay sign-in you already did.

```
node browsers.js        list what is installed and which one will be used
```

## Setup (once)

1. Double-click **LOGIN.bat** and sign into eBay in the window that opens. **Close that window
   completely** when you're done.
2. Double-click **START.bat**. The first run installs what it needs, then stays open.

Leave the START.bat window open while you work. Closing it stops the scanner.

### Why sign-in has its own step

Do **not** try to sign in inside the scanner's own window — eBay will reject it with a generic
"Something went wrong on our end" error. Sign-in is far more heavily bot-protected than search,
and a Playwright-driven browser reports itself as automated, so eBay refuses the login even
though it serves search results to that same browser quite happily.

LOGIN.bat sidesteps this without disguising anything: it opens the *same profile folder* in an
ordinary browser — no automation, nothing patched — so signing in is exactly as normal as doing
it on a second computer. The cookies land in that folder and the scanner picks the session up.

Only one program can hold a Chrome profile at a time, so **close the login window before
starting the scanner**. Buy It Now works with no sign-in at all; only Sold needs it.

## Using it

On the Price Lookup page with **eBay** selected, type a card name and press
**⚡ SCAN THIS CARD**. It loads both tabs and fills in Offers and Latest Sales.

A scan takes about 3 seconds for one tab, ~8 seconds for both.

## Why it works this way

eBay refuses every automated route we tested — a server-side fetch from Cloudflare, from this
machine, and through public reader services all return 403, and the page can't be framed. What
it *does* serve is a real browser on your own machine.

Two findings worth preserving, both measured rather than assumed:

- **Headless Chrome gets 403; a visible window gets 200.** Don't "optimise" this to headless.
  It stops working completely.
- **`--disable-blink-features=AutomationControlled` gets it blocked.** That flag is meant to
  hide automation but is itself a detection signal. Adding it produced a reliable 403; removing
  it produced a reliable 200.

The scanner only fetches page text. All parsing happens in the Price Lookup page, so there is
one parser to maintain and it's the one already proven against real pasted pages.

## Scope and pacing

One page each for Buy It Now (price + shipping, low to high) and Sold, both scoped to
Collectibles — first page only, no pagination. There's a deliberate pause between the two loads.

This is low-volume personal price research on your own account. Keep it that way: don't loop it
over a card list. Rapid automated traffic is what gets accounts flagged, and the throttle in
`scan.js` is there on purpose.

## Files

| File | Purpose |
|---|---|
| `LOGIN.bat` | Opens the scanner's profile in a normal browser so you can sign into eBay |
| `START.bat` | Double-click launcher — installs deps if needed, then runs the server |
| `server.js` | localhost:8787, the endpoint the Price Lookup page calls |
| `scan.js` | Drives the browser and grabs the page text. Also runs standalone |
| `browsers.js` | Finds the Chromium browsers installed on this PC |
| `.profile*/` | Per-browser profile folders — these hold your eBay sign-in |

Standalone check without the page:

```
node scan.js "cresselia lv x 103/106"
```

## If it stops working

- **"helper not running"** on the page — START.bat isn't open, or it's on a different port.
- **eBay shows an error code when you try to sign in** (e.g. `0.2706d217...`) — you're signing
  in inside the scanner's window. Don't. Close the scanner, run LOGIN.bat, sign in there, close
  it, then start the scanner.
- **Sold results empty** — the session expired. Run LOGIN.bat again.
- **Buy It Now returns 403** — check nothing has re-added an automation flag to `scan.js`.
- **Everything returns 0 listings** — eBay restyled. The parser keys on the phrase
  "Opens in a new window or tab" and on `NN% positive (count)`; if those changed, `parseEbay()`
  in `public/SEARCHDOG/price.html` needs updating, not this tool.
