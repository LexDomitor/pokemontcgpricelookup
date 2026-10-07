// Developed for Arcane 9 Labs by Alex Puh and Kyle He
'use strict';
// Drives a real, visible Chrome window and reads the text off the eBay pages it lands on.
//
// Why visible and not headless: eBay serves a headful Chrome (HTTP 200) and 403s a headless one.
// That was measured, not assumed — do not "optimise" this to headless, it stops working entirely.
//
// The window keeps its own profile directory, so signing into eBay once there is permanent and
// your everyday Chrome is never touched or locked.

const { chromium } = require('playwright-core');
const path = require('path');
const browsers = require('./browsers');

const PROFILE = path.join(__dirname, '.profile');

// _sacat=1 scopes to Collectibles. _sop=15 is price+shipping low->high, 16 is high->low —
// verified against the rendered "Sort:" caption, because the two are easy to transpose.
function binUrl(q)  { return 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(q) + '&_sacat=1&_sop=15&LH_BIN=1'; }
function soldUrl(q) { return 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(q) + '&_sacat=1&LH_Sold=1&LH_Complete=1'; }

let _ctx = null;
let _using = null;

// Each browser gets its own profile folder, so switching browsers doesn't corrupt a profile
// written by a different one — and a sign-in in Chrome stays put if you later try Edge.
function profileFor(id) { return PROFILE + (id === 'chrome' ? '' : '-' + id); }

async function browser() {
    if (_ctx) return _ctx;
    const pick = browsers.preferred();
    if (!pick) throw new Error('No Chromium browser found. Install Chrome, Edge, or Brave.');
    _ctx = await chromium.launchPersistentContext(profileFor(pick.id), Object.assign(
        { headless: false, viewport: { width: 1440, height: 900 } },
        browsers.launchOpts(pick)
    ));
    _using = pick;
    _ctx.on('close', () => { _ctx = null; _using = null; });
    return _ctx;
}

function using() { return _using; }

async function grab(page, url) {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const status = resp ? resp.status() : 0;

    // document.body is briefly null while a redirect swaps the document, and eBay redirects
    // more than once on the way to a results page — so every read of it is guarded.
    const BODY = 'document.body ? (document.body.innerText || "") : ""';

    // Wait for the result count rather than for the network to fall quiet: eBay holds
    // connections open long after the listings are already on screen.
    await page.waitForFunction(
        `(() => { const t = ${BODY};
                  return /\\d[\\d,]*\\+?\\s+results? for/i.test(t)
                      || /0 results|no exact matches|didn.t match any|signin/i.test(t); })()`,
        null, { timeout: 20000 }
    ).catch(() => {});
    await page.waitForTimeout(700);

    let text = '';
    for (let i = 0; i < 3 && !text; i++) {
        text = await page.evaluate(BODY).catch(() => '');
        if (!text) await page.waitForTimeout(900);
    }
    return { status, url: page.url(), text, signin: /signin\.ebay\./i.test(page.url()) };
}

/**
 * Scan one search term. Returns the raw page text for each tab — the Price Lookup page owns
 * all parsing, so there is exactly one parser to maintain and it is the one already tested.
 */
async function scan(query, opts) {
    opts = opts || {};
    const ctx = await browser();
    const page = ctx.pages()[0] || await ctx.newPage();
    const out = { query, bin: null, sold: null, errors: [] };

    if (opts.bin !== false) {
        try { out.bin = await grab(page, binUrl(query)); }
        catch (e) { out.errors.push('buy-it-now: ' + e.message.split('\n')[0]); }
    }

    // A courtesy gap between the two loads. This is low-volume personal price research, and
    // pacing it like a person is both polite and what keeps an account out of trouble.
    if (opts.bin !== false && opts.sold !== false) await page.waitForTimeout(1200 + Math.random() * 900);

    if (opts.sold !== false) {
        try {
            out.sold = await grab(page, soldUrl(query));
            // Signing in inside this window usually fails — eBay blocks logins from a browser
            // that reports itself as automated. LOGIN.bat opens the same profile in an ordinary
            // browser, which is the way to get a session into it.
            if (out.sold.signin) out.errors.push('Sold needs a sign-in. Close the scanner, run LOGIN.bat, sign in there, close it, then start the scanner again.');
        } catch (e) { out.errors.push('sold: ' + e.message.split('\n')[0]); }
    }
    return out;
}

async function close() { if (_ctx) { await _ctx.close().catch(() => {}); _ctx = null; } }

module.exports = { scan, close, binUrl, soldUrl, using, browsers };

// Run directly for a one-off check:  node scan.js "cresselia lv x 103/106"
if (require.main === module) {
    const q = process.argv.slice(2).join(' ');
    if (!q) { console.log('usage: node scan.js "card name and number"'); process.exit(1); }
    scan(q).then(async r => {
        const b=using(); if(b) console.log('  browser    : '+b.label);
        const n = s => s ? s.text.length : 0;
        console.log('  buy it now : http ' + (r.bin ? r.bin.status : '-') + '  ' + n(r.bin) + ' chars');
        console.log('  sold       : http ' + (r.sold ? r.sold.status : '-') + '  ' + n(r.sold) + ' chars');
        r.errors.forEach(e => console.log('  ! ' + e));
        await close();
    }).catch(async e => { console.error('  failed:', e.message); await close(); process.exit(1); });
}
