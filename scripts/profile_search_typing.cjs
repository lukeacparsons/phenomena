const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {writeFileSync,mkdirSync}=require('node:fs');
const assert=require('node:assert/strict');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8791',phase=process.argv[2]||'after';
const output='/private/tmp/vobarna-typing';mkdirSync(output,{recursive:true});
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;
(async()=>{
 const browser=await chromium.launch({headless:true});const report=[];
 try{for(const rate of process.argv.includes('--cpu-profile')?[4]:[1,4]){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await context.route(/\/api\/(completions|search)$/,route=>route.fulfill({json:{query:route.request().postDataJSON().query,suggestions:[]}}));
  await context.addInitScript(()=>{
   const add=EventTarget.prototype.addEventListener;window.typingMetrics={handlers:[],events:[],longTasks:[],frames:[],menus:[],active:false};
   let latest;
   add.call(document,'input',e=>{if(e.target.id==='search'&&window.typingMetrics.active)latest={value:e.target.value,start:performance.now()};},true);
   add.call(document,'DOMContentLoaded',()=>new MutationObserver(records=>{
    if(latest&&records.some(record=>record.target.id==='searchCompletionOptions'||record.target.closest?.('.search-options'))&&document.querySelector('.search-option')){window.typingMetrics.menus.push({value:latest.value,ms:performance.now()-latest.start});latest=null;}
   }).observe(document.body,{subtree:true,childList:true}));
   EventTarget.prototype.addEventListener=function(type,listener,options){
    if(['input','keydown','compositionend'].includes(type)&&typeof listener==='function'){
     const original=listener;listener=function(event){const start=performance.now();try{return original.call(this,event);}finally{if(event.target.id==='search'&&window.typingMetrics.active)window.typingMetrics.handlers.push({type,ms:performance.now()-start,value:event.target.value});}};
    }return add.call(this,type,listener,options);
   };
   new PerformanceObserver(list=>{if(window.typingMetrics.active)for(const e of list.getEntries())window.typingMetrics.events.push({name:e.name,ms:e.duration,processing:e.processingEnd-e.processingStart,delay:e.processingStart-e.startTime});}).observe({type:'event',durationThreshold:16,buffered:true});
   new PerformanceObserver(list=>{if(window.typingMetrics.active)for(const e of list.getEntries())window.typingMetrics.longTasks.push(e.duration);}).observe({type:'longtask',buffered:true});
  });
  const page=await context.newPage(),cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate});
  if(process.argv.includes('--cpu-profile')){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  const cold=process.argv.includes('--cold');
  if(cold)await page.route('**/programme.json',async route=>{await new Promise(resolve=>setTimeout(resolve,800));await route.continue();});
  await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
  if(cold)await page.waitForSelector('.search-composer');else{await page.waitForSelector('.search-idea',{timeout:60000});await page.waitForTimeout(500);}
  await page.evaluate(()=>{window.typingMetrics.active=true;let last=performance.now();function frame(t){if(!window.typingMetrics.active)return;window.typingMetrics.frames.push(t-last);last=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);});
  if(process.argv.includes('--refresh')){
   const programme=await (await context.request.get(base+'/programme.json')).json();programme.generated_at=new Date().toISOString();
   await page.route('**/programme.json',async route=>{await new Promise(resolve=>setTimeout(resolve,200));await route.fulfill({json:programme});});
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  }
  const input=page.locator('#search');await input.focus();
  for(const query of ['films in english','english subtitles','hunger games','films about friendship']){
   await input.press('ControlOrMeta+A');await input.press('Backspace');await input.pressSequentially(query,{delay:55});await page.waitForTimeout(220);
   if(await input.inputValue()!==query)throw Error('Loading or refresh overwrote typed text');
  }
  await input.press('ControlOrMeta+A');await input.press('Backspace');await page.waitForTimeout(250);
  const metrics=await page.evaluate(()=>{window.typingMetrics.active=false;return window.typingMetrics;});
  if(process.argv.includes('--cpu-profile')){const {profile}=await cdp.send('Profiler.stop');writeFileSync(output+'/'+phase+'.cpuprofile',JSON.stringify(profile));}
  const handlers=metrics.handlers.filter(e=>e.type==='input').map(e=>e.ms);
  const row={cpuSlowdown:rate,inputCallbacks:handlers.length,handlerP95:percentile(handlers,.95),handlerMax:Math.max(...handlers),eventP95:percentile(metrics.events.map(e=>e.ms),.95),eventMax:Math.max(0,...metrics.events.map(e=>e.ms)),longTasks:metrics.longTasks.length,longTaskMax:Math.max(0,...metrics.longTasks),menuP95:percentile(metrics.menus.map(e=>e.ms),.95),menuMax:Math.max(0,...metrics.menus.map(e=>e.ms)),frameP95:percentile(metrics.frames,.95),frameMax:Math.max(...metrics.frames)};
  if(process.argv.includes('--check')){
   assert.ok(row.handlerMax<8,'Input callbacks must stay below half a 60 Hz frame: '+JSON.stringify(row));
   assert.ok(row.eventMax<=80,'Typing must not wait behind a long catalogue task: '+JSON.stringify(row));
  }
  report.push(row);writeFileSync(output+'/'+phase+'-'+rate+'x-raw.json',JSON.stringify(metrics,null,2));await context.close();
 }}finally{await browser.close();}
 writeFileSync(output+'/'+phase+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
