// Real PostHog SDK, intercepted requests: never sends events or Telegram messages.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
// Headless browser bot detection changes during navigation. Disable the SDK's
// bot filter only in this intercepted fixture so native pageleave is exercised.
const source=(await readFile(new URL('../static/analytics.js',import.meta.url),'utf8'))
 .replace('api_host:API_HOST,','opt_out_useragent_filter:true,api_host:API_HOST,');
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
 const record=(url,bytes)=>{
  const b=Buffer.from(bytes),compressed=new URL(url).searchParams.get('compression');
  const text=b[0]===31?gunzipSync(b).toString():compressed==='base64'?Buffer.from(b.toString(),'base64').toString():b.toString();
  const data=JSON.parse(text);events.push(...(Array.isArray(data)?data:data.batch??[data]));
 };
 // Intercept beacons at the browser API too: request routing can lose them
 // when the originating document is destroyed. No event reaches PostHog.
 await context.exposeBinding('vobarnaTestBeacon',(_,url,bytes)=>record(url,bytes));
 await context.addInitScript(()=>{
  navigator.sendBeacon=(url,body)=>{
   const blob=body instanceof Blob?body:new Blob([body]);
   void blob.arrayBuffer().then(buffer=>window.vobarnaTestBeacon(String(url),[...new Uint8Array(buffer)])).catch(()=>{});
   return true;
  };
 });
 await context.route('**/*',async route=>{
  const r=route.request(),url=new URL(r.url());
  if(url.pathname==='/static/array.js'){
   sdkRequests++;
   return options.sdkBlocked?route.abort('blockedbyclient'):route.fulfill({body:sdk,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'}});
  }
  if(url.hostname.endsWith('.posthog.com')){
   if(r.method()==='POST'&&r.postDataBuffer()){
    record(r.url(),r.postDataBuffer());
   }
   return route.fulfill({json:{},headers:{'Access-Control-Allow-Origin':'*'}});
  }
  if(url.pathname==='/analytics.js')return route.fulfill({body:source,contentType:'text/javascript'});
  return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><head></head><body>
    <button id="programme">Programme works</button>
    <nav class="lang-switch"><a id="spanish" hreflang="es" href="/es/?q=private-language-query">ES</a></nav>
    <a id="internal" href="https://www.vobarna.com/en/">Internal</a>
    <a id="ticket" class="ticket-link" href="https://cinema.example/private-booking?token=private-token">Tickets</a>
    <footer><a id="outbound" href="https://operator.example/private-path?token=private-token#private-fragment">Operator</a></footer>
    <div style="height:4000px"></div>
    ${url.pathname==='/empty'?'':'<script type="module" src="/analytics.js"></script>'}</body></html>`});
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
async function until(check,message){
 for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,100));}
 assert.ok(check(),message);
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
 const lifecycle=await fixture();
 const initial=await lifecycle.visit('/en/?internal=1&q=private-search#private-fragment');
 await lifecycle.page.evaluate(()=>scrollTo(0,1800));
 await lifecycle.page.waitForTimeout(250);
 await lifecycle.page.evaluate(()=>{
   history.replaceState(null,'','/en/?q=private-filter#private-fragment');
   dispatchEvent(new Event('vobarna:navigation'));
   dispatchEvent(new Event('popstate'));
   // Prevent navigation while testing the real delegated click listeners.
   document.addEventListener('click',event=>event.preventDefault());
   for(const id of ['outbound','ticket','internal','spanish'])document.getElementById(id).click();
   document.getElementById('outbound').dispatchEvent(new MouseEvent('auxclick',{bubbles:true,button:1}));
   document.getElementById('outbound').dispatchEvent(new MouseEvent('auxclick',{bubbles:true,button:2}));
   history.pushState(null,'','/es/');document.documentElement.lang='es';
   dispatchEvent(new Event('vobarna:languagechange'));dispatchEvent(new Event('vobarna:navigation'));
 });
 await until(()=>lifecycle.events.filter(e=>e.event==='$pageview').length===2,'Language change must capture one view');
 const translated=lifecycle.events.filter(e=>e.event==='$pageview').at(-1).properties;
 assert.equal(translated.language,'es');assert.equal(translated.$prev_pageview_id,initial.$pageview_id);
 assert.ok(translated.$prev_pageview_duration>0);
 assert.ok(translated.$prev_pageview_max_scroll_percentage>0);
 const outbound=lifecycle.events.filter(e=>e.event==='outbound_click');
 assert.equal(outbound.length,2);assert.equal(outbound[0].properties.destination,'operator.example');
 assert.equal(outbound[0].properties.placement,'footer');
 const languages=lifecycle.events.filter(e=>e.event==='language_switch');
 assert.equal(languages.length,1);assert.equal(languages[0].properties.from_language,'en');assert.equal(languages[0].properties.to_language,'es');
 // Dispatch the native lifecycle event while the fixture can await its beacon.
 await lifecycle.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
 await until(()=>lifecycle.events.some(e=>e.event==='$pageleave'),'Pagehide must submit an SDK leave beacon');
 const leave=lifecycle.events.find(e=>e.event==='$pageleave').properties;
 assert.equal(leave.$prev_pageview_id,translated.$pageview_id);assert.equal(leave.$prev_pageview_pathname,'/es/');
 assert.equal(leave.internal_user,true);assert.equal(leave.visitor_identity_persisted,true);
 assert.equal(leave.site,'vobarna');assert.equal(leave.language,'es');assert.equal(leave.page_type,'home');
 assert.equal(leave.$current_url,'https://vobarna.com/es/');assert.ok(leave.$prev_pageview_duration>0);
 assert.equal(lifecycle.events.filter(e=>e.event==='$pageleave').length,1);
 assert.ok(!JSON.stringify(lifecycle.events).includes('private-'));assert.deepEqual(lifecycle.errors,[]);
 await lifecycle.context.close();
 console.log('PASS pagehide beacon payload, SPA duration/scroll, language navigation, outbound/middle clicks, internal flags and payload privacy');
 const restored=await fixture();await restored.visit();
 await restored.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
 await until(()=>restored.events.some(e=>e.event==='$pageleave'),'Cache entry must send one leave');
 await restored.page.clock.fastForward(60000);
 await restored.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 await until(()=>restored.events.filter(e=>e.event==='$pageview').length===2,'Cache restoration must start one view');
 const restoredView=restored.events.filter(e=>e.event==='$pageview').at(-1).properties;
 assert.equal(restoredView.restored_from_bfcache,true);assert.equal(restoredView.$prev_pageview_duration,undefined);
 await restored.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
 await until(()=>restored.events.filter(e=>e.event==='$pageleave').length===2,'Restored page must send its own leave');
 const restoredLeave=restored.events.filter(e=>e.event==='$pageleave').at(-1).properties;
 assert.equal(restoredLeave.$prev_pageview_id,restoredView.$pageview_id);assert.ok(restoredLeave.$prev_pageview_duration<30);
 assert.deepEqual(restored.errors,[]);await restored.context.close();
 console.log('PASS simulated back-cache lifecycle resets duration without duplicate pageviews');
 for(const options of [{blocked:true},{dnt:true},{gpc:true},{sdkBlocked:true},{host:'origin.vobarna.com'},{host:'localhost'}]){
  const f=await fixture(options),p=await f.visit();
  if(options.blocked){assert.equal(p.visitor_identity_persisted,false);assert.notEqual((await f.visit()).distinct_id,p.distinct_id);}
  else {assert.equal(f.events.length,0);if(!options.sdkBlocked)assert.equal(f.sdkRequests(),0);}
  assert.equal(await f.page.locator('#programme').innerText(),'Programme works');
  assert.deepEqual(await f.context.cookies(),[]);assert.deepEqual(f.errors,[]);
  await f.context.close();console.log('PASS',JSON.stringify(options));
 }
}finally{await browser.close();}
