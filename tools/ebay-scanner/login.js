'use strict';
// Opens the scanner's profile in an ORDINARY browser so you can sign into eBay normally.
//
// Why this exists: eBay's sign-in is far more heavily bot-protected than its search pages. A
// Playwright-driven browser announces itself as automated, and eBay refuses the login even
// though it happily serves search results to the same browser.
//
// Nothing here disguises anything. It launches the real browser, unmodified, pointed at the
// profile folder the scanner uses — the same as signing in on a second computer. The cookies
// land in that folder, and the scanner picks the session up from there afterwards.

const { spawn } = require('child_process');
const browsers = require('./browsers');
const path = require('path');

const PROFILE_BASE = path.join(__dirname, '.profile');
function profileFor(id) { return PROFILE_BASE + (id === 'chrome' ? '' : '-' + id); }

const pick = browsers.preferred();
if (!pick) {
    console.log('  No Chromium browser found. Install Chrome, Edge, or Brave.');
    process.exit(1);
}

const dir = profileFor(pick.id);
const args = [
    '--user-data-dir=' + dir,
    '--no-first-run',
    '--no-default-browser-check',
    'https://www.ebay.com/signin/'
];

console.log('');
console.log('  Opening ' + pick.label + ' with the scanner profile.');
console.log('  ' + dir);
console.log('');
console.log('  1. Sign into eBay in the window that opens.');
console.log('  2. Check a Sold search loads, e.g. search anything then tick "Sold Items".');
console.log('  3. CLOSE that window completely.');
console.log('');
console.log('  The scanner cannot use the profile while this window is open — Chrome locks a');
console.log('  profile folder to one running instance. Close it before scanning.');
console.log('');

const child = spawn(pick.exe, args, { detached: true, stdio: 'ignore' });
child.unref();
