import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {handleApi} from '../public/api.mjs';
import {createApp} from '../server.mjs';
test('API rejects unsupported methods, endpoints and unsafe embed targets',async()=>{
 for(const [url,method,status] of [['/api/me','GET',404],['/api/tcg','POST',405],['/api/tcgsearch','GET',400],['/api/embedcheck?url=http://localhost','GET',400],['/api/embedcheck?url=https://localhost','GET',400],['/api/tcg?q='+ 'x'.repeat(301),'GET',400]]){
  const r=await handleApi(new Request('http://localhost'+url,{method}));assert.equal(r.status,status);assert.equal(r.headers.get('Cache-Control'),'no-store');
 }
});
test('TCG search maps marketplace results and rejects redirects outside approved sources',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({results:[{results:[{productId:123,productName:'Pikachu',productLineName:'Pokemon',setName:'Base Set',marketPrice:12,customAttributes:{number:'58/102'}}],totalResults:1}]});
  const r=await handleApi(new Request('http://localhost/api/tcgsearch?q=Pikachu'));assert.equal(r.status,200);const d=await r.json();assert(JSON.stringify(d).includes('Pikachu'));assert(JSON.stringify(d).includes('123'));
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});};
  const blocked=await handleApi(new Request('http://localhost/api/embedcheck?url=https://www.ebay.com/'));assert((await blocked.json()).error.includes('not allowed'));assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test('local sheets save, reload, list, deduplicate, delete and report storage errors',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},context=vm.createContext({localStorage:storage,Response,URL,location:{origin:'http://localhost'}});
 vm.runInContext(await readFile(new URL('../public/local-sheets.js',import.meta.url),'utf8'),context);const request=context.LocalSheets.request;
 const save=(id)=>request('/api/pdb/save',{method:'POST',body:JSON.stringify({id,name:'My cards',rows:[{name:'Pikachu',how:{productId:123},market:12}]})});
 assert.equal((await save('one')).status,200);await save('two');assert.equal((await(await request('/api/pdb/list')).json()).dbs.length,2);assert.equal((await(await request('/api/pdb/cards')).json()).cards.length,1);assert.equal((await(await request('/api/pdb/get?id=one')).json()).rows[0].name,'Pikachu');
 await request('/api/pdb/drop',{method:'POST',body:JSON.stringify({id:'one'})});assert.equal((await request('/api/pdb/get?id=one')).status,404);
 storage.setItem=()=>{throw Error('quota exceeded');};assert.equal((await save('three')).status,500);
});
test('standalone Node server serves entry and scripts without site auth',async()=>{
 const server=createApp();await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const base='http://127.0.0.1:'+server.address().port;for(const path of ['/','/app.js','/styles.css','/cardscan-engine.js'])assert.equal((await fetch(base+path)).status,200);assert.equal((await fetch(base+'/api/me')).status,404);assert.equal((await fetch(base+'/_worker.js')).status,404);}finally{await new Promise(r=>server.close(r));}
});

test('full name lookup resolves alternatives, listing totals and sale history',async()=>{
 const original=globalThis.fetch;try{
 globalThis.fetch=async url=>{const path=new URL(url).pathname;if(path.endsWith('/latestsales'))return Response.json({data:[{purchasePrice:12,shippingPrice:1,quantity:1,condition:'Near Mint',orderDate:'2026-10-07'}]});if(path.endsWith('/listings'))return Response.json({results:[{results:[{price:10,shippingPrice:2,quantity:1,condition:'Near Mint',sellerName:'Fixture'}],totalResults:1}]});return Response.json({results:[{results:[{productId:123,productName:'Pikachu',productLineName:'Pokemon',setName:'Base Set',marketPrice:12,customAttributes:{number:'58/102'}}],totalResults:1}]});};
 const r=await handleApi(new Request('http://localhost/api/tcg?name=Pikachu'));const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));assert.equal(d.product.name,'Pikachu');assert(d.alts.length>0);assert.equal(d.listings[0].total,12);assert.equal(d.sales[0].total,13);
 }finally{globalThis.fetch=original;}
});

test('main files carry attribution and have no legacy backend or account routes',async()=>{
 const credit='Developed for Arcane 9 Labs by Alex Puh and Kyle He';
 for(const name of ['index.html','public/index.html','public/app.js','public/styles.css','public/api.mjs','public/config.js','public/browser-prices.js','public/local-sheets.js','public/cardscan-engine.js','public/cardscan-core.js','public/pokemon-autocomplete.js','public/pokemon-names.js','server.mjs']){
  const text=await readFile(new URL('../'+name,import.meta.url),'utf8');assert(text.split('\n')[0].includes(credit),name);assert(!/arcane9labs\.pages\.dev|chronovist\.pages\.dev|\/api\/(auth|me|msg)|sb_gate_token/.test(text),name);
 }
 const r=await handleApi(new Request('https://prices.example/api/tcgsearch'));assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');
});
