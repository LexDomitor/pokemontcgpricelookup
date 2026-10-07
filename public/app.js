
(function(){
'use strict';
const $=id=>document.getElementById(id);
const KEY='sb_price_v1';
const ACCENTS=['gold','red','orange','yellow','green','blue','purple','magenta','pink'];
const ACCENT_HEX={ gold:'#ff8c1a', red:'#ff5c5c', orange:'#ff9838', yellow:'#ffab35', green:'#4ce08a', blue:'#4c9dff', purple:'#a882ff', magenta:'#ff4dd2', pink:'#ff86c2' };
/* Cassette unless somebody has said otherwise, and what they said is kept where the Lab keeps
   it — one answer for the whole workspace rather than one per tool. */
const startMode = (function(){
    try{ return localStorage.getItem('ptcg-style') === 'dark' ? 'dark' : 'light'; }
    catch(_){ return 'light'; }
})();
const state={ theme:{ mode:startMode, accent:'gold' }, src:'tcgplayer', lang:'both', ebayRare:'none', sideOpen:true, last:null, conds:[],
    ebaySold:false, ebaySort:'low', ebayMode:'manual' };   // eBay redirects sold searches to sign-in, so active is the default
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Never let an HTML error page surface as a raw JSON parse error.
// The standalone Node server and Cloudflare adapter provide the same-origin price API.
const API_BASE = ''; // Standalone, same-origin API.
async function getJSON(url, opts){
    const full = (API_BASE && url.charAt(0)==='/') ? API_BASE+url : url;
    let r, t;
    try{ r=await fetch(full, opts||{}); t=await r.text(); }
    catch(e){ return { error:'Could not reach the price server ('+(e.message||e)+')' }; }
    try{ return JSON.parse(t); }
    catch(_){ return { error: t.trim().slice(0,1)==='<'
        ? 'The price server is not reachable from here (HTTP '+r.status+').'
        : ('Unreadable reply (HTTP '+r.status+')') }; }
}
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(_){} }
function load(){ try{ const r=localStorage.getItem(KEY); if(r){ const d=JSON.parse(r);
    if(d.theme) state.theme=d.theme; if(d.src) state.src=d.src; if(typeof d.sideOpen==='boolean') state.sideOpen=d.sideOpen; if(d.last) state.last=d.last; if(Array.isArray(d.conds)) state.conds=d.conds; if(typeof d.ebaySold==='boolean') state.ebaySold=d.ebaySold; if(d.ebaySort) state.ebaySort=d.ebaySort; if(d.ebayMode) state.ebayMode=d.ebayMode;
        // auto scan is switched off for now; anyone holding an old saved preference lands in manual
        if(!AUTO_ENABLED) state.ebayMode='manual'; } }catch(_){} }
let toastT=null;
function toast(m, opt){
    const t=$('toast'); t.textContent=m;
    t.classList.toggle('top', !!(opt && opt.top));
    t.classList.add('on');
    clearTimeout(toastT);
    toastT=setTimeout(()=>t.classList.remove('on'), (opt && opt.ms) || 2000);
}

// ── Theme ───────────────────────────────────────────────────────────────────
function buildSwatches(){ const w=document.querySelector('.tp-swatches'); w.innerHTML='';
    ACCENTS.forEach(a=>{ const b=document.createElement('div'); b.className='tp-sw'; b.dataset.accent=a; b.style.background=ACCENT_HEX[a];
        b.addEventListener('click',()=>{ state.theme.accent=a; applyTheme(); save(); }); w.appendChild(b); }); }
function applyTheme(){ document.body.classList.toggle('light', state.theme.mode==='light'); document.body.dataset.accent=state.theme.accent;
    document.documentElement.classList.remove('pre-light');
    try{ localStorage.setItem('ptcg-style', state.theme.mode==='light' ? 'light' : 'dark'); }catch(_){}
    document.querySelectorAll('.tp-sw').forEach(b=>b.classList.toggle('on', b.dataset.accent===state.theme.accent)); }
$('theme-btn').addEventListener('click',e=>{ e.stopPropagation(); const p=$('theme-pop');
    if(p.style.display==='block'){ p.style.display='none'; return; }
    const r=$('theme-btn').getBoundingClientRect(); p.style.display='block'; const pr=p.getBoundingClientRect();
    p.style.left=Math.max(8,Math.min(r.right-pr.width, window.innerWidth-pr.width-8))+'px'; p.style.top=(r.bottom+6)+'px'; });
document.addEventListener('click',e=>{ if(!(e.target.closest&&(e.target.closest('#theme-pop')||e.target.closest('#theme-btn')))) $('theme-pop').style.display='none'; });
document.querySelectorAll('.tp-modes button').forEach(b=>b.addEventListener('click',()=>{ state.theme.mode=b.dataset.mode; applyTheme(); save(); }));


// ── Query ───────────────────────────────────────────────────────────────────
// One free-text box. A card pulled from a database also fills _picked so the price
// lookup can use its exact name/set/number instead of re-parsing the text.
let _picked=null;
function parseQuery(t){
    t=String(t||'').trim(); if(!t) return { name:'', set:'', code:'' };
    let code='', rest=t;
    const m=t.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);                      // 223/197
    if(m){ code=m[1]; rest=t.replace(m[0],' '); }
    else { const m2=t.match(/(?:^|\s)#?(\d{1,3})(?=\s|$)/); if(m2){ code=m2[1]; rest=t.replace(m2[0],' '); } }
    return { name:rest.replace(/\s+/g,' ').trim(), set:'', code:code };
}
function fields(){ const raw=$('f-q').value.trim();
    if(_picked && _picked._raw===raw) return { name:_picked.name, set:_picked.set, code:_picked.code };
    return parseQuery(raw); }
function queryString(){ return $('f-q').value.trim(); }
// ── Condition filter ────────────────────────────────────────────────────────
// TCGplayer expresses this as  &Language=English&Condition=Near+Mint|Lightly+Played&page=1
// so we add and remove exactly those segments rather than rebuilding the address blind.
const CONDITIONS=[['NM','Near Mint'],['LP','Lightly Played'],['MP','Moderately Played'],['HP','Heavily Played'],['DMG','Damaged']];
// Conditions only mean something on TCGplayer; sort order only means something on eBay.
// They occupy the same slot in the toolbar and swap with the source.
const SORTS=[['Low→High','low'],['High→Low','high'],['Best','best']];
function buildSorts(){
    const wrap=$('sort-set'); if(!wrap) return; wrap.innerHTML='';
    SORTS.forEach(pair=>{
        const b=document.createElement('button');
        b.className='cb'+(state.ebaySort===pair[1]?' on':'');
        b.textContent=pair[0]; b.dataset.sort=pair[1];
        b.title = pair[1]==='best' ? 'eBay best match' : 'Price plus shipping, '+pair[0].toLowerCase();
        b.addEventListener('click',()=>{ state.ebaySort=pair[1]; save(); buildSorts(); loadEmbed(); });
        wrap.appendChild(b);
    });
}
/* Saving is the last thing you do, so the button is not there until there is a card to save.
   It sat at the foot of an empty column from the moment the page opened, offering to save
   nothing. */
function syncSaveBtn(){
    const gp=$('grab-page'); if(!gp) return;
    const got = state.src==='ebay'
        ? _ebayBuilt
        : !!((_offers && _offers.length) || (_sales && _sales.length));
    gp.hidden = !got;
}
function syncSrcUI(){
    const isEbay = state.src==='ebay';
    const c=$('cond-set'), o=$('sort-set'), l=$('filt-l');
    if(c) c.style.display = isEbay ? 'none' : '';
    if(o) o.style.display = isEbay ? '' : 'none';
    if(l) l.textContent = isEbay ? 'Sort by' : 'Condition';
    // The eBay panel and the sheet share the left column; the class decides which is showing.
    document.body.classList.toggle('ebay', isEbay);
    ebPre();
    if(isEbay) buildSorts();
    /* Korean and Chinese are not TCGplayer product lines, so they cannot be searched there —
       on eBay a language is just another word in the query, so all four are offered. */
    document.querySelectorAll('#lang-seg button').forEach(b=>{
        const only = b.dataset.lang==='kr' || b.dataset.lang==='cn';
        // Both is a TCGplayer idea. An eBay search is a string of words, and "both" is not a word
        // that narrows anything — the language has to be one of the four.
        const hide = (only && !isEbay) || (b.dataset.lang==='both' && isEbay);
        b.style.display = hide ? 'none' : '';
    });
    if(isEbay && (state.lang||'both')==='both'){
        state.lang='en'; save();
        document.querySelectorAll('#lang-seg button').forEach(x=>
            x.classList.toggle('on', x.dataset.lang==='en'));
    }
    // No address to steer and nothing to save until the pages are in.
    const ub=$('urlbar'); if(ub) ub.style.display = isEbay ? 'none' : '';
    syncSaveBtn();
    if(!isEbay && (state.lang==='kr' || state.lang==='cn')){
        // Leaving eBay with one of those chosen would search TCGplayer for nothing at all.
        state.lang='both'; save();
        document.querySelectorAll('#lang-seg button').forEach(x=>
            x.classList.toggle('on', x.dataset.lang==='both'));
    }
}
function buildConds(){ const wrap=$('cond-set'); if(!wrap) return; wrap.innerHTML='';
    CONDITIONS.forEach(pair=>{ const ab=pair[0], c=pair[1];
        const b=document.createElement('button'); b.className='cb'+((state.conds||[]).indexOf(c)>=0?' on':'');
        b.textContent=ab; b.title=c+' — toggle on or off'; b.dataset.c=c;
        // plain toggles — click to add, click again to drop; others are left alone
        b.addEventListener('click',()=>{
            const cur=(state.conds||[]).slice();
            const i=cur.indexOf(c); if(i>=0) cur.splice(i,1); else cur.push(c);
            state.conds=cur; buildConds(); afterCond();
        });
        wrap.appendChild(b); }); }
// A condition change re-filters whatever card is currently loaded — it never re-runs the
// original text lookup, which could resolve to a different printing.
function afterCond(){ save();
    if(state.src!=='tcgplayer'){ loadEmbed(); return; }   // eBay has no condition filter here
    const pid=productIdFromUrl($('ub-input').value || curUrl);
    const u=applyCondToUrl(curUrl || $('ub-input').value || srcUrl());
    setUrl(u);
    if(u){ const f=$('site-frame'); try{ f.src=u; }catch(_){}
        setStatus('', 'Reloading with '+((state.conds||[]).length?esc(state.conds.join(', ')):'no condition filter')+'…', true); }
    if(pid) loadProduct(pid, null);              // same card, new filter
    else if(state.last) grabAll();               // nothing loaded yet — fall back to the lookup
}
// Strip any Condition/Language/page segments we own, then re-add if something is selected.
function applyCondToUrl(u){
    if(!u) return u; let url; try{ url=new URL(u); }catch(_){ return u; }
    if(!/tcgplayer\.com$/.test(url.hostname.replace(/^www\./,''))) return u;   // only TCGplayer uses these
    url.searchParams.delete('Condition'); url.searchParams.delete('Language'); url.searchParams.delete('page');
    const c=state.conds||[];
    if(c.length){ url.searchParams.set('Language','English'); url.searchParams.set('Condition', c.join('|')); url.searchParams.set('page','1'); }
    return url.toString().replace(/%7C/g,'|').replace(/%20/g,'+'); }

// _sacat=1 scopes to Collectibles. LH_BIN=1 is Buy It Now; LH_Sold/LH_Complete are the
// completed sales, which eBay only serves to a signed-in account.

// The local scanner (tools/ebay-scanner) drives a real Chrome on this PC and hands back the
// text of each eBay page. eBay refuses every server-side fetch, so a browser on your own
// machine is the only thing that can see these pages — and the parsing still happens here,
// which keeps one parser to maintain rather than two.
// The local-scanner path is complete and tested, but switched off in the interface for now.
// Flip this to true to bring the Auto scan tab back — nothing else needs changing.
const AUTO_ENABLED = false;
const HELPER='http://127.0.0.1:8787';
let _helperUp=false, _helperInfo=null;
// The scanner drives whichever Chromium browser is installed — Chrome, Edge, Brave, Opera or
// Vivaldi all work. Edge is the safety net, since Windows always has it.
async function helperSetBrowser(id){
    try{
        const r=await fetch(HELPER+'/browser?id='+encodeURIComponent(id));
        const j=await r.json();
        if(j.error){ toast(j.error); return; }
        toast('Scanner will use '+j.browser.label);
        helperPing();
    }catch(_){ toast('Could not switch browser'); }
}
async function helperPing(){
    try{
        const c=new AbortController(); setTimeout(()=>c.abort(), 1500);
        const r=await fetch(HELPER+'/ping',{signal:c.signal});
        _helperUp = r.ok;
        if(r.ok){ const j=await r.json(); _helperInfo=j; }
    }catch(_){ _helperUp=false; _helperInfo=null; }
    const dot=document.getElementById('helper-dot');
    if(dot){ dot.textContent = _helperUp ? 'helper running' : 'helper not running';
             dot.style.color = _helperUp ? 'var(--accent)' : 'var(--dim)'; }
    const go=document.getElementById('helper-go');
    if(go){ go.style.opacity = _helperUp ? '1' : '0.45'; }
    const dl=document.getElementById('helper-dl');
    if(dl){ dl.style.display = _helperUp ? 'none' : ''; }

    const bw=document.getElementById('helper-browser');
    if(bw){
        const info=_helperInfo;
        if(_helperUp && info && info.available && info.available.length){
            bw.style.display='';
            bw.innerHTML='<span style="opacity:0.8">browser</span> '
                + info.available.map(b=>'<button class="hb" data-id="'+b.id+'" style="'
                    + 'margin:0 3px;padding:2px 8px;border-radius:6px;font:inherit;font-size:0.63rem;cursor:pointer;'
                    + 'border:1px solid '+(info.browser&&info.browser.id===b.id
                        ? 'var(--accent);background:var(--accent-soft);color:var(--accent)'
                        : 'var(--border);background:none;color:var(--dim)')+'">'+esc(b.label)+'</button>').join('');
            bw.querySelectorAll('.hb').forEach(x=>x.addEventListener('click',()=>helperSetBrowser(x.dataset.id)));
        } else bw.style.display='none';
    }
    return _helperUp;
}
// Scanning runs as two separate calls rather than one. Each tab's results render the moment
// they arrive, so Offers fill in while Sold is still loading — a single combined call left both
// panels empty for the whole run, which reads as broken rather than busy.
let _scanPhase='', _dotTimer=null;
function helperStatus(msg, tone){
    const el=document.getElementById('helper-dot');
    if(_dotTimer){ clearInterval(_dotTimer); _dotTimer=null; }
    _scanPhase = msg || '';
    if(!el) return;
    if(!msg){ helperPing(); return; }                    // finished — back to the idle line
    let n=0;
    const paint=()=>{ el.textContent = msg + '.'.repeat(1 + (n++ % 3)); };
    el.style.color = tone==='warn' ? 'var(--dim)' : 'var(--accent)';
    paint();
    _dotTimer=setInterval(paint, 400);
}

const _naprest = ms => new Promise(r=>setTimeout(r, ms));

// Cancelling has to reach the scanner as well as the page: the browser it is driving keeps
// loading otherwise, and the next scan would collide with it.
let _scanAbort=null, _scanning=false;
async function helperStop(){
    if(!_scanning) return;
    _scanning=false;
    if(_scanAbort){ try{ _scanAbort.abort(); }catch(_){} _scanAbort=null; }
    try{ await fetch(HELPER+'/cancel'); }catch(_){}
    helperStatus('');
    toast('Scan stopped');
    const go=document.getElementById('helper-go');
    if(go){ go.disabled=false; go.textContent='\u26a1 SCAN THIS CARD'; }
    const st=document.getElementById('helper-stop');
    if(st) st.style.display='none';
}

async function helperPhase(q, which){
    const qs = which==='bin' ? '&sold=0' : '&bin=0';
    _scanAbort = new AbortController();
    const r = await fetch(HELPER+'/scan?q='+encodeURIComponent(q)+qs, { signal:_scanAbort.signal });
    const j = await r.json();
    if(j.error) throw new Error(j.error);
    const part = j[which];
    if(part && part.text){ handlePaste(part.text, ''); }
    return { part, errors: j.errors||[] };
}

async function helperScan(){
    const q=queryString();
    if(!q){ toast('Enter a card name first'); return; }
    if(!await helperPing()){
        toast('Start the scanner first — run START.bat in tools/ebay-scanner');
        return;
    }
    // A previous run may still be driving the browser; clear it before starting another.
    if(_scanning){ await helperStop(); await _naprest(400); }
    _scanning=true;
    const go=document.getElementById('helper-go');
    if(go){ go.disabled=true; go.textContent='SCANNING\u2026'; }
    const st=document.getElementById('helper-stop');
    if(st) st.style.display='';
    _ebayLive=[]; _ebayDone=[]; _ebayExpected=null; _ebayBuilt=false;
    renderOffers([], [], _meta);

    let any=false;
    try{
        helperStatus('Opening browser, reading Buy It Now');
        try{
            const a=await helperPhase(q,'bin');
            if(a.part && a.part.text){ any=true; toast('Buy It Now: '+_ebayLive.length+' listing'+(_ebayLive.length===1?'':'s')); }
            a.errors.forEach(e=>toast(e));
        }catch(e){ toast('Buy It Now failed: '+e.message); }

        // Keep the same courtesy gap the scanner uses when it does both in one go.
        if(!_scanning) return;
        helperStatus('Pausing between pages');
        await _naprest(1200);
        if(!_scanning) return;

        helperStatus('Reading sold listings');
        try{
            const b=await helperPhase(q,'sold');
            if(b.part && b.part.text){ any=true; toast('Sold: '+_ebayDone.length+' listing'+(_ebayDone.length===1?'':'s')); }
            b.errors.forEach(e=>toast(e));
        }catch(e){ toast('Sold failed: '+e.message); }

        if(!any) toast('Scanner returned nothing');
    }catch(e){
        toast('Scan failed — is the scanner window still open?');
    }finally{
        _scanning=false; _scanAbort=null;
        helperStatus('');
        if(go){ go.disabled=false; go.textContent='\u26a1 SCAN THIS CARD'; }
        const s2=document.getElementById('helper-stop');
        if(s2) s2.style.display='none';
    }
}

function ebayUrl(sold){
    const q=encodeURIComponent(ebayQuery() || queryString() || 'pokemon card');
    // eBay's sort codes: 12 best match, 16 price+shipping low->high, 15 high->low.
    const sop = state.ebaySort==='high' ? 16 : state.ebaySort==='best' ? 12 : 15;
    return 'https://www.ebay.com/sch/i.html?_nkw='+q+'&_sacat=1&_sop='+sop
        + (sold ? '&LH_Sold=1&LH_Complete=1' : '&LH_BIN=1');
}
// Handles to the tabs we opened, so the page can close them again later.
let ebayTabs={ bin:null, sold:null };
// One tab per click. Browsers allow a single pop-up per user gesture, so there is deliberately
// no "open both" — it can only ever half-work.
function openEbayTab(sold){
    if(!queryString()){ toast('Enter a card name first'); return false; }
    const key = sold ? 'sold' : 'bin';
    let w=null;
    try{ w = window.open(ebayUrl(sold), 'sb_ebay_'+key); }catch(_){}
    if(w){ ebayTabs[key]=w; try{ w.focus(); }catch(_){}
           toast(sold ? 'Opened Sold tab' : 'Opened Buy It Now tab'); }
    else   toast('Pop-up blocked — allow pop-ups for this site');
    return !!w;
}

function closeEbayPair(){
    let n=0;
    ['bin','sold'].forEach(k=>{ const w=ebayTabs[k];
        try{ if(w && !w.closed){ w.close(); n++; } }catch(_){}
        ebayTabs[k]=null; });
    return n;
}
function srcUrl(){ const q=encodeURIComponent(queryString()||'pokemon card');
    if(state.src==='ebay') return state.ebaySold ? ebayUrl(true) : ebayUrl(false);
    return applyCondToUrl('https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q='+q); }
document.querySelectorAll('#src-seg button').forEach(b=>b.addEventListener('click',()=>{
    state.src=b.dataset.src; save(); syncSrcUI();
    document.querySelectorAll('#src-seg button').forEach(x=>x.classList.toggle('on',x===b));
    _alts=[]; renderAlts();
    if(state.src!=='tcgplayer'){ _offers=[]; _sales=[]; _meta=null; showEbayNote(); }
    if(state.last) doSearch();     // switching source reloads the embed with the same card
}));
/* Narrowing the search itself rather than the list it produced. The list keeps its own filter
   for sorting through what came back; this decides what is asked for in the first place. */
document.querySelectorAll('#lang-seg button').forEach(b=>b.addEventListener('click',()=>{
    state.lang=b.dataset.lang; save();
    document.querySelectorAll('#lang-seg button').forEach(x=>x.classList.toggle('on',x===b));
    // The results list follows, so the two cannot disagree about what is being looked at.
    _altLang = state.lang==='en' ? 'EN' : state.lang==='jp' ? 'JP' : '';
    _alts=[]; renderAlts();
    // On eBay it changes the search itself, so the page has to be asked again either way.
    if(state.src==='ebay') loadEmbed();
    if(state.last) doSearch();
}));
$('open-tab').addEventListener('click',()=>window.open(curUrl||srcUrl(),'_blank','noopener'));
$('reload').addEventListener('click',()=>loadEmbed());
$('f-q').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); doSearch(); } });

// ── Address bar ─────────────────────────────────────────────────────────────
// Shows what the frame was pointed at, and can steer it anywhere.
// (A cross-origin frame won't report its own navigation back to us — see the note in the status strip.)
let curUrl='', _navs=0;
function setUrl(u){ curUrl=u||''; const i=$('ub-input'); if(i && document.activeElement!==i) i.value=curUrl;
}
/* There was a watcher here that marked the address stale when the frame navigated. There
   is no frame any more, so the only thing it could report was its own hiding — which
   came out as "frame moved" over a page that was working perfectly. */
/* The address is a report now, not an instruction — there is no frame to point it at, so there
   is nothing to "go" to. Enter still works for anyone who typed one in out of habit. */
$('ub-input').addEventListener('keydown',e=>{
    if(e.key==='Enter'){ e.preventDefault();
        const u=$('ub-input').value.trim();
        if(u) try{ window.open(u,'_blank','noopener'); }catch(_){}
    }
});
$('ub-copy').addEventListener('click',()=>{ const u=$('ub-input').value;
    (navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(()=>toast('Address copied')).catch(()=>toast('Could not copy')); });

// ── Pull a card from the Data Entry databases (same origin, so we can read them) ──
const DE_KEY='ptcg-imported-databases';
let _dbs=[];
function loadDbs(){return LocalSheets.all().map(d=>({id:d.id,name:d.name,entries:d.rows.map(r=>({cardName:r.name||r.how?.query||''})),columns:[{key:'cardName',type:'text',label:'Card name'}]}));}
function sheetsOf(db){ const out=[]; const order=db.sheetOrder||Object.keys(db.sheets||{});
    order.forEach(k=>{ const sh=(db.sheets||{})[k]; if(sh && (sh.entries||[]).length) out.push({ key:k, label:sh.label||k, sh:sh }); });
    if(!out.length && Array.isArray(db.entries) && db.entries.length) out.push({ key:'entries', label:'Entries', sh:{ columns:db.columns||[], entries:db.entries } });
    return out; }
function openPicker(){
    _dbs=loadDbs();
    const dbSel=$('pk-db'); dbSel.innerHTML='';
    if(!_dbs.length){ $('pk-list').innerHTML='<div class="empty"><div class="big">📇</div><div class="t">No databases found</div>'
        +'<div class="s">Add cards in <b>Data Entry</b> first — this reads the same storage.</div></div>';
        $('pk-src').textContent=''; $('pk-note').textContent=''; $('pick-back').classList.add('on'); return; }
    _dbs.forEach((db,i)=>{ const o=document.createElement('option'); o.value=String(i); o.textContent=db.name||'Untitled'; dbSel.appendChild(o); });
    dbSel.value='0'; fillSheets(); $('pk-q').value=''; $('pick-back').classList.add('on');
    setTimeout(()=>$('pk-q').focus(),30);
}
function fillSheets(){ const db=_dbs[parseInt($('pk-db').value,10)||0]; const sel=$('pk-sheet'); sel.innerHTML='';
    const list=sheetsOf(db); list.forEach((s,i)=>{ const o=document.createElement('option'); o.value=String(i);
        o.textContent=s.label+' ('+(s.sh.entries||[]).length+')'; sel.appendChild(o); });
    sel.value='0'; renderPick(); }
function renderPick(){
    const db=_dbs[parseInt($('pk-db').value,10)||0]; if(!db) return;
    const sheets=sheetsOf(db); const s=sheets[parseInt($('pk-sheet').value,10)||0]; const box=$('pk-list');
    $('pk-src').textContent=(db._cloud?'☁ cloud · ':'')+(db.name||'');
    if(!s){ box.innerHTML='<div class="empty"><div class="t">This database has no rows</div></div>'; return; }
    const cols=s.sh.columns||[]; const q=$('pk-q').value.trim().toLowerCase();
    const nameKey=(cols.find(c=>c.key==='cardName')||cols.find(c=>c.type==='text')||{}).key||'cardName';
    const rows=(s.sh.entries||[]).filter(e=>!q || cols.some(c=>String(e[c.key]||'').toLowerCase().includes(q))).slice(0,400);
    $('pk-note').textContent=rows.length+' row'+(rows.length===1?'':'s')+' · click one to look it up';
    box.innerHTML='';
    if(!rows.length){ box.innerHTML='<div class="empty"><div class="t">Nothing matches</div></div>'; return; }
    rows.forEach(e=>{
        const nm=String(e[nameKey]||'(unnamed)'); const set=String(e.set||''); const code=String(e.cardCode||'');
        const val=e.price||e.sold||e.paid||'';
        const d=document.createElement('div'); d.className='pk-row';
        d.innerHTML='<span class="nm">'+esc(nm)+'</span>'
            +'<span class="mt">'+esc([set,code].filter(x=>x&&x!=='N/A').join(' · '))+'</span>'
            +'<span class="pv">'+esc(val&&val!=='N/A'?val:'')+'</span>';
        d.addEventListener('click',()=>{
            const parts=[nm, set&&set!=='N/A'?set:'', code&&code!=='N/A'?code:''].filter(Boolean);
            const raw=parts.join(' ');
            $('f-q').value=raw;
            _picked={ name:nm, set:(set&&set!=='N/A')?set:'', code:(code&&code!=='N/A')?code:'', _raw:raw };
            $('pick-back').classList.remove('on'); doSearch();
        });
        box.appendChild(d);
    });
}
$('from-db').addEventListener('click',openPicker);
$('pk-close').addEventListener('click',()=>$('pick-back').classList.remove('on'));
$('pk-db').addEventListener('change',fillSheets);
$('pk-sheet').addEventListener('change',renderPick);
$('pk-q').addEventListener('input',renderPick);
$('pick-back').addEventListener('mousedown',e=>{ if(e.target===$('pick-back')) $('pick-back').classList.remove('on'); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && $('pick-back').classList.contains('on')) $('pick-back').classList.remove('on'); });

// ── The embed (the default view) ────────────────────────────────────────────
function setStatus(cls, html, retry){ const s=$('status'); s.className=cls?cls:''; s.querySelector('.msg').innerHTML=html;
    $('reload').style.display=retry?'':'none'; }
function frameMsg(on, big, t, s){ const m=$('frame-msg'); m.classList.toggle('on',!!on);
    if(on) m.innerHTML='<div class="big">'+big+'</div><div class="t">'+t+'</div><div class="s">'+s+'</div>'; }
// Fit the framed site to a phone by rendering it at desktop width and scaling the result down.
// Cross-origin content cannot be styled, but the frame element itself is ours to transform, and
// the browser maps clicks through the transform correctly.
const FRAME_TARGET_W = 1024;                          // width the framed sites lay out for
function fitFrame(){
    const wrap=document.getElementById('frame-wrap'), f=document.getElementById('site-frame');
    if(!wrap||!f) return;
    const small = window.matchMedia('(max-width:820px), (max-height:520px)').matches;
    if(!small || !wrap.clientWidth){
        f.style.width='100%'; f.style.height='100%'; f.style.transform=''; return;
    }
    const s = Math.max(0.42, Math.min(1, wrap.clientWidth / FRAME_TARGET_W));
    const pct = (100/s)+'%';
    f.style.width=pct; f.style.height=pct;
    f.style.transformOrigin='top left';
    f.style.transform='scale('+s+')';
}
window.addEventListener('resize', fitFrame);
window.addEventListener('orientationchange', ()=>setTimeout(fitFrame,180));
/* Sites that send x-frame-options or a frame-ancestors policy. They cannot be displayed inside
   another page at all, so they are not attempted — the browser's own refusal page is a worse
   answer than ours. eBay has always been on this list; TCGplayer joined it. */
const NO_FRAME = { tcgplayer:1 };
let _apiOK = null;                                   // null = unknown, false = no /api here (local server)
async function loadEmbed(){
    // frameMsg rewrites the panel's innerHTML, which would destroy the textareas if they are
    // still parked inside it. Pull them back to the side column first, every single time.
    movePaste(null);
    const url=srcUrl(), host=new URL(url).hostname.replace(/^www\./,'');
    setUrl(url);
    const frame=$('site-frame');
    fitFrame();
    // eBay sends x-frame-options: SAMEORIGIN *and* a frame-ancestors CSP, so it can never
    // render here. Show our own way out instead of the browser's refusal page.
    if(state.src==='ebay'){
        try{ frame.src='about:blank'; }catch(_){}
        setStatus('warn','<b>eBay</b> has no API we can read \u2014 the two pages are opened and '
            +'pasted back', false);
        buildEbaySteps();
        return;
    }
    if(NO_FRAME[state.src]){
        ebayPanelOff();
        try{ frame.src='about:blank'; }catch(_){}
        const bs='margin:10px 5px 0;padding:9px 15px;border-radius:9px;font:700 0.7rem inherit;'
            +'letter-spacing:1.1px;text-transform:uppercase;cursor:pointer;';
        frameMsg(true,'\u2197','<b>'+esc(host)+'</b> cannot be shown here',
            '<div style="max-width:44ch;margin:0 auto;font-size:0.72rem;line-height:1.7;color:var(--dim)">'
            + esc(host) + ' blocks other sites from displaying its pages. '
            + '<b style="color:var(--accent)">Pricing is not affected</b> \u2014 the figures on '
            + 'the right come straight from the API and are still live.</div>'
            + '<button id="nf-go" style="'+bs+'margin-left:0;border:1px solid var(--accent);'
            + 'background:var(--accent-soft);color:var(--accent)">\u2197 Open in a tab</button>'
            + '<button id="nf-copy" style="'+bs+'border:1px solid var(--border);background:none;'
            + 'color:var(--dim)">Copy link</button>');
        setStatus('warn','<b>'+esc(host)+'</b> blocks embedding \u2014 opens in a tab \u00b7 prices still live', false);
        const go=document.getElementById('nf-go');
        if(go) go.addEventListener('click',()=>{ try{ window.open(url,'_blank','noopener'); }catch(_){} });
        const cp=document.getElementById('nf-copy');
        if(cp) cp.addEventListener('click',()=>{
            try{ navigator.clipboard.writeText(url); toast('Link copied'); }
            catch(_){ toast('Could not copy', true); }
        });
        return;
    }
    frameMsg(true,'⏳','Loading '+esc(host),'');
    setStatus('', 'Loading <b>'+esc(host)+'</b>…', false);
    let cleared=false;
    const clear=(msg,cls)=>{ if(cleared) return; cleared=true; frameMsg(false); setStatus(cls||'good', msg||('<b>'+esc(host)+'</b> loaded'), true); };
    frame.onload=()=>clear();                        // it rendered — nothing else matters
    try{ frame.src=url; }catch(_){}
    setTimeout(()=>clear(), 2500);                   // some sites never fire load; show it anyway

    if(_apiOK===false) return;                       // no API on this origin, don't bother
    let d={};
    try{ d=await getJSON('/api/embedcheck?url='+encodeURIComponent(url)); }catch(e){ d={ error:String(e.message||e) }; }
    if(d.error && /HTTP 404|web page instead/i.test(d.error)){ _apiOK=false; return; }
    _apiOK=true;
    if(d.xFrameOptions || d.frameAncestors){
        const why = d.xFrameOptions ? ('X-Frame-Options: '+esc(d.xFrameOptions)) : esc(d.frameAncestors);
        setStatus('bad','<b>'+esc(host)+'</b> may refuse to embed — <code>'+why+'</code> · use <b>↗</b> to open it in a tab', true);
    }
}

// Search loads the site in the frame; Grab prices fills the column from your clipboard.
function doSearch(){ const f=fields();
    if(!f.name && !f.set && !f.code){ toast('Type a card, or pull one from a database'); $('f-q').focus(); return; }
    state.last={ raw:$('f-q').value.trim() }; save(); loadEmbed(); grabAll(); }   // listings fetch themselves
$('go').addEventListener('click',doSearch);

// ── Competing Offers ────────────────────────────────────────────────────────
// Reads listings you copied off the TCGplayer tab. A price followed by a shipping line is
// folded together, and sellers carrying the gold-star badge are tracked separately.
const GOLD_STAR='gold-star.svg';
let _ebayExpected=null;
// Only eBay marks every result title this way; a TCGplayer block never carries it.
function isEbayText(t){
    t=String(t||'');
    return /Opens in a new window or tab/i.test(t) || /^\s*sold\s+\S/im.test(t) || /\bresults? for\b/i.test(t);
}
function parseOffers(text, html){
    if(!text && html){ try{ text=new DOMParser().parseFromString(html,'text/html').body.textContent||''; }catch(_){} }
    if(isEbayText(text)){
        const eb=parseEbay(text);
        if(eb.length){
            _ebayExpected = eb._expected!=null ? eb._expected : null;
            /* A plain-text copy loses the links, but a copy from the page carries the markup too
               — and the item ids arrive in the same order the rows do. Attaching them is what
               lets a row be opened rather than only counted. */
            if(html){
                const ids=[];
                const seen=new Set();
                String(html).replace(/ebay\.com\/itm\/(\d{6,})/g, (m, id) => {
                    if(!seen.has(id)){ seen.add(id); ids.push(id); }
                    return m;
                });
                eb.forEach((o, i) => { if(ids[i]) o.link = 'https://www.ebay.com/itm/' + ids[i]; });
            }
            return eb;
        }
    }
    const listings=parseListings(text);
    if(listings.length) return listings;
    return parseLoose(text);
}

// A whole eBay results page, copied with Ctrl+A. Two anchors make the real listings findable:
// every genuine result's title line ends with "Opens in a new window or tab", and every result
// closes with the seller's "<name> NN% positive (count)" line. Everything between those two is
// one listing; everything outside them — the ad strip, the Live-streams carousel, related
// searches, "Pick up where you left off" — is page furniture and is skipped.
// A slab and a raw card are not the same comp — a BGS 8.5 sitting in a list of loose copies
// will drag the average somewhere useless. The grade is only ever in the title, so it is read
// from there and kept as its own field so the two can be told apart.
function gradeOf(title){
    const m=String(title||'').match(/\b(PSA|BGS|CGC|SGC|ACE|TAG)\s*\.?\s*(10|[1-9](?:\.5)?)\b/i);
    return m ? (m[1].toUpperCase()+' '+m[2]) : '';
}
function parseEbay(text){
    const L=String(text||'').split(/\r?\n/).map(x=>x.replace(/ /g,' ').trim());
    const ANCHOR=/Opens in a new window or tab\s*$/;
    const SELLER=/^(\S+)\s+([\d.]+)%\s+positive\s+\(([\d,.]+)\s*([KM]?)\)\s*$/i;
    const money=x=>{ const m=String(x).match(/\$\s?([\d,]+(?:\.\d{2})?)/); return m?parseFloat(m[1].replace(/,/g,'')):null; };

    // eBay states the true count ("5 results for ..."), then pads the page with near-misses
    // under "Results matching fewer words". Only the rows above that line answer the search.
    let start=0, end=L.length, expected=null;
    for(let i=0;i<L.length;i++){
        const m=L[i].match(/^([\d,]+)\+?\s+results?\s+for\b/i);
        if(m){ expected=parseInt(m[1].replace(/,/g,''),10); start=i+1; break; }
    }
    for(let i=start;i<L.length;i++){
        if(/^(results matching fewer words|related searches|pick up where you left off|explore more like this|you may also like)\s*$/i.test(L[i])){ end=i; break; }
    }

    const NOISE=/^(derosnopS|sponsored|new listing|opens in a new window or tab)$/i;
    const anchors=[];
    for(let i=start;i<end;i++){
        if(!ANCHOR.test(L[i])) continue;
        const inline=L[i].replace(ANCHOR,'').trim();
        if(inline.length>3){ anchors.push({at:i,title:inline}); continue; }
        let j=i-1;                                  // phrase alone: the title is the line above
        while(j>start && (!L[j] || NOISE.test(L[j]))) j--;
        const prev=(L[j]||'').trim();
        if(prev.length>3) anchors.push({at:i,title:prev});
    }

    const out=[];
    anchors.forEach((an,idx)=>{
        const a=an.at;
        const stop = idx+1<anchors.length ? anchors[idx+1].at : end;
        const title=an.title;
        let price=null, ship=0, freeShip=false, cond='', loc='', date='',
            seller='', pct=null, revs=null, bin=false, bestOffer=false,
            watchers=0, qtySold=0, auth=false;

        let closed=false;
        for(let j=a+1;j<stop;j++){
            const line=L[j]; if(!line) continue;

            // A "Sold <date>" caption sits above the seller line on some result layouts and
            // below it on others, so it is searched for across the whole block. Every other
            // field is read only before the seller line, which is what really ends the row.
            const sd=line.match(/^sold\s+(.+)$/i);
            if(sd){ date=sd[1].trim(); continue; }

            // These sit on either side of the seller line depending on the listing, so like the
            // sold date they are read across the whole block rather than only before it closes.
            const wm=line.match(/^(\d[\d,]*)\s+watchers?$/i);
            if(wm){ watchers=parseInt(wm[1].replace(/,/g,''),10); continue; }
            const qm=line.match(/^(\d[\d,]*)\s+sold$/i);
            if(qm){ qtySold=parseInt(qm[1].replace(/,/g,''),10); continue; }
            if(/^authenticity guarantee/i.test(line)){ auth=true; continue; }

            const sm=line.match(SELLER);
            if(sm && !closed){
                seller=sm[1];
                pct=parseFloat(sm[2]);
                revs=Math.round(parseFloat(sm[3].replace(/,/g,'')) * (sm[4].toUpperCase()==='K'?1e3:sm[4].toUpperCase()==='M'?1e6:1));
                closed=true; continue;
            }
            if(closed) continue;
            if(/^located in\s+(.+)$/i.test(line)){ loc=line.replace(/^located in\s+/i,'').trim(); continue; }
            if(/^(pre-?owned|brand new|new \(other\)|new with|new without|used|open box|refurbished|certified|graded|ungraded)/i.test(line)){
                if(!cond) cond=line.slice(0,26); continue; }
            if(/^buy it now$/i.test(line)){ bin=true; continue; }
            if(/^or best offer$/i.test(line)){ bestOffer=true; continue; }
            if(/^free\s+(delivery|shipping|postage)/i.test(line)){ freeShip=true; ship=0; continue; }
            if(/(delivery|shipping|postage)/i.test(line)){
                const sv=money(line); if(sv!=null) ship=sv; continue; }
            // noise that can sit inside a listing block
            if(/^(customs services|derosnopS|sponsored|almost gone|last one|direct from|free returns|returns accepted|was:|\d+\s+bids?|opens in a new window)/i.test(line)) continue;
            if(price==null){ const pv=money(line); if(pv!=null) price=pv; }   // ranges: first = low end
        }

        if(price==null) return;
        out.push({ price, ship, total:+(price+ship).toFixed(2), freeShip,
            seller, pct, revs, loc, condition:cond, date, sold:!!date, bin, bestOffer,
            watchers, qtySold, auth, grade:gradeOf(title),
            gold:false, text:title.slice(0,80), title:title.slice(0,80) });
    });

    out._expected = expected;
    return out;
}

// A TCGplayer Listings block. Each listing starts with its price line:
//   "$103.01 + $1.49 Shipping"   or   "$110.00 Shipping: Included"
function parseListings(text){
    let L=String(text||'').split(/\r?\n/).map(s=>s.trim());
    // Everything we want sits under the "Listings / As low as $x" header — start there so the
    // market-price banner above it never gets counted as an offer.
    for(let i=0;i<L.length && i<80;i++){
        if(/^as low as\s*\$/i.test(L[i]) || /^\d+\s+listings?$/i.test(L[i])){ L=L.slice(i+1); break; }
    }
    const out=[];
    const isPrice=x=>/^\$\s?[\d,]+\.\d{2}\s*(?:\+|Shipping:|Free|$)/i.test(x);
    for(let i=0;i<L.length;i++){
        const m=L[i].match(/^\$\s?([\d,]+\.\d{2})\s*(?:\+\s*\$\s?([\d,]+\.\d{2})\s*Shipping|Shipping:\s*Included|Free Shipping)?\s*$/i);
        if(!m) continue;
        const price=parseFloat(m[1].replace(/,/g,'')), ship=m[2]?parseFloat(m[2].replace(/,/g,'')):0;
        let end=i+1; while(end<L.length && !isPrice(L[end])) end++;
        const b=L.slice(i+1,end);
        const cond=b.find(x=>/^(Near Mint|Lightly Played|Moderately Played|Heavily Played|Damaged|Unopened)\b/i.test(x))||'';
        const ai=b.findIndex(x=>/^Add to Cart$/i.test(x));
        const seller=ai>=0 ? (b.slice(ai+1).find(x=>x && !/^\d+$/.test(x))||'') : '';
        // the badge is the bare line "Gold Star Seller" — not the
        // "Gold Star Sellers have a feedback rating…" tooltip that every listing carries
        const gold=b.some(x=>/^Gold Star Seller$/i.test(x));
        out.push({ price, ship, total:+(price+ship).toFixed(2), gold, condition:cond, seller,
                   text:(seller||'')+(cond?(' · '+cond):'') });
        i=end-1;
    }
    return out;
}
// Fallback: any text with prices, folding a following shipping line into the price above it.
function parseLoose(text){
    const lines=String(text||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const offers=[];
    lines.forEach(line=>{
        const money=[...line.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)].map(m=>parseFloat(m[1].replace(/,/g,'')));
        if(!money.length){
            const sm=line.match(/([\d,]+\.\d{2})/);
            if(/shipping/i.test(line) && offers.length){
                if(/free/i.test(line)) offers[offers.length-1].ship=0;
                else if(sm) offers[offers.length-1].ship=parseFloat(sm[1].replace(/,/g,'')); }
            return; }
        if(/shipping/i.test(line) && offers.length && money.length===1){ offers[offers.length-1].ship=money[0]; return; }
        const o={ price:money[0], ship:0, gold:false, text:line.slice(0,90) };
        if(money.length>1 && /shipping|ship/i.test(line)) o.ship=money[1];
        offers.push(o); });
    offers.forEach(o=>o.total=+(o.price+(o.ship||0)).toFixed(2));
    return offers;
}
function stat(list){
    const t=list.map(o=>o.total).filter(n=>isFinite(n));
    if(!t.length) return null;
    return { low:Math.min.apply(null,t), high:Math.max.apply(null,t), avg:t.reduce((a,b)=>a+b,0)/t.length, n:t.length };
}
/* ── what a card is worth ─────────────────────────────────────────────────────
   The lowest asking price is not the market. It is one seller's opinion, often a damaged copy or
   somebody who wants out today, and taking it as the value understates every card by whatever
   the cheapest listing happens to be.

   Both halves say something different. What is on sale is what people are *asking*; what has
   sold is what somebody actually *paid*. So the two are combined rather than one being picked:
   the middle of each side, with the sold side counted twice, because a completed sale is
   evidence and an asking price is a hope.

   The middle rather than the mean on each side, so one absurd listing cannot drag the answer
   with it. */
function midOf(list){
    const t = (list || []).map(Number).filter(n => isFinite(n) && n > 0).sort((a, b) => a - b);
    if (!t.length) return null;
    return t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2;
}
function fairValue(listings, sales){
    const lo = midOf(listings), sa = midOf(sales);
    if (lo == null && sa == null) return null;
    if (lo == null) return sa;
    if (sa == null) return lo;
    return (sa * 2 + lo) / 3;
}
const FAIR_WHY = 'Arcane 9 Labs uses its own mathematical model to determine the fair market '
    + 'price using data on offers (currently unsold on market) and last solds of the card.';
function statPanels(st){
    if(!st) return '';
    return '<div class="co-stats">'
      +'<div class="co-stat lo"><div class="k">Low</div><div class="v">$'+st.low.toFixed(2)+'</div></div>'
      +'<div class="co-stat av"><div class="k">Avg</div><div class="v">$'+st.avg.toFixed(2)+'</div></div>'
      +'<div class="co-stat hi"><div class="k">High</div><div class="v">$'+st.high.toFixed(2)+'</div></div></div>';
}
// Rows start selected; clicking one drops it out of the maths so you can ignore outliers.
let _offSel=new Set(), _salSel=new Set();
// eBay writes review counts as "6.4K"; keep them that short on the row.
function fmtRevs(n){
    if(n==null) return '?';
    if(n>=1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'')+'M';
    if(n>=1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'')+'K';
    return String(n);
}
// eBay writes this a few ways depending on the listing.
function isUS(loc){ return /^(united states|usa|u\.s\.)/i.test(String(loc||'').trim()); }
function trimName(x){ x=String(x||''); return x.length>13 ? x.slice(0,12)+'\u2026' : x; }
// Manual mode shows the paste boxes inside the frame area; every other mode puts them back in
// the side column. Moving the nodes keeps their listeners and their contents.
/* The eBay controls, written into the side column. This used to go through frameMsg, which
   draws into the wrapper the dead iframe lives in — so it appeared under the sheet, a column
   away from the prices it is for. */
function ebayPanel(big, title, body){
    const el=$('ebay-panel'); if(!el) return;
    el.hidden=false;
    el.innerHTML='<div class="ep-h"><span class="ep-i">'+big+'</span><span class="ep-t">'
        +title+'</span></div><div class="ep-b">'+body+'</div>';
}
function ebayPanelOff(){ const el=$('ebay-panel'); if(el){ el.hidden=true; el.innerHTML=''; } }
/* ── eBay, one step at a time ─────────────────────────────────────────────────
   There is no API to read: eBay refuses every server-side request, so the two pages have to be
   opened by a person and handed back. That is a chore, and the old panel made it worse by
   explaining itself at length and offering a mode switch before the first useful action.

   So it asks for what it needs, in order, and nothing is live until the step before it is done.
   The set and the number matter because "ogerpon" on eBay returns a thousand things; the card
   number is what makes the search exact. */
const EBAY_WORD = { en:'English', jp:'Japanese', kr:'Korean', cn:'Chinese' };
/* English printings are called Illustration Rare and Special Illustration Rare; the Japanese,
   Korean and Chinese ones are AR and SAR. Same idea, different name, and searching eBay with the
   wrong one finds nothing — so which pair is offered follows the language. */
const RARE_EN = [['none','None','any printing'],
                 ['ir','IR','Illustration Rare'],
                 ['sir','SIR','Special Illustration Rare']];
const RARE_AS = [['none','None','any printing'],
                 ['ar','AR','Art Rare'],
                 ['sar','SAR','Special Art Rare']];
const RARE_WORD = { ir:'illustration rare', sir:'special illustration rare', ar:'AR', sar:'SAR' };
function rareSet(){ return (state.lang==='en' || state.lang==='both') ? RARE_EN : RARE_AS; }
function ebayQuery(){
    // Whatever has been filled in, in the order somebody would say it. Blanks simply drop out.
    const bits = [queryString(), (state.ebaySet||'').trim(), (state.ebayNum||'').trim(),
                  RARE_WORD[state.ebayRare] || '', EBAY_WORD[state.lang] || ''];
    return bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
/* Only the name and the language are needed. The set, the number and the rarity narrow a search
   that is often fine without them — demanding all three turned an optional refinement into a
   wall in front of the one useful action. */
function ebayReady(){
    return !!(queryString() && EBAY_WORD[state.lang]);
}
let _ebayArmed = false;
let _ebayOpened = '';
/* The set, the number and the language were already asked for on the way here, so the panel does
   not ask again — it builds the two searches from what is known and opens the first one. What is
   left is the part only a person can do: select the page, copy it, paste it back. */
function buildEbaySteps(){
    movePaste(null);
    const q = ebayQuery(), ready = ebayReady();
    /* Two boxes. The first says what this is and what it will search for; the second is the
       work. Running the explanation and the steps together made the first step look like a
       continuation of a sentence rather than something to do. */
    const who = esc(queryString() || 'this card');
    ebayPanel('\u2197', 'Pull eBay data',
        '<div class="eb-lede">Follow the steps to parse sales data. Click each of the buttons '
      + 'to open tabs to \u201c' + who + '\u201d\u2019s Offers and Sales pages on eBay.'
      + '<div class="eb-q" id="eb-q">' + (ready
            ? 'Searching <b>' + esc(q) + '</b>'
            : '<i>Go back and give this a card name and a language.</i>') + '</div></div>'
      + '<div class="eb-box">'
      + '<div class="eb-step"><b>1</b> Buy It Now</div>'
      + '<button class="eb-open" id="eb-bin"' + (ready ? '' : ' disabled') + '>\u2197 Open page</button>'
      + '<div id="eb-host-bin"></div>'
      + '<div class="eb-step"><b>2</b> Sold</div>'
      + '<button class="eb-open" id="eb-sold"' + (ready ? '' : ' disabled') + '>\u2197 Open page</button>'
      + '<div id="eb-host-sold"></div>'
      + '<button class="eb-go" id="eb-parse" disabled>Parse</button>'
      + '<button class="eb-go" id="eb-done" hidden>Build Price Sheet</button></div>'
      + '<div class="eb-note" id="eb-note"></div>');

    if(!ready){ _ebayArmed = false; return; }
    _ebayArmed = true;
    movePasteSplit();
    [['eb-bin', false], ['eb-sold', true]].forEach(([id, sold]) => {
        const b = $(id);
        b.classList.add('waiting');
        b.addEventListener('click', () => {
            if(openEbayTab(sold)) b.classList.remove('waiting');
        });
        /* The address it will open, following the cursor. These two searches are built out of
           five things picked several screens ago, and being able to read the result before
           committing to a tab is the difference between trusting it and guessing. */
        b.addEventListener('mouseenter', e => tipText(e, ebayUrl(sold)));
        b.addEventListener('mousemove', tipMove);
        b.addEventListener('mouseleave', tipHide);
    });
    $('eb-done').addEventListener('click', ebayBuild);

    /* Neither page opens itself any more. A tab appearing without being asked for is startling,
       and whichever one it picked would be the wrong one half the time. The buttons glow until
       they are pressed instead, and stop once their page has been opened. */
    void _ebayOpened;
    // The box at the top has already said this. Saying it again under the boxes was furniture.
    ebayNote('');
    $('eb-parse').addEventListener('click', ebParse);
    ebSyncParse();
    ebPre();
    ebaySteps();
}
// One box under each button, rather than two in a row that could take either page.
function movePasteSplit(){
    const a=$('co-paste'), b=$('co-paste2');
    const hb=$('eb-host-bin'), hs=$('eb-host-sold');
    if(!a||!b||!hb||!hs) return;
    hb.appendChild(a); hs.appendChild(b);
    a.style.display=''; b.style.display='';
    a.placeholder='Paste the Buy It Now page here';
    b.placeholder='Paste the Sold page here';
}
function ebayNote(html){ const el=$('eb-note'); if(el) el.innerHTML=html; }
/* The last step only exists once both pages are in. handlePaste already refuses the same page
   twice, so reaching here means they really are the two different pages. */
function ebayBoth(){ return !!(_ebayLive.length && _ebayDone.length); }
/* Before the sheet is built there is nothing below the panel worth the space. Afterwards there
   is, and the panel goes back to being a box at the top of it. */
function ebPre(){
    document.body.classList.toggle('eb-pre', state.src === 'ebay' && !_ebayBuilt);
}
/* Both pages, read together, once. Carry the whole record across rather than a hand-picked
   subset — dropping fields here is what left the sold rows without a grade or a seller, and
   silently disabled the raw/graded and US-only filters for that panel. */
function ebayBuild(){
    if(!ebayBoth()){ toast('Both pages need pasting in first.', true); return; }
    renderOffers(_ebayLive, _ebayDone.map(o => Object.assign({}, o, { qty:1 })), _meta);
    _ebayBuilt = true;
    ebPre();
    syncSaveBtn();
    ebayNote('Sheet built \u2014 ' + _ebayLive.length + ' on sale, ' + _ebayDone.length
           + ' sold. <b>Save to database</b> puts it on the sheet.');
    toast('Price sheet built');
    if(document.body.classList.contains('wiz')) wizPaint();
}
function ebaySteps(){
    const done=$('eb-done');
    if(done) done.hidden = !ebayBoth();
    /* Moving on is Parse's job. This used to jump to the next step the moment the second page
       landed, which took the screen away from somebody who was still checking they had pasted
       the right thing. */
    ebSyncParse();
}
function movePaste(host){
    const a=$('co-paste'), b2=$('co-paste2'), wrap=$('co-wrap'), out=$('co-out');
    if(!a||!b2||!wrap) return;
    if(host){ host.appendChild(a); host.appendChild(b2); a.style.display=''; b2.style.display=''; }
    else { wrap.insertBefore(a,out); wrap.insertBefore(b2,out);
           a.style.display='none'; b2.style.display='none'; }
}
let _tipEl=null;
function tipNode(){
    if(_tipEl) return _tipEl;
    _tipEl=document.createElement('div');
    _tipEl.style.cssText='position:fixed;z-index:9999;display:none;pointer-events:none;max-width:340px;'
        +'padding:9px 11px;border-radius:9px;border:1px solid var(--border);background:var(--panel,#15161a);'
        +'color:var(--text,#e8e8ea);box-shadow:0 10px 30px rgba(0,0,0,0.45);font-size:0.7rem;line-height:1.6;';
    document.body.appendChild(_tipEl);
    return _tipEl;
}
function tipHtml(o, kind){
    const row=(k,v)=>v ? '<div><span style="color:var(--dim)">'+k+'</span> '+esc(String(v))+'</div>' : '';
    let h='<div style="font-weight:700;margin-bottom:5px">'+esc(o.title||o.text||'(no title)')+'</div>';
    h+='<div style="font-size:0.9em">';
    h+=row('total', '$'+o.total.toFixed(2));
    if(o.price!=null) h+=row('price', '$'+o.price.toFixed(2)
        + (o.ship ? '  +  $'+o.ship.toFixed(2)+' shipping' : (o.freeShip ? '  +  free shipping' : '')));
    h+=row('grade', o.grade);
    h+=row('condition', o.condition);
    h+=row('ships from', o.loc);
    if(o.pct!=null) h+=row('seller', (o.seller||'')+'  '+o.pct+'% positive ('+fmtRevs(o.revs)+' reviews)');
    else h+=row('seller', o.seller);
    h+=row(kind==='sales'?'sold':'date', o.date);
    if(o.watchers) h+=row('watching', o.watchers);
    if(o.qtySold) h+=row('sold', o.qtySold);
    const f=[o.bestOffer?'accepts offers':'', o.bin?'buy it now':'', o.auth?'authenticity guarantee':''].filter(Boolean).join(' · ');
    h+=row('', f);
    h+='</div>';
    return h;
}
function tipShow(e, o, kind){
    const t=tipNode();
    t.innerHTML=tipHtml(o, kind);
    t.style.fontFamily=''; t.style.fontSize='0.7rem'; t.style.overflowWrap='';
    t.style.display='';
    tipMove(e);
}
function tipMove(e){
    if(!_tipEl || _tipEl.style.display==='none') return;
    const GAP=16, r=_tipEl.getBoundingClientRect();
    // right edge pinned to the left of the cursor; clamped so it never leaves the window
    let right = window.innerWidth - e.clientX + GAP;
    if(e.clientX - r.width - GAP < 4) right = Math.max(4, window.innerWidth - r.width - 8);
    let top = e.clientY - r.height/2;
    top = Math.max(6, Math.min(top, window.innerHeight - r.height - 6));
    _tipEl.style.right = right+'px';
    _tipEl.style.left = 'auto';
    _tipEl.style.top = top+'px';
}
function tipHide(){ if(_tipEl) _tipEl.style.display='none'; }
/* The same following tooltip, carrying one line rather than a listing. Broken anywhere, because
   an eBay search URL is long and a tooltip that runs off the screen has told you nothing. */
function tipText(e, text){
    const t = tipNode();
    t.textContent = String(text || '');
    t.style.overflowWrap = 'anywhere';
    t.style.fontFamily = 'ui-monospace,Menlo,Consolas,monospace';
    t.style.fontSize = '0.62rem';
    t.style.display = '';
    tipMove(e);
}
function drawGroup(host, title, rows, off, kind){
    const live=rows.filter((o,i)=>!off.has(i));
    const st=stat(live);
    let h='<div class="co-gh">'+title+'</div>';
    h+=statPanels(st);
    /* The fair figure sits with the others rather than only inside the sheet, so it is visible
       while judging a card and not just while filing one. */
    if(kind==='offers'){
        const nOff=_offers.length, nSold=_sales.length;
        const fv=fairValue(_offers.map(o=>o.total), _sales.map(o=>o.total));
        /* Say which side it came from. The model falls back to one side when the other is
           empty, and a fair price sitting over an empty offers list looks like a fault when it
           is the model doing exactly what it should — a condition filter with nothing under it
           is the usual reason, and that is worth saying out loud rather than leaving to be
           worked out. */
        const from = (nOff && nSold) ? 'offers and sold, weighted to sold'
                   : nSold ? 'sold only — nothing is listed at these filters'
                   : nOff ? 'offers only — nothing has sold recently'
                   : '';
        if(fv!=null) h+='<div class="co-fair" title="'+esc(FAIR_WHY)+'">'
            +'<span class="k">Fair market</span><span class="v">$'+fv.toFixed(2)+'</span>'
            +'<span class="n">'+esc(from)+'</span></div>';
    }
    if(rows.length>1){ h+='<div class="co-sel">tap a row to include or exclude it'
        +'<button data-act="all" data-kind="'+kind+'" style="margin-left:auto">all</button>'
        +(kind==='offers'&&rows.some(o=>o.gold) ? '<button data-act="gold" data-kind="'+kind+'" title="Count only gold-star sellers">★ only</button>' : '')
        +(rows.some(o=>o.grade)&&rows.some(o=>!o.grade)
            ? '<button data-act="raw" data-kind="'+kind+'" title="Loose copies only — drops the slabs">raw</button>'
              +'<button data-act="slab" data-kind="'+kind+'" title="Graded slabs only">graded</button>' : '')
        +(rows.some(o=>isUS(o.loc))&&rows.some(o=>o.loc&&!isUS(o.loc))
            ? '<button data-act="us" data-kind="'+kind+'" title="Only listings shipping from the US">US only</button>' : '')
        +'<button data-act="none" data-kind="'+kind+'">none</button></div>'; }
    if(!rows.length) h+='<div class="co-none">'+(_scanPhase
        ? esc(_scanPhase)+'\u2026'
        : (_ebayWait===kind
            ? 'Waiting for the <b>'+(kind==='sales'?'Sold':'Buy It Now')+'</b> page — paste it on the left.'
            : (kind==='sales' ? 'No recent sales published for this card.'
                              : 'Search a card above — listings load on their own.')))+'</div>';
    rows.forEach((o,i)=>{
        const isOff=off.has(i);
        const isLo=st&&!isOff&&o.total===st.low, isHi=st&&!isOff&&o.total===st.high;
        // Offers read straight down the page: total, then the price + shipping it came from.
        // eBay rows carry more than TCGplayer's: where it ships from, and how the seller rates.
        const rate = o.pct!=null ? (trimName(o.seller)+' '+o.pct+'% ('+fmtRevs(o.revs)+')') : (o.seller||'');
        const cost = o.ship ? ('$'+o.price.toFixed(2)+' + $'+o.ship.toFixed(2)+' ship')
                            : (o.freeShip ? ('$'+o.price.toFixed(2)+' + free ship') : '');
        // A graded card's grade IS its condition, so it replaces "Pre-Owned" when present.
        // OBO flags a price that is only an asking price; AG is eBay's authentication.
        const grade = o.grade || o.condition || '';
        const flags = [o.bestOffer?'OBO':'', o.auth?'AG':'',
                       o.watchers?(o.watchers+' watching'):''].filter(Boolean).join(' ');
        const note = kind==='sales'
            ? [o.date, o.grade||o.condition, o.loc||'', o.qty>1?('x'+o.qty):''].filter(Boolean).join(' · ')
            : [cost, grade, o.loc||'', rate, flags].filter(Boolean).join(' · ');
        h+='<div class="co-row'+(isOff?' off':'')+(isLo?' lo':'')+(isHi?' hi':'')
          +(o.link?' has-link':'')+'" data-kind="'+kind+'" data-i="'+i+'"'
          +(o.link?(' data-link="'+esc(o.link)+'"'):'')+'>'
          +'<button class="tick" type="button" title="'+(isOff?'Count this one':'Leave this one out')
          +'">'+(isOff?'○':'●')+'</button>'
          +'<span class="amt">$'+o.total.toFixed(2)+'</span>'
          +(o.gold?'<span class="star" title="Gold-star seller">★</span>':'')
          +'<span class="brk">'+esc(note)+'</span></div>';
    });
    const g=document.createElement('div'); g.className='co-grp'; g.innerHTML=h; host.appendChild(g);
}
const SHOW_N = 10;
let _ebayWait = null;                                // which panel is still expecting a paste                                   // rows shown per group, offers and sales alike
let _offers=[], _sales=[], _meta=null;
function renderOffers(offers, sales, meta){
    if(offers){ if(offers!==_offers){ _offers=offers; _offSel=new Set(); } }
    if(sales){ if(sales!==_sales){ _sales=sales; _salSel=new Set(); } }
    if(meta!==undefined && meta!==null) _meta=meta;
    const out=$('co-out'); out.innerHTML='';
    syncSaveBtn();
    if(_meta && _meta.name){
        const h=document.createElement('div'); h.className='co-prod';
        h.innerHTML='<div class="pn">'+esc(_meta.name)+'</div><div class="ps">'+esc(_meta.set||'')
            +(_meta.market?(' · market <b>$'+Number(_meta.market).toFixed(2)+'</b>'):'')
            +(_meta.total?(' · '+_meta.total+' listings'):'')+'</div>';
        out.appendChild(h);
    }
    // Say how many were read versus how many are on screen, so a cap never looks like a short read.
    const cap=(base, all, extra)=>{
        const n=Math.min(all.length, SHOW_N);
        let t=base;
        if(extra!=null && all.length) t+=' \u00b7 '+n+' of '+extra+' result'+(extra===1?'':'s');
        else if(all.length>n)        t+=' \u00b7 '+n+' of '+all.length;
        return t;
    };
    drawGroup(out, cap('Offers', _offers, _ebayExpected), _offers.slice(0,SHOW_N), _offSel, 'offers');
    drawGroup(out, cap('Latest sales', _sales, null),     _sales.slice(0,SHOW_N),  _salSel, 'sales');
}
(function(){
    const host=$('co-out');
    const rowOf=t=>{ const r=t&&t.closest?t.closest('.co-row'):null;
        if(!r) return null;
        const rows = (r.dataset.kind==='sales' ? _sales : _offers).slice(0,SHOW_N);
        const o = rows[+r.dataset.i];
        return o ? { o, kind:r.dataset.kind } : null; };
    host.addEventListener('mouseover',e=>{ const h=rowOf(e.target); if(h) tipShow(e,h.o,h.kind); });
    host.addEventListener('mousemove',e=>{ const h=rowOf(e.target); if(h) tipMove(e); else tipHide(); });
    host.addEventListener('mouseleave',tipHide);
    host.addEventListener('click',tipHide);
    window.addEventListener('scroll',tipHide,true);
})();
$('co-out').addEventListener('click',e=>{
    const b=e.target.closest('button[data-act]');
    if(b){ const sales=b.dataset.kind==='sales';
        const set=sales?_salSel:_offSel;
        const rows=(sales?_sales:_offers).slice(0,SHOW_N);
        set.clear();
        if(b.dataset.act==='none') rows.forEach((o,i)=>set.add(i));
        else if(b.dataset.act==='gold') rows.forEach((o,i)=>{ if(!o.gold) set.add(i); });
        else if(b.dataset.act==='raw')  rows.forEach((o,i)=>{ if(o.grade) set.add(i); });
        else if(b.dataset.act==='slab') rows.forEach((o,i)=>{ if(!o.grade) set.add(i); });
        else if(b.dataset.act==='us')   rows.forEach((o,i)=>{ if(!isUS(o.loc)) set.add(i); });
        renderOffers(); return; }
    const r=e.target.closest('.co-row'); if(!r) return;
    /* The switch is the switch; the row is the listing. Toggling used to be the only thing a row
       did, which meant the one obvious gesture — clicking the thing you want to look at — took
       it out of the maths instead of showing it to you. */
    if(e.target.closest('.tick')){
        const set=r.dataset.kind==='sales'?_salSel:_offSel;
        const i=+r.dataset.i; if(set.has(i)) set.delete(i); else set.add(i);
        renderOffers();
        return;
    }
    if(r.dataset.link){ try{ window.open(r.dataset.link,'_blank','noopener'); }catch(_){} }
});
// The sales table under "Latest Sales" / "Filter Sales":
//    7/29/26 · NM Holofoil · Near Mint Holofoil · 1  $109.98
function parseSales(text){
    const all=String(text||'').split(/\r?\n/).map(x=>x.trim());
    let from=0;
    for(let i=0;i<all.length;i++) if(/^(latest sales|filter sales)$/i.test(all[i])){ from=i+1; break; }
    const L=all.slice(from);
    const out=[]; let date='', cond='';
    for(let i=0;i<L.length;i++){
        const x=L[i]; if(!x) continue;
        if(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(x)){ date=x; cond=''; continue; }
        if(/^(Near Mint|Lightly Played|Moderately Played|Heavily Played|Damaged|Unopened)\b/i.test(x)){ cond=x; continue; }
        if(/^(NM|LP|MP|HP|DMG)\b/i.test(x) && x.length<40){ if(!cond) cond=x; continue; }
        const m=x.match(/^(\d+)\s+\$\s?([\d,]+\.\d{2})$/) || x.match(/^\$\s?([\d,]+\.\d{2})$/);
        if(m){
            const qty=m.length===3?parseInt(m[1],10):1;
            const price=parseFloat((m.length===3?m[2]:m[1]).replace(/,/g,''));
            if(date) out.push({ price, ship:0, total:price, qty, date, condition:cond });
            cond='';
        }
    }
    return out;
}
// Both boxes accept either dump. A completed-listings page carries a "Sold <date>" on its rows
// and an active one never does, so the paste is filed by what it contains rather than by which
// box it landed in — paste the two tabs in whichever order, and they still land correctly.
let _ebayLive=[], _ebayDone=[];
// Whether the two pastes have been read into a sheet yet. Having them is not the same as it.
var _ebayBuilt = false;
// Says what each paste turned out to be, so it is obvious the boxes are not fixed to one kind.
// Two pastes of the same page produce the same rows. Comparing a cheap fingerprint catches it,
// which matters because both would be filed to the same bucket and the second would look like
// it did nothing at all.
function pasteFp(rows){
    return rows.length+':'+rows.slice(0,6)
        .map(o=>o.total.toFixed(2)+'|'+String(o.title||'').slice(0,28)).join(',');
}
function pasteStatus(){
    const el=document.getElementById('paste-status'); if(!el) return;
    const bits=[];
    if(_ebayLive.length) bits.push('<b>'+_ebayLive.length+'</b> Buy It Now \u2192 Offers');
    if(_ebayDone.length) bits.push('<b>'+_ebayDone.length+'</b> sold \u2192 Latest sales');
    if(_ebayWait) bits.push('<span style="opacity:0.75">still waiting on the '
        +(_ebayWait==='sales'?'Sold':'Buy It Now')+' page</span>');
    el.innerHTML = bits.length ? ('\u2713 '+bits.join('  \u00b7  ')) : '';
    el.style.color = bits.length ? 'var(--accent)' : 'var(--dim)';
}
function handlePaste(text, html){
    const offers=parseOffers(text, html);
    let sales=parseSales(text);

    if(isEbayText(text) && offers.length){
        const sold=offers.filter(o=>o.sold);
        const isSoldDump = sold.length >= Math.ceil(offers.length/2);
        const fp=pasteFp(offers);
        const mine = isSoldDump ? _ebayDone : _ebayLive;

        if(mine.length && pasteFp(mine)===fp){
            toast('That is the same page again — nothing changed. The other box needs the '
                + (isSoldDump?'Buy It Now':'Sold') + ' page.');
            return;
        }
        if(isSoldDump) _ebayDone=offers; else _ebayLive=offers;
        // Hold off on declaring the other panel empty until its page has actually been pasted.
        _ebayWait = _ebayLive.length && !_ebayDone.length ? 'sales'
                  : _ebayDone.length && !_ebayLive.length ? 'offers' : null;

        /* Nothing is drawn yet. Pasting the first page used to redraw the sheet against half
           the data, which read as a finished answer while the other half was still on the
           clipboard. The sheet is built when it is asked for, in one go. */
        pasteStatus();
        ebaySteps();
        toast('Read as '+(isSoldDump?'SOLD':'BUY IT NOW')+' \u2014 '+offers.length+' listing'+(offers.length===1?'':'s'));
        return;
    }

    renderOffers(offers.length?offers:_offers, sales, _meta);
    toast((offers.length? offers.length+' offers' : '') + (sales.length? (offers.length?' \u00b7 ':'')+sales.length+' sales' : '') || 'Nothing found');
}
/* Nothing is read as it lands. Pasting one page used to parse it on the spot, which meant the
   step was quietly finished before the second box had been touched, and there was no moment
   where somebody said "yes, these two".

   The markup is kept because it is the only place the item links exist — the clipboard carries
   it, the textarea does not — and it is read again when Parse is pressed. */
['co-paste','co-paste2'].forEach(id=>{
    const el=$(id); if(!el) return;
    el.addEventListener('paste',e=>{
        const dt=e.clipboardData; if(!dt) return;
        el._html = dt.getData('text/html') || '';
        el._pasted = true;                      // the input event right behind this one is ours
        setTimeout(ebSyncParse, 0);
    });
    el.addEventListener('input',()=>{
        if(el._pasted) el._pasted = false; else el._html = '';
        ebSyncParse();
    });
});
function ebText(id){ const el=$(id); return el ? String(el.value || '').trim() : ''; }
/* Two boxes, two different pages. The same page in both is the mistake this catches: they look
   alike enough at a glance, and one of them read twice is half the data reported as all of it. */
function ebParseWhy(){
    const a = ebText('co-paste'), b = ebText('co-paste2');
    if(!a && !b) return 'Paste both pages in first.';
    if(!a) return 'The Buy It Now page is still missing.';
    if(!b) return 'The Sold page is still missing.';
    if(a === b) return 'Both boxes have the same page in them.';
    return '';
}
function ebSyncParse(){
    const btn = $('eb-parse'); if(!btn) return;
    const why = ebParseWhy();
    btn.disabled = !!why;
    btn.title = why || 'Read both pages';
}
function ebParse(){
    const why = ebParseWhy();
    if(why){ toast(why, true); return; }
    // A fresh read of what is in the boxes now, not an accumulation of everything ever pasted.
    _ebayLive = []; _ebayDone = []; _ebayBuilt = false;
    const a = $('co-paste'), b = $('co-paste2');
    handlePaste(a.value, a._html || '');
    handlePaste(b.value, b._html || '');
    if(!ebayBoth()){
        toast('Those did not read as one Buy It Now page and one Sold page.', true);
        return;
    }
    ebPre();
    toast('Read ' + _ebayLive.length + ' on sale and ' + _ebayDone.length + ' sold');
    if(document.body.classList.contains('wiz')) wizGo(5);
}

// Grab whatever card the address bar is pointing at. A TCGplayer product URL carries its
// id, so this pulls that exact printing rather than guessing from the search text.
function productIdFromUrl(u){ const m=String(u||'').match(/tcgplayer\.com\/product\/(\d+)/i); return m?m[1]:''; }
function showPasteFallback(msg){
    /* Only eBay has a page worth pasting. TCGplayer's figures come from the API now, so offering
       a paste box there tells somebody their working tool is broken and asks them to do a job
       that would not help. */
    if(state.src!=='ebay'){
        const out=$('co-out');
        if(out) out.innerHTML='<div class="empty" style="padding:18px 10px">'
            +'<div class="t" style="font-size:0.78rem">Nothing came back for that card</div>'
            +'<div class="s">'+esc(msg||'TCGplayer returned no figures for it.')
            +'<br>Try the other language, or use <b>Manual search</b> under the printings list '
            +'to load it by its link.</div></div>';
        return;
    }
    const t=$('co-paste'); t.style.display=''; t.placeholder=msg||'Automatic grab didn’t work — paste the copied page here instead.';
    t.focus();
}
// One place decides what the button says, so a reset cannot put the wrong word back on it.
function grabLabel(){ return state.src==='tcgplayer' ? '⤓ Save to database'
                                                    : '⤓ Grab this card’s pricing'; }
async function grabPage(){
    if(state.src!=='tcgplayer'){ showEbayNote(); return; }
    const b=$('grab-page'); const pid=productIdFromUrl($('ub-input').value || curUrl);
    b.disabled=true; b.textContent='⏳ Grabbing…';
    let d={};
    try{
        const p=new URLSearchParams();
        if(pid) p.set('productId', pid);
        else { const f=fields(); if(!f.name && !f.code){ b.disabled=false; b.textContent=grabLabel();
                   toast('Type a card above first'); return; }
               p.set('name', f.name||queryString()); if(f.code) p.set('number', f.code); }
        p.set('jp', state.lang || 'both');        // whichever side of the catalogue is wanted
        if((state.conds||[]).length) p.set('conditions', state.conds.join('|'));
        d=await getJSON('/api/tcg?'+p.toString());
    }catch(e){ d={ error:String(e.message||e) }; }
    b.disabled=false; b.textContent=grabLabel();
    if(d.error || !((d.listings||[]).length || (d.sales||[]).length)){
        toast(d.error ? String(d.error).slice(0,60) : 'Nothing came back for that page');
        showPasteFallback(d.error ? String(d.error) : 'Nothing came back for that one.');
        return;
    }
    applyTcg(d);
    toast((d.listings||[]).length+' listings · '+((d.sales||[]).length)+' sales');
}
/* The button used to scrape the framed page, because that was the only way to get at what the
   frame was showing. There is no frame now and the figures come from the API, so it saves what
   has already been pulled instead. */
$('grab-page').addEventListener('click',()=>{
    saveCardData();
});

// Other printings that matched, offered here so you pick one from our side rather than
// clicking around inside the frame (which we can't follow — the browser never reports it).
let _alts=[], _altId='', _altLang='';
function renderAlts(){
    const over=$('alt-over'), host=$('ao-list'); if(!over||!host) return;
    host.innerHTML='';
    const again=$('alt-again');
    // Once there is a list, there is a way back to it.
    if(again) again.style.display = _alts.length>1 ? '' : 'none';
    // Even with nothing to choose between, the way out below it is worth reaching.
    if(again) again.style.display='';
    if(_alts.length<2 && !_alts.length){ over.classList.remove('on'); }
    if(_alts.length<2){ return; }
    /* Japanese printings come back in the same list as the English ones, and for a popular card
       that is two of everything. The filter is over the list already fetched — nothing is asked
       for again to narrow it. */
    const shown=_alts.filter(a=>!_altLang || (a.lang||'EN')===_altLang);
    const langs=new Set(_alts.map(a=>a.lang||'EN'));
    const bar=$('alt-over').querySelector('.ao-lang');
    if(bar){
        bar.style.display = langs.size>1 ? '' : 'none';
        Array.prototype.forEach.call(bar.children, b=>
            b.classList.toggle('on', (b.getAttribute('data-lang')||'')===_altLang));
    }
    const msg=$('ao-msg');
    if(msg) msg.textContent = shown.length
        ? 'Pick the one you meant — the prices below follow it.'
        : 'None in that language. Try All.';
    shown.forEach(a=>{ const b=document.createElement('button');
        b.className='alt'+(String(a.productId)===String(_altId)?' on':'');
        /* The picture is the fastest way to tell two printings apart — a number and a set name
           are the same shape for both, and the artwork never is. Built from the product id, so
           it costs no extra call and cannot go missing while the product exists. */
        b.innerHTML=(a.image?('<img class="ai" loading="lazy" referrerpolicy="no-referrer" alt="" src="'+esc(a.image)+'">'):'<span class="ai np"></span>')
            +'<span class="an">'+esc(a.number||'—')+'</span><span class="as">'+esc(a.set||'')+'</span>'
            +((a.lang==='JP')?'<span class="lg jp">JP</span>':'<span class="lg">EN</span>')
            +(a.market?('<span class="am">$'+Number(a.market).toFixed(2)+'</span>'):'');
        b.title=a.name;
        // A picture that will not load leaves the row tidy rather than a broken frame.
        const im=b.querySelector('img.ai');
        if(im) im.addEventListener('error',()=>{ im.className='ai np'; im.removeAttribute('src'); });
        b.addEventListener('click',()=>{ over.classList.remove('on'); loadProduct(a.productId, a.url); });
        host.appendChild(b); });
    over.classList.add('on');
}
$('ao-x').addEventListener('click',()=>$('alt-over').classList.remove('on'));
$('alt-again').addEventListener('click',()=>{
    if(_alts.length>1) $('alt-over').classList.add('on');
});
/* When the search cannot find it. A name is a guess and their catalogue is full of printings a
   name search will not surface; the address of the card you are looking at is not a guess. */
function loadPasted(){
    const raw=$('ao-url').value.trim();
    const note=$('ao-pnote');
    // A whole address, or just the number out of one — both are things people actually paste.
    const pid=productIdFromUrl(raw) || (/^\d{3,}$/.test(raw) ? raw : '');
    if(!pid){
        note.className='ao-note bad';
        note.textContent='That is not a TCGplayer product link. It looks like '
                       + 'tcgplayer.com/product/587891/…';
        return;
    }
    note.className='ao-note';
    note.textContent='Loading '+pid+'\u2026';
    $('alt-over').classList.remove('on');
    loadProduct(pid, 'https://www.tcgplayer.com/product/'+pid);
}
$('ao-load').addEventListener('click',loadPasted);
$('ao-url').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); loadPasted(); } });
Array.prototype.forEach.call($('alt-over').querySelectorAll('.ao-lang button'), b=>{
    b.addEventListener('click',()=>{ _altLang=b.getAttribute('data-lang')||''; renderAlts(); });
});
$('alt-over').addEventListener('mousedown',e=>{ if(e.target===$('alt-over')) $('alt-over').classList.remove('on'); });
async function loadProduct(pid, url){
    _altId=pid; renderAlts();
    if(url){
        setUrl(url);
        /* Picking one loads its prices here and opens nothing. Going to TCGplayer is what the
           Tab button beside the address is for, and doing it on every pick made choosing between
           printings cost a tab each time. */
        if(NO_FRAME[state.src]){
            loadEmbed();
        } else {
            const f=$('site-frame'); frameMsg(false); try{ f.src=url; }catch(_){}
        }
    }
    /* Whichever way a card was picked — a row in the list, a pasted link, a match from the
       scanner — the list it was picked from has served its purpose. Closed here rather than at
       each of those, so a new way in cannot arrive without one. */
    const over=$('alt-over'); if(over) over.classList.remove('on');
    const p=new URLSearchParams(); p.set('productId', String(pid));
    if((state.conds||[]).length) p.set('conditions', state.conds.join('|'));
    let d={}; try{ d=await getJSON('/api/tcg?'+p.toString()); }catch(e){ d={ error:String(e.message||e) }; }
    if(d.error){ toast(String(d.error).slice(0,60)); return; }
    applyTcg(d, true);
    toast((d.listings||[]).length+' listings · '+((d.sales||[]).length)+' sales');
}
function showEbayNote(){
    const out=$('co-out'); if(!out) return;
    out.innerHTML='<div class="empty" style="padding:20px 10px">'
      +'<div class="t" style="font-size:0.78rem">Browsing eBay sold listings</div>'
      +'<div class="s">Sold prices are shown in the page on the left, newest first.<br>'
      +'Switch to <b>TCGplayer</b> for the automatic price table, or paste the page below to total it up.</div></div>';
    const ph='Paste either eBay page here — Buy It Now or Sold. Which one it is, is worked out from the page itself.';
    const t=$('co-paste'); if(t) t.placeholder=ph;
    const t2=$('co-paste2'); if(t2) t2.placeholder=ph;
}
function applyTcg(d, keepAlts){
    const got=(d.listings||[]).map(l=>({ price:l.price, ship:l.ship, total:l.total, gold:l.gold,
        seller:l.seller, condition:l.condition, text:l.seller }));
    /* The id, the picture and the link travel with it now — the sheet needs to be able to
       show a card and open it later, and the summary panel was the only thing that ever
       read this. */
    const m = d.product ? { name:d.product.name, set:d.product.set, market:d.product.market,
                            total:d.total, number:d.product.number||'',
                            /* The catalogue knows more than the price. Carried through so a
                               saved card can say what it is, not only what it costs. */
                            setCode:d.product.setCode||'', rarity:d.product.rarity||'',
                            kind:d.product.kind||'',
                            productId:d.productId||'', url:d.url||'',
                            image:d.productId ? ('https://tcgplayer-cdn.tcgplayer.com/product/'
                                    +d.productId+'_in_200x200.jpg') : '' } : null;
    const sales=(d.sales||[]).map(x=>({ price:x.price, ship:x.ship, total:x.total, qty:x.qty, condition:x.condition, date:x.date }));
    /* When several printings matched, the search has not answered the question yet — it has
       narrowed it. Drawing the first one's figures while the list of printings was still on its
       way put a finished-looking sheet on screen for a card nobody had chosen, and the numbers
       changed under you a moment later. The list goes up first; the sheet waits to be told which
       card it is about. */
    const many = !keepAlts && (d.alts || []).length > 1;
    if(many) renderOffers([], [], {});
    else renderOffers(got, sales, m);
    if(!keepAlts){ _alts=(d.alts||[]); _altId = many ? '' : (d.productId||''); renderAlts(); }
    if(d.url && !productIdFromUrl($('ub-input').value)) setUrl(d.url);
    $('co-paste').style.display='none';
    { const p2=$('co-paste2'); if(p2) p2.style.display='none'; }                 // the automatic path worked; hide the fallback
}

// Live listings arrive on their own when you search — nothing to press.
async function grabAll(){
    if(state.src!=='tcgplayer'){ showEbayNote(); return; }     // TCGplayer-only data path
    const f=fields();
    if(!f.name && !f.code) return;
    let d={};
    try{ const p=new URLSearchParams(); p.set('name', f.name||queryString());
         if(f.code) p.set('number', f.code);
         p.set('jp', state.lang || 'both');       // the same choice on this path
         if((state.conds||[]).length) p.set('conditions', state.conds.join('|'));
         d=await getJSON('/api/tcg?'+p.toString()); }
    catch(e){ d={ error:String(e.message||e) }; }
    if(d.error){ toast(String(d.error).slice(0,70)); showPasteFallback(String(d.error)); return; }
    applyTcg(d);
    /* A Japanese printing routinely comes back with sales and no live listings — that is what
       TCGplayer holds for that line, not a failure to read it. Saying so beats an empty panel
       that looks like something went wrong. */
    const nl=(d.listings||[]).length, ns=(d.sales||[]).length;
    // With a list up, the count that matters is how many printings there are to choose between.
    if((d.alts || []).length > 1){
        toast((d.alts.length) + ' printings matched \u2014 pick the one you meant');
        return;
    }
    toast(nl||ns ? (nl+' listings · '+ns+' recent sales'
                    + (!nl && ns ? ' · none on sale right now' : ''))
                 : 'No figures for that one');
}



// ── Viewport: fullscreen · display scale · mobile lock ──────────────────────
(function lockViewport(){ const stop=e=>e.preventDefault();
    ['gesturestart','gesturechange','gestureend'].forEach(ev=>document.addEventListener(ev,stop,{passive:false}));
    document.addEventListener('touchmove',e=>{ if(e.touches&&e.touches.length>1) e.preventDefault(); },{passive:false}); })();








load(); buildSwatches(); applyTheme(); buildConds();
if(window.SB_POKEAC) SB_POKEAC.attach($('f-q'));   // Pokémon names, Gen 1–9
document.querySelectorAll('#src-seg button').forEach(b=>b.classList.toggle('on', b.dataset.src===state.src));
document.querySelectorAll('#lang-seg button').forEach(b=>b.classList.toggle('on', b.dataset.lang===(state.lang||'both')));
_altLang = state.lang==='en' ? 'EN' : state.lang==='jp' ? 'JP' : '';
syncSrcUI();
if(state.last && state.last.raw) $('f-q').value=state.last.raw;

window.__pl = { state, doSearch, loadEmbed, grabAll, srcUrl, fields, applyTheme, parseOffers, handlePaste, save, load };

/* ── the sheet ────────────────────────────────────────────────────────────────
   A running list of the cards looked up, in the shape a stock sheet wants: what it is, what the
   market says, what you will pay, and what it eventually sold for. That last one is left empty
   and stays empty — it is the only figure nothing here can know, and guessing at it would make
   the other two untrustworthy by association.

   Kept on the device. It is a working note between a lookup and a spreadsheet, not a record. */
const LG_KEY = 'ptcg-price-ledger';
let ledger = [], lgOpen = '';
// Whether the sheet has been drawn once already this visit.
let lgDealt = false;
// Which view is up. Excluded rows are still in the sheet; they are simply not in front of you.
let lgView = 'active';
function lgLoad(){
    try{ ledger = JSON.parse(localStorage.getItem(LG_KEY) || '[]') || []; }catch(_){ ledger = []; }
    if(!Array.isArray(ledger)) ledger = [];
}
function lgSave(){
    try{ localStorage.setItem(LG_KEY, JSON.stringify(ledger.slice(0, 400))); }catch(_){}
    // A live sheet is one that follows this one, so every save here is a save there.
    if(typeof dbPush === 'function') dbPush();
    // And the count on the other tab, for the screen that only shows one of them at a time.
    if(typeof swapCount === 'function') swapCount();
}
const money = n => (n == null || !isFinite(n)) ? '' : '$' + Number(n).toFixed(2);

/* Everything worth offering as "the market price", worked out once from what the lookup pulled.
   Listings are what it is on sale for; sales are what it actually went for — both are offered
   rather than one being chosen on your behalf. */
function lgFigures(offers, sales){
    const nums = l => (l || []).map(o => +o.total).filter(n => isFinite(n) && n > 0).sort((a,b)=>a-b);
    const mid  = a => !a.length ? null
                    : (a.length % 2 ? a[(a.length-1)/2] : (a[a.length/2-1] + a[a.length/2]) / 2);
    const mean = a => !a.length ? null : a.reduce((x,y)=>x+y,0) / a.length;
    const lo = nums(offers), sa = nums(sales);
    const out = [];
    // Ours goes first, because it is the one that answers the question being asked.
    const fv = fairValue(lo, sa);
    if(fv != null) out.push({ k:'Fair market (A9)', v:fv,
                              note:(lo.length + sa.length) + ' figures' });
    if(lo.length){
        out.push({ k:'Lowest listing', v:lo[0], note:'of ' + lo.length });
        out.push({ k:'Listing median', v:mid(lo), note:'of ' + lo.length });
        out.push({ k:'Listing average', v:mean(lo), note:'of ' + lo.length });
    }
    if(sa.length){
        out.push({ k:'Highest recent sold', v:sa[sa.length-1] === undefined ? null : Math.max.apply(null, sa),
                   note:'of ' + sa.length });
        out.push({ k:'Lowest recent sold', v:Math.min.apply(null, sa), note:'of ' + sa.length });
        out.push({ k:'Sales median', v:mid(sa), note:'of ' + sa.length });
        out.push({ k:'Sales average', v:mean(sa), note:'of ' + sa.length });
        out.push({ k:'Last sale', v:sa[sa.length-1], note:'' });
    }
    return { picks: out.filter(x => x.v != null), listings: lo, sales: sa };
}
// The percentages a counter actually offers, plus whatever you type.
/* Every five points up to ninety. A counter's rate is a number somebody has already decided;
   this is a list to find it in, not a suggestion. */
const BUYBACK = [];
for(let q = 30; q <= 90; q += 5) BUYBACK.push(q / 100);

/* Everything it took to find this card, kept with the card. A product id is enough on the
   TCGplayer side; on eBay there is no id at all — the result is a search, so what has to survive
   is the words that were typed into the form. Without this an eBay row is a name and a price
   with no way back to what produced it. */
function howNow(){
    const how = { src: state.src, lang: state.lang || 'both', query: queryString(), at: Date.now() };
    if(state.src === 'ebay'){
        how.set = state.ebaySet || '';
        how.num = state.ebayNum || '';
        how.rare = state.ebayRare || 'none';
        how.search = ebayQuery();
        how.bin = ebayUrl(false);
        how.sold = ebayUrl(true);
    } else {
        how.conds = (state.conds || []).slice();
    }
    return how;
}
function saveCardData(){
    const isEbay = state.src === 'ebay';
    /* eBay used to be turned away here, which left the five steps ending on a button that
       explained why it would not do the thing it was labelled with. */
    if(isEbay && !_ebayBuilt){ toast('Build the price sheet first.', true); return; }
    const m = (!isEbay && _meta) ? _meta : {};
    const name = m.name || queryString();
    if(!name){ toast('Look a card up first.', true); return; }
    const fig = lgFigures(_offers, _sales);
    const row = {
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
        pid: m.productId || _altId || '',
        name: name, set: m.set || '', num: m.number || '',
        image: m.image || (m.productId ? ('https://tcgplayer-cdn.tcgplayer.com/product/'
                + m.productId + '_in_200x200.jpg') : ''),
        url: m.url || (m.productId ? ('https://www.tcgplayer.com/product/' + m.productId)
                                   : (isEbay ? ebayUrl(true) : '')),
        // Which marketplace produced these numbers, kept with them rather than assumed later.
        from: isEbay ? 'eBay' : 'TCGplayer',
        lang: (state.lang || 'both').toUpperCase(),
        // The rest of what the catalogue knew about it, rather than only what it costs.
        code: m.setCode || '',
        rarity: m.rarity || '',
        kind: m.kind || ((m.number || (isEbay && state.ebayNum)) ? 'single' : 'sealed'),
        how: howNow(),
        // What was on screen when it was saved, so opening the row later still has something
        // to offer rather than an empty panel.
        listings: fig.listings, sales: fig.sales,
        /* Sorted arrays lose which sale was the most recent, and that is the one figure people
           look for first. The dated originals are kept alongside them. */
        salesAt: (_sales||[]).map(x => ({ v:+x.total, at:x.date || '' }))
                             .filter(x => isFinite(x.v) && x.v > 0),
        /* The full rows, not only their totals. A condition, a seller and a gold star are what
           make one listing different from another at the same price, and a saved card that kept
           only the figures could never show why one was worth picking. */
        loFull: (_offers||[]).slice(0, 60).map(o => Object.assign({}, o)),
        saFull: (_sales||[]).slice(0, 60).map(o => Object.assign({}, o)),
        // picks[0] is the fair figure when there is one, so a saved card starts at what the
        // model says rather than at whichever listing happened to be cheapest.
        market: fig.picks.length ? +fig.picks[0].v.toFixed(2) : null,
        marketFrom: fig.picks.length ? fig.picks[0].k : '',
        buy: null, buyFrom: '',
        sale: null,                       // yours to fill in elsewhere; nothing here writes it
        at: Date.now()
    };
    ledger.unshift(row);
    lgSave(); lgPaint();
    // A scanned card that has reached the sheet is ticked off in the conversation it came from.
    if(typeof scMarkSaved === 'function') scMarkSaved();
    toast(name + ' added to database!', { top:true, ms:1000 });
}

/* Our own question rather than the browser's. window.confirm names itself after the site, cannot
   be worded in our own voice, and on a warning about our own pricing model that matters. */
let lgAskDone = null;
function lgAsk(o){
    return new Promise(res => {
        $('lg-ask-h').textContent = o.title || 'Are you sure?';
        $('lg-ask-h').className = 'h' + (o.danger ? ' bad' : '');
        $('lg-ask-b').innerHTML = o.body || '';
        $('lg-ask-yes').textContent = o.yes || 'Confirm';
        $('lg-ask-yes').className = 'go' + (o.danger ? ' bad' : '');
        $('lg-ask').classList.add('on');
        lgAskDone = v => { $('lg-ask').classList.remove('on'); lgAskDone = null; res(!!v); };
    });
}
$('lg-ask-yes').addEventListener('click', () => { if(lgAskDone) lgAskDone(true); });
$('lg-ask-no').addEventListener('click', () => { if(lgAskDone) lgAskDone(false); });
$('lg-ask').addEventListener('mousedown', e => {
    if(e.target === $('lg-ask') && lgAskDone) lgAskDone(false);
});
/* ── what each way of pricing actually costs ──────────────────────────────────
   Four ways of answering "what is this worth" produce four different totals, and the difference
   between them across a pile is usually larger than anybody expects. Rather than describe that,
   it is worked out on the cards actually in hand and drawn.

   Two questions are asked of each, because they are not the same question:

     selling  — a higher figure is a bigger asking price, so the tallest bar is the most
                optimistic and the one most likely to sit unsold
     buying   — the buy price is a percentage of whatever market is set to, so a higher market
                means paying more for the same card, and the shortest bar is the safest

   The model sits between them on purpose. It is not the best answer to either question; it is
   the one that is not badly wrong about either. */
function decideModels(rows){
    const of = (r, how) => {
        const lo = (r.listings || []), sa = (r.sales || []);
        if(how === 'fair') return fairValue(lo, sa);
        if(how === 'low')  return lo.length ? Math.min.apply(null, lo) : null;
        if(how === 'soldhi') return sa.length ? Math.max.apply(null, sa) : null;
        return sa.length ? Math.min.apply(null, sa) : null;
    };
    const defs = [
        ['fair',   'Fair market (A9)', 'the middle of both sides, weighted to what sold'],
        ['low',    'Lowest available', 'the cheapest thing on sale right now'],
        ['sold',   'Lowest sold',      'the cheapest of what actually sold'],
        ['soldhi', 'Highest sold',     'the dearest of what actually sold'],
    ];
    return defs.map(([k, name, note]) => {
        let total = 0, have = 0;
        rows.forEach(r => {
            const v = of(r, k);
            if(v != null && isFinite(v)){ total += v; have++; }
        });
        return { k, name, note, total, have };
    });
}
function showDecide(){
    const rows = lgRows();
    if(!rows.length){ toast('Nothing to compare.', true); return; }
    const models = decideModels(rows).filter(m => m.have);
    if(!models.length){ toast('No figures to compare yet.', true); return; }
    const top = Math.max.apply(null, models.map(m => m.total)) || 1;
    const fair = models.find(m => m.k === 'fair');
    const best = models.slice().sort((a, b) => b.total - a.total)[0];
    const safe = models.slice().sort((a, b) => a.total - b.total)[0];
    const buyPct = 60;

    const bar = (m) => {
        const w = Math.max(2, Math.round(m.total / top * 100));
        const vs = fair && m.k !== 'fair' && fair.total
            ? ((m.total - fair.total) / fair.total * 100) : null;
        return '<div class="dc-row' + (m.k === 'fair' ? ' me' : '') + '">'
            + '<div class="dc-n">' + esc(m.name)
            + (m.have < rows.length ? '<i>' + m.have + ' of ' + rows.length + '</i>' : '')
            + '</div>'
            + '<div class="dc-t"><i style="width:' + w + '%"></i></div>'
            + '<div class="dc-v">' + money(m.total)
            + (vs == null ? '' : '<b class="' + (vs >= 0 ? 'up' : 'dn') + '">'
                + (vs >= 0 ? '+' : '') + vs.toFixed(0) + '%</b>')
            + '</div></div>';
    };

    lgAsk({
        title: 'Help me decide',
        yes: 'Close',
        body: '<div class="dc">'
            + '<div class="dc-h">Across <b>' + rows.length + '</b> card'
            + (rows.length === 1 ? '' : 's') + ', what each way of pricing comes to:</div>'
            + models.map(bar).join('')
            + '<div class="dc-s"><b>Selling.</b> '
            + esc(best.name) + ' asks the most — ' + money(best.total)
            + ' — and is the most likely to sit unsold. '
            + (fair ? 'The model is ' + money(fair.total) + '.' : '') + '</div>'
            + '<div class="dc-s"><b>Buying.</b> A buyback is a percentage of whatever market is '
            + 'set to, so a higher market means paying more for the same card. At ' + buyPct
            + '%, ' + esc(safe.name) + ' costs you ' + money(safe.total * buyPct / 100)
            + (fair ? ' against ' + money(fair.total * buyPct / 100) + ' on the model' : '')
            + ' — the shortest bar is the safest place to buy.</div>'
            + '<div class="dc-s dim">The model is deliberately neither extreme. It is not the '
            + 'best answer to either question; it is the one that is not badly wrong about '
            + 'either.</div>'
            + '</div>'
    });
}
/* A buy price set as a percentage is a *rule*, not a number: it means "sixty per cent of
   whatever this is worth". Storing only the answer meant changing how market was calculated left
   the buy column showing sixty per cent of a figure that no longer existed. The rate is kept, and
   the answer is worked out again whenever the market it depends on moves. */
function reprice(r){
    if(r.buyPct == null) return;
    if(r.market == null || !isFinite(r.market)){ r.buy = null; return; }
    r.buy = +(r.market * (r.buyPct / 100)).toFixed(2);
    r.buyFrom = r.buyPct + '% of market';
}
function lgPaint(){
    const host = $('lg-rows'); if(!host) return;
    host.innerHTML = '';
    const hidden = ledger.filter(r => r.out);
    const shown = ledger.filter(r => lgView === 'out' ? r.out : !r.out);
    $('lg-n').textContent = String(shown.length);
    $('lg-empty').style.display = shown.length ? 'none' : '';
    if(!shown.length) $('lg-empty').innerHTML = lgView === 'out'
        ? 'Nothing is set aside.'
        : 'Nothing saved yet. Look a card up, then press <b>Save card data</b> to put it here.';
    const tab = $('lg-tab');
    if(tab){
        tab.hidden = !hidden.length && lgView !== 'out';
        tab.classList.toggle('on', lgView === 'out');
        $('lg-tabn').textContent = String(hidden.length);
    }
    /* Only the first time. Every expand and collapse redraws the whole sheet, and rows that
       re-deal themselves on each one stop reading as arrival and start reading as a flicker.
       Capped as well, so a long sheet does not spend two seconds dealing itself out. */
    const dealt = lgDealt; lgDealt = true;
    let land = 0;
    shown.forEach(r => {
        const row = document.createElement('div');
        row.className = 'lg-row' + (dealt ? '' : ' land');
        row.dataset.rid = r.id;
        if(!dealt) row.style.setProperty('--i', String(Math.min(land++, 22)));
        row.className += (lgPick.has(r.id) ? ' pick' : '');
        row.innerHTML = '<span class="c-k"><input type="checkbox"' + (lgPick.has(r.id) ? ' checked' : '') + '></span>'
            + '<span class="c-nm">' + (r.image
                ? '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + esc(r.image) + '">' : '')
              + '<span></span></span>'
            + '<span class="c-st"></span>'
            + '<span class="adv c-code">' + esc(codeOf(r)) + '</span>'
            + '<span class="adv c-lang">' + esc(r.lang || '\u2014') + '</span>'
            + '<span class="adv c-cat ' + kindOf(r) + '">' + kindOf(r).toUpperCase() + '</span>'
            + '<span class="c-n mk"></span><span class="c-n by"></span>'
            + '<span class="c-n em">\u2014</span>' + trendCell(r)
            + '<span class="c-sr"></span><span class="c-x"></span>';
        /* The address it came from, not just the name of the site. Six months later "TCGplayer"
           is not enough to check a figure against; the exact product is. */
        const src = row.querySelector('.c-sr');
        if(r.url){
            const a = document.createElement('a');
            a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
            a.textContent = r.from || 'TCGplayer';
            a.title = r.url;
            a.addEventListener('click', ev => ev.stopPropagation());
            src.appendChild(a);
        } else {
            const n = document.createElement('span');
            n.className = 'none'; n.textContent = r.from || '—';
            src.appendChild(n);
        }
        row.querySelector('.c-nm span').textContent = r.name + (r.num ? '  #' + r.num : '');
        row.querySelector('.c-st').textContent = r.set || '';
        row.querySelector('.c-n.mk').textContent = money(r.market) || '—';
        row.querySelector('.c-n.by').textContent = money(r.buy) || '—';
        if(!r.market) row.querySelector('.c-n.mk').classList.add('em');
        if(!r.buy) row.querySelector('.c-n.by').classList.add('em');
        // The tick is not a click on the row: one selects, the other opens.
        row.querySelector('input').addEventListener('click', ev => {
            ev.stopPropagation();
            if(lgPick.has(r.id)) lgPick.delete(r.id); else lgPick.add(r.id);
            lgPaint();
        });
        /* No per-row cross. Deleting is one button on the bar acting on what is ticked, so
           there is one way to remove a card and one question before it happens. */
        row.addEventListener('click', () => {
            lgOpen = (lgOpen === r.id) ? '' : r.id;
            lgPaint();
        });
        host.appendChild(row);
        if(lgOpen === r.id) host.appendChild(lgOpenPanel(r));
    });
    lgTotals();
}
/* Putting a column away is a normal thing to want on a small screen, and a dangerous one while
   a row is half-edited — so it asks, rather than quietly dropping the choices made.

   Three states in a ring: both, the sheet on its own, the search on its own, and round again.
   The arrow says which way the next press goes and the title says what it will leave you with,
   because a button with three answers has to be readable before it is pressed. */
const COLS = [
    { k:'',         mark:'\u21D4', say:'Both columns \u2014 press for the sheet alone' },
    { k:'side-off', mark:'\u21E5', say:'The sheet alone \u2014 press for the search alone' },
    { k:'body-off', mark:'\u21E4', say:'The search alone \u2014 press for both' }
];
let colAt = 0;
function colSet(i){
    colAt = ((i % COLS.length) + COLS.length) % COLS.length;
    COLS.forEach((c, n) => {
        if(c.k) document.body.classList.toggle(c.k, n === colAt);
    });
    const b = $('side-btn');
    if(b){ b.textContent = COLS[colAt].mark; b.title = COLS[colAt].say; }
    try{ localStorage.setItem('ptcg-price-cols', String(colAt)); }catch(_){}
}
$('side-btn').addEventListener('click', async () => {
    const next = (colAt + 1) % COLS.length;
    // Only leaving the search behind can lose anything; the sheet keeps what is typed into it.
    if(COLS[next].k === 'side-off' && lgDirty()){
        const ok = await lgAsk({ title:'Hide the search column', danger:true,
            yes:'Hide it anyway',
            body:'You have picked prices on an open card and not pressed <b>Submit</b> yet.'
               + '<br>Hiding the column loses them.' });
        if(!ok) return;
    }
    colSet(next);
});
try{ colSet(parseInt(localStorage.getItem('ptcg-price-cols'), 10) || 0); }catch(_){ colSet(0); }
/* ── the guided search ────────────────────────────────────────────────────────
   It asks the same questions the old form asks, one at a time, and then calls exactly what the
   old form calls: doSearch for TCGplayer, loadEmbed for eBay. Nothing new happens here — the
   difference is that four controls are not all shouting at once.

   The old form is still in the page, one button away, because a new arrangement of a working
   tool should never be the only arrangement on its first day. */
/* Carried in the page rather than fetched when the step is drawn. They are small, they never
   change, and a button whose picture depends on somebody else's server staying up is a button
   that is sometimes blank. This also means the lab asks tcgplayer.com and ebay.com for nothing
   until you actually press one of them. The eBay one is their own vector logo rather than the
   raster copy that was here first — that one was a wordmark padded out to a 500x400 box, so
   what survived being scaled into a 34px strip looked fried. */
const LOGO_TCG = 'data:image/x-icon;base64,AAABAAMAMDAAAAEAIACoJQAANgAAACAgAAABACAAqBAAAN4lAAAQEAAAAQAgAGgEAACGNgAAKAAAADAAAABgAAAAAQAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9WgKgPVoCoD2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9mgJv/doCEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD3aAhA9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/1aAqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFLv/QBS7/0AUu/9AAAAAAAAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/1aAqAAAAAAAAAAAAsLO9ALCzvQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvf+AFL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8uLu+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LCzvQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABS7/0AUvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LCzvQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABS9/4AUvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn//dnB//iOR//2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LCzvQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABS9/4AUvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn////////////2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3wvwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABS+/78Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn////////////92cH/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3wvwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/////////////////+7SE//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3wvwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn///////////////////////iOR//2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFLv/QBS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn///////////////////////3Zwf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/yws70AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFL3/gBS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/7tIT////////////////////////////////////////////////////////////7tIT/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/yws70AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFL3/gBS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/4jkf/////////////////////////////////////////////////////////////////+I5H//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y4u74AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFL3/gBS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn//dnB/////////////////////////////////////////////////////////////dnB//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y0t8L8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFL7/vxS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/+I5H//////////////////////////////////////////////////////////////////u0hP/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y0t8L8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFL3//xS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//3Zwf/////////////////////////////////////////////////////////////////4jkf/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y0t8P8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFL3//xS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//iOR////////////////////////////////////////dnB//3Zwf/92cH//dnB//3Zwf/7tIT/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y0t8P8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUu/9AFL3//xS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/92cH/////////////////////////////////+I5H//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y0t8P8sLO9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvf+AFL3//xS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/4jkf//////////////////////////////////dnB//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y0t8P8sLO9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvf+AFL3//xS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn//dnB//////////////////////////////////iOR//2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y0t8P8uLu+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvf+AFL3//xS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/+I5H//////////////////////////////////3Zwf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y0t8P8tLfC/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvv+/FL3//xS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//3Zwf/////////////////////////////////4jkf/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y0t8P8tLfC/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvf//FL3//xS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//iOR//7tIT/+7SE//u0hP/7tIT/+7SE//u0hP/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y0t8P8tLfD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvv+/FL3//xS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y0t8P8tLfC/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUu/9AFL3//xS9//8Uvf//FL3//xS9//8Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3w/y0t8P8tLfD/LS3w/y0t8L8sLO9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABS7/0AUvf+AFL3/gBS+/78Uvf//FL7/vwAAAAD2aAm/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAC0t8L8tLfD/LS3wvy0t8L8uLu+ALCzvQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD1aAqA9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAm/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD1aAqA9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/3aAhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA92gIQPZoCb/2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9WgKgPVoCoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///////wAA////////AAD///////8AAP///////wAA////////AAD///////8AAP///////wAA////////AAD///////8AAP/8AAA//wAA//gAAB//AAD/GAAAGf8AAP4IAAAQfwAA/ggAABA/AAD8CAAAED8AAPwIAAAQPwAA/AgAABA/AAD8CAAAED8AAPwIAAAQPwAA/AgAABA/AAD4CAAAEB8AAPgIAAAQHwAA+AgAABAfAAD4CAAAEB8AAPgIAAAQHwAA+AgAABAfAAD4CAAAEB8AAPAIAAAQDwAA8AgAABAPAADwCAAAEA8AAPAIAAAQDwAA8AgAABAPAADwCAAAEA8AAPAIAAAQDwAA8AgAABAPAAD8CAAAED8AAP/4AAAf/wAA//gAAB//AAD//AAAP/8AAP///////wAA////////AAD///////8AAP///////wAA////////AAD///////8AAP///////wAA////////AAD///////8AACgAAAAgAAAAQAAAAAEAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD3aAhA9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9WgKgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABS7/0AAAAAAAAAAAPZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/92gIQAAAAAAsLO9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvf//FL3//xS+/7/3aAhA9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/3aAhALS3wvy0t8P8tLfD/LCzvQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFL3/gBS9//8Uvf//FL7/v/doCED2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//doCEAtLfC/LS3w/y0t8P8uLu+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvf+AFL3//xS9//8Uvv+/92gIQPZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//u0hP/7tIT/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/92gIQC0t8L8tLfD/LS3w/y0t8L8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABS+/78Uvf//FL3//xS+/7/3aAhA9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/+7SE///////2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/3aAhALS3wvy0t8P8tLfD/LS3wvwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFL3//xS9//8Uvf//FL7/v/doCED2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/7tIT///////u0hP/2aAn/9mgJ//ZoCf/2aAn/9mgJ//doCEAtLfC/LS3w/y0t8P8tLfD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvf//FL3//xS9//8Uvv+/92gIQPZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//u0hP////////////u0hP/2aAn/9mgJ//ZoCf/2aAn/92gIQC0t8L8tLfD/LS3w/y0t8P8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFLv/QBS9//8Uvf//FL3//xS+/7/3aAhA9mgJ//ZoCf/92cH///////////////////////////////////////ZoCf/2aAn/9mgJ//ZoCf/3aAhALS3wvy0t8P8tLfD/LS3w/yws70AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvf+AFL3//xS9//8Uvf//FL7/v/doCED2aAn/9mgJ//u0hP//////////////////////////////////////+7SE//ZoCf/2aAn/9mgJ//doCEAtLfC/LS3w/y0t8P8tLfD/LCzvQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABS9/4AUvf//FL3//xS9//8Uvv+/92gIQPZoCf/2aAn/9mgJ////////////////////////////////////////////+7SE//ZoCf/2aAn/92gIQC0t8L8tLfD/LS3w/y0t8P8uLu+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFL7/vxS9//8Uvf//FL3//xS+/7/3aAhA9mgJ//ZoCf/2aAn/+7SE///////////////////////92cH//dnB//3Zwf/92cH/9mgJ//ZoCf/3aAhALS3wvy0t8P8tLfD/LS3w/y0t8L8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvv+/FL3//xS9//8Uvf//FL7/v/doCED2aAn/9mgJ//ZoCf/2aAn///////////////////////u0hP/2aAn/9mgJ//ZoCf/2aAn/9mgJ//doCEAtLfC/LS3w/y0t8P8tLfD/LS3wvwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABS9//8Uvf//FL3//xS9//8Uvv+/92gIQPZoCf/2aAn/9mgJ//ZoCf/7tIT///////////////////////ZoCf/2aAn/9mgJ//ZoCf/2aAn/92gIQC0t8L8tLfD/LS3w/y0t8P8tLfD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFL3//xS9//8Uvf//FL3//xS+/7/3aAhA9mgJ//ZoCf/2aAn/9mgJ//ZoCf//////////////////////+7SE//ZoCf/2aAn/9mgJ//ZoCf/3aAhALS3wvy0t8P8tLfD/LS3w/y0t8P8sLO9AAAAAAAAAAAAAAAAAAAAAABS7/0AUvf//FL3//xS9//8Uvf//FL7/v/doCED2aAn/9mgJ//ZoCf/2aAn/9mgJ//u0hP/92cH//dnB//3Zwf/7tIT/9mgJ//ZoCf/2aAn/9mgJ//doCEAtLfC/LS3w/y0t8P8tLfD/LS3w/yws70AAAAAAAAAAAAAAAAAAAAAAFLv/QBS9//8Uvf//FL3//xS9//8Uvv+/92gIQPZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/92gIQC0t8L8tLfD/LS3w/y0t8P8tLfD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFLv/QBS9/4AUvv+/FL3//xS+/7/3aAhA9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/3aAhALS3wvy0t8L8tLfC/Li7vgCws70AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPVoCoD2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/2aAm/9mgJv/ZoCb/3aAhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////////////////////////////4AB//2AAL/4AAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/gAAAH4AAAB+AAAAfgAAAH4AAAB+AAAAfgAAADwAAAA8AAAAfgAAAH/4AB//+AAf////////////////////////////////8oAAAAEAAAACAAAAABACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPVoCoD2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/3aAhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFL3/gBS9///1aAqA9mgJ//ZoCf/2aAn/9mgJ//ZoCf/2aAn/9WgKgC0t8P8tLfC/AAAAAAAAAAAAAAAAAAAAABS9//8Uvf//9WgKgPZoCf/2aAn/+I5H//u0hP/2aAn/9mgJ//VoCoAtLfD/LS3wvwAAAAAAAAAAAAAAAAAAAAAUvf//FL3///VoCoD2aAn/9mgJ//iOR///////9mgJ//ZoCf/1aAqALS3w/y0t8P8AAAAAAAAAAAAAAAAUu/9AFL3//xS9///1aAqA+I5H//////////////////u0hP/2aAn/9WgKgC0t8P8tLfD/LCzvQAAAAAAAAAAAFLv/QBS9//8Uvf//9WgKgPZoCf//////////////////////+I5H//VoCoAtLfD/LS3w/yws70AAAAAAAAAAABS9/4AUvf//FL3///VoCoD2aAn/+7SE////////////9mgJ//ZoCf/1aAqALS3w/y0t8P8uLu+AAAAAAAAAAAAUvf+AFL3//xS9///1aAqA9mgJ//ZoCf/92cH//dnB//iOR//2aAn/9WgKgC0t8P8tLfD/LS3wvwAAAAAAAAAAFLv/QBS+/78Uvf//9WgKgPZoCf/2aAn/9mgJ//ZoCf/2aAn/9mgJ//VoCoAtLfD/LS3wvy4u74AAAAAAAAAAAAAAAAAAAAAAAAAAAPdoCED2aAn/9mgJ//ZoCf/2aAn/9mgJ//ZoCf/1aAqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//AAD//wAA//8AAPAPAADAAwAAwAMAAMADAACAAQAAgAEAAIABAACAAQAAgAEAAPAPAAD//wAA//8AAP//AAA=';
const LOGO_EBAY = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMDAgMTIwLjMyNCI+IDxwYXRoIGQ9Ik0zOC44NjYgMjYuMzA4QzE3LjcyMSAyNi4zMDguMSAzNS4yOC4xIDYyLjM0NWMwIDIxLjQ0MiAxMS44NDkgMzQuOTQ0IDM5LjMxMiAzNC45NDQgMzIuMzI3IDAgMzQuMzk5LTIxLjI5NCAzNC4zOTktMjEuMjk0SDU4LjE0N3MtMy4zNTggMTEuNDY2LTE5LjY5IDExLjQ2NmMtMTMuMzAyIDAtMjIuODctOC45ODYtMjIuODctMjEuNThINzUuNDV2LTcuOTA0YzAtMTIuNDYtNy45MS0zMS42NjktMzYuNTgzLTMxLjY2OXpNMzguMzIgMzYuNDFjMTIuNjYzIDAgMjEuMjk1IDcuNzU4IDIxLjI5NSAxOS4zODRoLTQzLjY4YzAtMTIuMzQzIDExLjI2Ni0xOS4zODQgMjIuMzg1LTE5LjM4NHoiIGZpbGw9IiNlNTMyMzgiLz4gPHBhdGggZD0iTTc1LjQzOC4xdjgzLjU5N2MwIDQuNzQ1LS4zMzkgMTEuNDA4LS4zMzkgMTEuNDA4aDE0Ljk0cy41MzYtNC43ODUuNTM2LTkuMTU5YzAgMCA3LjM4MSAxMS41NDggMjcuNDUxIDExLjU0OCAyMS4xMzUgMCAzNS40OS0xNC42NzMgMzUuNDktMzUuNjk1IDAtMTkuNTU3LTEzLjE4Ni0zNS4yODYtMzUuNDU2LTM1LjI4Ni0yMC44NTQgMC0yNy4zMzQgMTEuMjYyLTI3LjMzNCAxMS4yNjJWLjF6bTM4Ljc2NiAzNi43NTNjMTQuMzUyIDAgMjMuNDc4IDEwLjY1MiAyMy40NzggMjQuOTQ2IDAgMTUuMzI4LTEwLjU0IDI1LjM1NS0yMy4zNzUgMjUuMzU1LTE1LjMxOCAwLTIzLjU4MS0xMS45Ni0yMy41ODEtMjUuMjE5IDAtMTIuMzU0IDcuNDE0LTI1LjA4MiAyMy40NzgtMjUuMDgyeiIgZmlsbD0iIzAwNjRkMiIvPiA8cGF0aCBkPSJNMTkwLjY0NSAyNi4zMDhjLTMxLjgxMiAwLTMzLjg1MiAxNy40Mi0zMy44NTIgMjAuMjAzaDE1LjgzNHMuODMtMTAuMTcgMTYuOTI2LTEwLjE3YzEwLjQ2IDAgMTguNTY0IDQuNzg4IDE4LjU2NCAxMy45OTJ2My4yNzZoLTE4LjU2NGMtMjQuNjQ1IDAtMzcuNjc0IDcuMjEtMzcuNjc0IDIxLjg0IDAgMTQuMzk4IDEyLjAzOCAyMi4yMzMgMjguMzA3IDIyLjIzMyAyMi4xNzEgMCAyOS4zMTMtMTIuMjUxIDI5LjMxMy0xMi4yNTEgMCA0Ljg3Mi4zNzYgOS42NzQuMzc2IDkuNjc0aDE0LjA3NnMtLjU0Ni01Ljk1Mi0uNTQ2LTkuNzZWNTIuNDMxYzAtMjEuNTgtMTcuNDA3LTI2LjEyMy0zMi43Ni0yNi4xMjN6bTE3LjQ3MiAzNy4xMjl2NC4zNjhjMCA1LjY5Ny0zLjUxNSAxOS44Ni0yNC4yMTIgMTkuODYtMTEuMzMzIDAtMTYuMTkyLTUuNjU1LTE2LjE5Mi0xMi4yMTYgMC0xMS45MzUgMTYuMzY0LTEyLjAxMiA0MC40MDQtMTIuMDEyeiIgZmlsbD0iI2Y1YWYwMiIvPiA8cGF0aCBkPSJNMjE0Ljg3OSAyOS4wNDFoMTcuODEzbDI1LjU2NSA1MS4yMTggMjUuNTA3LTUxLjIxOEgyOTkuOWwtNDYuNDYgOTEuMTgzaC0xNi45MjVsMTMuNDA2LTI1LjQxOHoiIGZpbGw9IiM4NmI4MTciLz4gPC9zdmc+';
/* Zero, because it is not one of the four questions about a card — it is the question of
   whether this is about one card at all. */
let wizStep = 0;
/* eBay has one more: the two pages have to be pasted in before there is anything to build, so
   building them into a sheet is a step of its own rather than a button hiding under the boxes. */
function wizSteps(){ return state.src === 'ebay' ? 5 : 4; }
// Whether the figures on screen were reached from the conversation rather than the form.
function fromChat(){ return !!SC && !!SC.back; }
/* Which of the two jobs is on. A step number on its own says how far through something you are
   without saying through what, and the two jobs look nothing alike once you are inside them. */
function wizWhat(){
    if(document.body.classList.contains('scan')) return 'Card Scanner';
    return wizStep < 1 ? '' : 'Card Lookup';
}
function wizGo(n){ wizStep = n; wizPaint(); }
// Back to the first question with nothing carried forward.
function wizReset(){
    /* Start over in the bar above means all of it, the scan session included — the bar the
       scanner had of its own is gone, and two Start overs meaning different things was one too
       many anyway. */
    scanOff();
    if(typeof scLog === 'function' && scLog()) scLog().innerHTML = '';
    $('f-q').value = '';
    state.ebaySet = ''; state.ebayNum = ''; state.ebayRare = 'none';
    save();
    wizGo(0);
}
/* One bar across the top of the column with the way back, the way out, and where you are. It is
   drawn the same on every step so none of it moves. */
function wizTop(){
    /* Three places, always the same three: the way back on the left, where you are in the
       middle, and the way out on the right. Both buttons say what they do in words — an arrow
       alone means "back" to whoever put it there and nothing in particular to anybody else. */
    /* Inside the chat there is no step to go back to — leaving it is what Start over does, and
       two buttons doing the same thing is one of them lying. The conversation carries its own
       way back instead. */
    /* Nothing has been chosen yet, so there is nothing to go back from, nothing to start over,
       and no step to be on. A bar of three disabled controls is furniture; a name is not. */
    /* At the start there is nothing to go back from, nothing to start over, and no step to be
       on — and a bar carrying only the name of the thing you are already looking at is furniture
       with a line under it. */
    if(wizStep < 1 && !scanning()) return '';
    return '<div class="wz-top"><div class="wz-topin">'
         + (scanning() ? '<span></span>'
             : '<button class="wz-up" data-nav="' + (fromChat() ? 'chat' : wizStep - 1) + '"'
               + (!fromChat() && wizStep < 1 ? ' disabled' : '')
               + '>\u2191 Back' + (fromChat() ? ' to the scan' : ' a step') + '</button>')
         + '<span class="wz-mid">'
         + (wizWhat() ? '<i>' + wizWhat() + '</i>' : '')
         + '<span class="wz-num">' + (wizStep < 1 ? 'Start'
              : 'Step ' + wizStep + ' of ' + wizSteps()) + '</span></span>'
         + '<button class="wz-over" data-nav="reset"' + (!scanning() && wizStep < 1 ? ' disabled' : '')
         + '>\u21ba Start over</button></div></div>';
}
function wizPaint(){
    const el = $('wiz');
    if(!el || !document.body.classList.contains('wiz')) return;
    el.innerHTML = wizTop();
    // While it is still asking it owns the column; once it has asked it steps out of the way.
    document.body.classList.toggle('wz-ask', wizStep < 4);
    const main = document.createElement('div');
    main.className = 'wz-main';
    el.appendChild(main);
    const body = document.createElement('div');
    body.className = 'wz-body';
    main.appendChild(body);
    const add = (html) => { const d = document.createElement('div'); d.innerHTML = html;
                            while(d.firstChild) body.appendChild(d.firstChild); };
    const q = queryString();

    if(wizStep === 0){
        /* Two different jobs, not two ways of doing one: a card you can name, or a pile of them
           in front of a camera. Asking first is cheaper than a mode switch found later. */
        add('<div class="wz-t">What would you like to do?</div>'
          + '<div class="wz-pick">'
          + '<button data-do="look"><svg class="wz-mag sm" viewBox="0 0 24 24" aria-hidden="true">'
          + '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4 L21 21"/></svg>'
          + '<b>Look up a card</b></button>'
          + '<button data-do="scan"><svg class="wz-mag sm" viewBox="0 0 24 24" aria-hidden="true">'
          + '<rect x="3" y="6" width="18" height="13" rx="2.5"/><circle cx="12" cy="12.5" r="3.6"/>'
          + '<path d="M8 6 L9.6 3.6 h4.8 L16 6"/></svg>'
          + '<b>Scan cards</b></button></div>');
        body.querySelectorAll('[data-do]').forEach(b => b.addEventListener('click', () => {
            if(b.dataset.do === 'scan') scanOn(); else wizGo(1);
        }));
        return;
    }

    if(wizStep === 1){
        /* One picture on the first screen, because an empty column with a text field in the
           middle of it does not look like anything in particular. */
        add('<svg class="wz-mag" viewBox="0 0 24 24" aria-hidden="true">'
          + '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4 L21 21"/></svg>'
          + '<div class="wz-t">What are you looking up?</div>'
          + '<div class="wz-row"><input id="wz-q" placeholder="Card name" autocomplete="off"></div>'
          + '<button class="wz-go" id="wz-next">Next</button>'
          + '<a class="wz-link" id="wz-db" href="#" role="button">or pull one from your databases</a>');
        const inp = $('wz-q');
        inp.value = q;
        const go = () => {
            const v = inp.value.trim();
            if(!v){ toast('Type a card name first.', true); return; }
            $('f-q').value = v;                      // the same field the old form fills
            wizGo(2);
        };
        $('wz-next').addEventListener('click', go);
        inp.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); go(); } });
        $('wz-db').addEventListener('click', e => { e.preventDefault(); dbCards(); });
        setTimeout(() => inp.focus(), 30);
        return;
    }

    if(wizStep === 2){
        /* The card being looked up belongs in the question rather than on a line under it —
           it is the same sentence either way, and one line reads faster than two.

           The two buttons carry the marks people already recognise and nothing else. A paragraph
           under each explaining how the data is fetched was answering a question nobody asks
           while choosing between two shops. */
        add('<div class="wz-t">Where should I look for \u201c' + esc(q) + '\u201d?</div>'
          + '<div class="wz-pick">'
          + '<button data-src="tcgplayer"><img alt="" src="' + LOGO_TCG + '"><b>TCGplayer</b></button>'
          + '<button data-src="ebay"><img alt="" src="' + LOGO_EBAY + '"><b>eBay</b></button></div>');

        body.querySelectorAll('[data-src]').forEach(b => b.addEventListener('click', () => {
            state.src = b.dataset.src; save();
            document.querySelectorAll('#src-seg button').forEach(x =>
                x.classList.toggle('on', x.dataset.src === state.src));
            syncSrcUI();
            wizGo(3);
        }));
        return;
    }

    if(wizStep === 3){
        const isEbay = state.src === 'ebay';
        const langs = isEbay ? [['en','EN'],['jp','JP'],['kr','KR'],['cn','CN']]
                             : [['both','Both'],['en','EN'],['jp','JP']];
        /* "A little more detail" over a smaller line naming the card said two things where one
           would do. The card and the shop are the heading. */
        let h = '<div class="wz-t">' + esc(q) + ' on '
          + (isEbay ? 'eBay' : 'TCGplayer') + ':</div>';
        /* Questions down one line, each numbered and in its own box, and only the ones the shop
           being searched can actually use. TCGplayer is read through an API that takes a language
           and a condition filter; the set, the number and the rarity are words that only mean
           something in an eBay search box, so asking for them there was asking for nothing.

           None of them carries a note underneath: "Set" and "Card number" say what they are, and
           a sentence under every field turned four short asks into a wall of small print. */
        h += '<div class="wz-flow">'
           + '<div class="wz-node"><i><b>1</b>Language</i><div class="wz-seg" id="wz-lang">';
        langs.forEach(([k, label]) => {
            h += '<button data-lang="' + k + '"' + (state.lang === k ? ' class="on"' : '')
               + '>' + label + '</button>';
        });
        h += '</div></div>';
        if(isEbay){
            h += '<div class="wz-node"><i><b>2</b>Set</i>'
               + '<input id="wz-set" placeholder="any set"></div>'
               + '<div class="wz-node"><i><b>3</b>Card number</i>'
               + '<input id="wz-num" placeholder="e.g. 148/SV-P"></div>'
               + '<div class="wz-node"><i><b>4</b>Rarity</i><div class="wz-seg wz-rare" id="wz-rare">';
            rareSet().forEach(([k, label, note]) => {
                h += '<button data-rare="' + k + '"' + ((state.ebayRare||'none') === k ? ' class="on"' : '')
                   + ' title="' + esc(note) + '"><b>' + label + '</b><s>' + esc(note) + '</s></button>';
            });
            h += '</div></div>';
        } else {
            // As many as you like, or none at all, which is every condition rather than no cards.
            h += '<div class="wz-node"><i><b>2</b>Condition</i><div class="wz-seg" id="wz-cond">';
            CONDITIONS.forEach(([ab, full]) => {
                h += '<button data-cond="' + esc(full) + '"'
                   + ((state.conds || []).indexOf(full) >= 0 ? ' class="on"' : '')
                   + ' title="' + esc(full) + '">' + ab + '</button>';
            });
            h += '</div></div>';
        }
        h += '</div>';
        h += '<button class="wz-go" id="wz-run">Search</button>';
        add(h);

        body.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => {
            state.lang = b.dataset.lang; save();
            body.querySelectorAll('[data-lang]').forEach(x => x.classList.toggle('on', x === b));
            document.querySelectorAll('#lang-seg button').forEach(x =>
                x.classList.toggle('on', x.dataset.lang === state.lang));
            // AR and SAR are not IR and SIR, so the choices are redrawn with the language.
            if(isEbay){
                state.ebaySet = $('wz-set').value.trim();
                state.ebayNum = $('wz-num').value.trim();
            }
            if(!rareSet().some(x => x[0] === (state.ebayRare||'none'))) state.ebayRare = 'none';
            save(); wizPaint();
        }));
        if(isEbay){
            $('wz-set').value = state.ebaySet || '';
            $('wz-num').value = state.ebayNum || '';
            body.querySelectorAll('[data-rare]').forEach(b => b.addEventListener('click', () => {
                state.ebayRare = b.dataset.rare; save();
                body.querySelectorAll('[data-rare]').forEach(x => x.classList.toggle('on', x === b));
            }));
        } else {
            // The same list the old form's chips write to, so the two stay in step.
            body.querySelectorAll('[data-cond]').forEach(b => b.addEventListener('click', () => {
                const c = b.dataset.cond, cur = (state.conds || []).slice();
                const at = cur.indexOf(c);
                if(at >= 0) cur.splice(at, 1); else cur.push(c);
                state.conds = cur; save();
                b.classList.toggle('on', at < 0);
                if(typeof buildConds === 'function') buildConds();
            }));
        }
        $('wz-run').addEventListener('click', () => {
            if(isEbay){
                state.ebaySet = $('wz-set').value.trim();
                state.ebayNum = $('wz-num').value.trim();
            }
            save();
            wizGo(4);
            // Exactly what the old form does, with exactly the same fields filled in.
            if(isEbay) loadEmbed(); else doSearch();
        });
        return;
    }

    if(wizStep === 5){
        const both = ebayBoth();
        add('<div class="wz-t">Build the price sheet</div>'
          + '<div class="wz-crumb">' + (both
                ? '<b>' + _ebayLive.length + '</b> on sale and <b>' + _ebayDone.length
                  + '</b> sold, pasted in'
                : 'Both pages still need pasting in.') + '</div>'
          + '<button class="wz-go" id="wz-build"' + (both ? '' : ' disabled')
          + '>Build Price Sheet</button>'
          + (_ebayBuilt ? '<div class="wz-crumb">Built. <b>Save to database</b> keeps it.</div>' : ''));
        $('wz-build').addEventListener('click', ebayBuild);
        return;
    }

    /* Out of the way once it has asked. The bar at the top is the way back, so all that is left
       here is the other printings of the same card — and on eBay there are none to offer,
       because the panel below is already the whole of what happens next. */
    let h4 = '<div class="wz-crumb"><b>' + esc(q) + '</b> on <b>'
           + (state.src === 'ebay' ? 'eBay' : 'TCGplayer') + '</b></div>';
    /* The card these figures are about, on the site they came from. The frame beside this shows
       it, but the frame is not always what is on screen — and a price you are about to write
       down is worth being able to check against its source in one press. */
    if(state.src !== 'ebay' && _altId){
        h4 += '<a class="wz-back wz-wide" target="_blank" rel="noopener" '
            + 'href="https://www.tcgplayer.com/product/' + encodeURIComponent(_altId) + '">'
            + '↗ Open on TCGplayer</a>';
    }
    if(state.src !== 'ebay'){
        h4 += '<button class="wz-back wz-wide" id="wz-again">'
            + '\u21c5 Choose a different ' + esc(q) + ' card</button>';
    }
    add(h4);
    if($('wz-again')) $('wz-again').addEventListener('click', () => {
        if(_alts.length > 1) $('alt-over').classList.add('on');
        else toast('Only one printing matched this one.');
    });
}
/* One handler for every Back and Start over the wizard draws, rather than one per step that has
   to be rewired each time a step changes shape. */
document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#wiz [data-nav]');
    if(!b) return;
    /* Inside the conversation, starting over is starting the conversation over — clearing it and
       asking the first question again, rather than walking out of it. */
    if(b.dataset.nav === 'reset'){
        if(scanning()) scStartOver(); else wizReset();
        return;
    }
    /* Arrived at the figures from the conversation, so that is where back goes. The chat is
       still exactly as it was — nothing in it was thrown away to show a price. */
    if(b.dataset.nav === 'chat'){ SC.back = false; scanOn(); return; }
    if(scanning()){ scanOff(); wizPaint(); return; }
    wizGo(+b.dataset.nav);
});
/* ── what shape of screen this is ────────────────────────────────────────────
   A phone by the size of the window and the coarseness of the pointer together: a narrow
   desktop window is still a desktop, and a tablet with a mouse is not a phone. Re-read on
   resize and on rotation, because both of those change the answer. */
function mobRead(){
    /* A phone on its side can be 932px across, so the width alone is no answer; a coarse
       pointer on a screen this size is one either way. The class is the single place that
       decides, and the stylesheet reads it rather than measuring again. */
    const narrow = window.matchMedia('(max-width: 1024px)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const mob = narrow && coarse;
    const port = window.innerHeight >= window.innerWidth;
    document.body.classList.toggle('mob', mob);
    document.body.classList.toggle('port', mob && port);
    document.body.classList.toggle('land', mob && !port);
    // The old search cannot be used on a phone, so on a phone it is not offered at all.
    if(mob && !document.body.classList.contains('wiz')) wizSet(true);
    if(mob && port && !document.body.classList.contains('pane-db')
       && !document.body.classList.contains('pane-find')) swapTo('find');
    swapCount();
}
/* Portrait shows one pane at a time. The conversation is what somebody came here to use, so it
   is what is on screen when they arrive; the sheet is a press away and says how much is in it. */
function swapTo(which){
    const db = which === 'db';
    document.body.classList.toggle('pane-db', db);
    document.body.classList.toggle('pane-find', !db);
    const f = $('swap-find'), d = $('swap-db');
    if(f) f.classList.toggle('on', !db);
    if(d) d.classList.toggle('on', db);
}
function swapCount(){
    const n = $('swap-n');
    if(n) n.textContent = (typeof ledger !== 'undefined' && ledger.length) ? String(ledger.length) : '';
}
// Guarded: one null here throws, and everything after it in this file stops being defined.
if($('swap-find')) $('swap-find').addEventListener('click', () => swapTo('find'));
if($('swap-db')) $('swap-db').addEventListener('click', () => swapTo('db'));
window.addEventListener('resize', mobRead, { passive:true });
window.addEventListener('orientationchange', () => setTimeout(mobRead, 120), { passive:true });

/* Guided by default. The old one is a fallback rather than a peer, so switching to it asks —
   somebody who has not seen the new one yet should not land in the old one by accident. */
function wizSet(on){
    document.body.classList.toggle('wiz', !!on);
    if(!on) document.body.classList.remove('wz-ask');
    try{ localStorage.setItem('ptcg-wiz', on ? '1' : '0'); }catch(_){}
    const b = $('wiz-btn');
    if(b){ b.textContent = on ? '\u2630 Guided' : '\u2637 Classic';
           b.classList.toggle('on', !!on); }
    if(on) wizPaint();
}
$('wiz-btn').addEventListener('click', async () => {
    // Not reachable on a phone — the button is not drawn there — but a guard is cheaper than
    // the bug where a window is resized across the line with the old form already up.
    if(document.body.classList.contains('mob')) return;
    const on = document.body.classList.contains('wiz');
    if(on){
        const ok = await lgAsk({ title:'Switch to the old search',
            yes:'Switch anyway', no:'Stay',
            body:'Are you sure you want to switch to the old search interface?<br>'
               + 'The guided one asks the same questions with less on screen at once.' });
        if(!ok) return;
    }
    wizSet(!on);
});
/* Guided, always. The old form is still here and still works — a new arrangement of a working
   tool should not take the old one out of the world — but it is no longer a preference, so a
   remembered answer of "classic" from before does not bring it back either. */
wizSet(true);
mobRead();

// Named sheets are stored only in this browser.
const DB_KEY = 'ptcg-price-db';
/* var, not let: lgSave runs during the first paint, before this line is reached, and a
   const/let read from up there would throw rather than simply find nothing to push. */
var lgDb = { id:'', name:'Saved cards', live:false, ro:false, mine:true, canLock:true, at:0, by:'' };
var dbReady = false;
function dbLoad(){
    try{
        const got = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
        if(got && typeof got === 'object') lgDb = Object.assign(lgDb, got);
    }catch(_){}
    // Always has one, live or not, so there is something to read out over a phone.
    if(!lgDb.id) lgDb.id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function dbSave(){ try{ localStorage.setItem(DB_KEY, JSON.stringify(lgDb)); }catch(_){} }
function dbStart(){ dbLoad(); dbReady = true; dbPaint(); }
function dbPaint(){
    const nm = $('lg-name'); if(!nm) return;
    if(document.activeElement !== nm) nm.value = lgDb.name || 'Saved cards';
    $('lg-id').textContent = 'ID: ' + lgDb.id;
    const live = $('lg-live');
    live.classList.toggle('on', !!lgDb.live);
    live.textContent = lgDb.live ? 'Saved locally' : 'Save sheet';
    live.title = lgDb.live
        ? 'Saved in this browser; edits update this copy'
        : 'Put this sheet up in this browser it';
    const ro = $('lg-ro');
    ro.hidden = true;
    ro.classList.toggle('on', !!lgDb.ro);
    ro.textContent = lgDb.ro ? '\u26bf Read only' : 'Read only';
    /* The flag is only worth anything if not everybody can take it off. Whoever cannot is told
       why rather than being left pressing a button that does nothing. */
    ro.disabled = !lgDb.canLock;
    ro.title = lgDb.canLock
        ? (lgDb.ro ? 'Let others write over this again' : 'Stop anybody else writing over it')
        : 'Only whoever made this sheet, or an admin, can change that'
          + (lgDb.by ? ' \u2014 this one is ' + lgDb.by + '\u2019s' : '');
}
// A live sheet follows what happens here, a beat behind so a run of edits is one write.
let dbPushT = null;
function dbPush(now){
    if(!dbReady || !lgDb.live) return;
    clearTimeout(dbPushT);
    dbPushT = setTimeout(async () => {
        try{
            const r = await LocalSheets.request('/api/pdb/save', { method:'POST', credentials:'same-origin',
                headers:{ 'Content-Type':'application/json' },
                body: JSON.stringify({ id: lgDb.id, name: lgDb.name,
                                       rows: ledger.filter(x => !x.out) }) });
            const j = await r.json().catch(() => ({}));
            if(!r.ok){
                // It stops calling itself live rather than quietly failing to be.
                lgDb.live = false; dbSave(); dbPaint();
                toast(j.error || 'Could not put that up', true);
                return;
            }
            lgDb.at = j.at || Date.now(); dbSave();if(now)toast('Saved in this browser');
        }catch(_){ toast('Could not access local storage', true); }
    }, now ? 0 : 1400);
}
$('lg-name').addEventListener('input', () => {
    lgDb.name = $('lg-name').value.slice(0, 60) || 'Saved cards';
    dbSave(); dbPush();
});
$('lg-live').addEventListener('click', async () => {
    if(lgDb.live){
        const ok = await lgAsk({ title:'Remove saved copy', danger:true, yes:'Remove copy',
            body:'This named saved copy will be removed from this browser.'
               + '<br>What is on this screen stays where it is.' });
        if(!ok) return;
        try{
            const r = await LocalSheets.request('/api/pdb/drop', { method:'POST', credentials:'same-origin',
                headers:{ 'Content-Type':'application/json' },
                body: JSON.stringify({ id: lgDb.id }) });
            const j = await r.json().catch(() => ({}));
            if(!r.ok){ toast(j.error || 'Could not take it down', true); return; }
        }catch(_){ toast('Could not access local storage', true); return; }
        lgDb.live = false; lgDb.ro = false; dbSave(); dbPaint();
        toast('Removed from saved sheets');
        return;
    }
    lgDb.live = true; dbSave(); dbPaint();
    dbPush(true);
    toast('Saved in this browser');
});
$('lg-ro').addEventListener('click', async () => {
    const want = !lgDb.ro;
    try{
        const r = await LocalSheets.request('/api/pdb/ro', { method:'POST', credentials:'same-origin',
            headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({ id: lgDb.id, ro: want }) });
        const j = await r.json().catch(() => ({}));
        if(!r.ok){ toast(j.error || 'Could not change that', true); return; }
        lgDb.ro = !!j.ro; dbSave(); dbPaint();
        toast(lgDb.ro ? 'Read only' : 'Others can write over it again');
    }catch(_){ toast('Could not access local storage', true); }
});

/* The catalogue. Name, how many are on it, who put it up and when — enough to tell two sheets
   apart without opening either. */
function dbWhen(ms){
    if(!ms) return '';
    return new Date(ms).toLocaleString([], { month:'short', day:'numeric',
                                             hour:'2-digit', minute:'2-digit' });
}
async function dbList(){
    $('db-back').classList.add('on');
    const host = $('db-list');
    host.innerHTML = '<div class="fb-note">Looking\u2026</div>';
    let dbs = [];
    try{
        const r = await LocalSheets.request('/api/pdb/list', { credentials:'same-origin' });
        const j = await r.json().catch(() => ({}));
        if(!r.ok){ host.innerHTML = '<div class="fb-note">' + esc(j.error || 'Could not read the list.') + '</div>'; return; }
        dbs = j.dbs || [];
    }catch(_){ host.innerHTML = '<div class="fb-note">Could not access local storage.</div>'; return; }
    if(!dbs.length){
        host.innerHTML = '<div class="fb-note">Nothing has been saved locally yet. '
                       + 'Press <b>Save sheet</b> on a sheet to put the first one up.</div>';
        return;
    }
    host.innerHTML = '';
    dbs.forEach(d => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'db-row';
        b.innerHTML = '<span class="nm">' + esc(d.name || 'Untitled')
                    + (d.ro ? ' <span class="lock" title="Read only">\u26bf</span>' : '') + '</span>'
                    + '<span class="n">' + d.n + '</span>'
                    + '<span class="sub">ID: ' + esc(d.id) + ' \u00b7 ' + esc(dbWhen(d.at))
                    + (d.by ? ' \u00b7 ' + esc(d.by) : '')
                    + (d.mine ? ' \u00b7 yours' : '') + '</span>';
        b.addEventListener('click', () => dbTake(d));
        host.appendChild(b);
    });
}
/* Loading one is destructive: whatever is on the sheet now goes. It is worth saying out loud,
   with the two ways of keeping it named, before anything is overwritten. */
async function dbTake(d){
    const ok = await lgAsk({ title:'Load ' + (d.name || 'that sheet'), danger:true,
        yes:'Load it', no:'Cancel',
        body:'This replaces the ' + ledger.length + ' card' + (ledger.length === 1 ? '' : 's')
           + ' on your sheet right now.<br><br>'
           + 'If you want to keep them, press <b>Save sheet</b> first to put them up, or '
           + '<b>Export</b> a copy to your drive. Otherwise they are overwritten.' });
    if(!ok) return;
    try{
        const r = await LocalSheets.request('/api/pdb/get?id=' + encodeURIComponent(d.id),
                              { credentials:'same-origin' });
        const j = await r.json().catch(() => ({}));
        if(!r.ok){ toast(j.error || 'Could not load that', true); return; }
        ledger = Array.isArray(j.rows) ? j.rows : [];
        lgPick.clear(); lgOpen = '';
        lgSave();
        /* It arrives as a copy, not as a connection. Nothing is pushed back until Save sheet is
           pressed, which is exactly what the warning above promised. */
        lgDb = { id: j.id, name: j.name || 'Saved cards', live: false, ro: !!j.ro,
                 mine: !!j.mine, canLock: !!j.canLock, at: j.at || 0, by: j.by || '' };
        dbSave(); dbPaint(); lgPaint();
        $('db-back').classList.remove('on');
        toast('Loaded ' + ledger.length + ' card' + (ledger.length === 1 ? '' : 's'));
    }catch(_){ toast('Could not access local storage', true); }
}
$('db-btn').addEventListener('click', dbList);
$('db-x').addEventListener('click', () => $('db-back').classList.remove('on'));
$('db-back').addEventListener('mousedown', e => {
    if(e.target === $('db-back')) $('db-back').classList.remove('on');
});
dbStart();

/* ── the card scanner, in the column ─────────────────────────
   Ported from the standalone scanner at /Lab/chat rather than reinvented: the same reader
   choice, the same drag-to-fix boxes, the same editable read. What changes is where it ends —
   the scanner priced cards itself, and here the page it is sitting in already does that, so a
   read hands off to the lookup instead.

   Two things could not come over as they are. The session rail hangs in the page margin there
   and a column has no margin, so it lies along the top and scrolls sideways. And the pricing,
   buyback and save steps are the rest of this page.

   OpenCV is ten megabytes and is not fetched until somebody opens this. */
/* var, not const: the bar above the column paints on load, long before this line is reached,
   and it asks whether the figures were arrived at from here. A const read from up there throws
   rather than answering — typeof does not save you from a temporal dead zone, it throws too,
   and the whole script died at that line taking both columns with it. */
var SC = { model: null, step: 'model', back: false };
let SC_AVATAR = '';
function scanning(){ return document.body.classList.contains('scan'); }
function scLog(){ return $('sc-log'); }
function scStatus(t, bad){
    const el = $('sc-status'); if(!el) return;
    el.textContent = t || '';
    el.style.color = bad ? 'var(--err, #ff6b6b)' : 'var(--dim)';
}
/* The bot wears the shared workspace avatar, whatever it has been set to — the same one the
   landing page and Data Entry use. Asked for once, and quietly ignored if it is not there. */
function scBubble(who, html, opts){
    const m = document.createElement('div');
    m.className = 'sc-msg' + (who === 'me' ? ' me' : '');
    if(who !== 'me'){
        const a = document.createElement('div');
        a.className = 'ava';
        if(SC_AVATAR) a.style.backgroundImage = 'url("' + SC_AVATAR + '")';
        m.appendChild(a);
    }
    const b = document.createElement('div');
    b.className = 'sc-bub' + (opts && opts.wide ? ' wide' : '');
    b.innerHTML = html;
    m.appendChild(b);
    scLog().appendChild(m);
    scLog().scrollTop = scLog().scrollHeight;
    return b;
}
/* The buttons stay put until the question is answered, so backing out of a confirm leaves the
   choice exactly where it was. */
function scOptions(bub, list){
    const wrap = document.createElement('div');
    wrap.className = 'sc-opts';
    list.forEach(o => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = o.label;
        if(o.primary) btn.className = 'pri';
        btn.addEventListener('click', async () => {
            const fire = () => {
                if(o.echo !== false) scBubble('me', esc(o.label));
                wrap.remove();
                o.run();
            };
            if(o.confirm){
                const ok = await lgAsk(o.confirm);
                if(ok) fire();
            } else fire();
        });
        wrap.appendChild(btn);
    });
    bub.appendChild(wrap);
    scLog().scrollTop = scLog().scrollHeight;
    return wrap;
}
function scanOn(){
    document.body.classList.add('scan');
    document.body.classList.remove('wz-ask');
    wizPaint();                       // the bar above it names the job, so it has to be redrawn
    if(!scLog().childElementCount) scAskModel();
}
function scanOff(){ document.body.classList.remove('scan'); }
/* Back into the conversation, exactly as it was. scanOn only greets an empty log, so this
   resumes rather than restarts. */
function scStartOver(){
    scLog().innerHTML = '';
    scStatus('');
    scAskModel();
}

// ── which reader ────────────────────────────────────────────────────────────
function scAskModel(){SC.model='local';scAskImage();}
function scAskImage(){
    SC.step = 'image';
    scStatus('waiting for a photo');
    const b = scBubble('bot',
        'Good — <b>' + 'Local text reader' + '</b> it is.'
      + '<div class="small">Send me a photo of a card, or a whole binder page. Lay the cards flat '
      + 'with a little space between them.</div>');
    scOptions(b, [
        { label:'📷  Take a photo', primary:true, echo:false, run:() => $('sc-shot').click() },
        { label:'🖼  Upload', echo:false, run:() => $('sc-file').click() }
    ]);
}
['sc-file', 'sc-shot'].forEach(id => $(id).addEventListener('change', e => {
    const files = Array.from(e.target.files || []).filter(f => /^image\//.test(f.type));
    e.target.value = '';              // the same photo twice in a row must still fire
    if(files.length) scPhotos(files);
}));
async function scPhotos(files){
    scBubble('me', esc(files.length === 1 ? files[0].name : files.length + ' photos'));
    const E = window.CardScanEngine;
    if(!E.ready()){
        scStatus('loading the detector (~10MB, first time only)…');
        E.load();
        await new Promise(res => { E.onReady = res; });
    }
    for(const f of files) await scOnePhoto(f);
}
async function scOnePhoto(file){
    const C = window.CardScanCore, E = window.CardScanEngine;
    // Phones hand over 12-megapixel files and OpenCV works in a fixed heap.
    const bmp = await createImageBitmap(file).catch(() => null);
    if(!bmp){ scBubble('bot', 'I could not open that image, sorry. Try another?'); return; }
    const MAXD = 1600, k = Math.min(1, MAXD / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h;
    cnv.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close();

    scStatus('looking for cards…');
    const src = cv.imread(cnv);
    let found; try{ found = E.detect(src); }catch(_){ found = { quads: [] }; }
    src.delete();
    scStatus('');

    let quads = found.quads || [];
    // A photo of one card filling the frame has no border to find.
    if(!quads.length) quads = [[{x:w*0.1,y:h*0.1},{x:w*0.9,y:h*0.1},{x:w*0.9,y:h*0.9},{x:w*0.1,y:h*0.9}]];

    const b = scBubble('bot',
        'I found <b>' + (found.quads || []).length + ' card'
      + ((found.quads || []).length === 1 ? '' : 's') + '</b>.'
      + '<div class="small">Drag a box to add one I missed, or drag a corner to straighten one. '
      + 'To drop one, hover the clipped card below it and press its ×. Tell me when it looks '
      + 'right.</div>', { wide:true });
    scAdjust(b, { cnv, w, h, quads, file:file.name });
}
// ── fixing the boxes, in the chat ───────────────────────────────────────────
function scAdjust(bub, st){
    SC.step = 'adjust';
    scStatus('adjusting boxes');
    const stage = document.createElement('div'); stage.className = 'sc-stage';
    const dbg = document.createElement('canvas'); dbg.width = st.w; dbg.height = st.h;
    stage.appendChild(dbg); bub.appendChild(stage);
    const thumbs = document.createElement('div'); thumbs.className = 'sc-thumbs';
    bub.appendChild(thumbs);
    st.dbg = dbg; st.thumbs = thumbs;
    scDrawAdjust(st);
    scWireAdjust(st);
    scOptions(bub, [
        { label:'Done.', primary:true, run:() => {
            if(!st.quads.length){
                scBubble('bot', 'There are no boxes left on that photo, so there is nothing to '
                    + 'read. Send another one whenever you like.');
                scAskImage(); return;
            }
            scReadCards(st);
        } },
        { label:'Cancel this photo.',
          confirm:{ title:'Discard this photo?', danger:true, yes:'Discard photo', no:'Keep it',
                    body:'The boxes on this photo will be thrown away.<br>Cards you have already '
                       + 'read are kept.' },
          run:() => { scBubble('bot', 'Cancelled. Send another photo whenever you like.'); scAskImage(); } }
    ]);
}
function scDrawAdjust(st, preview){
    const C = window.CardScanCore, E = window.CardScanEngine;
    const ord = C.sortReadingOrder(st.quads);
    st.ordered = ord;
    const d = st.dbg.getContext('2d');
    d.clearRect(0, 0, st.w, st.h); d.drawImage(st.cnv, 0, 0);
    const hr = Math.max(9, st.w / 150);
    ord.forEach(o => {
        d.beginPath(); d.moveTo(o.quad[0].x, o.quad[0].y);
        for(let i = 1; i < 4; i++) d.lineTo(o.quad[i].x, o.quad[i].y);
        d.closePath();
        /* White underneath, colour on top. One stroke can be lost against a dark card border or
           a bright holo; a pair is legible over both. */
        d.lineJoin = 'round';
        const LW = Math.max(3.5, st.w / 200);
        d.lineWidth = LW * 2.2; d.strokeStyle = 'rgba(255,255,255,0.98)'; d.stroke();
        d.lineWidth = LW;       d.strokeStyle = 'rgba(56,206,124,1)';     d.stroke();
        const c = C.centroid(o.quad), sz = Math.max(13, st.w / 46);
        d.font = '700 ' + sz + 'px Inter, sans-serif'; d.textAlign = 'center'; d.textBaseline = 'middle';
        d.lineWidth = 4; d.strokeStyle = 'rgba(0,0,0,0.8)'; d.strokeText(o.row + '·' + o.col, c.x, c.y);
        d.fillStyle = '#fff'; d.fillText(o.row + '·' + o.col, c.x, c.y);
        o.quad.forEach(pt => {
            d.beginPath(); d.arc(pt.x, pt.y, hr, 0, Math.PI * 2);
            d.fillStyle = 'rgba(12,8,3,0.8)'; d.fill();
            d.lineWidth = Math.max(3.4, st.w / 240); d.strokeStyle = 'rgba(255,255,255,0.98)'; d.stroke();
            d.lineWidth = Math.max(1.6, st.w / 470); d.strokeStyle = 'rgba(56,206,124,1)';     d.stroke();
        });
    });
    if(preview){
        const LW = Math.max(3.5, st.w / 200);
        d.setLineDash([10, 7]); d.lineJoin = 'round';
        d.lineWidth = LW * 2.2; d.strokeStyle = 'rgba(255,255,255,0.98)';
        d.strokeRect(preview.x, preview.y, preview.w, preview.h);
        d.lineWidth = LW;       d.strokeStyle = 'rgba(224,138,60,1)';
        d.strokeRect(preview.x, preview.y, preview.w, preview.h);
        d.setLineDash([]);
    }
    st.thumbs.innerHTML = '';
    const src = cv.imread(st.cnv);
    ord.forEach(o => {
        const box = document.createElement('div'); box.className = 'sc-th';
        const cc = document.createElement('canvas');
        const m = E.warp(src, C.expandQuad(C.orderCorners(o.quad), 0.035));
        cc.width = C.WARP_W; cc.height = C.WARP_H; cv.imshow(cc, m); m.delete();
        box.appendChild(cc);
        const n = document.createElement('div'); n.className = 'n';
        n.textContent = o.row + '·' + o.col;
        box.appendChild(n);
        /* Removing a card belongs on the card, not on the photo: down here you are looking at
           exactly what would be sent to the reader, which is the thing you are judging. */
        const x = document.createElement('button');
        x.className = 'x'; x.type = 'button'; x.textContent = '×';
        x.title = 'Remove this one';
        x.addEventListener('click', ev => { ev.stopPropagation(); scRemoveQuad(st, o.index); });
        box.appendChild(x);
        st.thumbs.appendChild(box);
    });
    src.delete();
}
/* Ray casting, so a press anywhere inside a box finds it — including the rotated ones, where a
   bounding-box test would claim hits well outside the card. */
function scInQuad(p, q){
    let inside = false;
    for(let i = 0, j = q.length - 1; i < q.length; j = i++){
        const xi = q[i].x, yi = q[i].y, xj = q[j].x, yj = q[j].y;
        if(((yi > p.y) !== (yj > p.y))
            && (p.x < (xj - xi) * (p.y - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
    }
    return inside;
}
// Topmost first, so the most recently drawn box wins where two overlap.
function scQuadAt(st, p){
    for(let i = st.quads.length - 1; i >= 0; i--) if(scInQuad(p, st.quads[i])) return i;
    return -1;
}
function scRemoveQuad(st, qi){
    if(qi < 0 || qi >= st.quads.length) return;
    st.quads.splice(qi, 1);
    st.drag = null;
    scDrawAdjust(st);
    scStatus(st.quads.length
        ? st.quads.length + ' box' + (st.quads.length === 1 ? '' : 'es') + ' left'
        : 'no boxes left — drag one out, or cancel this photo');
}
function scWireAdjust(st){
    const el = st.dbg; let marquee = null;
    const toImg = e => {
        const r = el.getBoundingClientRect();
        return { x:(e.clientX - r.left) * (st.w / r.width), y:(e.clientY - r.top) * (st.h / r.height) };
    };
    const hit = p => {
        const hr = Math.max(9, st.w / 150) * 1.6;
        let best = null, bd = hr;
        st.quads.forEach((q, qi) => q.forEach((pt, ci) => {
            const dd = Math.hypot(pt.x - p.x, pt.y - p.y);
            if(dd < bd){ bd = dd; best = { qi, ci }; }
        }));
        return best;
    };
    el.addEventListener('pointerdown', e => {
        const p = toImg(e);
        try{ el.setPointerCapture(e.pointerId); }catch(_){}
        e.preventDefault();
        const h = hit(p); if(h) st.drag = h; else marquee = p;
    });
    // A second way in, for anyone who reaches for the right button first.
    el.addEventListener('contextmenu', e => {
        const p = toImg(e), qi = scQuadAt(st, p);
        if(qi < 0) return;
        e.preventDefault();
        scRemoveQuad(st, qi);
    });
    el.addEventListener('pointermove', e => {
        const p = toImg(e);
        if(st.drag){
            const q = st.quads[st.drag.qi];
            if(q) q[st.drag.ci] = { x:Math.max(0, Math.min(st.w, p.x)),
                                    y:Math.max(0, Math.min(st.h, p.y)) };
            scDrawAdjust(st);
        } else if(marquee){
            scDrawAdjust(st, { x:marquee.x, y:marquee.y, w:p.x - marquee.x, h:p.y - marquee.y });
        }
    });
    const fin = e => {
        if(st.drag){ st.drag = null; scDrawAdjust(st); return; }
        if(!marquee) return;
        const p = toImg(e);
        const x0 = Math.min(marquee.x, p.x), x1 = Math.max(marquee.x, p.x);
        const y0 = Math.min(marquee.y, p.y), y1 = Math.max(marquee.y, p.y);
        marquee = null;
        if(x1 - x0 < 18 || y1 - y0 < 18){ scDrawAdjust(st); return; }
        st.quads.push([{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]);
        scDrawAdjust(st);
    };
    el.addEventListener('pointerup', fin);
    el.addEventListener('pointercancel', () => { st.drag = null; marquee = null; scDrawAdjust(st); });
}
// ── reading them ────────────────────────────────────────────────────────────
async function scReadCards(st){
    const C = window.CardScanCore, E = window.CardScanEngine;
    SC.step = 'reading';
    scStatus('reading');
    const b = scBubble('bot', 'Reading ' + st.ordered.length + ' card'
        + (st.ordered.length === 1 ? '' : 's') + '…');
    const src = cv.imread(st.cnv);
    const got = [];
    for(let i = 0; i < st.ordered.length; i++){
        const o = st.ordered[i];
        scStatus('reading ' + (i + 1) + ' of ' + st.ordered.length + '…');
        const m = E.warp(src, C.expandQuad(C.orderCorners(o.quad), 0.035));
        try{
            /* The whole card, not two cropped bands. Cropping to the text is what a
               shape-matching reader needs; a vision model wants the opposite — seeing the full
               layout is how it knows the large text at the top is the name and the small print at
               the foot is the collector number. */
            const cnv = document.createElement('canvas');
            cnv.width = C.WARP_W; cnv.height = C.WARP_H;
            cv.imshow(cnv, m);
            const d = await E.readLocal(m);
            got.push({ row:o.row, col:o.col, source:st.file, title:d.title || '', hp:d.hp || '',
                       number:d.number || '', set:d.set || '', err:d.error || '', raw:d.raw || '',
                       thumb: cnv.toDataURL('image/jpeg', 0.72) });
        }catch(e){
            got.push({ row:o.row, col:o.col, source:st.file, title:'', hp:'', number:'', set:'',
                       err:String(e.message || e) });
        }
        m.delete();
    }
    src.delete();
    scStatus('');
    scShowRead(b, got);
}
/* Not a spell check — a sanity check. It is looking for the reader having failed, not for a
   misspelling, so it stays crude on purpose. */
function scNameOk(t){
    const v = String(t || '').trim();
    if(v.length < 3) return false;
    const letters = (v.match(/[A-Za-z\u3040-\u30ff\u4e00-\u9fff]/g) || []).length;
    return letters >= 3 && letters >= v.length * 0.5;
}
/* Every card at once, in order, with what it decided shown beside the clip it decided from.
   Nothing is priced by this — it only fills in which card each one is. */
async function scMatchAll(got){
    const doable = got.filter(c => scNameOk(c.title));
    if(!doable.length){
        scBubble('bot', 'None of those names is enough to search on. Type at least one in and '
            + 'press the button again.');
        return;
    }
    const b = scBubble('bot', 'Matching ' + doable.length + ' card'
        + (doable.length === 1 ? '' : 's') + ' by their pictures…');
    let done = 0, strong = 0;
    for(const c of doable){
        scStatus('matching ' + (++done) + ' of ' + doable.length + '…');
        let hits = await scHits(c);
        if(!hits.length){ c.matchNote = 'nothing in the catalogue matched'; scRowActions(c); continue; }
        hits = await scRank(c, hits);
        const conf = scConfidence(hits);
        const top = hits[0];
        c.match = { productId:top.productId, name:top.name || '', set:top.set || '',
                    number:top.number || '', image:top.image || '', url:top.url || '',
                    lang:top.lang || '' };
        c.matchConf = conf;
        c.matchNote = '';
        if(conf && conf.tone === 'ok') strong++;
        scRowActions(c);
    }
    scStatus('');
    scMarkSaved();
    b.innerHTML = 'Matched ' + doable.length + ' card' + (doable.length === 1 ? '' : 's')
        + ' — <b>' + strong + '</b> I am confident about.'
        + '<div class="small">The catalogue picture sits beside your photo on each one. If they '
        + 'are not the same card, press <b>Match a different card</b> and choose it yourself.</div>';
}
function scRenderRead(c){
    const row = document.createElement('div'); row.className = 'sc-read';
    if(c.thumb){
        const im = document.createElement('img');
        im.className = 'rt'; im.src = c.thumb; im.alt = c.title || 'card';
        im.title = 'Hover to enlarge';
        im.addEventListener('mouseenter', e => scZoomShow(e, c.thumb));
        im.addEventListener('mousemove', scZoomMove);
        im.addEventListener('mouseleave', scZoomHide);
        row.appendChild(im);
    }
    const f = document.createElement('div'); f.className = 'fields';
    const field = (key, label, ph) => {
        const w = document.createElement('div'); w.className = 'f';
        const l = document.createElement('label'); l.textContent = label;
        const i = document.createElement('input');
        i.value = c[key] || ''; i.placeholder = ph || ''; i.spellcheck = false;
        if(key === 'title' && !c.title) i.className = 'empty';
        i.addEventListener('input', () => {
            c[key] = i.value.trim();
            if(key === 'title') i.classList.toggle('empty', !c.title);
        });
        w.appendChild(l); w.appendChild(i);
        return w;
    };
    // "Ex:" so these read as examples rather than as a value the reader already found.
    f.appendChild(field('title',  'name',   'Ex: type the name'));
    f.appendChild(field('number', 'number', 'Ex: 58/102'));
    f.appendChild(field('set',    'set',    'Ex: TEF'));
    row.appendChild(f);

    if(c.err){
        const w = document.createElement('div'); w.className = 'warn';
        w.textContent = String(c.err).slice(0, 120);
        f.appendChild(w);
    } else if(!c.title){
        const w = document.createElement('div'); w.className = 'warn';
        w.textContent = 'Nothing came back'
            + (c.raw ? ' — the reader said “' + String(c.raw).slice(0, 70) + '”' : '')
            + '. Type the name in above and I will still look it up.';
        f.appendChild(w);
    }
    /* Two decisions, in that order: which card is this, and then what is it worth. Pricing on
       the press of one button meant the first was being guessed at silently, and a wrong guess
       cost a lookup and a wrong figure rather than a second press. */
    const acts = document.createElement('div');
    acts.className = 'acts';
    f.appendChild(acts);
    c._row = row; c._acts = acts;
    scRowActions(c);
    SC_ROWS.push(c);
    scMarkSaved();
    return row;
}
/* The buttons under a read, redrawn whenever what is known about it changes. */
function scRowActions(c){
    const acts = c._acts; if(!acts) return;
    acts.innerHTML = '';
    if(c.matchNote){
        const w = document.createElement('div');
        w.className = 'note';
        w.textContent = c.matchNote;
        acts.appendChild(w);
    }
    if(c.match){
        const m = c.match, cf = c.matchConf;
        const chip = document.createElement('div');
        chip.className = 'ref' + (cf ? ' ' + cf.tone : '');
        /* The catalogue's picture next to the one we clipped, at the same size. Two pictures side
           by side is a question anybody can answer in a second; a product id is not. */
        chip.innerHTML = (m.image
                ? '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + esc(m.image) + '">'
                : '')
            + '<span><b>' + esc(m.name || '') + '</b>'
            + '<i>' + esc([m.number, m.set, m.lang].filter(Boolean).join('  ·  ')) + '</i>'
            + (cf ? '<u>' + cf.text + ' · ' + Math.round(cf.best * 100) + '</u>' : '') + '</span>';
        acts.appendChild(chip);
    }
    const btn = (label, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = cls || '';
        b.textContent = label;
        b.addEventListener('click', fn);
        acts.appendChild(b);
        return b;
    };
    btn(c.match ? 'Match a different card' : 'Match to a card…', '', () => scOfferMatch(c));
    // Only once there is something to price. Before that it would be pricing a guess.
    if(c.match) btn('Price it out →', 'go', () => scPriceOut(c));
}
/* The same catalogue list the lookup itself uses, offered here rather than a match chosen for
   you. Nothing is priced by picking one — it only says which card this is. */
/* Japanese characters in the name mean the Japanese line, and only that one — searching both
   there doubles a list with English cards that cannot be what was photographed. */
function scJapanese(t){ return /[\u3040-\u30ff\u4e00-\u9fff]/.test(String(t || '')); }
function scQuery(c){
    return [(c.title || '').trim(), (c.number || '').trim(), (c.set || '').trim()]
        .filter(Boolean).join(' ');
}
/* 019/068 and 19/68 are the same card written twice. Both sides are reduced to digits and
   slashes with the padding taken off before they are compared. */
function scNum(v){
    return String(v || '').toLowerCase().replace(/[^a-z0-9/]+/g, '')
        .split('/').map(x => x.replace(/^0+(?=\d)/, '')).join('/');
}
/* What the reader saw, used to cut the list down rather than only to sort it. A number is close
   to unique within a set and HP is close to unique within a name — but each filter is only kept
   if it leaves something behind, because a wrong read must not empty the list. */
function scNarrow(c, hits){
    const want = scNum(c.number);
    if(want && want.length > 1){
        const exact = hits.filter(h => scNum(h.number) === want);
        if(exact.length) return exact;
        /* Failing that, the digits alone. A promo reads 148/SV-P on their side and often
           SV-P 148 off the card, which is the same number in the other order. */
        const digits = v => (String(v || '').match(/\d+/) || [''])[0].replace(/^0+(?=\d)/, '');
        const lead = digits(want);
        if(lead && lead.length > 1){
            const part = hits.filter(h => digits(scNum(h.number)) === lead);
            if(part.length) return part;
        }
    }
    const hp = String(c.hp || '').replace(/\D+/g, '');
    if(hp){
        const same = hits.filter(h => String(h.hp || '').replace(/\D+/g, '') === hp);
        if(same.length) return same;
    }
    return hits;
}
async function scHits(c){
    try{
        /* Three pages rather than one. A name like Pikachu has hundreds of printings, and the
           right one is often not in the first twenty however good the ranking is. */
        const d = await getJSON('/api/tcgsearch?jp=1&pages=3&q=' + encodeURIComponent(scQuery(c)));
        let hits = (d && d.results) || [];
        /* A name read in Japanese characters cannot be an English printing, so those come out
           rather than being ranked against a photograph they cannot be of. Only when it leaves
           something behind — an empty list is worse than a mixed one. */
        if(scJapanese(c.title)){
            const jp = hits.filter(h => h.lang === 'JP');
            if(jp.length) hits = jp;
        }
        return scNarrow(c, hits);
    }catch(_){ return []; }
}
/* The list opens on the card it is about, with the photograph of that card at the top of it.
   Sending it to the bottom of the log meant scrolling away from the thing being matched to
   choose what it matched \u2014 and by then the only picture of it was off screen. */
async function scOfferMatch(c){
    const name = (c.title || '').trim();
    if(!name){ toast('Type the name in first.', true); return; }
    if(c._open){ c._open.remove(); c._open = null; return; }   // pressed again: put it away
    const q = scQuery(c);
    const panel = document.createElement('div');
    panel.className = 'sc-open';
    panel.innerHTML = '<div class="sc-open-h">'
        + (c.thumb ? '<img alt="" src="' + esc(c.thumb) + '">' : '')
        + '<span><b>Which one is this?</b><i>Searching for ' + esc(q) + '\u2026</i></span></div>';
    c._row.appendChild(panel);
    c._open = panel;
    panel.scrollIntoView({ behavior:'smooth', block:'nearest' });
    scStatus('searching the catalogue…');
    let hits = await scHits(c);
    // Ranked by the picture, so the one it thinks it is comes first rather than whichever
    // TCGplayer happened to return first.
    if(hits.length) hits = await scRank(c, hits);
    scStatus('');
    if(!hits.length){
        panel.querySelector('i').textContent =
            'Nothing in the catalogue matched that. Try correcting the name, number or set above.';
        return;
    }
    const conf = scConfidence(hits);
    panel.querySelector('i').textContent = hits.length + ' matched'
        + (conf ? ' \u00b7 best first by picture \u00b7 ' + conf.text : '');
    const b = panel;
    const list = document.createElement('div');
    list.className = 'sc-hits';
    hits.slice(0, 24).forEach((h, i) => {
        const row = document.createElement('button');
        row.type = 'button'; row.className = 'sc-hit' + (i === 0 && conf ? ' top' : '');
        row.innerHTML = (h.image
                ? '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + esc(h.image) + '">'
                : '<span class="np"></span>')
            + '<span class="t"><b>' + esc(h.name || '') + '</b>'
            + '<span>' + esc([h.number, h.set, h.lang].filter(Boolean).join('  ·  ')) + '</span></span>'
            + (h.score != null
                ? '<span class="sc">' + Math.round(h.score * 100) + '</span>' : '')
            + (h.market != null ? '<span class="p">' + money(h.market) + '</span>' : '');
        const im = row.querySelector('img');
        if(im) im.addEventListener('error', () => { im.className = 'np'; im.removeAttribute('src'); });
        row.addEventListener('click', () => {
            c.match = { productId:h.productId, name:h.name || '', set:h.set || '',
                        number:h.number || '', image:h.image || '', url:h.url || '',
                        lang:h.lang || '' };
            /* Chosen by hand, so it is not reported as a guess with a score on it. */
            c.matchConf = null;
            c.matchNote = '';
            panel.remove(); c._open = null;
            scRowActions(c);
            scMarkSaved();
        });
        list.appendChild(row);
    });
    b.appendChild(list);
}
function scShowRead(bub, got){
    /* A name is what the whole search is built on, so a bad one is worth stopping for. Anything
       empty, a couple of characters long, or more punctuation than letters is more likely to be
       the reader having a bad time than a card called that. */
    const iffy = got.filter(c => !scNameOk(c.title));
    const b = scBubble('bot', 'Here is what I read. <b>Every value can be edited</b> — whatever '
        + 'is in these boxes is what I search TCGplayer for, so correcting one now saves a rescan '
        + 'later.'
        + '<div class="small">' + (iffy.length
            ? '<b>' + iffy.length + ' of ' + got.length + '</b> '
              + (iffy.length === 1 ? 'name does' : 'names do') + ' not look right to me. '
              + 'Please read them over before I search.'
            : 'They look reasonable to me, but they are worth a glance.')
        + '</div>', { wide:true });
    const list = document.createElement('div'); list.className = 'sc-reads';
    got.forEach(c => list.appendChild(scRenderRead(c)));
    b.appendChild(list);
    scOptions(b, [
        { label:'The names are right — match them', primary:true, echo:false,
          run:() => scMatchAll(got) },
        { label:'📷  Another photo', echo:false, run:() => $('sc-file').click() },
        /* Back a step inside the conversation: it asks the previous question again and leaves
           everything already said where it is. Nothing here throws work away except Start over,
           which says so. */
        { label:'↑  Go back to the last step', echo:false, run:() => {
            scBubble('bot', 'Back a step — send another photo whenever you are ready.');
            scAskImage();
        } },
        { label:'Start over', confirm:{ title:'Start over?', danger:true, yes:'Start over',
            no:'Keep going', body:'This clears the conversation and starts again from the '
               + 'beginning.' }, run: scStartOver }
    ]);
    scStatus(got.length + ' card' + (got.length === 1 ? '' : 's') + ' read');
}
/* ── matching by the picture ──────────────────────────────────
   The reader gives a name and usually a number. The catalogue gives twenty products with the
   same name and pictures of every one of them. Comparing the picture we clipped against the
   pictures they publish is what turns that list into an answer.

   Their CDN sends Access-Control-Allow-Origin: *, so the thumbnails can be read pixel by pixel
   in the browser without a proxy — and their _in_NxN variants are fitted rather than padded, so
   a 143x200 thumbnail and our 450x628 warp are the same card face at different sizes.

   Only the artwork window is compared. Borders and text are where two printings of one card
   look most alike and where glare and white balance do the most damage; the illustration is what
   actually differs between one card and another.

   What this can do: collapse eleven printings to the two or three that share an artwork.
   What it cannot: tell those apart. A reverse holo and its normal printing publish nearly the
   same photograph, and the set symbol is a handful of pixels at this size — the number and the
   set still decide between them. It is offered as a ranking, never as a verdict. */
const ART = { x0:0.06, x1:0.94, y0:0.11, y1:0.55 };
const HN = 16;                       // 16x16 gradient hash: 256 bits
const HIST = 4;                      // 4x4x4 colour bins
/* A gradient hash rather than the pixels themselves: it records which way the brightness steps
   between neighbours, which survives a phone's white balance and a lamp on one side. */
function scFeatures(img, w, h){
    const x = Math.round(w * ART.x0), y = Math.round(h * ART.y0);
    const cw = Math.round(w * (ART.x1 - ART.x0)), ch = Math.round(h * (ART.y1 - ART.y0));
    if(cw < 8 || ch < 8) return null;
    const c = document.createElement('canvas');
    c.width = HN + 1; c.height = HN;
    const g = c.getContext('2d', { willReadFrequently:true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, x, y, cw, ch, 0, 0, HN + 1, HN);
    let px;
    try{ px = g.getImageData(0, 0, HN + 1, HN).data; }
    catch(_){ return null; }          // a tainted canvas, if a CDN ever stops allowing this
    const bits = new Uint8Array(HN * HN);
    let at = 0;
    for(let row = 0; row < HN; row++){
        for(let col = 0; col < HN; col++){
            const i = (row * (HN + 1) + col) * 4, j = i + 4;
            const a = px[i] * 0.299 + px[i+1] * 0.587 + px[i+2] * 0.114;
            const b = px[j] * 0.299 + px[j+1] * 0.587 + px[j+2] * 0.114;
            bits[at++] = a > b ? 1 : 0;
        }
    }
    // And the colours, coarsely — two cards with the same layout and different art part here.
    const c2 = document.createElement('canvas');
    c2.width = 16; c2.height = 16;
    const g2 = c2.getContext('2d', { willReadFrequently:true });
    g2.drawImage(img, x, y, cw, ch, 0, 0, 16, 16);
    let p2;
    try{ p2 = g2.getImageData(0, 0, 16, 16).data; }catch(_){ return null; }
    const hist = new Float32Array(HIST * HIST * HIST);
    for(let i = 0; i < p2.length; i += 4){
        const r = Math.min(HIST - 1, (p2[i]   * HIST) >> 8);
        const gg = Math.min(HIST - 1, (p2[i+1] * HIST) >> 8);
        const bb = Math.min(HIST - 1, (p2[i+2] * HIST) >> 8);
        hist[(r * HIST + gg) * HIST + bb] += 1;
    }
    const n = 16 * 16;
    for(let i = 0; i < hist.length; i++) hist[i] /= n;
    return { bits, hist };
}
function scScore(a, b){
    if(!a || !b) return 0;
    let same = 0;
    for(let i = 0; i < a.bits.length; i++) if(a.bits[i] === b.bits[i]) same++;
    const shape = same / a.bits.length;
    let d = 0;
    for(let i = 0; i < a.hist.length; i++) d += Math.abs(a.hist[i] - b.hist[i]);
    const colour = 1 - d / 2;         // L1 over two normalised histograms is at most 2
    return 0.65 * shape + 0.35 * colour;
}
function scLoadImg(src, cors){
    return new Promise(go => {
        const im = new Image();
        if(cors) im.crossOrigin = 'anonymous';
        im.onload = () => go(im);
        im.onerror = () => go(null);
        im.src = src;
    });
}
// Six at a time: enough to keep the connection busy, not enough to stall a phone.
async function scPool(items, n, fn){
    const out = new Array(items.length);
    let at = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while(at < items.length){
            const i = at++;
            out[i] = await fn(items[i], i);
        }
    }));
    return out;
}
/* Ranked, with the gap between first and second carried alongside. The gap is the honest
   measure: a best score of 0.8 means nothing if the runner-up also scored 0.8. */
async function scRank(c, hits){
    if(!c.thumb) return hits.map(h => Object.assign({ score:null }, h));
    const mine = await scLoadImg(c.thumb, false);
    const f0 = mine ? scFeatures(mine, mine.naturalWidth, mine.naturalHeight) : null;
    if(!f0) return hits.map(h => Object.assign({ score:null }, h));
    const scored = await scPool(hits, 6, async h => {
        if(!h.image) return Object.assign({ score:0 }, h);
        const im = await scLoadImg(h.image, true);
        const f = im ? scFeatures(im, im.naturalWidth, im.naturalHeight) : null;
        return Object.assign({ score: f ? scScore(f0, f) : 0 }, h);
    });
    scored.sort((a, b) => (b.score || 0) - (a.score || 0));
    return scored;
}
function scConfidence(list){
    if(!list.length || list[0].score == null) return null;
    const best = list[0].score, second = list.length > 1 ? list[1].score : 0;
    const gap = best - second;
    if(best >= 0.62 && gap >= 0.06) return { tone:'ok', gap, best, text:'strong match' };
    if(best >= 0.55) return { tone:'meh', gap, best, text:'close call \u2014 worth checking' };
    return { tone:'bad', gap, best, text:'weak \u2014 pick it yourself' };
}

// ── into the lookup, and back out of it ─────────────────────────────────────
/* Pricing takes the column, because that is where the figures are drawn. Which means it is
   somewhere you go — and the way back is to the conversation you left, not to a form you were
   never in. */
function scPriceOut(c){
    const m = c.match;
    if(!m){ toast('Match it to a card first.', true); return; }
    SC.back = true;                     // the lookup was reached from the chat
    scanOff();
    $('f-q').value = m.name || c.title || '';
    state.src = 'tcgplayer';
    if(m.lang === 'JP') state.lang = 'jp';
    save();
    document.querySelectorAll('#src-seg button').forEach(x =>
        x.classList.toggle('on', x.dataset.src === state.src));
    document.querySelectorAll('#lang-seg button').forEach(x =>
        x.classList.toggle('on', x.dataset.lang === state.lang));
    syncSrcUI();
    wizGo(4);
    if(m.productId) loadProduct(m.productId,
        m.url || ('https://www.tcgplayer.com/product/' + m.productId));
    else doSearch();
    toast('Pricing ' + (m.name || c.title || 'that card'));
}
/* A card that has been put on the sheet is done with, and says so — ticked and dimmed, but not
   disabled: the match can still be changed, and changing it makes it undone again. */
let SC_ROWS = [];
function scMarkSaved(){
    SC_ROWS.forEach(c => {
        if(!c._row) return;
        const on = !!(c.match && c.match.productId
            && ledger.some(r => String(r.pid || '') === String(c.match.productId)));
        c._row.classList.toggle('saved', on);
    });
}
// ── the enlarged clip ───────────────────────────────────────────────────────
let _scZoom = null;
function scZoomShow(e, src){
    if(!_scZoom) _scZoom = $('sc-zoom');
    _scZoom.querySelector('img').src = src;
    _scZoom.style.display = 'block';
    scZoomMove(e);
}
function scZoomMove(e){
    if(!_scZoom || _scZoom.style.display === 'none') return;
    const r = _scZoom.getBoundingClientRect(), GAP = 16;
    let left = e.clientX - r.width - GAP;
    if(left < 6) left = Math.min(window.innerWidth - r.width - 6, e.clientX + GAP);
    let top = e.clientY - 30;
    top = Math.max(6, Math.min(window.innerHeight - r.height - 6, top));
    _scZoom.style.left = left + 'px';
    _scZoom.style.top = top + 'px';
}
function scZoomHide(){ if(_scZoom) _scZoom.style.display = 'none'; }
// ── typing at it ────────────────────────────────────────────────────────────
/* A short vocabulary rather than a pretend conversation: the words somebody actually types at a
   scanner are the ones already on the buttons. */
function scSay(){
    const v = $('sc-say').value.trim();
    if(!v) return;
    $('sc-say').value = '';
    scBubble('me', esc(v));
    const low = v.toLowerCase();
    if(/\b(photo|picture|image|upload|scan|another)\b/.test(low)){ $('sc-file').click(); return; }
    if(/\b(start over|restart|reset|clear)\b/.test(low)){ scStartOver(); return; }


    if(/\b(back|lookup|look up|price)\b/.test(low)){
        scanOff(); wizPaint();
        return;
    }
    scBubble('bot', 'I can take a <b>photo</b> or <b>start over</b>. Images are read locally; review the names before searching.');
}
$('sc-send').addEventListener('click', scSay);
$('sc-say').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); scSay(); } });
window.CardScanEngine.onStatus(scStatus);

/* ── cards already in the databases ──────────────────────────
   Not a list of sheets but a list of cards, gathered across every sheet that has been saved locally.
   The point is to be able to say "that one again" about a lookup somebody did last week — so
   each row carries what it takes to recognise the card and what it takes to run the same lookup
   over, and picking one sets the form back to how it was and runs it. */
let _dbcCards = [];
function dbcRef(c){
    const h = c.how || {};
    if(c.pid) return 'TCGplayer product <b>' + esc(c.pid) + '</b>';
    if(h.src === 'ebay'){
        const bits = [h.search || h.query || c.name, h.set, h.num,
                      h.rare && h.rare !== 'none' ? h.rare.toUpperCase() : ''];
        return 'eBay search <b>' + esc(bits.filter(Boolean).join(' ')) + '</b>';
    }
    if(h.query) return 'searched <b>' + esc(h.query) + '</b>';
    // Rows saved before any of this was kept. Said plainly rather than dressed up.
    return 'no reference kept for this one';
}
function dbcPaint(){
    const host = $('dbc-list');
    const q = ($('dbc-q').value || '').trim().toLowerCase();
    const list = !q ? _dbcCards : _dbcCards.filter(c =>
        (c.name + ' ' + (c.set||'') + ' ' + (c.num||'')).toLowerCase().indexOf(q) >= 0);
    if(!list.length){
        host.innerHTML = '<div class="fb-note">' + (q
            ? 'Nothing on the saved sheets matches that.'
            : 'No cards saved yet. Press <b>Save sheet</b> to keep a named copy here.')
          + '</div>';
        return;
    }
    host.innerHTML = '';
    list.slice(0, 300).forEach(c => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'dbc-row';
        b.innerHTML = (c.image
                ? '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + esc(c.image) + '">'
                : '<span class="np"></span>')
            + '<span><span class="nm">' + esc(c.name) + '</span>'
            + '<span class="st">' + esc([c.set, c.num, c.from, c.dbName].filter(Boolean).join('  \u00b7  '))
            + '</span><span class="rf">' + dbcRef(c) + '</span></span>';
        const im = b.querySelector('img');
        if(im) im.addEventListener('error', () => { im.className = 'np'; im.removeAttribute('src'); });
        b.addEventListener('click', () => dbcTake(c));
        host.appendChild(b);
    });
}
async function dbCards(){
    $('dbc-back').classList.add('on');
    const host = $('dbc-list');
    host.innerHTML = '<div class="fb-note">Reading the saved sheets\u2026</div>';
    try{
        const r = await LocalSheets.request('/api/pdb/cards', { credentials:'same-origin' });
        const j = await r.json().catch(() => ({}));
        if(!r.ok){
            host.innerHTML = '<div class="fb-note">' + esc(j.error || 'Could not read them.') + '</div>';
            return;
        }
        _dbcCards = j.cards || [];
    }catch(_){
        host.innerHTML = '<div class="fb-note">Could not access local storage.</div>';
        return;
    }
    dbcPaint();
    setTimeout(() => $('dbc-q').focus(), 30);
}
/* Picking one puts the form back the way it was when that card was found, then runs it. On
   TCGplayer that is the exact product rather than a name search, which is the difference between
   the card you meant and the first of eleven printings. */
function dbcTake(c){
    const h = c.how || {};
    $('f-q').value = c.name || h.query || '';
    if(h.src) state.src = h.src;
    if(h.lang) state.lang = h.lang;
    if(h.src === 'ebay'){
        state.ebaySet = h.set || '';
        state.ebayNum = h.num || '';
        state.ebayRare = h.rare || 'none';
    } else if(Array.isArray(h.conds)){
        state.conds = h.conds.slice();
    }
    save();
    document.querySelectorAll('#src-seg button').forEach(x =>
        x.classList.toggle('on', x.dataset.src === state.src));
    document.querySelectorAll('#lang-seg button').forEach(x =>
        x.classList.toggle('on', x.dataset.lang === state.lang));
    syncSrcUI();
    if(typeof buildConds === 'function') buildConds();
    $('dbc-back').classList.remove('on');
    if(document.body.classList.contains('wiz')) wizGo(4);
    if(state.src === 'ebay') loadEmbed();
    else if(c.pid) loadProduct(c.pid, c.purl || ('https://www.tcgplayer.com/product/' + c.pid));
    else doSearch();
    toast('Loaded ' + (c.name || 'that card'));
}
$('dbc-x').addEventListener('click', () => $('dbc-back').classList.remove('on'));
$('dbc-back').addEventListener('mousedown', e => {
    if(e.target === $('dbc-back')) $('dbc-back').classList.remove('on');
});
$('dbc-q').addEventListener('input', dbcPaint);

/* ── feedback ──────────────────────────────────────────
   One conversation, with Alex, opened where you already are. It asks the server for that thread
   and nothing else — there is no list here and no route to anybody else's, because the only
   thing this button is for is telling somebody what went wrong while it is still in front of you. */
document.addEventListener('keydown',e=>{if(e.key==='Escape'){ $('db-back').classList.remove('on');$('dbc-back').classList.remove('on');}});
$('lg-tab').addEventListener('click', () => {
    lgView = lgView === 'out' ? 'active' : 'out';
    // The tick marks carry no meaning across the two lists, so they are dropped on the way.
    lgPick.clear(); lgOpen = '';
    lgPaint();
});
$('lg-hide').addEventListener('click', () => {
    const rows = ledger.filter(r => lgPick.has(r.id));
    if(!rows.length) return;
    rows.forEach(r => { r.out = true; });
    lgPick.clear(); lgOpen = '';
    lgSave(); lgPaint();
    toast(rows.length + ' set aside');
});
$('lg-show').addEventListener('click', () => {
    const rows = ledger.filter(r => lgPick.has(r.id));
    if(!rows.length) return;
    rows.forEach(r => { r.out = false; });
    lgPick.clear(); lgOpen = '';
    lgSave(); lgPaint();
    toast(rows.length + ' put back');
});

/* What the ticked rows come to. Market against buy, and the difference — which is the number the
   whole sheet exists to produce, so it is the one shown in colour.

   Rows with a figure missing are counted in the side they do have and left out of the other.
   Treating a blank as zero would quietly report a margin of 100%. */
const lgPick = new Set();
/* A set code and the card's number, which is how a card is written down on paper. Rows saved
   before the code was carried fall back to the number alone rather than showing nothing. */
function codeOf(r){
    return [r.code || '', r.num || ''].filter(Boolean).join(' ') || '\u2014';
}
/* Sealed or single. The server works this out from the card number, because TCGplayer's own
   sealed flag is false on booster boxes. Rows saved before that was asked for are read the same
   way here, so an old sheet does not sit there full of blanks. */
function kindOf(r){
    if(r.kind === 'sealed' || r.kind === 'single') return r.kind;
    return r.num ? 'single' : 'sealed';
}
/* Which way the sold prices have been going. trendRead needs four dated sales before it will
   say anything, and where there are fewer this says so rather than inventing a direction. */
function trendCell(r){
    const t = trendRead(r);
    if(t.drift == null) return '<span class="adv c-tr none">\u2014</span>';
    const pct = t.drift * 100;
    const cls = pct >= 5 ? 'up' : pct <= -5 ? 'dn' : 'flat';
    const mark = pct >= 5 ? '\u25b2' : pct <= -5 ? '\u25bc' : '\u2013';
    return '<span class="adv c-tr ' + cls + '" title="Across the dated sales on this card">'
         + mark + ' ' + (pct > 0 ? '+' : '') + pct.toFixed(0) + '%</span>';
}
/* How long ago the figures were pulled. Days, because that is the unit a price moves in — an
   hour is noise and a week is a different market. */
function syncAge(){
    const t = syncAt();
    if(!t) return null;
    const a = new Date(t), b = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    return Math.round((day(b) - day(a)) / 86400000);
}
function syncFresh(){
    const el = $('lg-fresh'); if(!el) return;
    const days = syncAge();
    el.classList.toggle('ok', days === 0);
    el.classList.toggle('old', days != null && days > 0);
    el.title = days == null
        ? 'Never synced. Sheet tools › Sync market pulls today\u2019s figures.'
        : 'Last synced ' + syncAtText() + ' \u00b7 '
          + (days === 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago');
}
/* One menu for everything that acts on the sheet rather than on a card. The buttons it stands in
   for are still there, hidden, so each one keeps the handler it always had. */
/* Everything that acts on the whole sheet, in one place — and the two that are a choice rather
   than an action open their choices underneath themselves. They used to reach across and press
   the other buttons in the header, which opened a second menu that the same click then closed
   on its way up to the document. */
$('lg-tools').addEventListener('click', ev => {
    ev.stopPropagation();
    const adv = document.body.classList.contains('lg-adv');
    const days = syncAge();
    lgMenu('lg-tout', [
        { label:adv ? 'Simple columns' : 'Advanced columns',
          note:adv ? 'card, set, prices and source'
                   : 'code, language, category and trend as well',
          run:() => advSet(!adv) },
        { sep:true },
        { label:'\u2211 Set market', note:'how every ticked card is priced', opts:marketOpts },
        { label:'% Set buyback', note:'what you pay against that price', opts:buyOpts },
        { sep:true },
        { label:'\u21bb Sync market',
          note:days == null ? 'never run \u2014 pull today\u2019s figures'
                            : days === 0 ? 'last run today'
                            : 'last run ' + days + ' day' + (days === 1 ? '' : 's') + ' ago',
          run:() => $('lg-sync').click() }
    ]);
});
document.addEventListener('click', () => {
    const pad = $('lg-tout'); if(pad) pad.classList.remove('on');
});
const ADV_KEY = 'ptcg-price-adv';
function advSet(on){
    document.body.classList.toggle('lg-adv', !!on);
    const b = $('lg-tools');
    if(b) b.classList.toggle('on', !!on);
    try{ localStorage.setItem(ADV_KEY, on ? '1' : '0'); }catch(_){}
}
$('lg-adv').addEventListener('click', () => advSet(!document.body.classList.contains('lg-adv')));
try{ advSet(localStorage.getItem(ADV_KEY) === '1'); }catch(_){ advSet(false); }
syncFresh();

function lgTotals(){
    const box = $('lg-sum'); if(!box) return;
    const rows = ledger.filter(r => lgPick.has(r.id));
    box.hidden = !rows.length;
    const delBtn = $('lg-del');
    if(delBtn) delBtn.hidden = !rows.length;
    const hb = $('lg-hide'), sb = $('lg-show');
    if(hb) hb.hidden = !rows.length || lgView === 'out';
    if(sb) sb.hidden = !rows.length || lgView !== 'out';
    if(!rows.length) return;
    let mk = 0, by = 0;
    rows.forEach(r => {
        if(r.market != null && isFinite(r.market)) mk += r.market;
        if(r.buy != null && isFinite(r.buy)) by += r.buy;
    });
    const diff = mk - by;
    $('sum-n').textContent = String(rows.length);
    $('sum-market').textContent = money(mk);
    $('sum-buy').textContent = money(by);
    $('sum-diff').textContent = money(diff);
    /* Against what it costs. Buy at 80% of market and this reads 25%: 20 over 80. The same
       spread against the sale price is 20%, which is the margin — a different number with a
       different name, and worth not mixing up on a sheet somebody prices stock from. */
    $('sum-pct').textContent = by > 0 ? (diff / by * 100).toFixed(1) + '%' : '—';
    $('sum-diff').parentNode.classList.toggle('neg', diff < 0);
    const del = $('lg-del');
    if(del) del.hidden = !rows.length;
    const hide = $('lg-hide'), show = $('lg-show');
    if(hide) hide.hidden = !rows.length || lgView === 'out';
    if(show) show.hidden = !rows.length || lgView !== 'out';
    const all = $('lg-all');
    if(all){
        all.checked = rows.length === ledger.length && ledger.length > 0;
        all.indeterminate = rows.length > 0 && rows.length < ledger.length;
    }
}

/* ── one card, opened out ─────────────────────────────────────────────────────
   Laid out the way the right column lays out a lookup: each side of the market gets its
   headline figures first, then the individual rows behind them. Nothing is written to the sheet
   until Submit, so picking about is free and the row underneath does not flicker while you
   think.

   Pending choices live on the panel rather than on the row. A half-made decision is not a
   decision, and a sheet that changed as you browsed would make the totals meaningless. */
let lgPending = null;
function lgDirty(){ return !!(lgPending && (lgPending.market != null || lgPending.buy != null)); }
function lgOpenPanel(r){
    lgPending = { id:r.id, market:null, marketFrom:'', buy:null, buyFrom:'', buyPct:null };

    const box = document.createElement('div');
    box.className = 'lg-open';
    const cols = document.createElement('div');
    cols.className = 'lg-cols2';
    const card = document.createElement('div'); card.className = 'lg-pane lg-card';
    card.innerHTML = (r.image
            ? '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + esc(r.image) + '">'
            : '<div class="noimg">no picture</div>')
        + '<div class="cn"></div><div class="cc"></div><div class="cs"></div>';
    card.querySelector('.cn').textContent = r.name || 'Untitled';
    card.querySelector('.cc').textContent = r.num ? '#' + r.num : '';
    card.querySelector('.cs').textContent = r.set || '';
    const im = card.querySelector('img');
    if(im) im.addEventListener('error', () => {
        const d2 = document.createElement('div');
        d2.className = 'noimg'; d2.textContent = 'no picture';
        im.replaceWith(d2);
    });
    /* A way to the card itself, under the line that names it — so the picture, the name and the
       link read as one block about one card rather than three separate offers. */
    if(r.url){
        const a = document.createElement('a');
        a.className = 'lg-visit';
        a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = '\u2197 View on ' + (r.from || 'TCGplayer');
        card.appendChild(a);
    }
    // Its figures can be fetched again without leaving the sheet.
    if(r.pid){
        const up = document.createElement('button');
        up.className = 'lg-refresh'; up.type = 'button';
        up.textContent = '↻ Update prices';
        up.addEventListener('click', () => refreshRow(r, up));
        card.appendChild(up);
    }
    const paneL = document.createElement('div'); paneL.className = 'lg-pane';
    const paneR = document.createElement('div'); paneR.className = 'lg-pane';
    cols.appendChild(card); cols.appendChild(paneL); cols.appendChild(paneR);
    box.appendChild(cols);

    const lo = (r.listings || []).slice(), sa = (r.sales || []).slice();
    const dated = (r.salesAt || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const latest = dated.length ? dated[dated.length - 1] : null;
    const fair = fairValue(lo, sa);

    // ── market ──
    const head = document.createElement('div');
    head.className = 'lg-sec'; head.textContent = 'Market price';
    paneL.appendChild(head);

    const chosen = document.createElement('div');
    chosen.className = 'lg-chosen';
    const paint = () => {
        const v = lgPending.market != null ? lgPending.market : r.market;
        const from = lgPending.market != null ? lgPending.marketFrom : (r.marketFrom || 'not set');
        chosen.innerHTML = '<span class="k">Will save</span><b>' + (money(v) || '—')
            + '</b><i>' + esc(from) + '</i>';
        mkSubmit.disabled = lgPending.market == null;
        [...paneL.querySelectorAll('[data-v]')].forEach(el =>
            el.classList.toggle('on', lgPending.market != null
                && Math.abs(parseFloat(el.dataset.v) - lgPending.market) < 0.005));
    };
    const pick = (v, from) => {
        lgPending.market = +Number(v).toFixed(2); lgPending.marketFrom = from;
        paint();
    };

    /* The headline readings for each side, then the rows they came from. The same three shapes
       on both sides, so one is read the same way as the other. */
    /* Each side of the market in its own column, laid out the way the right column lays out a
       lookup — the same rows, the same gold star, the same detail on hover. A price on its own
       does not say whether it is a damaged copy from an unrated seller. */
    /* The one figure that answers the question sits above the two that argue about it. */
    if(fair != null){
        const fb = document.createElement('button');
        fb.type = 'button'; fb.className = 'lg-fair'; fb.dataset.v = fair;
        fb.title = FAIR_WHY;
        fb.innerHTML = '<i>Fair market (A9)</i><b>' + money(fair) + '</b>'
                     + '<u>offers and sold, weighted to sold</u>';
        fb.addEventListener('click', () => pick(fair, 'Fair market (A9)'));
        paneL.appendChild(fb);
    }
    const two = document.createElement('div');
    two.className = 'lg-sides';
    paneL.appendChild(two);
    const group = (title, arr, full, kind) => {
        if(!arr.length) return;
        const col = document.createElement('div');
        col.className = 'lg-side lg-box';
        const sorted = arr.slice().sort((a, b) => a - b);
        // The mean, not the middle: it is the figure people mean when they say average.
        const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
        let h = '<div class="lg-sec sub">' + esc(title) + '  ·  ' + arr.length + '</div>'
              + '<div class="lg-picks">';
        [['Lowest', sorted[0]], ['Avg', avg], ['Highest', sorted[sorted.length - 1]]]
            .forEach(([label, v]) => {
                h += '<button type="button" data-v="' + v + '" data-from="' + esc(kind + ' ' + label.toLowerCase())
                   + '">' + label + '<b>' + money(v) + '</b></button>';
            });
        h += '</div>';
        col.innerHTML = h;

        const list = document.createElement('div');
        list.className = 'lg-rows2';
        const recs = (full && full.length) ? full.slice() : sorted.map(v => ({ total:v }));
        recs.sort((a, b) => (+a.total) - (+b.total));
        let land = 0;
        recs.forEach(o => {
            const v = +o.total;
            if(!isFinite(v)) return;
            const bits = [o.grade || o.condition, o.loc || '',
                          o.seller ? o.seller + (o.rating ? ' ' + o.rating + '%' : '') : '',
                          o.date || '', o.qty > 1 ? ('x' + o.qty) : '',
                          o.ship ? ('+' + money(o.ship) + ' post') : 'free post'].filter(Boolean);
            const row = document.createElement('button');
            row.type = 'button'; row.className = 'lg-r2 land'; row.dataset.v = v;
            row.style.setProperty('--i', String(Math.min(land++, 22)));
            row.dataset.from = 'one ' + kind;
            row.title = bits.join('  ·  ');
            row.innerHTML = '<span class="a">' + money(v) + '</span>'
                + (o.gold ? '<span class="st" title="Gold-star seller">★</span>' : '')
                + '<span class="c">' + esc(o.grade || o.condition || '') + '</span>'
                + '<span class="s">' + esc(o.seller || o.date || '') + '</span>';
            if(latest && kind === 'sold' && Math.abs(v - latest.v) < 0.005){
                row.classList.add('latest');
                row.title = 'Most recent sale · ' + row.title;
            }
            list.appendChild(row);
        });
        col.appendChild(list);
        two.appendChild(col);
        // One handler for the column rather than one per row.
        col.addEventListener('click', ev => {
            const b = ev.target.closest('[data-v]');
            if(b) pick(parseFloat(b.dataset.v), b.dataset.from || kind);
        });
    };

    group('Recently sold', sa, r.saFull, 'sold');
    group('Current offers', lo, r.loFull, 'offer');

    const own = document.createElement('div');
    own.className = 'lg-own';
    own.innerHTML = '<input type="number" step="0.01" min="0" placeholder="your own">'
                  + '<button type="button">Use</button>';
    own.querySelector('button').addEventListener('click', () => {
        const v = parseFloat(own.querySelector('input').value);
        if(isFinite(v) && v >= 0) pick(v, 'typed in');
    });
    paneL.appendChild(own);
    paneL.appendChild(chosen);
    const mkSubmit = document.createElement('button');
    mkSubmit.className = 'lg-submit'; mkSubmit.type = 'button';
    mkSubmit.textContent = 'Submit market price';
    mkSubmit.disabled = true;
    mkSubmit.addEventListener('click', () => {
        r.market = lgPending.market; r.marketFrom = lgPending.marketFrom;
        reprice(r);
        lgPending.market = null; lgPending.marketFrom = '';
        lgSave(); lgFlash(r.id, 'mk'); paint();
    });
    paneL.appendChild(mkSubmit);

    // ── buy ──
    const bh = document.createElement('div');
    bh.className = 'lg-sec'; bh.textContent = 'Buy value';
    paneR.appendChild(bh);

    const base = () => lgPending.market != null ? lgPending.market : r.market;
    const bChosen = document.createElement('div');
    bChosen.className = 'lg-chosen';
    const bPaint = () => {
        const v = lgPending.buy != null ? lgPending.buy : r.buy;
        const from = lgPending.buy != null ? lgPending.buyFrom : (r.buyFrom || 'not set');
        bChosen.innerHTML = '<span class="k">Will save</span><b>' + (money(v) || '—')
            + '</b><i>' + esc(from) + '</i>';
        buySubmit.disabled = lgPending.buy == null;
    };
    const setPct = (q) => {
        const m = base();
        if(m == null || !isFinite(m)){ toast('Set a market price first.', true); return; }
        lgPending.buyPct = q;
        lgPending.buy = +(m * (q / 100)).toFixed(2);
        lgPending.buyFrom = q + '% of market';
        pctOut.textContent = q + '%';
        slider.value = q;
        bPaint();
    };

    const srow = document.createElement('div');
    srow.className = 'lg-slide';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
    slider.value = String(r.buyPct == null ? 60 : r.buyPct);
    const pctOut = document.createElement('b');
    pctOut.textContent = slider.value + '%';
    // Free to drag anywhere, but it settles on fives — which is how these rates are actually
    // quoted, and stops a drag landing on 63%.
    slider.addEventListener('input', () => setPct(Math.round(slider.value / 5) * 5));
    srow.appendChild(slider); srow.appendChild(pctOut);
    paneR.appendChild(srow);

    const bown = document.createElement('div');
    bown.className = 'lg-own';
    bown.innerHTML = '<input type="number" step="1" min="0" max="100" placeholder="%">'
                   + '<button type="button">Use %</button>';
    bown.querySelector('button').addEventListener('click', () => {
        const q = parseFloat(bown.querySelector('input').value);
        if(isFinite(q) && q >= 0) setPct(q);
    });
    paneR.appendChild(bown);

    const bflat = document.createElement('div');
    bflat.className = 'lg-own';
    bflat.innerHTML = '<input type="number" step="0.01" min="0" placeholder="flat amount">'
                    + '<button type="button">Use</button>';
    bflat.querySelector('button').addEventListener('click', () => {
        const v = parseFloat(bflat.querySelector('input').value);
        if(!isFinite(v) || v < 0) return;
        lgPending.buy = +v.toFixed(2); lgPending.buyFrom = 'flat rate'; lgPending.buyPct = null;
        bPaint();
    });
    paneR.appendChild(bflat);
    paneR.appendChild(bChosen);
    const buySubmit = document.createElement('button');
    buySubmit.className = 'lg-submit'; buySubmit.type = 'button';
    buySubmit.textContent = 'Submit buy value';
    buySubmit.disabled = true;
    buySubmit.addEventListener('click', () => {
        r.buy = lgPending.buy; r.buyFrom = lgPending.buyFrom; r.buyPct = lgPending.buyPct;
        lgPending.buy = null; lgPending.buyFrom = '';
        lgSave(); lgFlash(r.id, 'by'); bPaint();
    });
    paneR.appendChild(buySubmit);

    if(r.url){
        const go = document.createElement('div');
        go.className = 'lg-own';
        go.innerHTML = '<button type="button">↗ Open on ' + esc(r.from || 'TCGplayer') + '</button>';
        go.querySelector('button').addEventListener('click', () => {
            try{ window.open(r.url, '_blank', 'noopener'); }catch(_){}
        });
        paneR.appendChild(go);
    }

    if(TREND_ON){
        const tr = trendPanel(r);
        if(tr) box.appendChild(tr);
    }
    paint(); bPaint();
    return box;
}
/* ── an experimental read on supply and demand ────────────────────────────────
   Marked experimental on purpose, and easy to switch off. What follows is inference from two
   small samples, not a market feed, and it is labelled as such wherever it is shown.

   What can honestly be said from what we hold:

     supply   — how many are on sale and how tightly they are priced. A wall of listings at
                nearly the same price is a deep supply; three listings spread wide is a thin one.
     demand   — what has actually sold against what is being asked. If sales are landing at or
                above the asking prices, buyers are taking them; if sales sit well under, the
                asking prices are aspirational.
     trend    — sales in date order, split in half, earlier against later. With a handful of
                sales this is a hint and nothing more, so the sample size is always shown.

   Nothing here is a forecast. It describes the numbers we already have. */
const TREND_ON = true;
/* ── where the floor is, and how crowded it is ────────────────────────────────
   The first version drew abstract bars for "supply" and "demand" and said nothing a person could
   act on. This asks the two questions somebody actually has when deciding whether to buy:

     how low is the bottom?   the cheapest listing against what things have been selling for
     how crowded is it?       how many listings sit within reach of that bottom

   A cheap listing on its own is one seller in a hurry. A cheap listing with six more just above
   it is a queue, and the next sale happens down there rather than at the average. That is the
   thing worth knowing, and it is stated in figures rather than drawn as a gauge. */
function trendRead(r){
    const lo = (r.listings || []).slice().sort((a,b)=>a-b);
    const sa = (r.sales || []).slice().sort((a,b)=>a-b);
    const dated = (r.salesAt || []).slice()
        .filter(x => x.at).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
    const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
    const t = { lo, sa, dated, nLo:lo.length, nSa:sa.length };
    t.floor   = lo.length ? lo[0] : null;          // cheapest thing on sale
    t.soldAvg = mean(sa);
    t.soldLow = sa.length ? sa[0] : null;
    t.askAvg  = mean(lo);
    t.latest  = dated.length ? dated[dated.length-1] : null;

    /* How far under the going rate the floor is. Negative means the cheapest listing is already
       below what people have been paying — the direction that drags a price down. */
    if(t.floor != null && t.soldAvg) t.floorGap = (t.floor - t.soldAvg) / t.soldAvg;
    // Within a tenth of the floor is "in the queue at the bottom".
    if(t.floor != null){
        t.near = lo.filter(v => v <= t.floor * 1.10).length;
        t.nearPct = t.near / lo.length;
    }
    if(dated.length >= 4){
        const h = Math.floor(dated.length/2);
        const a1 = mean(dated.slice(0,h).map(x=>x.v)), a2 = mean(dated.slice(h).map(x=>x.v));
        if(a1) t.drift = (a2 - a1) / a1;
    }
    return t;
}
/* One sentence, earned by the figures above it. Deliberately hedged where the sample is thin —
   three listings is not a market. */
function trendVerdict(t){
    if(t.nLo < 2 && t.nSa < 2) return null;
    const crowded = t.nearPct != null && t.nearPct >= 0.4 && t.near >= 3;
    const under   = t.floorGap != null && t.floorGap <= -0.10;
    const falling = t.drift != null && t.drift <= -0.05;
    const rising  = t.drift != null && t.drift >= 0.05;
    if(under && crowded)
        return { tone:'warn', text:'Prices look likely to fall. The cheapest listing is well '
            + 'under what has been selling, and it is not alone — ' + t.near + ' of ' + t.nLo
            + ' are down there. A buyer takes the bottom of that queue, not the average.' };
    if(under)
        return { tone:'warn', text:'Somebody is undercutting. The cheapest listing is below the '
            + 'going rate, but only ' + t.near + ' of ' + t.nLo + ' are near it, so it may just '
            + 'be one seller in a hurry.' };
    if(crowded && falling)
        return { tone:'warn', text:'Supply is stacked at the bottom and recent sales are drifting '
            + 'down. Expect the next one to go near the floor.' };
    if(crowded)
        return { tone:'flat', text:t.near + ' of ' + t.nLo + ' listings sit within 10% of the '
            + 'cheapest. That is a queue at the bottom — the next sale probably happens there '
            + 'rather than at the average.' };
    if(rising)
        return { tone:'good', text:'Recent sales are drifting up and nothing is stacked at the '
            + 'bottom. There is room to ask above the average.' };
    if(falling)
        return { tone:'warn', text:'Recent sales are drifting down, though the listings are not '
            + 'bunched at the floor yet.' };
    return { tone:'flat', text:'Listings are spread out and sales are steady. The average is a '
        + 'fair reading.' };
}
function trendPanel(r){
    const t = trendRead(r);
    if(!t.nLo && !t.nSa) return null;
    const box = document.createElement('div');
    box.className = 'lg-trend';

    const pc = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(0) + '%';
    const fig = (k, v, note, tone) =>
        '<div class="sd-f' + (tone ? ' ' + tone : '') + '"><i>' + esc(k) + '</i><b>' + v + '</b>'
        + (note ? '<u>' + esc(note) + '</u>' : '') + '</div>';

    let html = '<div class="tr-h">Where the floor is <span>experimental · '
             + t.nLo + ' on sale, ' + t.nSa + ' sold</span></div><div class="sd-figs">';
    if(t.floor != null)
        html += fig('Cheapest on sale', money(t.floor),
            t.floorGap != null ? pc(t.floorGap) + ' vs sold average' : '',
            t.floorGap != null && t.floorGap <= -0.10 ? 'warn' : '');
    if(t.soldAvg != null) html += fig('Sold average', money(t.soldAvg), t.nSa + ' sales', '');
    if(t.soldLow != null) html += fig('Cheapest sold', money(t.soldLow), '', '');
    if(t.latest) html += fig('Latest sale', money(t.latest.v), t.latest.at || '', '');
    html += '</div>';

    /* The listings drawn against the range they occupy, with the bottom tenth shaded — so a wall
       of sellers at the floor looks like a wall rather than reading as a number. */
    if(t.nLo > 1){
        const min = t.lo[0], max = t.lo[t.lo.length-1], span = (max - min) || 1;
        html += '<div class="sd-strip"><div class="sd-zone" style="width:'
             + Math.min(100, Math.round((t.floor * 1.10 - min) / span * 100)) + '%"></div>';
        t.lo.forEach(v => {
            html += '<i style="left:' + Math.round((v - min) / span * 100) + '%"></i>';
        });
        if(t.soldAvg != null && t.soldAvg >= min && t.soldAvg <= max)
            html += '<s style="left:' + Math.round((t.soldAvg - min) / span * 100) + '%"></s>';
        html += '</div><div class="sd-ends"><span>' + money(min) + '</span>'
             + '<span class="mid">shaded: within 10% of the cheapest'
             + (t.soldAvg != null ? ' · line: sold average' : '') + '</span>'
             + '<span>' + money(max) + '</span></div>';
    }
    if(t.nearPct != null)
        html += '<div class="sd-bunch"><b>' + t.near + ' of ' + t.nLo + '</b> listings ('
             + Math.round(t.nearPct * 100) + '%) are within 10% of the cheapest.</div>';

    const v = trendVerdict(t);
    if(v) html += '<div class="sd-say ' + v.tone + '">' + esc(v.text) + '</div>';
    if(t.drift == null && t.nSa)
        html += '<div class="tr-note">Not enough dated sales to read a direction — four are '
              + 'needed and there are ' + t.dated.length + '.</div>';
    html += '<div class="tr-note">Read from the figures on this card alone. Treat it as a hint, '
          + 'not a forecast.</div>';
    box.innerHTML = html;
    return box;
}

/* The row is not redrawn on submit — that would close the panel underneath the press. Only the
   cell that changed is touched, and it is lit briefly so the change is seen where it landed. */
function lgFlash(id, which){
    const rows = [...document.querySelectorAll('#lg-rows .lg-row')];
    const r = ledger.filter(x => lgView === 'out' ? x.out : !x.out).findIndex(x => x.id === id);
    const el = rows[r] && rows[r].querySelector('.c-n.' + which);
    if(!el) return;
    const rec = ledger.find(x => x.id === id);
    const v = which === 'mk' ? rec.market : rec.buy;
    el.textContent = money(v) || '—';
    el.classList.toggle('em', v == null);
    el.classList.remove('flash');
    void el.offsetWidth;                 // restart the animation rather than ignore a repeat
    el.classList.add('flash');
    lgTotals();
}
// Its figures again, without leaving the sheet or losing the row.
async function refreshRow(r, btn){
    if(!r.pid) return;
    const was = btn.textContent;
    btn.disabled = true; btn.textContent = 'Updating…';
    try{
        const p2 = new URLSearchParams();
        p2.set('productId', String(r.pid));
        if((state.conds||[]).length) p2.set('conditions', state.conds.join('|'));
        const d = await getJSON('/api/tcg?' + p2.toString());
        if(d && !d.error){
            const nums = l => (l||[]).map(o => +o.total).filter(n => isFinite(n) && n > 0).sort((a,b)=>a-b);
            r.listings = nums(d.listings);
            r.sales = nums(d.sales);
            r.salesAt = (d.sales||[]).map(x => ({ v:+x.total, at:x.date || '' }))
                                     .filter(x => isFinite(x.v) && x.v > 0);
            r.loFull = (d.listings||[]).slice(0, 60).map(o => Object.assign({}, o));
            r.saFull = (d.sales||[]).slice(0, 60).map(o => Object.assign({}, o));
            r.at = Date.now();
            reprice(r);
            lgSave(); lgPaint();
            toast('Updated · ' + r.listings.length + ' on sale, ' + r.sales.length + ' sold');
            return;
        }
        toast((d && d.error) || 'Could not update that one', true);
    }catch(_){ toast('Could not access local storage', true); }
    btn.disabled = false; btn.textContent = was;
}

/* Out as a spreadsheet, with Sale as an empty column rather than a missing one — the sheet is
   meant to be finished somewhere else. */
// Whatever is ticked, or everything if nothing is — the obvious reading of a button pressed
// with no selection made.
function lgRows(){
    const picked = ledger.filter(r => lgPick.has(r.id));
    /* Set-aside rows are out of the reckoning as well as out of sight — a total or an export
       that quietly included them would make putting one aside meaningless. */
    return picked.length ? picked : ledger.filter(r => !r.out);
}
const LG_HEAD = ['Card','Number','Set','Market','Market from','Buy','Buy from','Sale',
                 'Source','Source link','Saved'];
function lgTable(){
    return lgRows().map(r => [r.name, r.num, r.set,
        r.market == null ? '' : r.market.toFixed(2), r.marketFrom,
        r.buy == null ? '' : r.buy.toFixed(2), r.buyFrom,
        '', r.from || '', r.url || '', new Date(r.at).toLocaleString()]);
}
function lgDrop(name, text, type){
    const blob = new Blob([text], { type: type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
}
const lgStamp = () => new Date().toISOString().slice(0,10);
function lgCsv(){
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [LG_HEAD].concat(lgTable());
    lgDrop('card-prices-' + lgStamp() + '.csv',
           rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
}
// Tabs paste straight into a sheet, which is what most people actually do with this.
function lgTsv(){
    const rows = [LG_HEAD].concat(lgTable());
    const text = rows.map(r => r.map(v => String(v == null ? '' : v)
        .replace(/[\t\r\n]/g, ' ')).join('\t')).join('\r\n');
    if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text)
            .then(() => toast('Copied ' + lgRows().length + ' rows — paste into a sheet'))
            .catch(() => lgDrop('card-prices-' + lgStamp() + '.tsv', text, 'text/tab-separated-values'));
        return;
    }
    lgDrop('card-prices-' + lgStamp() + '.tsv', text, 'text/tab-separated-values');
}
/* Excel opens this without the import dialog CSV triggers, and it is still only text — writing
   a real .xlsx would mean a zip container and a pile of XML for no gain here. */
function lgXls(){
    const cell = v => '<td>' + String(v == null ? '' : v)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</td>';
    const body = [LG_HEAD].concat(lgTable())
        .map(r => '<tr>' + r.map(cell).join('') + '</tr>').join('');
    lgDrop('card-prices-' + lgStamp() + '.xls',
        '<html><head><meta charset="utf-8"></head><body><table>' + body + '</table></body></html>',
        'application/vnd.ms-excel');
}
function lgJson(){
    lgDrop('card-prices-' + lgStamp() + '.json',
        JSON.stringify(lgRows().map(r => ({ name:r.name, number:r.num, set:r.set,
            market:r.market, marketFrom:r.marketFrom, buy:r.buy, buyFrom:r.buyFrom,
            sale:null, source:r.from || '', url:r.url, language:r.lang || '',
            saved:r.at })), null, 2), 'application/json');
}
/* ── on paper ────────────────────────────────────────────────────────────────
   The other exports hand the rows to another program. This one is the end of the line: a list
   somebody prints, initials, and puts in a folder.

   It ignores the tick boxes on purpose. A printed sheet is a statement of what is in the pile,
   and half a pile with a total under it is a document that will be read as the whole thing six
   months from now. Set-aside cards are still out, because putting one aside is what taking it
   out of the reckoning means. */
function lgPaperRows(){ return ledger.filter(r => !r.out); }
function lgPaperSums(rows){
    let market = 0, buy = 0, mn = 0, bn = 0;
    rows.forEach(r => {
        if(r.market != null && isFinite(r.market)){ market += r.market; mn++; }
        if(r.buy != null && isFinite(r.buy)){ buy += r.buy; bn++; }
    });
    return { market: market, buy: buy, mn: mn, bn: bn, spread: market - buy };
}
const PAPER_TITLE = 'Card prices \u2014 Arcane 9 Labs';
function lgPaperWhen(){
    return new Date().toLocaleString([], { year:'numeric', month:'short', day:'numeric',
                                           hour:'2-digit', minute:'2-digit' });
}
/* Letter paper, half-inch margins, and a row height that fits about fifty to a page. The head
   repeats itself on every sheet because a second page of bare numbers is unreadable. */
function lgPaperHtml(){
    const rows = lgPaperRows(), sum = lgPaperSums(rows);
    const cell = v => String(v == null ? '' : v)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const cash = v => (v == null || !isFinite(v)) ? '\u2014' : '$' + Number(v).toFixed(2);
    const body = rows.map((r, i) =>
        '<tr><td class="n">' + (i + 1) + '</td><td>' + cell(r.name) + '</td>'
      + '<td class="q">' + cell(r.num) + '</td><td class="sm">' + cell(r.set) + '</td>'
      + '<td class="q r">' + cash(r.market) + '</td><td class="q r">' + cash(r.buy) + '</td></tr>'
    ).join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + PAPER_TITLE + '</title>'
      + '</head><body>'
      + '<h1>' + PAPER_TITLE + '</h1>'
      + '<div class="when">' + cell(lgPaperWhen()) + ' \u00b7 ' + rows.length
      + (rows.length === 1 ? ' card' : ' cards') + '</div>'
      + '<table><thead><tr><th></th><th>Card</th><th>Number</th><th>Set</th>'
      + '<th class="r">Market</th><th class="r">Buy</th></tr></thead>'
      + '<tbody>' + body + '</tbody>'
      + '<tfoot><tr><td></td><td colspan="3">Total, all ' + rows.length + '</td>'
      + '<td class="q r">' + cash(sum.market) + '</td>'
      + '<td class="q r">' + cash(sum.buy) + '</td></tr></tfoot></table>'
      + '<div class="sums">'
      + '<div>Market total <b>' + cash(sum.market) + '</b> across ' + sum.mn + ' priced'
      + (sum.mn === rows.length ? '' : ' of ' + rows.length) + '</div>'
      + '<div>Buy total <b>' + cash(sum.buy) + '</b> across ' + sum.bn + ' with a buy price</div>'
      + '<div>Spread <b>' + cash(sum.spread) + '</b></div>'
      + '</div></body></html>';
}
/* Printing an iframe rather than the page itself: the sheet has its own layout and the page it
   came from has nothing worth putting on paper. Whether that becomes a PDF is the print
   dialog's business, which is where people already know to look for it. */
function lgPdf(){
    const rows = lgPaperRows();
    if(!rows.length){ toast('Nothing to print.', true); return; }
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
    f.srcdoc = lgPaperHtml();
    f.onload = () => {
        try{
            f.contentWindow.focus();
            f.contentWindow.print();
        }catch(_){ toast('Could not open the print dialog', true); }
        setTimeout(() => f.remove(), 60000);
    };
    document.body.appendChild(f);
    toast(rows.length + ' cards \u00b7 choose Save as PDF in the dialog');
}
/* The same sheet drawn straight onto a canvas. There is no library here to turn HTML into a
   picture, and adding one to draw six columns of text would be a lot of weight for something a
   canvas does in forty lines. 200 dpi, so it holds up printed as well as on screen. */
const PG_W = 1700, PG_H = 2200, PG_M = 100, PG_ROW = 34;
function lgPngPage(rows, from, count, page, pages, sum){
    const c = document.createElement('canvas');
    c.width = PG_W; c.height = PG_H;
    const x = c.getContext('2d');
    const F = ' -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
    const cash = v => (v == null || !isFinite(v)) ? '\u2014' : '$' + Number(v).toFixed(2);
    x.fillStyle = '#fff'; x.fillRect(0, 0, PG_W, PG_H);
    x.textBaseline = 'alphabetic';

    let y = PG_M + 30;
    x.fillStyle = '#111'; x.font = '700 30px' + F;
    x.fillText(PAPER_TITLE, PG_M, y);
    y += 26;
    x.fillStyle = '#666'; x.font = '17px' + F;
    x.fillText(lgPaperWhen() + '  \u00b7  ' + count + (count === 1 ? ' card' : ' cards')
             + (pages > 1 ? '  \u00b7  page ' + page + ' of ' + pages : ''), PG_M, y);

    // Columns, right-aligned where the figures are so the decimal points line up.
    const C = { n:PG_M, name:PG_M + 46, num:PG_M + 640, set:PG_M + 870, mk:PG_W - PG_M - 150,
                buy:PG_W - PG_M };
    y += 46;
    x.fillStyle = '#555'; x.font = '700 14px' + F;
    const head = (t, at, right) => {
        x.textAlign = right ? 'right' : 'left';
        x.fillText(t.toUpperCase(), at, y);
    };
    head('Card', C.name); head('Number', C.num); head('Set', C.set);
    head('Market', C.mk, true); head('Buy', C.buy, true);
    x.textAlign = 'left';
    y += 8;
    x.strokeStyle = '#222'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(PG_M, y); x.lineTo(PG_W - PG_M, y); x.stroke();

    // Clipped rather than overflowing, or a long set name would run through the next column.
    const clip = (t, w) => {
        t = String(t == null ? '' : t);
        if(x.measureText(t).width <= w) return t;
        while(t.length > 1 && x.measureText(t + '\u2026').width > w) t = t.slice(0, -1);
        return t + '\u2026';
    };
    rows.forEach((r, i) => {
        y += PG_ROW;
        if(i % 2){ x.fillStyle = '#f5f5f6'; x.fillRect(PG_M, y - PG_ROW + 9, PG_W - PG_M * 2, PG_ROW); }
        const base = y - 2;
        x.font = '15px' + F; x.fillStyle = '#aaa'; x.textAlign = 'left';
        x.fillText(String(from + i + 1), C.n, base);
        x.font = '19px' + F; x.fillStyle = '#111';
        x.fillText(clip(r.name, C.num - C.name - 20), C.name, base);
        x.font = '17px ui-monospace,Menlo,Consolas,monospace'; x.fillStyle = '#444';
        x.fillText(clip(r.num, C.set - C.num - 20), C.num, base);
        x.font = '16px' + F; x.fillStyle = '#666';
        x.fillText(clip(r.set, C.mk - C.set - 110), C.set, base);
        x.font = '18px ui-monospace,Menlo,Consolas,monospace'; x.fillStyle = '#111';
        x.textAlign = 'right';
        x.fillText(cash(r.market), C.mk, base);
        x.fillStyle = (r.buy == null || !isFinite(r.buy)) ? '#bbb' : '#111';
        x.fillText(cash(r.buy), C.buy, base);
        x.textAlign = 'left';
    });

    // The totals go on the last sheet, and they are the totals for every card, not this page's.
    if(page === pages){
        y += 30;
        x.strokeStyle = '#222'; x.lineWidth = 2;
        x.beginPath(); x.moveTo(PG_M, y); x.lineTo(PG_W - PG_M, y); x.stroke();
        y += 34;
        x.font = '700 19px' + F; x.fillStyle = '#111';
        x.fillText('Total, all ' + count + (count === 1 ? ' card' : ' cards'), C.name, y);
        x.font = '700 20px ui-monospace,Menlo,Consolas,monospace';
        x.textAlign = 'right';
        x.fillText(cash(sum.market), C.mk, y);
        x.fillText(cash(sum.buy), C.buy, y);
        x.textAlign = 'left';
        y += 30;
        x.font = '16px' + F; x.fillStyle = '#555';
        x.fillText('Spread ' + cash(sum.spread) + '  \u00b7  ' + sum.mn + ' priced  \u00b7  '
                 + sum.bn + ' with a buy price', C.name, y);
    }
    return c;
}
function lgPng(){
    const all = lgPaperRows();
    if(!all.length){ toast('Nothing to draw.', true); return; }
    const sum = lgPaperSums(all);
    // Room for the totals block on the last sheet, so it never lands past the bottom edge.
    const per = Math.floor((PG_H - PG_M * 2 - 240) / PG_ROW);
    const pages = Math.max(1, Math.ceil(all.length / per));
    const stamp = lgStamp();
    for(let i = 0; i < pages; i++){
        const slice = all.slice(i * per, (i + 1) * per);
        const c = lgPngPage(slice, i * per, all.length, i + 1, pages, sum);
        const name = 'card-prices-' + stamp + (pages > 1 ? '-p' + (i + 1) : '') + '.png';
        // Staggered, because a browser handed five downloads in the same tick drops most of them.
        setTimeout(() => c.toBlob(b => {
            if(!b) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b); a.download = name;
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
        }, 'image/png'), i * 320);
    }
    toast(all.length + ' cards on ' + pages + (pages === 1 ? ' sheet' : ' sheets'));
}

/* Cloud sheets. Nothing here talks to Google or Microsoft — that needs an account connection
   this site does not have, and pretending otherwise would be a button that fails on press. What
   it does instead is open a new sheet and put the rows on the clipboard, so it is one paste. */
function lgCloud(where){
    lgTsv();
    const url = where === 'google' ? 'https://sheets.new'
              : 'https://office.live.com/start/Excel.aspx';
    setTimeout(() => { try{ window.open(url, '_blank', 'noopener'); }catch(_){} }, 260);
}
$('lg-all').addEventListener('click', () => {
    const every = ledger.every(r => lgPick.has(r.id));
    lgPick.clear();
    if(!every) ledger.forEach(r => lgPick.add(r.id));
    lgPaint();
});
/* One menu rather than a row of buttons: this is a thing you do occasionally and in one of
   several ways, which is exactly what a menu is for.

   The choices are written once here and read by both the button in the header and the one menu
   that gathers all three together, so a rate added in this list appears in both places rather
   than in whichever of the two somebody remembered to edit. */
function lgScope(){
    const rows = lgRows();
    return lgPick.size ? (lgPick.size + ' selected') : (rows.length + ' rows');
}
/* Three ways of answering "what is this worth" applied to everything ticked at once, since the
   answer is usually the same policy for a whole pile rather than a decision per card. */
function marketOpts(){
    const some = lgScope();
    const out = [['Set market to average', 'our model · offers and sold, weighted to sold', 'fair'],
                 ['Lowest available', 'the cheapest thing on sale right now', 'low'],
                 ['Lowest sold recent', 'the cheapest of what actually sold', 'sold'],
                 ['Highest recent sold', 'the dearest of what actually sold', 'soldhi']]
        .map(r => ({ label:r[0], note:r[1] + ' · ' + some,
                     run:() => applyPricing(r[2]) }));
    out.push({ sep:true });
    out.push({ label:'Help me decide',
               note:'what each way of pricing does to the pile · ' + some,
               run:() => showDecide() });
    return out;
}
/* The same idea on the buy side. A buyback rate is a policy for a pile rather than a decision
   per card, so it is applied to everything ticked at once. */
function buyOpts(){
    const some = lgScope();
    // The rates a counter actually offers, off whatever each card's market price already is.
    const out = [40, 50, 60, 65, 70, 75, 80].map(q => ({
        label:q + '% of market', note:'each card against its own market price · ' + some,
        run:() => applyBuy({ pct:q }) }));
    out.push({ sep:true });
    out.push({ label:'Your own percentage…', note:'a rate that is not on the list · ' + some,
        run:() => {
            const q = parseFloat(window.prompt('Buy at what percentage of market?', '60'));
            if(isFinite(q) && q >= 0) applyBuy({ pct:q });
        } });
    out.push({ label:'A flat amount…', note:'the same figure on every one of them · ' + some,
        run:() => {
            const v = parseFloat(window.prompt('Buy every selected card at what price?', ''));
            if(isFinite(v) && v >= 0) applyBuy({ flat:v });
        } });
    out.push({ label:'Clear the buy column', note:'leaves the market prices alone · ' + some,
        run:() => applyBuy({ clear:true }) });
    return out;
}
/* Every menu on the sheet, shut. A choice that runs something closes all of them; a choice that
   only opens more of itself closes none, and stops the click before it reaches the handler that
   would. */
function lgShut(){
    ['lg-tout', 'lg-pout', 'lg-bout', 'lg-out'].forEach(id => {
        const p = $(id); if(p) p.classList.remove('on');
    });
}
function lgFill(pad, items, depth){
    items.forEach(o => {
        if(o.sep){
            const d = document.createElement('div'); d.className = 'sep'; pad.appendChild(d);
            return;
        }
        const b = document.createElement('button');
        b.type = 'button';
        if(depth) b.className = 'sub';
        b.innerHTML = esc(o.label) + (o.note ? '<small>' + esc(o.note) + '</small>' : '');
        if(o.opts){
            b.classList.add('more');
            const kids = document.createElement('div');
            kids.className = 'lg-sub';
            lgFill(kids, o.opts(), (depth || 0) + 1);
            b.addEventListener('click', ev => {
                ev.stopPropagation();
                kids.classList.toggle('on', b.classList.toggle('open'));
            });
            pad.appendChild(b); pad.appendChild(kids);
            return;
        }
        b.addEventListener('click', () => { lgShut(); o.run(); });
        pad.appendChild(b);
    });
}
function lgMenu(id, items){
    const pad = $(id);
    if(!pad) return;
    if(pad.classList.contains('on')){ pad.classList.remove('on'); return; }
    lgShut();
    pad.innerHTML = '';
    lgFill(pad, items, 0);
    pad.classList.add('on');
}
$('lg-price').addEventListener('click', (ev) => {
    ev.stopPropagation();
    lgMenu('lg-pout', marketOpts());
});
document.addEventListener('click', () => {
    const pad = $('lg-pout'); if(pad) pad.classList.remove('on');
});
/* Each way of reading a market price, in one place, so a sync can re-apply whichever one was
   chosen for a card instead of imposing its own. */
const MARKET_RULE = {
    fair:   (lo, sa) => fairValue(lo, sa),
    low:    (lo) => lo.length ? Math.min.apply(null, lo) : null,
    sold:   (lo, sa) => sa.length ? Math.min.apply(null, sa) : null,
    soldhi: (lo, sa) => sa.length ? Math.max.apply(null, sa) : null
};
const RULE_NAME = { fair:'Fair market (A9)', low:'lowest available',
                    sold:'lowest sold recent', soldhi:'highest recent sold' };
/* Rows saved before there was a rule to record carry only the words, so the words map back.
   Anything else — a figure typed in, or a price taken off one particular listing — is a decision
   somebody made about that card, and nothing here is entitled to overwrite it. */
function ruleOf(r){
    if(r.marketRule && MARKET_RULE[r.marketRule]) return r.marketRule;
    const from = String(r.marketFrom || '').toLowerCase();
    for(const k in RULE_NAME) if(from.indexOf(RULE_NAME[k].toLowerCase()) === 0) return k;
    return '';
}
async function applyPricing(how){
    const rows = lgRows();
    if(!rows.length){ toast('Nothing to price.', true); return; }
    /* Said before it happens, not after. The model is ours and somebody pricing stock off it
       deserves to know what it is doing before it overwrites a column. */
    if(how === 'fair'){
        const ok = await lgAsk({ title:'Set market to average',
            yes:'Set ' + rows.length + ' card' + (rows.length === 1 ? '' : 's'),
            body: esc(FAIR_WHY) });
        if(!ok) return;
    }
    let done = 0, skipped = 0;
    rows.forEach(r => {
        const lo = r.listings || [], sa = r.sales || [];
        let v = null, from = '';
        if(how === 'fair'){ v = fairValue(lo, sa); from = 'Fair market (A9)'; }
        else if(how === 'low'){ v = lo.length ? Math.min.apply(null, lo) : null; from = 'lowest available'; }
        else if(how === 'soldhi'){ v = sa.length ? Math.max.apply(null, sa) : null; from = 'highest recent sold'; }
        else { v = sa.length ? Math.min.apply(null, sa) : null; from = 'lowest sold recent'; }
        // A card with nothing of that kind is left alone rather than zeroed.
        if(v == null || !isFinite(v)){ skipped++; return; }
        r.market = +Number(v).toFixed(2); r.marketFrom = from;
        r.marketRule = how;            // so a sync later can read it the same way
        reprice(r);                    // whatever rate was set stays the rate
        done++;
    });
    lgSave(); lgPaint();
    toast(done + ' priced' + (skipped ? ' · ' + skipped + ' had no figures of that kind' : ''));
}

/* ── syncing against what the market says today ──────────────────────────────
   A sheet is a snapshot. Cards move, and a buy price worked out as a percentage of a figure from
   three weeks ago is a percentage of nothing in particular. This walks the sheet, pulls each
   card's current offers and recent sales, and works its market price out again from both.

   Only the TCGplayer ones. eBay figures arrive by somebody copying two pages, and there is
   nothing to go and read on their behalf — so those are left exactly as they are rather than
   quietly zeroed or half-updated. */
const SYNC_KEY = 'ptcg-price-sync';
function syncAt(){
    try{ const v = +localStorage.getItem(SYNC_KEY); return isFinite(v) && v > 0 ? v : 0; }
    catch(_){ return 0; }
}
// "Never" rather than a blank or an epoch date, which both read as a bug.
function syncAtText(){
    const t = syncAt();
    return t ? new Date(t).toLocaleString([], { year:'numeric', month:'short', day:'numeric',
                                                hour:'2-digit', minute:'2-digit' })
             : 'Never';
}
function syncable(){ return ledger.filter(r => !r.out && r.pid); }
$('lg-sync').addEventListener('click', async () => {
    const rows = syncable();
    if(!rows.length){
        toast('Nothing here came from TCGplayer, so there is nothing to sync.', true);
        return;
    }
    const skipped = ledger.filter(r => !r.out).length - rows.length;
    const ok = await lgAsk({ title:'Sync market prices', danger:true, yes:'Sync them', no:'Cancel',
        body:'Last sync: <b>' + esc(syncAtText()) + '</b><br><br>'
           + 'This reads the current offers and recent sales for <b>' + rows.length + '</b> card'
           + (rows.length === 1 ? '' : 's') + ' and works each market price out again '
           + '<b>the same way that card is already priced</b> \u2014 whichever rule you picked '
           + 'stays, and so does your buy percentage. A price you typed in yourself is left alone.'
           + '<br><br><b>Prices can move a long way between syncs</b>, and buy prices set as a '
           + 'percentage move with them.'
           + (skipped ? '<br><br><b>' + skipped + '</b> card' + (skipped === 1 ? ' is' : 's are')
                      + ' not from TCGplayer and will be left alone.' : '') });
    if(!ok) return;

    const btn = $('lg-sync'), was = btn.innerHTML;
    btn.disabled = true;
    document.body.classList.add('lg-syncing');
    // Which one is being read right now, lit where it sits rather than named in a status line.
    const light = (r) => {
        document.querySelectorAll('.lg-row.syncing').forEach(x => x.classList.remove('syncing'));
        if(!r) return;
        const el = document.querySelector('.lg-row[data-rid="' + String(r.id).replace(/"/g, '') + '"]');
        if(el){ el.classList.add('syncing'); try{ el.scrollIntoView({ block:'nearest' }); }catch(_){} }
    };
    let done = 0, moved = 0, failed = 0, kept = 0;
    for(const r of rows){
        btn.textContent = 'Syncing ' + (done + 1) + '/' + rows.length + '\u2026';
        $('lg-lock-n').textContent = (done + 1) + ' of ' + rows.length
            + (rows.length === 1 ? ' card' : ' cards');
        $('lg-lock-w').textContent = r.name || '';
        light(r);
        try{
            const q = new URLSearchParams();
            q.set('productId', String(r.pid));
            if((state.conds||[]).length) q.set('conditions', state.conds.join('|'));
            const d = await getJSON('/api/tcg?' + q.toString());
            if(!d || d.error){ failed++; }
            else {
                const nums = l => (l||[]).map(o => +o.total)
                    .filter(n => isFinite(n) && n > 0).sort((a,b) => a-b);
                r.listings = nums(d.listings);
                r.sales = nums(d.sales);
                r.salesAt = (d.sales||[]).map(x => ({ v:+x.total, at:x.date || '' }))
                                         .filter(x => isFinite(x.v) && x.v > 0);
                r.loFull = (d.listings||[]).slice(0, 60).map(o => Object.assign({}, o));
                r.saFull = (d.sales||[]).slice(0, 60).map(o => Object.assign({}, o));
                r.at = Date.now();
                /* Read again the way this card was already being read. A sync is new figures,
                   not a new opinion — imposing one rule on a sheet would quietly undo every
                   choice made card by card. A price that was typed in, or taken off one
                   particular listing, is left exactly as it is; so is a card that came back with
                   nothing, which keeps what it had rather than being blanked. */
                const rule = ruleOf(r);
                if(!rule){ kept++; }
                else {
                    const v = MARKET_RULE[rule](r.listings || [], r.sales || []);
                    if(v == null || !isFinite(v)){ kept++; }
                    else {
                        if(r.market == null || Math.abs(v - r.market) >= 0.005) moved++;
                        r.market = +Number(v).toFixed(2);
                        r.marketFrom = RULE_NAME[rule];
                        r.marketRule = rule;
                        // The buy rate is theirs too: the percentage stays, the figure follows.
                        reprice(r);
                    }
                }
            }
        }catch(_){ failed++; }
        done++;
        // A short gap between calls: this is a walk down a list, not a flood.
        await new Promise(go => setTimeout(go, 120));
    }
    try{ localStorage.setItem(SYNC_KEY, String(Date.now())); }catch(_){}
    syncFresh();
    light(null);
    document.body.classList.remove('lg-syncing');
    btn.disabled = false; btn.innerHTML = was;
    lgSave(); lgPaint();
    // Belt and braces: the figures at the foot are the point of the exercise.
    lgTotals();
    toast(moved + ' price' + (moved === 1 ? '' : 's') + ' moved of ' + rows.length
        + (kept ? ' \u00b7 ' + kept + ' left as you set ' + (kept === 1 ? 'it' : 'them') : '')
        + (failed ? ' \u00b7 ' + failed + ' could not be read' : ''));
});

$('lg-buy').addEventListener('click', (ev) => {
    ev.stopPropagation();
    lgMenu('lg-bout', buyOpts());
});
document.addEventListener('click', () => {
    const pad = $('lg-bout'); if(pad) pad.classList.remove('on');
});
function applyBuy(how){
    const rows = lgRows();
    if(!rows.length){ toast('Nothing to price.', true); return; }
    let done = 0, skipped = 0;
    rows.forEach(r => {
        if(how.clear){ r.buy = null; r.buyFrom = ''; r.buyPct = null; done++; return; }
        if(how.flat != null){ r.buy = +Number(how.flat).toFixed(2); r.buyFrom = 'flat rate';
                              r.buyPct = null; done++; return; }
        /* A percentage needs something to be a percentage of. A card with no market price is
           left alone rather than set to nothing, which would read as "we pay zero". */
        if(r.market == null || !isFinite(r.market)){ skipped++; return; }
        r.buyPct = how.pct;
        r.buy = +(r.market * (how.pct / 100)).toFixed(2);
        r.buyFrom = how.pct + '% of market';
        done++;
    });
    lgSave(); lgPaint();
    toast(done + (how.clear ? ' cleared' : ' priced')
        + (skipped ? ' · ' + skipped + ' had no market price to work from' : ''));
}

$('lg-export').addEventListener('click', (ev) => {
    ev.stopPropagation();
    let pad = $('lg-out');
    if(!pad){
        pad = document.createElement('div');
        pad.id = 'lg-out';
        $('ledger').appendChild(pad);
    }
    if(pad.classList.contains('on')){ pad.classList.remove('on'); return; }
    const n = lgRows().length;
    const some = lgPick.size ? (lgPick.size + ' selected') : (n + ' rows');
    pad.innerHTML = '';
    [['New Google Sheet', 'opens a blank sheet, rows copied ready to paste', () => lgCloud('google')],
     ['New Excel workbook', 'opens Excel online, rows copied ready to paste', () => lgCloud('excel')],
     ['sep'],
     ['Print or save as PDF', 'the list on letter paper', lgPdf, 'every card, totalled'],
     ['Download .png', 'the same sheet as a picture', lgPng, 'every card, totalled'],
     ['sep'],
     ['Copy for a sheet', 'tab-separated, pastes into any spreadsheet', lgTsv],
     ['Download .xls', 'opens straight in Excel', lgXls],
     ['Download .csv', 'the plain interchange format', lgCsv],
     ['Download .json', 'for anything that reads data', lgJson]].forEach(row => {
        if(row[0] === 'sep'){
            const d = document.createElement('div');
            d.className = 'sep'; pad.appendChild(d); return;
        }
        const b = document.createElement('button');
        b.type = 'button';
        /* Most of these follow the tick boxes; the paper ones never do, and say so rather than
           carrying a count they are going to ignore. */
        b.innerHTML = esc(row[0]) + '<small>' + esc(row[1]) + ' \u00b7 '
                    + esc(row[3] || some) + '</small>';
        b.addEventListener('click', () => { pad.classList.remove('on'); row[2](); });
        pad.appendChild(b);
    });
    pad.classList.add('on');
});
document.addEventListener('click', () => {
    const pad = $('lg-out'); if(pad) pad.classList.remove('on');
});

$('lg-del').addEventListener('click', async () => {
    const rows = ledger.filter(r => lgPick.has(r.id));
    if(!rows.length) return;
    const ok = await lgAsk({ title:'Delete saved cards', danger:true,
        yes:'Delete ' + rows.length,
        body:'<b>' + rows.length + ' card' + (rows.length === 1 ? '' : 's')
            + '</b> will be removed from the sheet.<br>'
            + esc(rows.slice(0, 4).map(r => r.name).join(', '))
            + (rows.length > 4 ? ' and ' + (rows.length - 4) + ' more' : '')
            + '<br><br>This cannot be undone.' });
    if(!ok) return;
    ledger = ledger.filter(r => !lgPick.has(r.id));
    lgPick.clear(); lgOpen = '';
    lgSave(); lgPaint();
    toast(rows.length + ' removed');
});
lgLoad(); lgPaint();

})();
