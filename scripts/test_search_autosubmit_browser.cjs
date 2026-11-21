const assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8791';

(async()=>{
 for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
  const browser=await engine.launch({headless:true});
  try{for(const mobile of [true,false]){
   const context=await browser.newContext({viewport:{width:mobile?390:1280,height:900},isMobile:mobile,hasTouch:mobile});
   await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   const film=(id,title)=>({id,title,details:{genres:['Drama'],runtime_minutes:100},sessions:[{id:'session-'+id,cinema_id:'balmes',provider:'mooby',date:'2099-01-01',time:'21:00',starts_at:'2099-01-01T21:00:00+01:00',language:'French',formats:[]}]});
   const programme={generated_at:'2099-01-01T08:00:00Z',timezone:'Europe/Madrid',cinemas:[{id:'balmes',name:'Balmes',short:'Balmes'}],films:[film('bright','Bright Afternoon'),film('paris','Paris Nights')]};
   await context.route('**/programme.json',route=>route.fulfill({json:programme}));
   await context.route('**/api/search-suggestions*',route=>route.fulfill({status:503,json:{}}));
   await context.route('**/api/completions',route=>route.fulfill({json:{query:route.request().postDataJSON().query,suggestions:[]}}));
   const requests=[],held=new Map();
   await context.route('**/api/search',async route=>{
    const {query}=route.request().postDataJSON();requests.push(query);
    if(query==='a seaside memory')await new Promise(resolve=>held.set(query,resolve));
    await route.fulfill({json:{query,mode:'interpreted',intent:{text:query==='a seaside memory'?'bright':'paris',conditions:[],semantic_query:'',sort:'relevance',unsupported:[]},semantic_scores:null}});
   });
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.clock.setFixedTime(new Date('2099-01-01T10:00:00Z'));
   await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});await page.waitForSelector('.search-idea');
   await page.evaluate(()=>{window.submittedQueries=[];addEventListener('vobarna:search',()=>window.submittedQueries.push(new URLSearchParams(location.search).get('q')||''));});
   const input=page.locator('#search'),query=()=>new URL(page.url()).searchParams.get('q');
   const waitQuery=value=>page.waitForFunction(q=>(new URLSearchParams(location.search).get('q')||'')===q&&window.submittedQueries.at(-1)===q,value);
   const ids=()=>page.locator('#grid .card').evaluateAll(nodes=>nodes.map(node=>node.dataset.film).sort());

   await input.fill('Bright');await page.waitForTimeout(150);
   await input.fill('Bright Afternoon');await page.waitForTimeout(250);
   assert.equal(query(),null,'Each keystroke restarts the pause');
   await waitQuery('Bright Afternoon');assert.deepEqual(await ids(),['bright']);
   assert.deepEqual(requests,[],'Exact titles filter locally without a model call');
   assert.deepEqual(await page.evaluate(()=>window.submittedQueries),['Bright Afternoon'],'Only the completed draft is submitted');
   assert.ok(await input.evaluate(el=>el===document.activeElement));
   assert.equal(await input.getAttribute('aria-expanded'),'true','Automatic results leave suggestions open');

   await input.fill('  Paris Nights  ');await input.evaluate(el=>el.setSelectionRange(5,5));
   await waitQuery('Paris Nights');assert.deepEqual(await ids(),['paris']);
   assert.deepEqual(await input.evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd,focused:el===document.activeElement})),{value:'  Paris Nights  ',start:5,end:5,focused:true},'Searching preserves whitespace, caret and focus');
   await input.fill('');await waitQuery('');assert.deepEqual(await ids(),['bright','paris']);
   assert.ok(await input.evaluate(el=>el===document.activeElement),'Clearing keeps the keyboard open');

   await input.fill('Bright Afternoon');await input.press('Enter');assert.equal(query(),'Bright Afternoon','Enter commits immediately');
   const committed=await page.evaluate(()=>window.submittedQueries.length);await page.waitForTimeout(500);
   assert.equal(await page.evaluate(()=>window.submittedQueries.length),committed,'Enter cancels the pending automatic submission');

   await input.fill('Paris Nights');await input.dispatchEvent('compositionstart');await page.waitForTimeout(500);
   assert.equal(query(),'Bright Afternoon','IME composition cancels pending submission');
   await input.dispatchEvent('compositionend');await waitQuery('Paris Nights');

   await input.fill('Bright Afternoon');await input.press('Escape');await page.locator('#clearFilters').click();await page.waitForTimeout(500);
   assert.equal(query(),null,'Reset cancels the pending draft');assert.equal(await input.inputValue(),'');

   await input.fill('a seaside memory');await page.waitForFunction(()=>document.querySelector('#grid').getAttribute('aria-busy')==='true');
   for(let i=0;i<200&&!held.has('a seaside memory');i++)await page.waitForTimeout(10);
   assert.ok(held.has('a seaside memory'));
   await input.fill('a moonlit journey');await waitQuery('a moonlit journey');
   await page.waitForFunction(()=>document.querySelector('#grid').getAttribute('aria-busy')==='false');
   assert.deepEqual(await ids(),['paris']);
   held.get('a seaside memory')();await page.waitForTimeout(250);
   assert.equal(query(),'a moonlit journey');assert.deepEqual(await ids(),['paris'],'An older response cannot replace the newer automatic search');
   assert.deepEqual(requests,['a seaside memory','a moonlit journey']);

   await input.fill('Bright Afternoon');await input.press('Tab');await waitQuery('Bright Afternoon');
   assert.equal(await input.evaluate(el=>el===document.activeElement),false,'Automatic submission does not pull focus back after tabbing away');
   assert.deepEqual(errors,[]);await context.close();
   console.log(name+' '+(mobile?'mobile':'desktop')+': automatic search, debounce, caret, menu, clear/reset, Enter, IME and stale responses passed');
  }}finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
