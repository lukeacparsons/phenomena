const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8791';
const publication=process.env.VOBARNA_PUBLICATION_ROOT||'.site';
const isPoster=url=>url.includes('/preview-data/images/')&&url.endsWith('.webp');

(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const report={};
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:2});
    // Keep these checks independent of external font services.
    await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:'',contentType:'text/css'}));
    const page=await context.newPage(),requested=new Set(),errors=[];
    page.on('request',request=>{if(isPoster(request.url()))requested.add(request.url());});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelectorAll('#grid .poster').length>24);
    await page.waitForFunction(()=>document.querySelector('#grid .poster')?.dataset.imageWidth>=480);
    const rendered=await page.locator('#grid .poster').count();
    const total=JSON.parse(fs.readFileSync(publication+'/current/public/programme.json')).films.filter(f=>f.poster_url).length;
    assert.ok(requested.size<=12,`Only nearby posters should load, got ${requested.size}/${total}`);
    assert.match(await page.locator('#grid .poster').last().getAttribute('src'),/^data:/);
    const initial=await page.evaluate(()=>({
      images:[...document.querySelectorAll('#grid img[data-image-width]')].map(image=>({source:image.dataset.imageSource,url:new URL(image.src).pathname})),
      downloads:performance.getEntriesByType('resource').filter(r=>r.name.includes('/preview-data/images/')&&r.name.endsWith('.webp')).map(r=>({url:r.name,bytes:r.decodedBodySize})),
      originals:performance.getEntriesByType('resource').filter(r=>r.name.includes('/preview-data/posters/')).length
    }));
    assert.equal(initial.originals,0,'Original posters must not download in the grid');
    report.initial={requested:requested.size,totalPosters:total,renderedPosters:rendered,posterBytes:initial.downloads.reduce((n,r)=>n+r.bytes,0),
      originalBytesForVisible:initial.images.reduce((n,image)=>n+fs.statSync('static'+image.source).size,0),
      optimizedBytesForVisible:initial.images.reduce((n,image)=>n+fs.statSync('static'+image.url).size,0)};
    fs.mkdirSync('output/images',{recursive:true});
    await page.screenshot({path:'output/images/desktop.png'});
    const before=requested.size;
    await page.locator('#grid .poster').nth(20).scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>document.querySelectorAll('#grid .poster')[20]?.dataset.imageWidth>0);
    assert.ok(requested.size>before,'Scrolling must request the newly visible artwork');
    assert.ok(requested.size<total/3,'Scrolling must not start the entire catalogue');
    report.afterScroll=requested.size;
    await page.locator('.title-button').nth(20).click();
    await page.waitForFunction(()=>document.querySelector('dialog[open] .dialog-poster')?.dataset.imageWidth>0);
    await page.keyboard.press('Escape');
    await page.locator('#search').fill('Dune');
    await page.waitForFunction(()=>document.querySelectorAll('#grid .poster').length<24&&document.querySelector('#grid .poster')?.dataset.imageWidth>0);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'output/images/mobile.png'});
    assert.deepEqual(errors,[]);

    // A deterministic page tests the scheduler while real requests are held back.
    const film=JSON.parse(fs.readFileSync(publication+'/current/public/programme.json')).films.find(f=>f.poster_image?.width>=640&&f.poster_image.height*32%f.poster_image.width!==0);
    const fixture=`<!doctype html><style>body{margin:0}img{display:block;width:260px;height:auto}section{height:900px}</style><main></main><script type="module">
      import {posterMarkup,observeImages} from '/progressive-images.js';
      const film=${JSON.stringify(film).replaceAll('<','\\u003c')};
      document.querySelector('main').innerHTML=Array.from({length:8},()=>'<section>'+posterMarkup(film)+'</section>').join('');observeImages();
    </script>`;
    const slow=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
    await slow.addInitScript(()=>{
      const connection=new EventTarget();connection.saveData=true;connection.effectiveType='2g';
      Object.defineProperty(navigator,'connection',{value:connection,configurable:true});
    });
    await slow.route('**/image-fixture',route=>route.fulfill({body:fixture,contentType:'text/html'}));
    const slowPage=await slow.newPage();
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    const slowRequests=[];
    await slowPage.route('**/preview-data/images/*.webp',async route=>{
      slowRequests.push(route.request().url());await gate;await route.continue();
    });
    await slowPage.goto(base+'/image-fixture',{waitUntil:'domcontentloaded'});
    await slowPage.waitForFunction(()=>document.querySelectorAll('.poster').length===8);
    await slowPage.waitForTimeout(200);
    assert.equal(slowRequests.length,1,'Save-data should run one request for the visible image');
    const previewBox=await slowPage.locator('img').first().boundingBox();
    assert.match(await slowPage.locator('img').first().getAttribute('src'),/^data:image\/webp/);
    release();
    await slowPage.waitForFunction(()=>document.querySelector('img').dataset.imageWidth==='160');
    assert.deepEqual(await slowPage.locator('img').first().boundingBox(),previewBox,'Sharpening must not shift layout');
    assert.match(await slowPage.locator('img').nth(1).getAttribute('src'),/^data:/);
    await slowPage.evaluate(()=>{navigator.connection.saveData=false;navigator.connection.effectiveType='4g';navigator.connection.dispatchEvent(new Event('change'));});
    await slowPage.waitForFunction(()=>Number(document.querySelector('img').dataset.imageWidth)>=640);
    report.connectionUpgrade='160 → 640 pixels';

    const failed=await browser.newContext({viewport:{width:390,height:844}});
    await failed.route('**/image-fixture',route=>route.fulfill({body:fixture,contentType:'text/html'}));
    await failed.route('**/preview-data/images/*.webp',route=>route.abort());
    const failedPage=await failed.newPage();
    await failedPage.goto(base+'/image-fixture',{waitUntil:'networkidle'});
    assert.match(await failedPage.locator('img').first().getAttribute('src'),/^data:image\/webp/);
    assert.equal(await failedPage.locator('img').first().isVisible(),true);
    await failed.unroute('**/preview-data/images/*.webp');
    await failedPage.evaluate(()=>dispatchEvent(new Event('online')));
    await failedPage.waitForFunction(()=>document.querySelector('img').dataset.imageWidth>0);
    report.failureRecovery=true;

    const noJS=await browser.newContext({javaScriptEnabled:false,viewport:{width:1280,height:900}});
    await noJS.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:'',contentType:'text/css'}));
    const plain=await noJS.newPage();
    await plain.goto(base+'/en/',{waitUntil:'load'});
    assert.ok(await plain.locator('noscript img').first().isVisible());
    assert.match(await plain.locator('noscript img').first().getAttribute('src'),/\/preview-data\/images\//);
    const filmLink=await plain.locator('.card h2 a').first().getAttribute('href');
    await plain.goto(base+filmLink,{waitUntil:'load'});
    assert.equal((await plain.locator('noscript img').first().boundingBox()).width,200);
    report.noJavaScript=true;
    fs.writeFileSync('output/images/verification.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
