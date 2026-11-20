// Real SDK/recorder, fully intercepted: no events or notifications leave this test.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const source=await readFile(new URL('../static/analytics.js',import.meta.url),'utf8');
const prefix=process.env.POSTHOG_TEST_ASSET_PREFIX||'output/session-replay/posthog';
const assets=new Map(await Promise.all([
  ['array.js','sdk'],['posthog-recorder.js','posthog-recorder'],['config.js','remote-config']
].map(async([name,file])=>[name,await readFile(`${prefix}-${file}.js`,'utf8')])));
const remote=JSON.parse(await readFile(`${prefix}-remote-config.json`,'utf8'));
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'});
 await context.addInitScript(()=>{
  Object.defineProperty(navigator,'webdriver',{get:()=>false});
  Object.defineProperty(navigator,'userAgentData',{get:()=>undefined});
 });
 const events=[],requests=[],errors=[];
 await context.route('**/*',async route=>{
  const r=route.request(),url=new URL(r.url()),name=url.pathname.split('/').at(-1);
  requests.push(url.pathname);
  const headers={'Access-Control-Allow-Origin':'*'};
  if(url.hostname.endsWith('.posthog.com')){
   if(assets.has(name))return route.fulfill({body:assets.get(name),contentType:'text/javascript',headers});
   if(name==='config')return route.fulfill({json:remote,headers});
   if(r.method()==='POST'&&r.postDataBuffer()){
    const b=r.postDataBuffer(),data=JSON.parse(b[0]===31?gunzipSync(b).toString():b.toString());
    events.push(...(Array.isArray(data)?data:data.batch??[data]));
   }
   return route.fulfill({json:{},headers});
  }
  if(url.pathname==='/analytics.js')return route.fulfill({body:source,contentType:'text/javascript'});
  return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><head></head><body>
   <h1>Public programme</h1><input id="search" value="private-initial-input">
   <div id="filterChips">private-summary</div><p id="searchStatus">private-status</p>
   <a class="ticket-link" href="https://cinema.example/private-booking">Tickets</a>
   <a class="buyrow-ticket" href="https://cinema.example/private-dialog-booking">Tickets</a>
   <a href="/es/?q=private-link-query">Español</a>
   <button id="programme">Programme works</button><div style="height:2000px"></div>
   <script type="module" src="/analytics.js"></script></body></html>`});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://vobarna.com/en/?q=private-page-query#private-fragment');
 await page.waitForFunction(()=>window.posthog?.sessionRecordingStarted(),null,{timeout:20000}).catch(async e=>{
  throw Error(e.message+' '+JSON.stringify({requests,errors,state:await page.evaluate(()=>({loaded:window.posthog?.__loaded,recording:window.posthog?.sessionRecording?.status}))}));
 });
 await page.locator('#search').fill('private-typed-input');
 await page.locator('#programme').click();
 await page.evaluate(()=>{console.log('private-console-message');document.querySelector('#filterChips').textContent='private-updated-summary';});
 await page.mouse.wheel(0,450);
 for(let i=0;i<100&&!events.some(e=>e.event==='$snapshot');i++)await page.waitForTimeout(100);
 const snapshots=events.filter(e=>e.event==='$snapshot');
 assert.ok(snapshots.length,'Recorder must send a snapshot: '+JSON.stringify({requests,errors}));
 // SDK snapshot compression is separate from transport compression.
 const decoded=JSON.stringify(snapshots,(_key,value)=>{
  if(typeof value==='string'&&value.charCodeAt(0)===31&&value.charCodeAt(1)===139){
   return JSON.parse(gunzipSync(Buffer.from(value,'latin1')).toString());
  }
  if(typeof value==='string'&&value.startsWith('H4sI')){
   try{return gunzipSync(Buffer.from(value,'base64')).toString();}catch{}
  }
  return value;
 });
 assert.ok(decoded.includes('Public programme'),'Public page content must be recorded');
 for(const secret of ['private-initial-input','private-typed-input','private-summary','private-status','private-booking','private-dialog-booking','private-link-query','private-page-query','private-fragment','private-console-message','private-updated-summary']){
  assert.ok(!decoded.includes(secret),`Replay leaked ${secret}`);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(await context.cookies(),[]);
 console.log(`PASS ${snapshots.length} replay payload(s): public DOM recorded, inputs/URLs/links/summaries masked, no console capture or cookies`);
 await context.close();
}finally{await browser.close();}
