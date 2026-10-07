// Developed for Arcane 9 Labs by Alex Puh and Kyle He
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleApi} from './public/api.mjs';
const root=fileURLToPath(new URL('./public/',import.meta.url));
export function createApp(){return createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){const response=await handleApi(new Request(url,{method:req.method}));res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
 const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 if(!file.startsWith(resolve(root)+sep)||/[/\\]_[^/\\]*$/.test(file)){res.writeHead(404);return res.end('Not found');}
 const bytes=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.png':'image/png'})[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch(e){res.writeHead(e.code==='ENOENT'?404:500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.code==='ENOENT'?'Not found':'Request failed'}));}});}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT||8788);createApp().listen(port,'127.0.0.1',()=>console.log('Price Lookup: http://127.0.0.1:'+port));}
