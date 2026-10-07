import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const root=resolve('.'),prefix='/pokemontcgpricelookup/';
const server=createServer(async(req,res)=>{try{let name=new URL(req.url,'http://localhost').pathname;if(!name.startsWith(prefix))throw Error();name=name.slice(prefix.length)||'index.html';if(name!=='index.html'&&!name.startsWith('public/'))throw Error();const file=resolve(root,name);if(!file.startsWith(root+sep))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage(),errors=[],missing=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('127.0.0.1')&&r.status()>=400)missing.push(r.url());});const requests=[];page.on('request',r=>requests.push(r.url()));
await page.route('https://api.pokemontcg.io/v2/**',r=>r.fulfill({json:{data:r.request().url().includes('/cards?')?[card]:card}}));
const card={id:'base1-58',name:'Pikachu',number:'58',set:{name:'Base Set',id:'base1'},tcgplayer:{url:'https://www.tcgplayer.com/product/123',updatedAt:'2026/10/07',prices:{normal:{market:12},reverseHolofoil:{market:24}}}};
await page.goto('http://127.0.0.1:'+server.address().port+prefix);await page.locator('[data-do="look"]').click();await page.locator('#wz-q').fill('Pikachu');assert.equal(await page.evaluate(()=>PRICE_LOOKUP_CONFIG.mode),'browser');
await page.locator('#wz-next').click();await page.locator('.wz-body [data-src="tcgplayer"]').click();await page.locator('#wz-run').click();
await page.locator('#snapshot-variant').waitFor();await page.locator('#snapshot-variant').selectOption('reverseHolofoil');
await page.waitForFunction(()=>document.querySelector('#co-out').textContent.includes('24.00'));
await page.locator('#grab-page').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ptcg-price-ledger')||'[]').length===1);
const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('ptcg-price-ledger'))[0]);assert.equal(saved.market,24);assert.equal(saved.pid,'ptcg:base1-58:reverseHolofoil');assert.deepEqual(saved.listings,[]);assert.deepEqual(saved.sales,[]);
assert(!requests.some(u=>/pages\.dev|\/api\/tcg/.test(u)));
assert.equal(await page.locator('link[rel="stylesheet"]').evaluate(el=>el.sheet.cssRules.length>0),true);assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);console.log('GitHub Pages root and project-relative assets passed.');}finally{await browser.close();await new Promise(r=>server.close(r));}
