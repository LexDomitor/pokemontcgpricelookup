<!-- Developed for Arcane 9 Labs by Alex Puh and Kyle He -->
# Pokemon TCG Price Lookup (SEARCHDOG)

Standalone SEARCHDOG price lookup. Includes guided TCGplayer and eBay lookups, English/Japanese search, condition filters, price statistics, a card ledger, named saved sheets, photo card detection, and spreadsheet/image/JSON exports.

## GitHub Pages

A root index.html and .nojekyll are included. In GitHub, open Settings > Pages, choose Deploy from a branch, then main and / (root), and Save.

The project URL is https://lexdomitor.github.io/pokemontcgpricelookup/ once Pages finishes publishing. GitHub gives project repositories a path under your account's github.io site, rather than a separate subdomain per repository.

The root page runs without a hosted backend or login. It queries the public [Pokemon TCG API](https://pokemontcg.io/) directly for English cards and TCGplayer USD market-price summaries. Choose a printing and price variant (normal, holofoil, etc.) before saving. Summaries show their update date; they are not individual offers, condition-specific quotes, or recent sale transactions. Missing prices stay unavailable, not zero. Searches return up to 60 matches; narrow your query when needed. Public API availability and rate limits apply.

Individual marketplace offers, recent sales, Japanese lookup and numeric TCGplayer product links require the local Node server below. Existing saved marketplace IDs remain intact but cannot be refreshed through the browser-only API; search and select a printing to save a browser-compatible entry. eBay manual paste, local sheets, exports and on-device OCR remain available.

## Run locally

Requires Node.js 20 or newer. No credentials or install step are needed for the local web server:

```sh
npm start
```

Open http://127.0.0.1:8788. Keep the terminal running. Use the Node server, not file:// or a static-only Live Server: the full offers-and-sales lookup needs the included API proxy. Set PORT to use another port.

## Storage and independence

- Named sheets and the current ledger live in this browser's localStorage. They are not cloud backups; export important work before clearing browser data or switching devices.
- Save sheet keeps a named local copy and updates it as you edit. Clicking Saved locally removes that saved copy after confirmation; the open ledger remains. Load database opens previously saved local copies.
- The app opens immediately. No accounts, access codes, chat, account databases or login cookies are used.
- The existing card detector and OCR routines now use local Tesseract for on-device processing. OpenCV and Tesseract download on demand from public CDNs; images are processed on the device. The reader is English-oriented and all detected fields remain editable. Review OCR before pricing.
- Local-server TCGplayer pricing uses the same unofficial public marketplace endpoints as the original module. Availability and results depend on those upstream services. Prices can be missing, stale, or blocked; they are not guaranteed valuations.
- eBay supports the original manual paste workflow. For automated scanning, see tools/ebay-scanner/README.md. That optional helper opens a separate browser profile and stays on localhost. No browser profiles, login sessions or credentials are included.

## Project layout

- public/index.html, styles.css, app.js: extracted interface and pricing/ledger logic.
- public/api.mjs: standalone read-only marketplace API for the Node server.
- public/browser-prices.js: direct public API adapter for static hosting.
- server.mjs: dependency-free local Node server.
- public/local-sheets.js: browser-local named-sheet storage.
- public/cardscan-*.js, pokemon-*.js: detector, OCR, name data and autocomplete.
- tools/ebay-scanner: optional local eBay browser helper.
- tests: API/storage tests and browser workflow smoke tests.

## Checks

```sh
npm ci
npm test
npm run test:browser
npm run test:pages
```

Optional live OCR check: `node tests/ocr.browser.mjs` downloads public OCR libraries and reads a synthetic card without uploading its image.

Browser tests use installed Chrome on Windows by default. Set CHROME_PATH for another Chrome/Chromium installation. Test price responses are fixtures; live upstream availability is a separate check.

Pokemon, TCGplayer and eBay marks belong to their respective owners; this tool is independent of those services.
