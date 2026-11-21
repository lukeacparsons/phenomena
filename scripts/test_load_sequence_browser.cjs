// What a first view may fetch, and when. Run against the local public preview.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8789';
const decoration=url=>/cinema-curtain-toggle\/(?:frames\/|cloth\.js|capture\.js|vendor\/)/.test(url);
const trial='**/trial-token.js';

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:'chrome'})});
  const open=async({connection='4g',setup=async()=>{}}={})=>{
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,colorScheme:'light'});
    context.setDefaultTimeout(30000);
    await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:'',contentType:'text/css'}));
    await context.route(trial,route=>route.fulfill({body:'',contentType:'text/javascript'}));
    await context.addInitScript(effectiveType=>{
      Object.defineProperty(navigator,'connection',{value:Object.assign(new EventTarget(),{effectiveType,saveData:false}),configurable:true});
    },connection);
    const page=await context.newPage(),requests=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>requests.push(request.url()));
    await setup(page);
    return {context,page,requests,errors};
  };
  try{
    // The first poster comes from HTML at its final size; decoration waits for the catalogue.
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    let view=await open({setup:page=>page.route('**/programme.json',async route=>{await gate;await route.continue();})});
    await view.page.goto(base+'/en/',{waitUntil:'load'});
    const first=view.page.locator('#grid img').first();
    assert.ok(await first.getAttribute('srcset'),'The first poster must be selectable before scripts run');
    assert.equal(await first.getAttribute('fetchpriority'),'high');
    const poster=await first.evaluate(async image=>{
      if(!image.complete)await new Promise(resolve=>image.addEventListener('load',resolve,{once:true}));
      // naturalWidth is density-corrected for a srcset choice; the variant name is not.
      const url=new URL(image.currentSrc).pathname;
      const box=image.getBoundingClientRect().width;
      const target=Math.ceil(box*Math.min(devicePixelRatio,2));
      const variants=JSON.parse(image.dataset.imageVariants);
      const expected=(variants.find(variant=>variant.width>=target)||variants.at(-1)).width;
      return {url,width:Number(url.match(/-(\d+)\.webp$/)[1]),box,expected};
    });
    // The loader caps the device pixel ratio at 2; the HTML choice must agree.
    assert.equal(poster.width,poster.expected,`First poster chose ${JSON.stringify(poster)}`);
    await view.page.waitForFunction(expected=>Number(document.querySelector('#grid img').dataset.imageWidth)>=expected,poster.expected);
    assert.equal(view.requests.filter(url=>url.endsWith(poster.url)).length,1,'The first poster must download once');
    assert.equal(view.requests.some(url=>/-160\.webp$/.test(url)&&url.includes(poster.url.replace(/-\d+\.webp$/,''))),false,'No thumbnail may precede the first poster');
    await view.page.waitForTimeout(1500);
    assert.deepEqual(view.requests.filter(decoration).map(url=>url.split('/').pop()),['frame-16.png'],'Only the resting switch may load before the catalogue');
    assert.equal(await view.page.locator('.theme-toggle').evaluate(element=>element.localName),'button');
    release();
    await view.page.waitForSelector('#grid[data-enhanced] .title-button');
    await view.page.waitForSelector('cinema-theme-toggle');
    await view.page.waitForFunction(()=>performance.getEntriesByType('resource').some(entry=>entry.name.endsWith('/cinema-curtain-toggle/cloth.js')));
    assert.deepEqual(view.errors,[]);
    await view.context.close();
    console.log('First poster from HTML and deferred decoration passed');

    // A catalogue that keeps arriving is never abandoned, however slow.
    view=await open({setup:page=>page.route('**/programme.json',async route=>{await new Promise(resolve=>setTimeout(resolve,9500));await route.continue();})});
    await view.page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
    await view.page.waitForSelector('#grid[data-enhanced] .title-button');
    await view.page.locator('#search').fill('Dune');await view.page.locator('#search').press('Enter');
    await view.page.waitForFunction(()=>location.search==='?q=Dune');
    assert.deepEqual(view.errors,[]);
    await view.context.close();
    console.log('Slow catalogue passed');

    // The third-party origin-trial script cannot hold up the document.
    // A page route takes precedence over the context's immediate reply.
    view=await open({setup:page=>page.route(trial,async route=>{await new Promise(resolve=>setTimeout(resolve,5000));await route.fulfill({body:'',contentType:'text/javascript'});})});
    const started=Date.now();
    await view.page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
    await view.page.waitForSelector('#grid[data-enhanced] .title-button');
    assert.ok(Date.now()-started<4500,'Search must be ready while the trial script is outstanding');
    assert.equal(await view.page.locator('script[data-webmcp-trial]').getAttribute('data-webmcp-trial'),'');
    await view.page.waitForFunction(()=>document.querySelector('script[data-webmcp-trial]').dataset.webmcpTrial==='loaded');
    assert.deepEqual(view.errors,[]);
    await view.context.close();
    console.log('Non-blocking trial script passed');

    // A constrained connection fetches the animation only when the switch is used.
    view=await open({connection:'3g'});
    await view.page.goto(base+'/en/',{waitUntil:'load'});
    await view.page.waitForSelector('#grid[data-enhanced] .title-button');
    await view.page.waitForTimeout(2500);
    assert.deepEqual(view.requests.filter(decoration).map(url=>url.split('/').pop()),['frame-16.png']);
    const box=await view.page.locator('.theme-toggle').boundingBox();
    await view.page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
    await view.page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    await view.page.waitForSelector('cinema-theme-toggle');
    await view.page.waitForFunction(()=>document.querySelector('cinema-theme-toggle').checked===false);
    assert.equal(await view.page.evaluate(()=>localStorage.getItem('vobarna-theme')),'dark');
    assert.deepEqual(view.errors,[]);
    await view.context.close();
    console.log('On-demand animation passed');

    // HTML and CSS place the subtitle; scripts move nothing in the header.
    const frame=page=>page.evaluate(()=>{
      const box=element=>{const {x,y,width,height}=element.getBoundingClientRect();return [x,y,width,height].map(Math.round);};
      const shown=[...document.querySelectorAll('.logo-subtitle')].filter(element=>element.getClientRects().length);
      return {header:box(document.querySelector('.header-wrap header')),subtitles:shown.map(element=>[element.parentElement.className,...box(element)]),dates:box(document.querySelector('#dates')).slice(0,2)};
    });
    view=await open({setup:page=>page.route('**/*.js',route=>route.abort())});
    await view.page.goto(base+'/en/',{waitUntil:'load'});
    const unscripted=await frame(view.page);
    assert.deepEqual(unscripted.subtitles.map(([parent])=>parent),['filters'],'A small screen shows the subtitle once, above the dates');
    await view.context.close();
    view=await open();
    await view.page.goto(base+'/en/',{waitUntil:'load'});
    await view.page.waitForSelector('.lang-switch.has-language-menu');
    await view.page.waitForSelector('#grid[data-enhanced] .title-button');
    assert.deepEqual(await frame(view.page),unscripted,'Scripts must not move the header or its subtitle');
    await view.page.setViewportSize({width:1280,height:800});
    assert.deepEqual((await frame(view.page)).subtitles.map(([parent])=>parent),['logo-copy'],'A wide screen shows the subtitle once, in the header');
    assert.deepEqual(view.errors,[]);
    await view.context.close();
    console.log('Stable header passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
