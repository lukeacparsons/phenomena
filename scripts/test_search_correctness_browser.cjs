const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8791';
(async()=>{
 for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   const calls=[],errors=[];
   await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   await context.route(/\/api\/(search|completions)$/,route=>{calls.push(route.request().url());return route.fulfill({status:503,json:{error:'No paid calls in this test'}});});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});await page.waitForSelector('.search-idea',{timeout:60000});
   const input=page.locator('#search');
   const submit=async query=>{await input.fill(query);await input.press('Enter');await page.waitForTimeout(100);};
   await submit('Films in Catalan');
   assert.ok(await page.locator('#grid .card').count()>0);
   assert.equal(await page.locator('#grid .card').filter({hasText:'Wild Horse Nine'}).count(),0,'English film must not match Catalan audio');
   const query='Films in Catalan at Verdi',provider=page.locator('button[data-remove-filter="intent"][data-value="provider:eq:verdi"]');
   await submit(query);assert.equal(await provider.count(),1);assert.ok(await page.locator('#grid .card').count()>0);
   const before=await page.locator('#grid .card').evaluateAll(els=>els.map(e=>e.dataset.film));
   await provider.click();assert.equal(await provider.count(),0);
   await input.press('Enter');await page.waitForTimeout(100);
   assert.equal(await provider.count(),1,'Resubmitting restores the venue restriction');
   assert.deepEqual(await page.locator('#grid .card').evaluateAll(els=>els.map(e=>e.dataset.film)),before);
   await submit('long films first');
   assert.match(await page.locator('#filterChips').innerText(),/longest/);
   const runtimes=await page.evaluate(async()=>{
    const p=await fetch('/programme.json').then(r=>r.json()),byId=new Map(p.films.map(f=>[f.id,f]));
    return [...document.querySelectorAll('#grid .card')].map(e=>{const f=byId.get(e.dataset.film);return f.details?.runtime_minutes??f.runtime_minutes??null;});
   });
   assert.ok(runtimes.length>3);for(let i=1;i<runtimes.length;i++)assert.ok(runtimes[i]===null||(runtimes[i-1]!==null&&runtimes[i]<=runtimes[i-1]));
   assert.deepEqual(calls,[],'These factual searches need no LLM calls');assert.deepEqual(errors,[]);
   console.log(name+': Catalan audio, combined Verdi filtering, resubmission and longest-first catalogue results passed');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
