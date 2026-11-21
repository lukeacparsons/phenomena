const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8797';
const routes={
 en:['/en/guides/classic-films-barcelona/','/en/guides/original-version-cinema-eixample/','/en/guides/cinema-discount-days-barcelona/'],
 es:['/es/guias/cine-clasico-barcelona/','/es/guias/cine-version-original-eixample/','/es/guias/descuentos-cine-barcelona/'],
 ca:['/ca/guies/cinema-classic-barcelona/','/ca/guies/cinema-versio-original-eixample/','/ca/guies/descomptes-cinema-barcelona/']
};
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const plain=await browser.newContext({javaScriptEnabled:false,viewport:{width:1280,height:900}});
  await plain.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const page=await plain.newPage();
  for(const [lang,paths] of Object.entries(routes))for(const [i,path] of paths.entries()){
   const response=await page.goto(base+path,{waitUntil:'domcontentloaded'});
   assert.equal(response.status(),200,path);
   assert.equal(await page.locator('h1').count(),1);
   assert.equal(await page.locator('html').getAttribute('lang'),lang);
   assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://vobarna.com'+path);
   assert.equal(await page.locator('link[hreflang]').count(),4);
   const cards=await page.locator('[data-discovery-film]').count();
   assert.ok(cards>0,'Acceptance fixture requires current collected inventory: '+path);
   assert.equal(await page.locator('.screening-action').count(),cards);
   const graph=JSON.parse(await page.locator('script[type="application/ld+json"]').first().textContent())['@graph'];
   assert.equal(graph.find(n=>n['@type']==='ItemList').numberOfItems,cards);
   if(i===2){
    assert.equal(await page.locator('.discount-offer').count(),20);
    assert.equal(await page.locator('.discount-offers ~ section').count()>0,true);
    assert.equal(await page.locator('.discount-offers time').count(),0);
    assert.equal(await page.locator('time[datetime="2026-11-21"]').count()>0,true);
    assert.equal(graph.some(n=>n['@type']==='Offer'),false);
    assert.equal(await page.locator('#verdi-monday details a').count(),2);
   }
  }
  await plain.close();console.log('Nine localized collections passed no-JS, metadata, counts, and tariff separation checks.');
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const live=await context.newPage(),errors=[];
  live.on('pageerror',e=>errors.push(e.message));
  fs.mkdirSync('output/seo',{recursive:true});
  for(const [i,path] of routes.en.entries()){
   await live.goto(base+path,{waitUntil:'domcontentloaded'});
   assert.equal(await live.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,path+' must fit mobile');
   if(i<2){
    await live.locator('main .discovery-sections a').last().click();
    assert.equal(new URL(live.url()).hash,'#guide-information');
   }
   await live.locator('.discovery-film:visible summary').first().click();
   const action=live.locator('.screening-action:visible').first();
   const expected=await action.locator('xpath=ancestor::li').locator('.ticket-link').getAttribute('data-ticket-screening');
   await action.click();await live.waitForSelector('dialog[open] .buyrow.is-highlighted');
   assert.equal(await live.locator('.buyrow.is-highlighted').getAttribute('data-session'),expected);
   await live.reload({waitUntil:'domcontentloaded'});await live.waitForSelector('dialog[open] .buyrow.is-highlighted');
   assert.equal(await live.locator('.buyrow.is-highlighted').getAttribute('data-session'),expected);
   await live.keyboard.press('Escape');console.log('Exact-session action and reload passed:',path);
  }
  await live.goto(base+routes.en[0],{waitUntil:'domcontentloaded'});
  await live.screenshot({path:'output/seo/classics-mobile.png'});
  await live.goto(base+routes.en[2],{waitUntil:'domcontentloaded'});
  await live.locator('#texas-thursday').scrollIntoViewIfNeeded();
  await live.screenshot({path:'output/seo/discounts-mobile.png'});
  await live.setViewportSize({width:1280,height:900});
  await live.goto(base+routes.en[2],{waitUntil:'domcontentloaded'});
  await live.screenshot({path:'output/seo/discounts-desktop.png'});
  const day=await live.locator('.discovery').getAttribute('data-discovery-date');
  await live.clock.install({time:new Date(day+'T12:00:00+01:00')});
  await live.clock.setSystemTime(new Date(day+'T12:00:00+01:00').getTime()+86400000);
  await live.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  assert.equal(await live.locator('.discovery-stale').isVisible(),true);
  assert.equal(await live.locator('.discount-offers').isVisible(),true,'Dated tariff facts remain readable when session examples require refresh');
  await live.goto(base+routes.en[1],{waitUntil:'domcontentloaded'});
  assert.equal(await live.locator('.discovery-stale').isVisible(),true);
  await live.goto(base+routes.en[0],{waitUntil:'domcontentloaded'});
  assert.equal(await live.locator('.discovery-stale').isVisible(),false);
  await live.clock.setSystemTime(new Date('2027-01-02T12:00:00Z'));
  await live.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  assert.equal(await live.locator('.discovery-empty').isVisible(),true);
  assert.equal(await live.locator('#guide-information').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('Mobile layout, section links, exact-session selection, expiry, empty state and Madrid rollover passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
