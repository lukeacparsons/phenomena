const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8792';
const routes={
 en:['/en/showtimes/today/','/en/showtimes/english-language/','/en/guides/english-subtitles-barcelona/'],
 es:['/es/cartelera/hoy/','/es/cartelera/peliculas-en-ingles/','/es/guias/cine-subtitulos-ingles-barcelona/'],
 ca:['/ca/cartellera/avui/','/ca/cartellera/pellicules-en-angles/','/ca/guies/cinema-subtitols-angles-barcelona/']
};
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const plain=await browser.newContext({javaScriptEnabled:false,viewport:{width:1280,height:900}});
  await plain.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await plain.newPage();
  for(const [lang,paths] of Object.entries(routes)){
   await page.goto(base+`/${lang}/`);
   assert.equal(await page.locator('.card[data-film]').count(),24);
   assert.equal(await page.locator('main .discovery-links').count(),0);
   const footer=page.locator('footer .site-information');
   assert.equal(await footer.getAttribute('open'),null);
   assert.equal(await footer.locator('.discovery-links').isVisible(),false);
   await footer.locator('summary').click();
   assert.equal(await footer.locator('.discovery-links').isVisible(),true);
   for(const path of paths){
    const response=await page.goto(base+path);
    assert.equal(response.status(),200);
    assert.equal(await page.locator('h1').count(),1);
    assert.equal(await page.locator('html').getAttribute('lang'),lang);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://vobarna.com'+path);
    assert.equal(await page.locator('link[hreflang]').count(),4);
    assert.ok((await page.locator('.discovery-count').textContent()).trim());
    assert.equal(await page.locator('.discovery [data-discovery-film]').count(),await page.locator('.discovery a.screening-action').count());
   }
  }
  const js=await browser.newContext({viewport:{width:1280,height:900}});
  await js.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const live=await js.newPage(),errors=[];
  live.on('pageerror',e=>errors.push(e.message));
  await live.goto(base+routes.en[1]);
  await live.locator('.discovery-film:visible summary').first().click();
  const action=live.locator('.discovery .screening-action:visible').first();
  const row=action.locator('xpath=ancestor::li');
  const expected=await row.locator('.ticket-link').getAttribute('data-ticket-screening');
  const target=await action.getAttribute('href');
  await action.click();
  await live.waitForSelector('dialog[open] .buyrow.is-highlighted');
  assert.equal(new URL(live.url()).pathname+new URL(live.url()).hash,target);
  assert.equal(await live.locator('.buyrow.is-highlighted').getAttribute('data-session'),expected);
  assert.equal(await live.evaluate(()=>document.activeElement?.dataset.session),expected);
  await live.keyboard.press('Tab');
  assert.equal(await live.evaluate(()=>document.activeElement?.classList.contains('buyrow-ticket')),true);
  await live.reload();
  await live.waitForSelector('dialog[open] .buyrow.is-highlighted');
  assert.equal(await live.locator('.buyrow.is-highlighted').getAttribute('data-session'),expected);
  await live.keyboard.press('Escape');
  await live.setViewportSize({width:390,height:844});
  for(const path of routes.en){
   await live.goto(base+path);
   assert.equal(await live.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,path+' must not overflow on mobile');
   if(await live.locator('.discovery-session:visible').count()){
    const bounds=await live.locator('.discovery-session:visible .screening-action').first().boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390,'Select screening must fit without sideways scrolling');
   }
  }
  fs.mkdirSync('output/seo',{recursive:true});
  await live.screenshot({path:'output/seo/english-subtitles-mobile.png',fullPage:true});
  await live.setViewportSize({width:1280,height:900});
  await live.goto(base+routes.en[1]);
  await live.screenshot({path:'output/seo/english-audio-desktop.png',fullPage:true});
  // An open rolling page must expire sessions and stop claiming yesterday is today.
  const date=await live.locator('.discovery').getAttribute('data-discovery-date');
  await live.clock.install({time:new Date(date+'T12:00:00+01:00')});
  await live.clock.setSystemTime(new Date(date+'T12:00:00+01:00').getTime()+24*60*60*1000);
  await live.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  assert.equal(await live.locator('.discovery-results').isVisible(),false);
  assert.equal(await live.locator('.discovery-stale').isVisible(),true);
  await live.clock.setSystemTime(new Date(date+'T12:00:00+01:00'));
  await live.goto(base+routes.en[2]);
  const starts=await live.locator('[data-discovery-film]').first().getAttribute('data-starts');
  const rowId=await live.locator('[data-discovery-film]').first().getAttribute('id');
  await live.clock.setSystemTime(new Date(Date.parse(starts)+1000));
  await live.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  assert.equal(await live.locator('#'+rowId).isVisible(),false);
  const remaining=await live.locator('[data-discovery-film]:visible').count();
  assert.match(await live.locator('.discovery-count').textContent(),new RegExp(`· ${remaining} screenings`));
  assert.deepEqual(errors,[]);
  console.log('Nine localized pages: no-JS content, closed-footer discovery, exact-session modal/reload/keyboard, mobile layout, expiry and Madrid rollover passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
