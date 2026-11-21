const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:18837';
const paths=['/en/guides/english-subtitles-barcelona/','/es/guias/cine-subtitulos-ingles-barcelona/','/ca/guies/cinema-subtitols-angles-barcelona/'];
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const plain=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    const page=await plain.newPage();
    for(const path of paths){
      assert.equal((await page.goto(base+path,{waitUntil:'domcontentloaded'})).status(),200);
      assert.equal(await page.locator('h1').count(),1);
      assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://vobarna.com'+path);
      assert.equal(await page.locator('link[hreflang]').count(),4);
      assert.equal(await page.locator('#subtitles-foreign').count(),1);
      const film=page.locator('.guide-sources>summary').first();
      if(await film.count()){
        await film.click();
        const action=page.locator('.screening-action:visible').first();
        assert.match(await action.getAttribute('href'),/#screening-/);
        assert.match(await action.locator('xpath=ancestor::li').locator('.ticket-link').getAttribute('href'),/^https:\/\//);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,path);
    }
    await plain.close();
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const live=await context.newPage(),errors=[];
    live.on('pageerror',e=>errors.push(e.message));
    await live.goto(base+paths[0],{waitUntil:'networkidle'});
    const action=live.locator('.discovery .card-showtime:visible').first();
    if(await action.count()){
      await live.screenshot({path:'/private/tmp/vobarna-english-subtitles-mobile.png'});
      const expected=await action.getAttribute('data-session');
      await action.click();
      await live.waitForSelector('dialog[open] .buyrow.is-highlighted');
      assert.equal(await live.locator('.buyrow.is-highlighted').getAttribute('data-session'),expected);
    }
    // An open page must expire every row, including events, without losing its empty state.
    await live.clock.setFixedTime(new Date('2199-01-01T12:00:00Z'));
    await live.goto(base+paths[0],{waitUntil:'networkidle'});
    assert.equal(await live.locator('.discovery .card:visible').count(),0);
    assert.equal(await live.locator('.discovery-empty').isVisible(),true);
    assert.equal(await live.locator('#subtitles-foreign .discovery-group-empty').isVisible(),true);
    assert.deepEqual(errors,[]);
    console.log('Subtitle pages: EN/ES/CA, no-JS, mobile layout, exact-session links and automatic expiry passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
