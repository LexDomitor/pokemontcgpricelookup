'use strict';
// The local half of Price Lookup. Serves one endpoint on 127.0.0.1 that the deployed page calls;
// the page then runs its own parser on the text it gets back.
//
// An HTTPS page reaching a local address needs two things from us: ordinary CORS, and Chrome's
// Private Network Access preflight (Access-Control-Allow-Private-Network). Both are answered below.
// Bound to 127.0.0.1 only — nothing on your network can reach this.

const http = require('http');
const { scan, close, using } = require('./scan');
const browsers = require('./browsers');

const PORT = Number(process.env.PORT || 8787);

// Only the Price Lookup page may call this — a random site you visit must not be able to
// drive your signed-in eBay session.
const ALLOWED = [
    'https://pokemontcgpricelookup.pages.dev',
    'http://localhost:8788', 'http://127.0.0.1:8788',
    ...(process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
    'http://localhost:5500', 'http://127.0.0.1:5500',
    'http://localhost:8787', 'http://127.0.0.1:8787'
];
function corsFor(origin) {
    if (!origin) return null;
    if (ALLOWED.includes(origin)) return origin;
    if (/^https:\/\/[a-z0-9]+\.pokemontcgpricelookup\.pages\.dev$/i.test(origin)) return origin;  // preview deploys
    return null;
}

let busy = false;

const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const allow = corsFor(origin);
    const url = new URL(req.url, 'http://127.0.0.1');

    const head = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (allow) {
        head['Access-Control-Allow-Origin'] = allow;
        head['Vary'] = 'Origin';
        if (req.headers['access-control-request-private-network']) {
            head['Access-Control-Allow-Private-Network'] = 'true';
        }
    }
    if (req.method === 'OPTIONS') {
        head['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
        head['Access-Control-Allow-Headers'] = 'Content-Type';
        head['Access-Control-Max-Age'] = '600';
        res.writeHead(allow ? 204 : 403, head); return res.end();
    }

    if (url.pathname === '/ping') {
        const live = using();                       // what is actually open right now
        const pick = live || browsers.preferred();  // otherwise, what the next scan will use
        res.writeHead(200, head);
        return res.end(JSON.stringify({
            ok: true, name: 'solarbeam-ebay-scanner', version: 2, busy,
            browser: pick ? { id: pick.id, label: pick.label, running: !!live } : null,
            available: browsers.available().map(b => ({ id: b.id, label: b.label }))
        }));
    }

    // Switch browsers. The open window is closed so the next scan starts in the new one;
    // each browser keeps its own profile, so a sign-in in the old one is not lost.
    if (url.pathname === '/browser') {
        if (!allow) { res.writeHead(403, head); return res.end(JSON.stringify({ error: 'origin not allowed' })); }
        if (busy)   { res.writeHead(429, head); return res.end(JSON.stringify({ error: 'a scan is running' })); }
        const id = (url.searchParams.get('id') || '').trim().toLowerCase();
        const hit = browsers.available().find(b => b.id === id);
        if (!hit) { res.writeHead(400, head); return res.end(JSON.stringify({ error: 'browser not installed: ' + id })); }
        browsers.remember(id);
        await close();
        console.log('  browser set to ' + hit.label);
        res.writeHead(200, head);
        return res.end(JSON.stringify({ ok: true, browser: { id: hit.id, label: hit.label } }));
    }

    // Stop whatever is in flight. Closing the browser context makes the pending navigation
    // reject, so the running scan unwinds through its own error handling and frees `busy`.
    if (url.pathname === '/cancel') {
        if (!allow) { res.writeHead(403, head); return res.end(JSON.stringify({ error: 'origin not allowed' })); }
        const was = busy;
        await close();
        busy = false;
        if (was) console.log('  cancelled');
        res.writeHead(200, head);
        return res.end(JSON.stringify({ ok: true, wasRunning: was }));
    }

    if (url.pathname === '/scan') {
        if (!allow) { res.writeHead(403, head); return res.end(JSON.stringify({ error: 'origin not allowed' })); }
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) { res.writeHead(400, head); return res.end(JSON.stringify({ error: 'missing q' })); }
        if (busy) { res.writeHead(429, head); return res.end(JSON.stringify({ error: 'a scan is already running' })); }

        busy = true;
        const t0 = Date.now();
        console.log('  scan: ' + q);
        try {
            const r = await scan(q, {
                bin:  url.searchParams.get('bin')  !== '0',
                sold: url.searchParams.get('sold') !== '0'
            });
            const size = s => (s ? s.text.length : 0);
            console.log('        bin ' + size(r.bin) + ' chars, sold ' + size(r.sold) + ' chars, ' +
                        ((Date.now() - t0) / 1000).toFixed(1) + 's');
            r.errors.forEach(e => console.log('        ! ' + e));
            res.writeHead(200, head);
            res.end(JSON.stringify(r));
        } catch (e) {
            console.log('        failed: ' + e.message);
            res.writeHead(500, head);
            res.end(JSON.stringify({ error: e.message }));
        } finally { busy = false; }
        return;
    }

    res.writeHead(404, head);
    res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  SolarBeam eBay scanner');
    console.log('  listening on http://127.0.0.1:' + PORT);
  const list=browsers.available(), pick=browsers.preferred();
  console.log('  browser:     ' + (pick?pick.label:'NONE FOUND — install Chrome, Edge or Brave'));
  if(list.length>1) console.log('  also found:  ' + list.filter(b=>!pick||b.id!==pick.id).map(b=>b.label).join(', '));
    console.log('');
    console.log('  Leave this window open, then use "Scan with local helper"');
    console.log('  on the Price Lookup page.');
    console.log('');
    console.log('  First run: a Chrome window opens on the first scan. If eBay asks you to');
    console.log('  sign in, do it there once — it is remembered from then on.');
    console.log('');
    console.log('  Ctrl+C to stop.');
    console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => { console.log('\n  closing…'); await close(); process.exit(0); });
}
