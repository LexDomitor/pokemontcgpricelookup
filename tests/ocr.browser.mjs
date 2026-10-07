// Optional integration check: downloads OpenCV and Tesseract from their public CDNs.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
const server=createApp();await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage();page.setDefaultTimeout(120000);const uploads=[];page.on('request',r=>{if(r.method()==='POST')uploads.push(r.url());});await page.goto('http://127.0.0.1:'+server.address().port);
const result=await page.evaluate(async()=>{
 const E=CardScanEngine;await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Detector download timed out')),100000);E.onReady=()=>{clearTimeout(timeout);resolve();};E.onStatus((text,bad)=>{if(bad){clearTimeout(timeout);reject(Error(text));}});E.load();});
 const canvas=document.createElement('canvas');canvas.width=450;canvas.height=628;const g=canvas.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,450,628);g.fillStyle='#000';g.font='bold 28px Arial';g.fillText('Pikachu',30,60);g.font='22px Arial';g.fillText('HP 60',330,60);g.fillText('58/102',30,594);const mat=cv.imread(canvas);try{return await E.readLocal(mat);}finally{mat.delete();}
});assert(result.title.toLowerCase().includes('pikachu'),JSON.stringify(result));assert.equal(uploads.length,0);console.log('Local OCR read synthetic Pikachu, without image uploads:',result.title,result.number);
}finally{await browser.close();await new Promise(r=>server.close(r));}
