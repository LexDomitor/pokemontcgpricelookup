/* Named price sheets stay in this browser, never in a shared account database. */
(function(root){
 const KEY='ptcg-saved-sheets';
 function all(){const value=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(value))throw Error('Saved sheets are damaged. Export your current sheet before clearing browser storage.');return value;}
 function reply(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}
 async function request(path,options={}){try{
  const url=new URL(path,location.origin),sheets=all(),body=JSON.parse(options.body||'{}'),id=String(body.id||url.searchParams.get('id')||''),existing=sheets.find(d=>d.id===id);
  if(url.pathname.endsWith('/list'))return reply({dbs:sheets.map(({rows,...d})=>({...d,n:rows.length,mine:true,canLock:true,by:'This browser'}))});
  if(url.pathname.endsWith('/get'))return existing?reply({...existing,mine:true,canLock:true}):reply({error:'Saved sheet not found'},404);
  if(url.pathname.endsWith('/cards')){const found=new Map();for(const d of sheets.slice().sort((a,b)=>b.at-a.at))for(const row of d.rows){const key=row.how?.productId||row.name;if(!found.has(key))found.set(key,{...row,sheet:d.name});}return reply({cards:[...found.values()].slice(0,600)});}
  if(options.method!=='POST')return reply({error:'POST required'},405);
  if(!id||id.length>80)return reply({error:'Invalid sheet ID'},400);
  if(url.pathname.endsWith('/save')){if(!Array.isArray(body.rows)||body.rows.length>400||JSON.stringify(body.rows).length>900000)return reply({error:'Sheet is too large'},413);if(existing?.ro)return reply({error:'Unlock this sheet before saving'},403);const value={id,name:String(body.name||'Saved cards').slice(0,60),rows:body.rows,at:Date.now(),ro:false};localStorage.setItem(KEY,JSON.stringify(sheets.filter(d=>d.id!==id).concat(value)));return reply({ok:true,id,at:value.at});}
  if(url.pathname.endsWith('/drop')){localStorage.setItem(KEY,JSON.stringify(sheets.filter(d=>d.id!==id)));return reply({ok:true});}
  if(url.pathname.endsWith('/ro')&&existing){existing.ro=!!body.ro;localStorage.setItem(KEY,JSON.stringify(sheets));return reply({ok:true,ro:existing.ro});}
  return reply({error:'Unknown local sheet operation'},404);
 }catch(e){return reply({error:'Could not save/read local sheets: '+e.message},500);}}
 root.LocalSheets={all,request};
})(globalThis);
