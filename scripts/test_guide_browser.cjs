const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8847';
const output=path.resolve('output/guide-ux-fix/browser');
const routes=[
 ['english','/en/showtimes/english-language/'],['weekend','/en/showtimes/this-weekend/'],
 ['subtitles','/en/guides/english-subtitles-barcelona/'],['vosc','/en/showtimes/catalan-subtitles/'],
 ['imax','/en/guides/imax-original-version-barcelona/'],['film','/en/guides/35mm-70mm-barcelona/'],
 ['gracia','/en/guides/original-version-cinema-gracia/'],['eixample','/en/guides/original-version-cinema-eixample/'],
 ['classics','/en/guides/classic-films-barcelona/'],['discounts','/en/guides/cinema-discount-days-barcelona/'],
 ['directory','/en/guides/'],['formats','/en/guides/cinema-screen-sound-formats/'],
 ['versions','/en/guides/vose-vosc-original-version/'],['programme','/en/programme/'],
 ['spanish','/es/cartelera/peliculas-en-ingles/'],['catalan','/ca/cartellera/pellicules-en-angles/']
];
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const report={views:[],checks:[]};
 try{
  const context=await browser.newContext({reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const [name,url] of routes){
   assert.equal((await page.goto(base+url,{waitUntil:'load'})).status(),200);
   if(await page.locator('.discovery').count())await page.waitForFunction(()=>!document.querySelector('.guide-controls').hidden);
   if(['english','spanish','catalan'].includes(name)){
    assert.equal(await page.locator('.guide-selects,.discovery-count').count(),0,'English audio guides have only date controls');
   }
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await page.evaluate(()=>scrollTo(0,0));
    for(const theme of ['light','dark']){
     await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
     const metrics=await page.evaluate(()=>{
      const visible=e=>e.checkVisibility({checkVisibilityCSS:true})&&e.getBoundingClientRect().height>0;
      const cards=[...document.querySelectorAll('.discovery .card')].filter(visible);
      const posters=cards.map(c=>c.querySelector('.poster,.poster-placeholder'));
      const targets=[...document.querySelectorAll('.discovery .title-button,.guide-directory-link,.guide-selects select,.guide-information>summary,.programme-index>summary')].filter(visible);
      return {overflow:document.documentElement.scrollWidth>innerWidth+1,cards:cards.length,posters:posters.filter(Boolean).length,
       firstPoster:posters[0]?Math.round(posters[0].getBoundingClientRect().top):null,
       targets:targets.every(a=>a.getBoundingClientRect().height>=44),
       previews:cards.every(c=>c.querySelector('.card-showtime')),inlineSchedules:document.querySelectorAll('.discovery .card details').length,
       columns:cards[0]?getComputedStyle(cards[0].parentElement).gridTemplateColumns.split(' ').length:null};
     });
     assert.equal(metrics.overflow,false,`${name} ${width}: overflow`);
     assert.equal(metrics.targets,true,`${name} ${width}: touch targets`);
     assert.equal(metrics.posters,metrics.cards,`${name}: all cards have artwork or a placeholder`);
     assert.equal(metrics.previews,true,`${name}: visible matching previews`);
     assert.equal(metrics.inlineSchedules,0);
     if(metrics.cards){assert.equal(metrics.columns,width===1440?4:1,name);if(name!=='discounts')assert.ok(metrics.firstPoster<650,`${name} ${width}: first poster ${metrics.firstPoster}`);}
     report.views.push({name,width,theme,...metrics});
     await page.screenshot({path:path.join(output,`${name}-${width}-${theme}.png`)});
    }
   }
  }
  await page.goto(base+'/en/guides/',{waitUntil:'load'});
  for(const route of ['/en/showtimes/english-language/','/en/showtimes/this-weekend/'])assert.equal(await page.locator(`.guide-directory a[href="${route}"]`).count(),1);
  await page.goto(base+routes[1][1],{waitUntil:'load'});
  await page.waitForFunction(()=>!document.querySelector('.guide-controls').hidden);
  const chosen=await page.evaluate(()=>{
   const data=JSON.parse(document.getElementById('discovery-data').textContent);
   for(const [group,entries] of Object.entries(data.groups))for(const entry of entries){
    const film=data.films.find(f=>f.id===entry.id),sessions=film.sessions.filter(s=>entry.sessions.includes(s.id)&&Date.parse(s.starts_at)>Date.now());
    for(const session of sessions){const matches=sessions.filter(s=>s.date===session.date&&s.cinema_id===session.cinema_id);if(matches.length>3)return {group,id:film.id,date:session.date,cinema:session.cinema_id,ids:matches.map(s=>s.id)};}
   }
  });
  assert.ok(chosen,'test programme must contain a film with several matching times');
  await page.locator(`.guide-controls button[data-date="${chosen.date}"]`).click();
  await page.locator('[data-guide-cinema]').selectOption(chosen.cinema);
  if(await page.locator('[data-guide-group]').count())await page.locator('[data-guide-group]').selectOption(chosen.group);
  const card=page.locator(`.discovery-group[id="${chosen.group}"] .card[data-film="${chosen.id}"]`);
  const previewIds=await card.locator('.card-showtime').evaluateAll(nodes=>nodes.map(n=>n.dataset.session));
  assert.ok(previewIds.every(id=>chosen.ids.includes(id)));
  assert.ok(previewIds.length<=3);
  const more=card.locator('.card-more');
  assert.match(await more.textContent(),new RegExp(String(chosen.ids.length-previewIds.length)));
  await more.focus();await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[open][data-view=showtimes]');
  assert.deepEqual((await page.locator('dialog .card-showtime').evaluateAll(nodes=>nodes.map(n=>n.dataset.session))).sort(),[...chosen.ids].sort());
  await page.screenshot({path:path.join(output,'scoped-showtimes.png')});
  const session=await page.locator('dialog .card-showtime').first().getAttribute('data-session');
  await page.locator('dialog .card-showtime').first().click();
  assert.equal(await page.locator('dialog .buyrow').getAttribute('data-session'),session);
  assert.equal(await page.locator('dialog .guide-session-facts').count(),1);
  await page.reload({waitUntil:'load'});
  await page.waitForSelector('dialog[open] .buyrow');
  assert.equal(await page.locator('dialog .buyrow').getAttribute('data-session'),session,'reload retains exact session and scope');
  await page.locator('dialog [data-show-film-times]').click();
  assert.deepEqual((await page.locator('dialog .card-showtime').evaluateAll(nodes=>nodes.map(n=>n.dataset.session))).sort(),[...chosen.ids].sort());
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog').open);
  await page.waitForFunction(()=>!location.hash.includes('film='));
  assert.equal(new URL(page.url()).searchParams.get('cinema'),chosen.cinema);
  await page.goForward();await page.waitForSelector('dialog[open]');
  await page.goBack();await page.waitForFunction(()=>!document.querySelector('dialog').open);
  // A fresh opener must regain focus when a dialog closes.
  await more.click();await page.waitForSelector('dialog[open]');await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('dialog').open);
  assert.equal(await more.evaluate(node=>document.activeElement===node),true);
  report.checks.push('scoped previews/counts, keyboard open, exact session, reload, back/forward and focus restoration');
  await page.goto(base+routes[0][1]+'?date=2199-01-01',{waitUntil:'load'});
  await page.waitForFunction(()=>!document.querySelector('.guide-controls').hidden);
  assert.equal(await page.locator('.discovery .card:visible').count(),0);
  assert.equal(await page.locator('.discovery-empty').isVisible(),true);
  const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:900}}),plain=await nojs.newPage();
  for(const route of [routes[0][1],routes[2][1],routes[5][1]]){
   await plain.goto(base+route,{waitUntil:'load'});
   assert.ok(await plain.locator('.discovery .card-showtime:visible').count(),'initial HTML includes showtimes');
   assert.match(await plain.locator('.discovery .card-showtime').first().getAttribute('href'),/#screening-/);
   await plain.locator('.guide-sources>summary').click();
   assert.ok(await plain.locator('.guide-sources .ticket-link:visible').count());
  }
  await nojs.close();report.checks.push('empty filters and no-JavaScript posters, previews, complete sources and ticket links');
  await page.clock.setFixedTime(new Date('2199-01-01T12:00:00Z'));
  await page.goto(base+routes[2][1],{waitUntil:'load'});
  assert.equal(await page.locator('.discovery .card:visible').count(),0);
  assert.equal(await page.locator('.discovery-empty').isVisible(),true);
  await page.goto(base+routes[0][1],{waitUntil:'load'});
  assert.equal(await page.locator('.discovery-stale').isVisible(),true);
  assert.equal(await page.locator('.discovery-results').isVisible(),false);
  assert.deepEqual(errors,[]);report.checks.push('expiration, midnight stale state, no page exceptions');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(`${report.views.length} responsive/theme views and all guide interaction checks passed.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
