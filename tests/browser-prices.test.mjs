import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../public/browser-prices.js',import.meta.url),'utf8');
function api(fetch){const ctx={window:{},URL,URLSearchParams,AbortSignal,fetch};vm.runInNewContext(code,ctx);return ctx.window.BrowserPrices;}
test('browser summaries preserve variants, missing prices and do not fabricate transactions',async()=>{
const a=api(async()=>({ok:true,json:async()=>({data:{id:'base1-58',name:'Pikachu',tcgplayer:{prices:{normal:{market:12},holofoil:{low:5}}}}})}));
const d=await a.getJSON('/api/tcg?productId=ptcg:base1-58:normal');assert.equal(d.product.market,12);assert.equal(d.listings.length,0);assert.equal(d.sales.length,0);
assert.equal((await a.getJSON('/api/tcg?productId=ptcg:base1-58:holofoil')).product.market,null);
assert.match((await a.getJSON('/api/tcg?productId=123')).error,/card name/);
assert.match((await a.getJSON('/api/tcg?productId=ptcg:base1-58:missing')).error,/variant/);
});
test('public API rate limits surface as actionable errors',async()=>{const a=api(async()=>({ok:false,status:429}));assert.match((await a.getJSON('/api/tcg?name=Pikachu')).error,/rate limit/);});
