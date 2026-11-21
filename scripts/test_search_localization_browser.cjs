const assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8791';
(async()=>{
 for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
  const browser=await engine.launch({headless:true});
  try{
   const context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-GB'}),calls=[];
   await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   await context.route(/\/api\/(search|completions)$/,r=>{calls.push(r.request().postDataJSON().query);return r.fulfill({json:{query:r.request().postDataJSON().query,suggestions:[]}});});
   await context.addInitScript(()=>{window.geoCalls=0;navigator.geolocation.getCurrentPosition=fn=>{window.geoCalls++;fn({coords:{latitude:41.39,longitude:2.16}});};});
   context.setDefaultTimeout(30000);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/es/',{waitUntil:'domcontentloaded'});await page.waitForSelector('.search-idea',{timeout:120000});
   const input=page.locator('#search');
   assert.ok((await page.locator('.search-idea').allTextContents()).some(q=>q.startsWith('Películas ')),'The selected Spanish page overrides the English browser');
   assert.equal(await page.evaluate(()=>window.geoCalls),0);
   await input.fill('cerca de mi');await page.getByRole('option',{name:'Películas cerca de mí',exact:true}).click();
   await page.waitForFunction(()=>window.geoCalls===1&&document.querySelector('#grid .card'));
   assert.equal(await input.inputValue(),'Películas cerca de mí');assert.equal(new URL(page.url()).searchParams.get('q'),'Películas cerca de mí');
   await page.locator('#clearFilters').click();
   await page.evaluate(()=>{window.localeMarker='same-document';document.querySelector('.lang-switch a[hreflang="ca"]').click();});
   await page.waitForFunction(()=>document.documentElement.lang==='ca'&&[...document.querySelectorAll('.search-idea')].some(e=>e.textContent.startsWith('Pel·lícules ')));
   assert.equal(await page.evaluate(()=>window.localeMarker),'same-document','Language switching updates suggestions without reloading');
   await input.fill('a prop meu');await page.getByRole('option',{name:'Pel·lícules a prop meu',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('#grid .card'));
   assert.equal(await input.inputValue(),'Pel·lícules a prop meu');
   await page.locator('#clearFilters').click();await input.fill('subtítols en ang');
   await page.getByRole('option',{name:'Subtítols en anglès',exact:true}).click();
   assert.equal(new URL(page.url()).searchParams.get('q'),'Subtítols en anglès');
   assert.ok(await page.locator('#grid .card').count()>0);assert.deepEqual(calls,[],'Localized menu selections need no model calls');assert.deepEqual(errors,[]);
   console.log(name+': selected locale, translated chips and menu, accentless nearby input, language switching, subtitles and zero AI calls passed');
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
