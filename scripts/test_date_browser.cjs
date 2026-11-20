const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8808';
const calendar={en:['showtimes/today','showtimes/tomorrow'],es:['cartelera/hoy','cartelera/manana'],ca:['cartellera/avui','cartellera/dema']};
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const next=new Date(day+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);
const tomorrow=next.toISOString().slice(0,10);

(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const raw=await browser.newContext({javaScriptEnabled:false,viewport:{width:1280,height:900}});
  await raw.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const page=await raw.newPage();
  for(const [lang,paths] of Object.entries(calendar))for(const [i,path] of paths.entries()){
   const selected=i?tomorrow:day,url=`/${lang}/${path}/`;
   const response=await page.goto(base+url);
   assert.equal(response.status(),200);assert.equal(response.headers()['x-robots-tag'],undefined);
   assert.equal(await page.locator('body').getAttribute('data-listing-date'),selected);
   assert.equal(await page.locator('meta[name=robots]').getAttribute('content'),'index,follow');
   assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://vobarna.com'+url);
   assert.ok((await page.title()).includes(selected));
   assert.deepEqual([...new Set(await page.locator('#grid .card-day').evaluateAll(rows=>rows.map(x=>x.dataset.date)))], [selected]);
   assert.ok(await page.locator('[data-programme-entries] time').count()>0);
   assert.equal(await page.locator('.filters').isVisible(),false);
   for(const [other,otherPaths] of Object.entries(calendar))assert.equal(await page.locator(`.lang-switch a[lang=${other}]`).getAttribute('href'),`/${other}/${otherPaths[i]}/`);
  }
  for(const lang of Object.keys(calendar)){
   const response=await page.goto(base+`/${lang}/?date=${tomorrow}`);
   assert.equal(response.headers()['x-robots-tag'],'noindex, follow');
   assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),`https://vobarna.com/${lang}/?date=${tomorrow}`);
   assert.deepEqual([...new Set(await page.locator('#grid .card-day').evaluateAll(rows=>rows.map(x=>x.dataset.date)))],[tomorrow]);
  }
  await page.goto(base+'/en/?date=2099-12-31');
  assert.equal(await page.locator('.card[data-film]').count(),0);
  assert.ok((await page.locator('.empty').innerText()).includes('unknown'));
  assert.equal((await page.goto(base+'/en/?date=2026-02-30')).status(),404);
  await raw.close();

  const enhanced=await browser.newContext({viewport:{width:1280,height:900}});
  await enhanced.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const live=await enhanced.newPage(),errors=[];
  live.on('pageerror',e=>errors.push(e.message));
  await live.goto(base+'/en/showtimes/tomorrow/');
  await live.waitForSelector('#grid[data-enhanced]');
  assert.equal(live.url(),base+'/en/showtimes/tomorrow/');
  assert.equal(await live.locator('#dates [aria-pressed=true]').getAttribute('data-date'),tomorrow);
  assert.deepEqual([...new Set(await live.locator('#grid .card-day').evaluateAll(rows=>rows.map(x=>x.dataset.date)))],[tomorrow]);
  await live.locator('.card-showtime').first().click();
  await live.waitForSelector('#filmDialog[open]');
  assert.equal(await live.locator('.buyrow.is-highlighted').count(),1);
  await live.keyboard.press('Escape');
  await live.waitForURL(base+'/en/showtimes/tomorrow/');
  assert.equal(live.url(),base+'/en/showtimes/tomorrow/');
  await live.locator('.lang-switch a[lang=es]').click();
  await live.waitForSelector('#grid[data-enhanced]');
  assert.equal(live.url(),base+'/es/cartelera/manana/');
  await live.locator(`#dates button[data-date="${day}"]`).click();
  await live.waitForFunction(day=>location.pathname==='/es/'&&new URLSearchParams(location.search).get('date')===day,day);
  await live.reload();await live.waitForSelector('#grid[data-enhanced]');
  assert.equal(await live.locator('body').getAttribute('data-listing-date'),day);
  await live.locator('#dates [data-date=all]').click();
  await live.waitForFunction(()=>!location.search);
  await live.goto(base+'/en/showtimes/today/');await live.waitForSelector('#grid[data-enhanced]');
  fs.mkdirSync('output/date-discovery',{recursive:true});
  await live.screenshot({path:'output/date-discovery/today-desktop.png'});
  await live.setViewportSize({width:390,height:844});
  assert.equal(await live.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await live.screenshot({path:'output/date-discovery/today-mobile.png'});
  // A previously opened relative page must refresh when Madrid's date changes.
  await live.route('**/en/showtimes/today/',async route=>{
   const response=await route.fetch();let html=await response.text();
   html=html.replace(`data-listing-date="${day}"`,'data-listing-date="2000-01-01"');
   await route.fulfill({response,body:html});
   await live.unroute('**/en/showtimes/today/');
  },{times:1});
  await live.reload();
  await live.waitForFunction(day=>document.body.dataset.listingDate===day,day);
  assert.deepEqual(errors,[]);
  console.log('Date pages: six localized landings, raw day HTML, indexing, empty/invalid dates, hydration, modal return, locale/date navigation, mobile and stale-day refresh passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
