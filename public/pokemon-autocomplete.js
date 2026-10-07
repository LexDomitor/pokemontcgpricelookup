// Developed for Arcane 9 Labs by Alex Puh and Kyle He
// Needs pokemon-names.js loaded first (window.PTCG_POKEMON).
//
//   PTCG_POKEAC.attach(inputEl)            – dropdown of species names + a "did you mean" hint
//   PTCG_POKEAC.attach(el, { onPick })     – called with the chosen name
//
// Card names in the shop are things like "Charizard V" or "N's Zoroark EX", so this never rewrites
// what you typed on its own — it completes the species word and offers a correction you have to accept.
(function(){
'use strict';
if(!window.PTCG_POKEMON) return;
var P = window.PTCG_POKEMON;

function css(){
    if(document.getElementById('sb-poke-css')) return;
    var s=document.createElement('style'); s.id='sb-poke-css';
    s.textContent = ''
      + '.sb-poke-dd{position:fixed;z-index:9999;display:none;background:var(--panel,#17171d);border:1px solid var(--accent,#ff8c1a);'
      + 'border-radius:9px;box-shadow:0 14px 40px rgba(0,0,0,.5);max-height:260px;overflow-y:auto;min-width:190px;padding:5px;}'
      + '.sb-poke-dd.on{display:block;}'
      + '.sb-poke-i{padding:7px 11px;border-radius:6px;cursor:pointer;font-size:.84rem;color:var(--text,#ece9f2);white-space:nowrap;}'
      + '.sb-poke-i:hover,.sb-poke-i.sel{background:var(--accent-soft,rgba(255,138,43,.15));color:var(--accent,#ff8c1a);}'
      + '.sb-poke-h{padding:5px 11px;font-size:.56rem;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim,#8f8fa3);font-weight:700;}'
      + '.sb-poke-fix{padding:7px 11px;border-radius:6px;cursor:pointer;font-size:.78rem;color:var(--warn,#ff8f5a);font-weight:700;}'
      + '.sb-poke-fix:hover{background:rgba(255,143,90,.14);}';
    document.head.appendChild(s);
}

// The species word is usually the first token — "Charizard VMAX" -> "Charizard".
function head(v){ return String(v||'').trim().split(/\s+/)[0] || ''; }
function replaceHead(v, name){
    var t=String(v||'').trim(), parts=t.split(/\s+/);
    if(!parts.length || !parts[0]) return name;
    parts[0]=name; return parts.join(' ');
}

function attach(input, opts){
    if(!input || input._sbPoke) return; input._sbPoke=true;
    opts = opts || {};
    css();
    var dd=document.createElement('div'); dd.className='sb-poke-dd'; document.body.appendChild(dd);
    var items=[], sel=-1;

    function hide(){ dd.classList.remove('on'); sel=-1; }
    function place(){
        var r=input.getBoundingClientRect();
        dd.style.left=r.left+'px'; dd.style.top=(r.bottom+4)+'px'; dd.style.minWidth=r.width+'px';
        var dr=dd.getBoundingClientRect();
        if(dr.bottom>window.innerHeight-8) dd.style.top=Math.max(4, r.top-dr.height-4)+'px';
    }
    function choose(name){
        input.value = opts.whole ? name : replaceHead(input.value, name);
        hide();
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.dispatchEvent(new Event('change',{bubbles:true}));
        if(opts.onPick) opts.onPick(name);
        input.focus();
    }
    function render(){
        var word=head(input.value);
        if(word.length<2){ hide(); return; }
        var list=P.match(word, opts.limit||7);
        // don't nag when what's typed is already an exact species name
        if(list.length===1 && P.isName(word)){ hide(); return; }
        if(!list.length){ hide(); return; }
        dd.innerHTML='';
        var exact=P.isName(word);
        if(!exact && list[0] && P.norm(list[0]).indexOf(P.norm(word))!==0){
            var fix=document.createElement('div'); fix.className='sb-poke-fix';
            fix.textContent='Did you mean “'+list[0]+'”?';
            fix.addEventListener('mousedown',function(e){ e.preventDefault(); choose(list[0]); });
            dd.appendChild(fix);
        }
        var h=document.createElement('div'); h.className='sb-poke-h'; h.textContent='Pokémon'; dd.appendChild(h);
        items=[];
        list.forEach(function(n){
            var d=document.createElement('div'); d.className='sb-poke-i'; d.textContent=n;
            d.addEventListener('mousedown',function(e){ e.preventDefault(); choose(n); });
            dd.appendChild(d); items.push(d);
        });
        sel=-1; dd.classList.add('on'); place();
    }
    function move(dir){
        if(!items.length) return;
        if(sel>=0) items[sel].classList.remove('sel');
        sel=(sel+dir+items.length)%items.length;
        items[sel].classList.add('sel'); items[sel].scrollIntoView({block:'nearest'});
    }
    input.addEventListener('input',render);
    input.addEventListener('focus',render);
    input.addEventListener('blur',function(){ setTimeout(hide,150); });
    input.addEventListener('keydown',function(e){
        if(!dd.classList.contains('on')) return;
        if(e.key==='ArrowDown'){ e.preventDefault(); move(1); }
        else if(e.key==='ArrowUp'){ e.preventDefault(); move(-1); }
        else if(e.key==='Enter' && sel>=0){ e.preventDefault(); choose(items[sel].textContent); }
        else if(e.key==='Escape'){ hide(); }
    });
    window.addEventListener('scroll',function(){ if(dd.classList.contains('on')) place(); },true);
    window.addEventListener('resize',function(){ if(dd.classList.contains('on')) place(); });
}

window.PTCG_POKEAC = { attach:attach, head:head, replaceHead:replaceHead };
})();
