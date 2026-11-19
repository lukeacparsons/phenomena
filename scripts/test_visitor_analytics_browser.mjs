// Real PostHog SDK, intercepted requests: never sends events or Telegram messages.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const source=await readFile(new URL('../static/analytics.js',import.meta.url),'utf8');
const sdk=await readFile(process.env.POSTHOG_SDK_FILE||'output/visitor-notifications/posthog-sdk.js','utf8');
const browser=await chromium.launch({headless:true});
async function fixture(options={}){
 const context=await browser.newContext({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'});
 await context.addInitScript(options=>{
  Object.defineProperty(navigator,'webdriver',{get:()=>false});
  Object.defineProperty(navigator,'userAgentData',{get:()=>undefined});
  if(options.dnt)Object.defineProperty(navigator,'doNotTrack',{value:'1'});
  if(options.gpc)Object.defineProperty(navigator,'globalPrivacyControl',{value:true});
  if(options.blocked)Object.defineProperty(window,'localStorage',{get:()=>{throw new DOMException('Blocked','SecurityError');}});
 },options);
 const events=[],errors=[];let sdkRequests=0;
 await context.route('**/*',async route=>{
  const r=route.request(),url=new URL(r.url());
  if(url.pathname==='/static/array.js'){
   sdkRequests++;
   return options.sdkBlocked?route.abort('blockedbyclient'):route.fulfill({body:sdk,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'}});
  }
  if(url.hostname.endsWith('.posthog.com')){
   if(r.method()==='POST'&&r.postDataBuffer()){
    const b=r.postDataBuffer();const data=JSON.parse(b[0]===31?gunzipSync(b).toString():b.toString());
    events.push(...(Array.isArray(data)?data:data.batch??[data]));
   }
   return route.fulfill({json:{},headers:{'Access-Control-Allow-Origin':'*'}});
  }
  if(url.pathname==='/analytics.js')return route.fulfill({body:source,contentType:'text/javascript'});
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head></head><body><button id="programme">Programme works</button>'+(url.pathname==='/empty'?'':'<script type="module" src="/analytics.js"></script>')+'</body></html>'});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date()});
 async function visit(path='/en/'){
  const count=events.filter(e=>e.event==='$pageview').length;
  await page.goto('https://'+(options.host||'vobarna.com')+path);
  if(options.dnt||options.gpc||options.sdkBlocked||options.host){await page.waitForTimeout(350);return;}
  for(let i=0;i<80;i++){
   const views=events.filter(e=>e.event==='$pageview');
   if(views.length>count)return views.at(-1).properties;
   await page.waitForTimeout(100);
  }
  throw Error('Pageview was not captured '+JSON.stringify({errors,sdkRequests,state:await page.evaluate(()=>({posthog:typeof window.posthog,loaded:window.posthog?.__loaded,config:window.posthog?.config?.cookieless_mode,scripts:[...document.scripts].map(s=>s.src)}))}));
 }
 return {context,page,events,errors,visit,sdkRequests:()=>sdkRequests};
}
try{
 const f=await fixture();const first=await f.visit();const reload=await f.visit();
 assert.equal(first.visitor_alert_version,1);assert.equal(first.visitor_identity_persisted,true);
 assert.equal(reload.distinct_id,first.distinct_id);assert.equal(reload.$session_id,first.$session_id);
 await f.page.clock.setSystemTime(new Date(Date.now()+31*60000));
 const returning=await f.visit('/en/films/test/');
 assert.equal(returning.distinct_id,first.distinct_id);assert.notEqual(returning.$session_id,first.$session_id);
 assert.equal((await f.visit('/en/?internal=1')).internal_user,true);
 assert.equal((await f.visit()).internal_user,true);
 assert.equal((await f.visit('/en/?internal=0')).internal_user,false);
 await f.visit('/en/?q=private-search#private-fragment');
 assert.ok(!JSON.stringify(f.events).includes('private-search'));assert.ok(!JSON.stringify(f.events).includes('private-fragment'));
 await f.page.goto('https://vobarna.com/empty');
 await f.page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
 assert.notEqual((await f.visit()).distinct_id,first.distinct_id);
 assert.deepEqual(await f.context.cookies(),[]);assert.deepEqual(f.errors,[]);
 assert.ok(f.events.filter(e=>e.event).every(e=>e.properties.$process_person_profile===false));
 await f.context.close();
 console.log('PASS stable identity, session expiry, reload, internal flags, reset, sanitized URLs, no cookies/profiles');
 for(const options of [{blocked:true},{dnt:true},{gpc:true},{sdkBlocked:true},{host:'origin.vobarna.com'},{host:'localhost'}]){
  const f=await fixture(options),p=await f.visit();
  if(options.blocked){assert.equal(p.visitor_identity_persisted,false);assert.notEqual((await f.visit()).distinct_id,p.distinct_id);}
  else {assert.equal(f.events.length,0);if(!options.sdkBlocked)assert.equal(f.sdkRequests(),0);}
  assert.equal(await f.page.locator('#programme').innerText(),'Programme works');
  assert.deepEqual(await f.context.cookies(),[]);assert.deepEqual(f.errors,[]);
  await f.context.close();console.log('PASS',JSON.stringify(options));
 }
}finally{await browser.close();}
