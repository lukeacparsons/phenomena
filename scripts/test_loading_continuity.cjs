const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8789';

(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:998},deviceScaleFactor:1});
    context.setDefaultTimeout(20000);
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const html=await (await context.request.get(base+'/en/')).text();
    const cutoff=Date.parse(html.match(/class="card-showtime[\s\S]*?<time datetime="([^"]+)"/)[1]);
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date(cutoff-1000));
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    await page.route('**/programme.json',async route=>{await gate;await route.continue();});
    await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Number(document.querySelector('#grid img').dataset.imageWidth)>160);
    await page.evaluate(()=>{
      window.originalCards=[...document.querySelectorAll('#grid .card')];
      window.originalImages=originalCards.map(card=>card.querySelector('img'));
      window.originalSession=document.querySelector('.card-showtime');
    });
    fs.mkdirSync('output/perf/loading',{recursive:true});
    await page.screenshot({path:'output/perf/loading/before-catalogue.png'});
    await page.clock.setFixedTime(new Date(cutoff+2000));
    release();
    await page.waitForSelector('#grid[data-enhanced]');
    assert.deepEqual(await page.evaluate(()=>({
      cards:originalCards.every((card,index)=>card===document.querySelectorAll('#grid .card')[index]),
      posters:originalImages.every((image,index)=>image===originalCards[index].querySelector('img')),
      session:originalSession===document.querySelector('.card-showtime'),
      expired:originalSession.getAttribute('aria-disabled')==='true'
    })),{cards:true,posters:true,session:true,expired:true});
    await page.locator('.card-showtime').first().click({force:true});
    assert.equal(await page.locator('#filmDialog').evaluate(dialog=>dialog.open),false);
    assert.equal(page.url(),base+'/en/');
    await page.screenshot({path:'output/perf/loading/after-catalogue.png'});
    await page.unroute('**/programme.json');

    // The visitor's next explicit action uses current time and chronological order.
    await page.locator('#dates [data-date="all"]').click();
    assert.equal(await page.locator('.card-showtime.is-started').count(),0);
    const current=await page.evaluate(async()=>{
      const {queryFilms,emptySearch}=await import('/cinema-search.js');
      const programme=await (await fetch('/programme.json')).json();
      return {expected:queryFilms(programme,emptySearch()).slice(0,32).map(f=>f.id),
        actual:[...document.querySelectorAll('#grid .card')].slice(0,32).map(card=>card.dataset.film)};
    });
    assert.deepEqual(current.actual,current.expected);

    // A cached visit must preserve its nodes when the identical network reply lands.
    await page.waitForFunction(async()=>{
      const {readProgrammeCache}=await import('/programme-cache.js');
      return Boolean(await readProgrammeCache('vobarna-public-programme-v1'));
    });
    let releaseRefresh;
    const refreshGate=new Promise(resolve=>{releaseRefresh=resolve;});
    await page.route('**/programme.json',async route=>{await refreshGate;await route.continue();});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector('#grid[data-enhanced]');
    await page.evaluate(()=>{
      window.cachedCards=[...document.querySelectorAll('#grid .card')];
      window.cachedImages=cachedCards.map(card=>card.querySelector('img'));
      window.cachedTitles=cachedCards.map(card=>card.querySelector('h2'));
    });
    const response=page.waitForResponse(response=>response.url().endsWith('/programme.json'));
    releaseRefresh();await (await response).finished();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(()=>cachedCards.every((card,index)=>card===document.querySelectorAll('#grid .card')[index]&&
      cachedImages[index]===card.querySelector('img')&&cachedTitles[index]===card.querySelector('h2'))),true);

    // Changed metadata updates its card without discarding decoded artwork.
    await page.unroute('**/programme.json');
    const programme=await (await context.request.get(base+'/programme.json')).json();
    const id=await page.locator('#grid .card').first().getAttribute('data-film');
    programme.generated_at=new Date(cutoff+3000).toISOString();
    programme.films.find(film=>film.id===id).title='Updated programme title';
    await page.route('**/programme.json',route=>route.fulfill({json:programme}));
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(()=>document.querySelector('#grid .card h2').textContent==='Updated programme title');
    assert.equal(await page.evaluate(()=>cachedCards[0]===document.querySelector('#grid .card')&&cachedImages[0]===cachedCards[0].querySelector('img')),true);
    assert.deepEqual(errors,[]);
    await context.close();
    console.log('Loading continuity: cutoff, preserved cards/images/showtimes, expired actions, explicit reordering, cached revalidation and changed metadata passed.');
  }catch(error){console.error(error);throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
