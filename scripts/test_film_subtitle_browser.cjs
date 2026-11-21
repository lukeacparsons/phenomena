const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8847';
(async()=>{
 const {hasEnglishSubtitles}=await import('../static/screening-language.js');
 const data=JSON.parse(fs.readFileSync('static/preview-data/screenings.json','utf8'));
 const registry=JSON.parse(fs.readFileSync('.site/current/registry.json','utf8'));
 const future=f=>f.sessions.filter(s=>Date.parse(s.starts_at)>Date.now());
 const mixed=data.films.find(f=>future(f).some(hasEnglishSubtitles)&&future(f).some(s=>!hasEnglishSubtitles(s)));
 const all=data.films.find(f=>future(f).length&&future(f).every(hasEnglishSubtitles));
 const none=data.films.find(f=>future(f).length&&!f.sessions.some(hasEnglishSubtitles));
 assert.ok(mixed&&all&&none,'programme needs mixed, all-English-subtitle and ordinary films');
 const path=(film,lang='en')=>{
  const record=registry.entities[registry.aliases['films:'+film.id]];
  return `/${lang}/${{en:'films',es:'peliculas',ca:'pellicules'}[lang]}/${record.slugs[lang]}/`;
 };
 const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
 fs.mkdirSync('output/guide-ux-fix/subtitle-films',{recursive:true});
 try{
  const context=await browser.newContext({reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const visibleIds=()=>page.locator('#showtimes .card-showtime:visible').evaluateAll(nodes=>nodes.map(n=>n.dataset.session).sort());
  const expected=future(mixed).filter(hasEnglishSubtitles).map(s=>s.id).sort();
  for(const lang of ['en','es','ca']){
   await page.goto(base+path(mixed,lang),{waitUntil:'load'});
   await page.waitForSelector('#filmDialog',{state:'attached'});
   assert.equal(await page.locator('#english-subtitles').isVisible(),false,'supporting copy stays in the closed footer');
   assert.equal(await page.locator('[data-subtitle-filter]:visible').count(),1);
   assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://vobarna.com'+path(mixed,lang));
   await page.locator('[data-subtitle-filter]').click();
   assert.deepEqual(await visibleIds(),expected);
   for(const width of [1440,390])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    await page.locator('#showtimes').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.ok((await page.locator('[data-subtitle-filter]').boundingBox()).height>=44);
    await page.screenshot({path:`output/guide-ux-fix/subtitle-films/${lang}-${width}-${theme}.png`});
   }
   const first=page.locator('#showtimes .card-showtime:visible').first(),id=await first.getAttribute('data-session');
   await first.click();await page.waitForSelector('dialog[open] .buyrow');
   assert.equal(await page.locator('dialog .buyrow').getAttribute('data-session'),id);
   await page.reload({waitUntil:'load'});await page.waitForSelector('dialog[open] .buyrow');
   assert.deepEqual(await visibleIds(),expected);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog').open);
   assert.equal(new URL(page.url()).searchParams.get('subtitles'),'en');
   assert.ok((await page.locator('.lang-switch a[hreflang]').first().getAttribute('href')).includes('?subtitles=en'));
   await page.locator('[data-subtitle-filter]').click();
   assert.equal((await visibleIds()).length,future(mixed).length);
   await page.goBack();assert.deepEqual(await visibleIds(),expected);
  }
  for(const film of [all,none]){
   await page.goto(base+path(film),{waitUntil:'load'});
   await page.waitForSelector('#filmDialog',{state:'attached'});
   assert.equal(await page.locator('[data-subtitle-filter]:visible').count(),0,'no unnecessary control');
   if(film===all)assert.equal(await page.locator('.film-showtimes-heading').innerText(),'English subtitles');
  }
  const plainContext=await browser.newContext({javaScriptEnabled:false}),plain=await plainContext.newPage();
  await plainContext.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await plain.goto(base+path(mixed),{waitUntil:'load'});
  await plain.locator('[data-subtitle-filter]').click();
  assert.equal(await plain.locator('#english-subtitles').isVisible(),true,'native fragment opens the footer without JavaScript');
  assert.ok(await plain.locator('#english-subtitles .screening-action:visible').count());
  await plainContext.close();
  await page.clock.setFixedTime(new Date('2199-01-01T12:00:00Z'));
  await page.goto(base+path(mixed)+'?subtitles=en',{waitUntil:'load'});
  await page.waitForSelector('#filmDialog',{state:'attached'});
  assert.deepEqual(errors,[],'page exceptions before expiry assertions');
  assert.deepEqual(await visibleIds(),[]);
  assert.equal(await page.locator('#showtimes .film-empty').isVisible(),true);
  assert.equal(await page.locator('#english-subtitles [data-subtitle-empty]').getAttribute('hidden'),null);
  assert.deepEqual(errors,[]);
  console.log('Film subtitles: 12 responsive/theme views, scoped sessions, reload/history, locales, no-clutter states, no-JavaScript fallback and expiry passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
