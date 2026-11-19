const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||process.argv[2]||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8765';
const venuePath='/en/cinemas/mooby-balmes/';

(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const output='output/cinema-design';
    fs.mkdirSync(output,{recursive:true});
    const staticContext=await browser.newContext({javaScriptEnabled:false,viewport:{width:1280,height:900}});
    const fallback=await staticContext.newPage();
    await fallback.goto(base+venuePath,{waitUntil:'domcontentloaded'});
    assert.ok(await fallback.locator('#grid .card').count()>0);
    assert.ok(await fallback.locator('.screenings tbody tr').count()>0,'Full screenings remain in HTML');
    assert.ok(await fallback.locator('.poster-button noscript img:visible').count()>0,'Posters work without JavaScript');
    assert.equal(await fallback.locator('.filters').isVisible(),false);
    assert.equal(await fallback.locator('.venue-disclosure[open]').count(),0);
    await fallback.locator('.venue-disclosure:has(.room)>summary').click();
    assert.equal(await fallback.locator('.room').first().isVisible(),true);
    await fallback.locator('.venue-disclosure:has(.screenings)>summary').click();
    assert.equal(await fallback.locator('.screenings').isVisible(),true);
    await staticContext.close();

    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const ready=async()=>{
      await page.waitForSelector('#grid[data-enhanced] .card .title-button',{state:'attached'});
      await page.waitForFunction(()=>document.querySelector('#grid').getAttribute('aria-busy')==='false');
    };
    const scoped=async(id='mooby-balmes')=>{
      const ids=await page.locator('.card-cinema').evaluateAll(nodes=>nodes.map(n=>n.dataset.cinema));
      assert.ok(ids.length>0);
      assert.ok(ids.every(value=>value===id),'All rendered showtimes belong to the selected cinema');
    };
    const componentStyles=()=>{
      const selectors=['.dates','.dates .all-dates','.search','.grid','.card','.card-body','.card-showtime'];
      return Object.fromEntries(selectors.map(selector=>{
        const s=getComputedStyle(document.querySelector(selector));
        return [selector,[s.display,s.fontSize,s.padding,s.borderRadius,s.backgroundColor,s.gridTemplateColumns]];
      }));
    };
    await page.goto(base+venuePath,{waitUntil:'domcontentloaded'});
    await ready();await scoped();
    assert.equal(await page.locator('.venue-film,.venue-dates,.venue-search').count(),0,'No parallel venue-specific listing UI');
    assert.equal(await page.locator('#dates [aria-pressed=true]').getAttribute('data-date'),'all');
    const venueStyles=await page.evaluate(componentStyles);
    let filmIds=await page.locator('.card[data-film]').evaluateAll(nodes=>nodes.map(n=>n.dataset.film));
    const day=await page.locator('.card-day').first().getAttribute('data-date');
    await page.locator(`#dates [data-date="${day}"]`).click();
    await scoped();
    assert.ok((await page.locator('.card-day').evaluateAll(nodes=>nodes.map(n=>n.dataset.date))).every(value=>value===day));
    const title=await page.locator('.title-button').first().innerText();
    await page.locator('#search').fill(title);
    await page.waitForFunction(query=>new URLSearchParams(location.search).get('q')===query&&document.querySelector('#grid').getAttribute('aria-busy')==='false',title);
    await scoped();
    const returnURL=page.url();
    await page.locator('.card-showtime').first().click();
    await page.waitForSelector('#filmDialog[open]');
    assert.ok((await page.locator('.dialog-cinema').evaluateAll(nodes=>nodes.map(n=>n.dataset.cinema))).every(id=>id==='mooby-balmes'));
    const booking=await page.locator('.buyrow-ticket').first().getAttribute('href');
    assert.ok((await page.locator('.screenings a.ticket-link').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')))).includes(booking));
    await page.goBack();
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    assert.equal(page.url(),returnURL);
    await page.goForward();
    await page.waitForSelector('#filmDialog[open]');
    await page.keyboard.press('Escape');
    await page.waitForURL(returnURL);
    await page.locator('#clearFilters').click();
    await scoped();
    assert.equal(page.url(),base+venuePath,'Reset keeps the cinema scope');
    filmIds=await page.locator('.card[data-film]').evaluateAll(nodes=>nodes.map(n=>n.dataset.film));
    await page.locator('#search').fill('zzzz-no-such-film-zzzz');
    await page.waitForSelector('#grid .empty');
    await page.locator('#grid [data-reset]').click();
    await scoped();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:output+'/desktop.png'});
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No overflow at ${width}px`);
      await page.screenshot({path:output+`/mobile-${width}.png`});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(base+'/en/?cinemas=mooby-balmes',{waitUntil:'domcontentloaded'});
    await ready();
    assert.deepEqual(await page.evaluate(componentStyles),venueStyles,'Homepage and venue use identical component styling');
    assert.deepEqual(await page.locator('.card[data-film]').evaluateAll(nodes=>nodes.map(n=>n.dataset.film)),filmIds);
    await page.locator('#clearFilters').click();
    const homeCinemas=await page.locator('.card-cinema').evaluateAll(nodes=>new Set(nodes.map(n=>n.dataset.cinema)).size);
    assert.ok(homeCinemas>1,'Cinema pages never narrow the shared catalogue cache');
    await page.goto(base+venuePath+'#sala-9',{waitUntil:'domcontentloaded'});
    await ready();
    assert.equal(await page.locator('#sala-9').isVisible(),true);
    assert.equal(new URL(page.url()).hash,'#sala-9');
    for(const [lang,section] of [['es','cines'],['ca','cinemes']]){
      await page.goto(base+`/${lang}/${section}/mooby-balmes/`,{waitUntil:'domcontentloaded'});
      await ready();await scoped();
      assert.equal(await page.locator('html').getAttribute('lang'),lang);
    }
    await page.goto(base+'/en/cinemas/phenomena-experience/',{waitUntil:'domcontentloaded'});
    await ready();await scoped('phenomena');
    assert.deepEqual(errors,[]);
    console.log('Cinema pages passed: shared homepage styling/cards, scoped filters/reset/dialogs, booking links, history, cache isolation, disclosures, EN/ES/CA, no-JavaScript content and responsive layouts.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
