<!-- Developed for Arcane 9 Labs by Alex Puh and Kyle He -->
# Pokemon TCG Price Lookup (SEARCHDOG)

Standalone SEARCHDOG price lookup. Includes guided TCGplayer and eBay lookups, English/Japanese search, condition filters, price statistics, a card ledger, named saved sheets, photo card detection, and spreadsheet/image/JSON exports.

## GitHub Pages

A root index.html and .nojekyll are included. In GitHub, open Settings > Pages, choose Deploy from a branch, then main and / (root), and Save.

The project URL is https://lexdomitor.github.io/pokemontcgpricelookup/ once Pages finishes publishing. GitHub gives project repositories a path under your account's github.io site, rather than a separate subdomain per repository.

GitHub Pages cannot run a server. Its root entry uses the project's own public pricing API at https://pokemontcgpricelookup.pages.dev for live prices; local saved sheets and OCR stay in the browser. No login or credentials are sent. To use an independent backend instead, deploy the included Cloudflare project and change apiBase in public/config.js to that HTTPS origin (the backend must allow your Pages origin through CORS). Local Node and direct Cloudflare hosting continue using their own same-origin API.

## Run locally

Requires Node.js 20 or newer. No credentials or install step are needed for the local web server:

```sh
npm start
```

Open http://127.0.0.1:8788. Keep the terminal running. Use the Node server, not file:// or a static-only Live Server: live pricing needs the included API proxy. Set PORT to use another port.

## Cloudflare Pages (optional)

```sh
npm ci
npx wrangler login
npx wrangler pages project create pokemontcgpricelookup --production-branch main --force
npm run deploy:cloudflare
```

Create the Pages project only once. The public folder is the publish directory; no build step, D1 database, Workers AI binding, or secret is required. The included Worker handles /api/* and static assets are served by Pages. GitHub Pages alone cannot run these API routes. The independent backend is deployed at https://pokemontcgpricelookup.pages.dev.

## Storage and independence

- Named sheets and the current ledger live in this browser's localStorage. They are not cloud backups; export important work before clearing browser data or switching devices.
- Save sheet keeps a named local copy and updates it as you edit. Clicking Saved locally removes that saved copy after confirmation; the open ledger remains. Load database opens previously saved local copies.
- The app opens immediately. No accounts, access codes, chat, account databases or login cookies are used.
- The existing card detector and OCR routines now use local Tesseract instead of the site's account-bound Cloudflare AI models. OpenCV and Tesseract download on demand from public CDNs; images are processed on the device. The reader is English-oriented and all detected fields remain editable. Review OCR before pricing.
- TCGplayer pricing uses the same unofficial public marketplace endpoints as the original module. Availability and results depend on those upstream services. Prices can be missing, stale, or blocked; they are not guaranteed valuations.
- eBay supports the original manual paste workflow. For automated scanning, see tools/ebay-scanner/README.md. That optional helper opens a separate browser profile and stays on localhost. No browser profiles, login sessions or credentials are included.

## Project layout

- public/index.html, styles.css, app.js: extracted interface and pricing/ledger logic.
- public/api.mjs: standalone read-only marketplace API; public/_worker.js: Cloudflare adapter.
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
```

Optional live OCR check: `node tests/ocr.browser.mjs` downloads public OCR libraries and reads a synthetic card without uploading its image.

Browser tests use installed Chrome on Windows by default. Set CHROME_PATH for another Chrome/Chromium installation. Test price responses are fixtures; live upstream availability is a separate check.

Pokemon, TCGplayer and eBay marks belong to their respective owners; this tool is independent of those services.
