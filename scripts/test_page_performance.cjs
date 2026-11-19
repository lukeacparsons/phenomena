const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8789';
const cacheKey='vobarna-public-programme-v1';

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:'chrome'})}),report={};
  try{
    for(const width of [390,1280]){
      const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:2});
      context.setDefaultTimeout(20000);
      await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:'',contentType:'text/css'}));
      await context.addInitScript(()=>{
        Object.defineProperty(navigator,'connection',{value:Object.assign(new EventTarget(),{effectiveType:'4g',saveData:false}),configurable:true});
        if(!sessionStorage.getItem('seeded')){
          // This is enough to reproduce the former two-catalogue quota failure.
          localStorage.setItem('barcelona-cinema-programme-v1','x'.repeat(2600000));
          localStorage.setItem('keep-preference','keep');sessionStorage.setItem('seeded','1');
        }
      });
      const page=await context.newPage(),errors=[],posters=new Set();
      page.on('pageerror',error=>errors.push(error.message));
      page.on('request',request=>{if(request.url().includes('/preview-data/images/'))posters.add(request.url());});
      let release;
      const gate=new Promise(resolve=>{release=resolve;});
      await page.route('**/programme.json',async route=>{await gate;await route.continue();});
      await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
      // Images must sharpen while the search catalogue is still held back.
      await page.waitForFunction(()=>Number(document.querySelector('#grid img').dataset.imageWidth)>160);
      const before=await page.locator('#grid').boundingBox();
      const posterBefore=await page.locator('#grid img').first().boundingBox();
      const firstFilm=await page.locator('#grid .card').first().getAttribute('data-film');
      assert.equal(await page.locator('.filters').isVisible(),true);
      assert.ok(await page.locator('.card-showtime').count()>0,'Full showtimes must be present before the catalogue');
      await page.evaluate(()=>{
        window.firstCards=[...document.querySelectorAll('#grid .card')].slice(0,4);
        window.firstPosters=firstCards.map(card=>card.querySelector('img'));
        window.firstShowtimes=firstCards.map(card=>card.querySelector('.card-showtime'));
        window.firstSources=firstPosters.map(image=>image.src);
      });
      assert.ok(posters.size<=12,`Only nearby artwork should load (${posters.size})`);
      release();
      await page.waitForSelector('#grid[data-enhanced] .title-button');
      const after=await page.locator('#grid').boundingBox();
      const continuity=await page.evaluate(()=>({
        cards:firstCards.every((card,index)=>card===document.querySelectorAll('#grid .card')[index]),
        posters:firstPosters.every((image,index)=>image===firstCards[index].querySelector('img')),
        showtimes:firstShowtimes.every((link,index)=>link===firstCards[index].querySelector('.card-showtime')),
        quality:firstPosters.every((image,index)=>!firstSources[index].startsWith('data:')?!image.src.startsWith('data:'):true),
        controls:getComputedStyle(document.querySelector('.filters')).visibility==='visible'
      }));
      assert.deepEqual(continuity,{cards:true,posters:true,showtimes:true,quality:true,controls:true});
      const samePoster=page.locator('.card[data-film="'+firstFilm+'"] img').first();
      const posterAfter=await samePoster.count()?await samePoster.boundingBox():null;
      assert.ok(Math.abs(before.y-after.y)<=1,`Filters must not move the grid: ${before.y} → ${after.y}`);
      if(posterAfter)assert.ok(Math.abs(posterBefore.height-posterAfter.height)<=1,`Poster aspect ratios must survive hydration: ${JSON.stringify({posterBefore,posterAfter,firstFilm})}`);
      await page.waitForFunction(()=>localStorage.getItem('barcelona-cinema-programme-v1')===null);
      const cached=await page.evaluate(async key=>{
        const {readProgrammeCache}=await import('/programme-cache.js');
        const value=await readProgrammeCache(key);
        return {films:value?.films.length,localCopy:localStorage.getItem(key),preference:localStorage.getItem('keep-preference')};
      },cacheKey);
      assert.ok(cached.films>24);assert.equal(cached.localCopy,null);assert.equal(cached.preference,'keep');
      await page.unroute('**/programme.json');
      await page.route('**/programme.json',route=>route.abort());
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForSelector('#grid[data-enhanced] .title-button');
      await page.locator('#search').fill('Dune');
      await page.waitForFunction(()=>location.search==='?q=Dune'&&document.querySelector('.title-button'));
      assert.deepEqual(errors,[]);
      report[width]={gridTopBefore:before.y,gridTopAfter:after.y,earlyPosterRequests:posters.size,cachedFilms:cached.films,offlineSearch:true,continuity};
      console.log('Layout, early artwork and cache passed at '+width+'px');
      await context.close();
    }

    // Verify the fallback path in a browser where IndexedDB is unavailable.
    const fallback=await browser.newContext(),fallbackPage=await fallback.newPage();
    await fallbackPage.goto(base+'/programme-data.js');
    const fallbackResult=await fallbackPage.evaluate(async key=>{
      Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Unavailable','SecurityError');}});
      const {readProgrammeCache,saveProgrammeCache}=await import('/programme-cache.js');
      localStorage.setItem('barcelona-cinema-programme-v1','x'.repeat(2600000));
      const value={films:[{id:'cached',padding:'x'.repeat(2800000)}],cinemas:[]};
      const saved=await saveProgrammeCache(key,value);
      return {saved,id:(await readProgrammeCache(key))?.films[0].id,legacy:localStorage.getItem('barcelona-cinema-programme-v1')};
    },cacheKey);
    assert.deepEqual(fallbackResult,{saved:true,id:'cached',legacy:null});
    await fallback.close();

    // Advance browser time instead of waiting fifteen real minutes between polls.
    const polling=await browser.newContext(),page=await polling.newPage();
    await polling.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:'',contentType:'text/css'}));
    await page.clock.install();
    await page.addInitScript(()=>{
      window.seatWrites=0;
      const set=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key==='barcelona-cinema-seats-v1')window.seatWrites++;return set.call(this,key,value);};
    });
    let requests=[],phase='idle';
    await page.route('**/availability.json',async route=>{
      const headers=route.request().headers();requests.push(headers);
      if(phase==='idle'&&requests.length>1)return route.fulfill({status:304,headers:{ETag:'"idle"'}});
      if(phase==='failed')return route.fulfill({status:503,body:'Unavailable'});
      await route.fulfill({headers:{ETag:'"'+phase+'"'},json:{sessions:{},errors:{},refreshing:phase==='refreshing',refresh_interval_seconds:900}});
    });
    await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.seatWrites===1);
    await page.clock.fastForward(30000);
    assert.equal(requests.length,1,'Idle availability must not poll every fifteen seconds');
    let next=page.waitForResponse(response=>response.url().endsWith('/availability.json'));
    await page.clock.fastForward(15*60*1000);
    await next;
    assert.equal(requests.length,2);
    assert.equal(requests[1]['if-none-match'],'"idle"');
    assert.equal(await page.evaluate(()=>window.seatWrites),1,'304 must not rewrite the cached snapshot');
    phase='refreshing';
    next=page.waitForResponse(response=>response.url().endsWith('/availability.json'));
    await page.clock.fastForward(15*60*1000);await next;
    await page.waitForFunction(()=>window.seatWrites===2);
    next=page.waitForResponse(response=>response.url().endsWith('/availability.json'));
    await page.clock.fastForward(31000);await next;
    assert.equal(requests.length,4,'An active source refresh is checked again sooner');
    assert.equal(await page.evaluate(()=>window.seatWrites),2,'Matching ETags must skip parsing and persistence even with a 200 response');
    phase='failed';next=page.waitForResponse(response=>response.url().endsWith('/availability.json'));
    await page.clock.fastForward(31000);await next;
    const failedCount=requests.length;
    await page.clock.fastForward(31000);
    assert.equal(requests.length,failedCount,'Failed requests must back off');
    next=page.waitForResponse(response=>response.url().endsWith('/availability.json'));
    await page.clock.fastForward(31000);await next;
    assert.equal(requests.length,failedCount+1,'Failed availability must retry');
    report.polling={conditionalRequests:true,unchangedSnapshotsSkipped:true,idleSeconds:900,refreshingSeconds:30,retrySeconds:60};
    await polling.close();
    fs.mkdirSync('output/perf/page-fixes',{recursive:true});
    fs.writeFileSync('output/perf/page-fixes/checks.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }catch(error){console.error(error);throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
