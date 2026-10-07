// Developed for Arcane 9 Labs by Alex Puh and Kyle He
(function(){
'use strict';
const cache=new Map();
const label=v=>v.replace(/([a-z])([A-Z])/g,'$1 $2');
const price=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
async function request(path){
 const hit=cache.get(path);if(hit&&Date.now()-hit.at<60000)return hit.data;
 const r=await fetch('https://api.pokemontcg.io/v2/'+path,{credentials:'omit',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(r.status===429?'Price service rate limit reached. Please try again later.':'Price service unavailable (HTTP '+r.status+').');
 const d=await r.json();if(d.error)throw Error(d.error.message||'Price service error');
 cache.set(path,{at:Date.now(),data:d.data});return d.data;
}
function variants(c){return Object.entries(c.tcgplayer?.prices||{}).map(([key,p])=>({key,label:label(key),market:price(p.market),low:price(p.low),mid:price(p.mid),high:price(p.high)}));}
function summary(c,variant){
 const vs=variants(c),v=variant?vs.find(v=>v.key===variant):(vs.find(v=>v.key==='normal')||vs[0]);
 if(variant&&!v)throw Error('This printing no longer has that price variant. Search again to choose a variant.');
 return {productId:'ptcg:'+c.id+':'+(v?.key||''),url:c.tcgplayer?.url||'',product:{name:c.name,set:c.set?.name||'',number:c.number||'',setCode:c.set?.ptcgoCode||c.set?.id||'',rarity:c.rarity||'',kind:'single',lang:'EN',image:c.images?.small||'',market:v?.market??null,snapshot:true,priceVariant:v?.key||'',priceVariants:vs,priceUpdated:c.tcgplayer?.updatedAt||'',cardId:c.id},listings:[],sales:[],total:0};
}
async function getJSON(path){try{
 const u=new URL(path,'https://local.invalid');
 if(!['/api/tcg','/api/tcgsearch'].includes(u.pathname))throw Error('This feature requires the local Node server.');
 const id=u.searchParams.get('productId');
 if(id){if(!/^ptcg:[a-zA-Z0-9-]+:[a-zA-Z0-9]*$/.test(id))throw Error('On GitHub Pages, search by card name instead of a marketplace link or old marketplace ID.');const [,card,variant]=id.split(':');return summary(await request('cards/'+encodeURIComponent(card)),variant);}
 const quote=s=>'"'+String(s).replace(/["\\]/g,' ').trim()+'"';
 const name=u.searchParams.get('name')||u.searchParams.get('q')||'';
 const num=u.searchParams.get('number');if(!name.trim()&&!num)throw Error('Enter a card name.');
 const query=[name.trim()?'name:'+quote(name):'',num?'number:'+quote(num):''].filter(Boolean).join(' ');
 const cards=await request('cards?'+new URLSearchParams({q:query,pageSize:'60',orderBy:'-set.releaseDate'}));
 if(!cards?.length)throw Error('No English cards found. Try just the card name and optional card number.');
 const alts=cards.map(c=>{const d=summary(c);return {...d.product,productId:d.productId,url:d.url};});
 if(u.pathname==='/api/tcgsearch')return {results:alts};
 return {...summary(cards[0]),alts};
 }catch(e){return {error:e.name==='TimeoutError'?'Price service timed out. Please try again.':e.message||'Could not reach the public price service.'};}}
window.BrowserPrices={getJSON};
})();
