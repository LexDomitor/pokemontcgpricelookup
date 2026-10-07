'use strict';
// Finds a Chromium-based browser already on this machine.
//
// Only Chromium engines are usable here. Playwright can drive Firefox, but only its own patched
// build — it cannot attach to the Firefox a person already has installed — so offering it would
// mean a download, which defeats the point.
//
// Edge is the reliable fallback: it ships with Windows, so there is essentially always something
// to drive even on a machine with no Chrome.

const fs = require('fs');
const path = require('path');

const PF     = process.env['ProgramFiles'] || 'C:\\Program Files';
const PF86    = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL  = process.env['LOCALAPPDATA'] || '';

// `channel` lets Playwright locate the browser itself; `paths` is only used to report whether
// it is present, and as an executablePath for the browsers Playwright has no channel for.
const KNOWN = [
    { id: 'chrome', label: 'Google Chrome', channel: 'chrome', paths: [
        path.join(PF,   'Google\\Chrome\\Application\\chrome.exe'),
        path.join(PF86, 'Google\\Chrome\\Application\\chrome.exe'),
        LOCAL && path.join(LOCAL, 'Google\\Chrome\\Application\\chrome.exe')
    ] },
    { id: 'msedge', label: 'Microsoft Edge', channel: 'msedge', paths: [
        path.join(PF86, 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(PF,   'Microsoft\\Edge\\Application\\msedge.exe')
    ] },
    { id: 'brave', label: 'Brave', paths: [
        path.join(PF,   'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
        path.join(PF86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
        LOCAL && path.join(LOCAL, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe')
    ] },
    { id: 'vivaldi', label: 'Vivaldi', paths: [
        LOCAL && path.join(LOCAL, 'Vivaldi\\Application\\vivaldi.exe'),
        path.join(PF, 'Vivaldi\\Application\\vivaldi.exe')
    ] },
    { id: 'opera', label: 'Opera', paths: [
        LOCAL && path.join(LOCAL, 'Programs\\Opera\\opera.exe'),
        LOCAL && path.join(LOCAL, 'Programs\\Opera GX\\opera.exe')
    ] }
];

function found(b) {
    for (const p of b.paths) { if (p && fs.existsSync(p)) return p; }
    return null;
}

/** Every Chromium browser present, in preference order. */
function available() {
    return KNOWN.map(b => {
        const exe = found(b);
        return exe ? { id: b.id, label: b.label, channel: b.channel || null, exe } : null;
    }).filter(Boolean);
}

const CONFIG = path.join(__dirname, 'browser.json');

function preferred() {
    // env var wins, then the saved choice, then whatever is installed
    let want = (process.env.SCANNER_BROWSER || '').trim().toLowerCase();
    if (!want) {
        try { want = String((JSON.parse(fs.readFileSync(CONFIG, 'utf8')) || {}).browser || '').toLowerCase(); }
        catch (_) { want = ''; }
    }
    const list = available();
    if (want) {
        const hit = list.find(b => b.id === want);
        if (hit) return hit;
    }
    return list[0] || null;
}

function remember(id) {
    try { fs.writeFileSync(CONFIG, JSON.stringify({ browser: id }, null, 2)); return true; }
    catch (_) { return false; }
}

/** Launch options for launchPersistentContext. Prefer the channel; fall back to the exe path. */
function launchOpts(b) {
    return b.channel ? { channel: b.channel } : { executablePath: b.exe };
}

module.exports = { available, preferred, remember, launchOpts, KNOWN };

if (require.main === module) {
    const list = available(), pick = preferred();
    if (!list.length) { console.log('  No Chromium browser found. Install Chrome, Edge, or Brave.'); process.exit(1); }
    console.log('  Chromium browsers on this machine:');
    list.forEach(b => console.log('    ' + (pick && b.id === pick.id ? '>' : ' ') + ' ' + b.label.padEnd(16) + b.exe));
    console.log('\n  Using: ' + (pick ? pick.label : 'none'));
    console.log('  Override with  SCANNER_BROWSER=msedge  or edit browser.json');
}
