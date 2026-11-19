const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8789';

(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:'chrome'})});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  context.setDefaultTimeout(15000);
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid[data-enhanced] .title-button',{state:'attached'});
  await page.evaluate(()=>document.fonts.ready);
  const settle=()=>page.waitForFunction(()=>document.getElementById('grid').getAttribute('aria-busy')==='false');
  const search=async text=>{await page.locator('#search').fill(text);await settle();};
  const selected=await page.evaluate(async()=>{
   const programme=await (await fetch('/programme.json')).json();
   const futureFilms=new Set(programme.films.filter(f=>f.sessions.length&&f.sessions.every(s=>Date.parse(s.starts_at)>Date.now()+60*60*1000)).map(f=>f.id));
   window.savedCard=[...document.querySelectorAll('.card')].find(card=>futureFilms.has(card.dataset.film)&&card.querySelector('[data-session]'));
   const session=savedCard.querySelector('[data-session]').dataset.session;
   const screening=programme.films.find(f=>f.id===savedCard.dataset.film).sessions.find(s=>s.id===session);
   return {id:savedCard.dataset.film,title:savedCard.querySelector('h2').textContent,session,checkedAt:screening.seat_data?.checked_at};
  });
  assert.ok(selected.session);
  await search(selected.title);
  assert.equal(await page.evaluate(()=>document.querySelector('.card[data-film="'+savedCard.dataset.film+'"]')===savedCard),true,'Unchanged cards must retain their DOM and loaded images');
  await search('');
  await page.evaluate(()=>{
   window.searchTimings=[];const start=performance.now();
   new PerformanceObserver(list=>searchTimings.push(...list.getEntries().filter(e=>e.name==='input'&&e.startTime>=start).map(e=>({duration:e.duration,processing:e.processingEnd-e.processingStart})))).observe({type:'event',durationThreshold:16});
  });
  await page.locator('#search').pressSequentially('Spanish',{delay:15});
  await settle();
  assert.equal(await page.locator('#search').inputValue(),'Spanish');
  assert.equal(new URL(page.url()).searchParams.get('q'),'Spanish');
  const comparison=await page.evaluate(async()=>{
   const {queryFilms,emptySearch,createSearchIndex}=await import('/cinema-search.js');
   const programme=await (await fetch('/programme.json')).json();
   const expected=queryFilms(programme,{...emptySearch(),query:'Spanish'},{index:createSearchIndex(programme)}).map(f=>f.id);
   return {expected,actual:[...document.querySelectorAll('.card')].map(el=>el.dataset.film),timings:window.searchTimings};
  });
  assert.deepEqual(comparison.actual,comparison.expected.slice(0,comparison.actual.length));
  assert.ok(comparison.actual.length<=64,'Initial results should render in small batches');
  if(comparison.actual.length<comparison.expected.length){
   await page.locator('#moreFilms').scrollIntoViewIfNeeded();
   await page.waitForFunction(count=>document.querySelectorAll('.card').length===count,comparison.expected.length);
  }
  // A synchronous reset must cancel the older pending typing frame.
  await page.evaluate(()=>{
   const input=document.getElementById('search');input.value='Dune';input.dispatchEvent(new Event('input',{bubbles:true}));
   document.getElementById('clearFilters').click();
  });
  await settle();
  assert.equal(await page.locator('#search').inputValue(),'');
  assert.equal(new URL(page.url()).searchParams.has('q'),false);
  assert.ok(await page.locator('.card').count()>24);
  await page.locator('#dates button[data-date]').nth(1).click();
  assert.equal(new URL(page.url()).searchParams.has('date'),true);
  await search('Saturday');
  assert.equal(new URL(page.url()).searchParams.has('date'),false,'A typed date replaces an older date-picker selection');
  await search('');
  // Composition doesn't run a search until the text is committed.
  await page.evaluate(()=>{
   const input=document.getElementById('search');input.value='français';
   input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
  });
  assert.equal(new URL(page.url()).searchParams.has('q'),false);
  await page.evaluate(()=>document.getElementById('search').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  await settle();
  assert.equal(new URL(page.url()).searchParams.get('q'),'français');
  // Cached cards must pick up seat changes received while they were filtered out.
  await search('no-such-film-zzzz');
  const checkedAt=new Date(Math.max(Date.now(),Date.parse(selected.checkedAt)||0)+1000).toISOString();
  await page.route('**/availability.json',route=>route.fulfill({json:{sessions:{[selected.session]:{available:0,kind:'ordinary',is_sold_out:true,checked_at:checkedAt}},errors:{}}}));
  const refreshedSeats=page.waitForResponse(response=>response.url().endsWith('/availability.json'));
  // Returning after the source's refresh interval must update cached cards.
  await page.clock.setFixedTime(new Date(await page.evaluate(()=>Date.now()+16*60*1000)));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await refreshedSeats;
  await page.waitForFunction(({id,checkedAt})=>JSON.parse(localStorage.getItem('barcelona-cinema-seats-v1')||'{}')[id]?.checked_at===checkedAt,{id:selected.session,checkedAt},{timeout:30000});
  await search(selected.title);
  await page.waitForFunction(id=>document.querySelector('[data-session="'+id+'"]')?.classList.contains('is-sold-out'),selected.session);
  // Replacing a programme refreshes the search index and card contents.
  await search('');
  const programme=await (await context.request.get(base+'/programme.json')).json();
  programme.generated_at=new Date().toISOString();
  programme.films.find(f=>f.id===selected.id).title='Fresh programme marker';
  await page.route('**/programme.json',route=>route.fulfill({json:programme}));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await search('Fresh programme marker');
  await page.waitForFunction(id=>document.querySelector('.card[data-film="'+id+'"] h2')?.textContent==='Fresh programme marker',selected.id);
  assert.equal(await page.locator('.card h2').first().innerText(),'Fresh programme marker');
  assert.deepEqual(errors,[]);
  fs.mkdirSync('output/perf/search',{recursive:true});
  fs.writeFileSync('output/perf/search/browser-check.json',JSON.stringify({passed:true,inputTimings:comparison.timings},null,2));
  console.log('Fast search: rapid typing, stable cards, reset cancellation, composition, seat freshness and programme replacement passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
