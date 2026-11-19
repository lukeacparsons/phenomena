const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8795';

(async()=>{
 const programme=await (await fetch(base+'/programme.json')).json();
 const sessionIds=new Map(programme.films.flatMap(film=>film.sessions.map(session=>[film.urls.en+session.anchor,session.id])));
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(const mode of ['no-js','interactive','catalogue-failure']){
   const context=await browser.newContext({javaScriptEnabled:mode!=='no-js',viewport:{width:390,height:844}});
   context.setDefaultTimeout(30000);
   await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    return url.origin!==base||(mode==='catalogue-failure'&&url.pathname==='/programme.json')?route.abort():route.continue();
   });
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
   const disclosure=page.locator('main > #complete-programme');
   assert.equal(await disclosure.count(),1);
   assert.equal(await disclosure.getAttribute('open'),null);
   assert.equal(await disclosure.locator('.complete-programme-content').isVisible(),false);
   const expected=Number(await disclosure.getAttribute('data-sessions'));
   assert.ok(expected>0);
   assert.equal(await disclosure.locator('a[data-programme-session]').count(),expected);
   assert.equal(await disclosure.locator('img').count(),0);
   if(mode==='interactive'){
    await page.waitForFunction(()=>document.querySelector('#grid')?.dataset.enhanced==='true');
    await page.locator('#search').fill('Dune');
    await page.waitForFunction(()=>location.search==='?q=Dune'&&document.querySelector('#grid')?.getAttribute('aria-busy')==='false');
    assert.equal(await disclosure.locator('a[data-programme-session]').count(),expected);
    assert.equal(await disclosure.getAttribute('open'),null);
   }
   if(mode==='catalogue-failure')await page.waitForFunction(()=>document.querySelector('#grid')?.getAttribute('aria-busy')==='false');
   const gridBefore=await page.locator('#grid .card').evaluateAll(nodes=>nodes.map(node=>node.dataset.film));
   // Native details works without a script and supports keyboard activation.
   await disclosure.locator('summary').focus();await page.keyboard.press('Enter');
   assert.equal(await disclosure.locator('.complete-programme-content').isVisible(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(mode==='interactive'){
    const position=await disclosure.locator('a[data-programme-session]').evaluateAll(nodes=>nodes.findIndex(node=>Date.parse(node.querySelector('time').dateTime)>Date.now()+60000));
    assert.ok(position>=0);
    const selection=disclosure.locator('a[data-programme-session]').nth(position);
    const id=sessionIds.get(await selection.getAttribute('href'));
    assert.ok(id);
    await selection.click();
    await page.waitForSelector('#filmDialog[open] .buyrow.is-highlighted');
    assert.equal(await page.locator('.buyrow.is-highlighted').getAttribute('data-session'),id);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('buyrow-ticket')),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#search').inputValue(),'Dune');
   }
   await disclosure.locator('summary').focus();await page.keyboard.press('Enter');
   assert.equal(await disclosure.getAttribute('open'),null);
   assert.deepEqual(await page.locator('#grid .card').evaluateAll(nodes=>nodes.map(node=>node.dataset.film)),gridBefore);
   assert.deepEqual(errors,[]);
   console.log(mode+': complete HTML, closed disclosure, native keyboard, mobile layout and grid preservation passed.');
   await context.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
