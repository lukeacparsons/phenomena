const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8792';
const routes={
 en:['/en/showtimes/english-language/','/en/guides/english-subtitles-barcelona/','/en/showtimes/this-weekend/','/en/guides/imax-original-version-barcelona/','/en/guides/35mm-70mm-barcelona/'],
 es:['/es/cartelera/peliculas-en-ingles/','/es/guias/cine-subtitulos-ingles-barcelona/','/es/cartelera/este-fin-de-semana/','/es/guias/imax-version-original-barcelona/','/es/guias/cine-35mm-70mm-barcelona/'],
 ca:['/ca/cartellera/pellicules-en-angles/','/ca/guies/cinema-subtitols-angles-barcelona/','/ca/cartellera/aquest-cap-de-setmana/','/ca/guies/imax-versio-original-barcelona/','/ca/guies/cinema-35mm-70mm-barcelona/']
};
const additions={
 en:['/en/showtimes/catalan-subtitles/','/en/guides/original-version-cinema-gracia/'],
 es:['/es/cartelera/subtitulos-catalan/','/es/guias/cine-version-original-gracia/'],
 ca:['/ca/cartellera/subtitols-catala/','/ca/guies/cinema-versio-original-gracia/']
};
const comparisons={en:'/en/guides/cinema-screen-sound-formats/',es:'/es/guias/formatos-pantalla-sonido-cine/',ca:'/ca/guies/formats-pantalla-so-cinema/'};
for(const lang of Object.keys(routes))routes[lang].push(...additions[lang]);
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const plain=await browser.newContext({javaScriptEnabled:false,viewport:{width:1280,height:900}});
  await plain.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await plain.newPage();
  for(const [lang,paths] of Object.entries(routes)){
   await page.goto(base+`/${lang}/`,{waitUntil:'domcontentloaded'});
   assert.equal(await page.locator('.card[data-film]').count(),24);
   assert.equal(await page.locator('main .discovery-links').count(),0);
   const footer=page.locator('footer .site-information');
   assert.equal(await footer.getAttribute('open'),null);
   assert.equal(await footer.locator('.discovery-links').isVisible(),false);
   await footer.locator('summary').click();
   assert.equal(await footer.locator('.discovery-links').isVisible(),true);
   assert.match(await footer.locator('[data-today-link]').getAttribute('href'),new RegExp(`^/${lang}/\\?date=\\d{4}-\\d{2}-\\d{2}$`));
   for(const path of paths){
    const response=await page.goto(base+path,{waitUntil:'domcontentloaded'});
    assert.equal(response.status(),200);
    assert.equal(await page.locator('h1').count(),1);
    assert.equal(await page.locator('html').getAttribute('lang'),lang);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://vobarna.com'+path);
    assert.equal(await page.locator('link[hreflang]').count(),4);
    assert.ok((await page.locator('.discovery-count').textContent()).trim());
    assert.equal(await page.locator('.discovery [data-discovery-film]').count(),await page.locator('.discovery a.screening-action').count());
    assert.equal(await page.locator('.discovery').getAttribute('data-discovery-kind')==='today',false);
   }
   await page.goto(base+comparisons[lang],{waitUntil:'domcontentloaded'});
   assert.equal(await page.locator('.comparison-room').count(),6);
   assert.ok((await page.locator('#compare-cinesa-diagonal-mar-9').textContent()).includes('IMAX'));
   assert.ok((await page.locator('#compare-cinesa-diagonal-mar-10').textContent()).includes('iSense'));
   assert.ok((await page.locator('#compare-kinepolis-splau-18').textContent()).includes('Cornellà'));
  }
  await plain.close();
  console.log('No-JS checks passed for all 24 localized pages.');
  const js=await browser.newContext({viewport:{width:1280,height:900}});
  await js.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const live=await js.newPage(),errors=[];
  live.on('pageerror',e=>errors.push(e.message));
  await live.goto(base+'/en/showtimes/today/');
  const todayURL=new URL(live.url());
  assert.equal(todayURL.pathname,'/en/');
  const today=todayURL.searchParams.get('date');
  assert.match(today,/^\d{4}-\d{2}-\d{2}$/);
  await live.waitForSelector(`#dates button[data-date="${today}"][aria-pressed="true"]`);
  await live.waitForFunction(date=>[...document.querySelectorAll('.card-day[data-date]')].every(row=>row.dataset.date===date),today);
  assert.equal(await live.locator('.discovery').count(),0);
  assert.equal(await live.locator('link[rel=canonical]').getAttribute('href'),'https://vobarna.com/en/');
  await live.goto(base+routes.en[0]);
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
  // Each new page reaches the same exact-session modal, including format pages
  // where the audio language is not inferred from a film's original language.
  for(const path of routes.en.slice(2)){
   await live.goto(base+path);
   const film=live.locator('.discovery-film:visible summary').first();
   if(await film.count())await film.click();
   const selection=live.locator('.discovery .screening-action:visible').first();
   assert.ok(await selection.count(),path+' needs real collected inventory for this acceptance run');
   const expected=await selection.locator('xpath=ancestor::li').locator('.ticket-link').getAttribute('data-ticket-screening');
   await selection.click();
   await live.waitForSelector('dialog[open] .buyrow.is-highlighted');
   assert.equal(await live.locator('.buyrow.is-highlighted').getAttribute('data-session'),expected);
   await live.keyboard.press('Escape');
   console.log('Exact-session action passed:',path);
  }
  await live.setViewportSize({width:390,height:844});
  for(const path of Object.values(comparisons)){
   await live.goto(base+path);
   assert.equal(await live.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,path+' comparison must fit mobile');
   await live.locator('main nav a[href*="#compare-"]').last().click();
   assert.equal(new URL(live.url()).hash,'#compare-cinesa-parc-valles-imax');
  }
  for(const path of routes.en){
   await live.goto(base+path);
   assert.equal(await live.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,path+' must not overflow on mobile');
   if(await live.locator('.discovery-session:visible').count()){
    const bounds=await live.locator('.discovery-session:visible .screening-action').first().boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390,'Select screening must fit without sideways scrolling');
   }
  }
  fs.mkdirSync('output/seo',{recursive:true});
  await live.screenshot({path:'output/seo/gracia-mobile.png',fullPage:true});
  await live.setViewportSize({width:1280,height:900});
  await live.goto(base+routes.en[2]);
  await live.screenshot({path:'output/seo/weekend-desktop.png',fullPage:false});
  // An open rolling page must expire sessions and stop claiming yesterday is today.
  const date=await live.locator('.discovery').getAttribute('data-discovery-date');
  await live.clock.install({time:new Date(date+'T12:00:00+01:00')});
  await live.clock.setSystemTime(new Date(date+'T12:00:00+01:00').getTime()+24*60*60*1000);
  await live.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  assert.equal(await live.locator('.discovery-results').isVisible(),false);
  assert.equal(await live.locator('.discovery-stale').isVisible(),true);
  await live.goto(base+additions.en[1]);
  assert.equal(await live.locator('.discovery-results').isVisible(),false,'Gràcia rolling window must refresh across Madrid midnight');
  assert.equal(await live.locator('.discovery-stale').isVisible(),true);
  await live.clock.setSystemTime(new Date(date+'T12:00:00+01:00'));
  await live.goto(base+routes.en[1]);
  const starts=await live.locator('[data-discovery-film]').first().getAttribute('data-starts');
  const rowId=await live.locator('[data-discovery-film]').first().getAttribute('id');
  await live.clock.setSystemTime(new Date(Date.parse(starts)+1000));
  await live.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  assert.equal(await live.locator('#'+rowId).isVisible(),false);
  const remaining=await live.locator('[data-discovery-film]:visible').count();
  assert.match(await live.locator('.discovery-count').textContent(),new RegExp(`· ${remaining} screenings`));
  for(const path of routes.en.slice(3,6)){
   await live.clock.setSystemTime(new Date(date+'T12:00:00+01:00'));
   await live.goto(base+path);
   await live.clock.setSystemTime(new Date(date+'T12:00:00+01:00').getTime()+86400000);
   await live.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
   assert.equal(await live.locator('.discovery-stale').isVisible(),false,'Evergreen format guides remain usable across midnight');
   assert.equal(await live.locator('.discovery-results').isVisible(),true);
   if(path===routes.en[4]){
    await live.clock.setSystemTime(new Date('2100-01-01T00:00:00Z'));
    await live.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    assert.equal(await live.locator('.discovery-empty').isVisible(),true);
    assert.equal(await live.locator('.discovery-group-empty:visible').count(),2);
    assert.equal(await live.locator('[data-today-link]').getAttribute('href'),'/en/?date=2100-01-01');
   }
  }
  assert.deepEqual(errors,[]);
  console.log('21 localized discovery pages and 3 room comparisons: no-JS content, closed-footer discovery, Today homepage filter, exact-session modal/reload/keyboard, mobile layout, expiry, empty format sections and Madrid rollover passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
