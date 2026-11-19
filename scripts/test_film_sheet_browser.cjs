const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || process.argv[2] || 'playwright');
const base = process.env.VOBARNA_PUBLIC_URL || 'http://127.0.0.1:8765';

(async () => {
  const browser = await chromium.launch({headless:true, channel:'chrome'});
  try {
    const context = await browser.newContext({viewport:{width:393,height:852}, isMobile:true, hasTouch:true, reducedMotion:'reduce'});
    context.setDefaultTimeout(15000);
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    // Exercise the working source against a generated public programme snapshot.
    await context.route(base+'/film-dialog.js',route=>route.fulfill({path:require('node:path').resolve(__dirname,'../static/film-dialog.js')}));
    await context.route(base+'/cinemas.css',route=>route.fulfill({path:require('node:path').resolve(__dirname,'../static/cinemas.css')}));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => {errors.push(error.message);console.error('Page error:',error.message);});
    const input = await context.newCDPSession(page);
    const dialog = page.locator('#filmDialog');
    const handle = dialog.locator('.dialog-drag-handle');
    const pause = () => new Promise(resolve => setTimeout(resolve, 25));
    // Real browser touch input exercises scroll arbitration and native cancellation.
    async function swipe(target, dx, dy, {cancel=false, returnToStart=false}={}) {
      const box = typeof target.boundingBox === 'function' ? await target.boundingBox() : target;
      const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 2, 24);
      const point = (x,y) => [{x,y,id:0,radiusX:1,radiusY:1,force:1}];
      await input.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:point(x,y)});
      for(let step=1;step<=8;step++) {
        await pause();
        await input.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:point(x+dx*step/8,y+dy*step/8)});
      }
      if(returnToStart) {
        await pause();
        await input.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:point(x,y)});
      }
      await input.send('Input.dispatchTouchEvent', {type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
    }
    console.log('Loading public listing',base);
    await page.goto(base+'/en/', {waitUntil:'domcontentloaded'});
    console.log('Listing HTML loaded.');
    await page.waitForSelector('#grid[data-enhanced] .title-button',{state:'attached',timeout:30000});
    console.log('Public listing loaded.');
    const opener = page.locator('.card:has(.card-more) .title-button').first();
    const filmPath = await opener.getAttribute('href');
    const openListing = async () => {
      await opener.click();
      await page.waitForSelector('#filmDialog[open]');
      await dialog.evaluate(node => {node.scrollTop=0;});
    };
    const stillOpen = async () => {
      assert.equal(await dialog.evaluate(node => node.open),true);
      assert.equal(await dialog.evaluate(node => node.style.getPropertyValue('--sheet-offset')),'');
    };

    await openListing();
    await swipe(handle,0,20);await stillOpen();
    await swipe(handle,0,150,{cancel:true});await stillOpen();
    await swipe(handle,0,150,{returnToStart:true});await stillOpen();
    await swipe(handle,100,10);await stillOpen();
    console.log('Short pulls, canceled pulls, returning to the start and horizontal swipes passed.');

    const box = await dialog.boundingBox();
    const contentPoint = {x:box.x+12,y:box.y+Math.min(400,box.height-90),width:1,height:1};
    await swipe(contentPoint,0,-160);
    await page.waitForFunction(() => document.getElementById('filmDialog').scrollTop>30);
    assert.equal(await dialog.evaluate(node => node.open),true,'Swiping up scrolls the content');
    await dialog.evaluate(node => {node.scrollTop=240;});
    await swipe(contentPoint,0,100);
    assert.equal(await dialog.evaluate(node => node.open),true,'Swiping down in the content must not dismiss');

    await dialog.evaluate(node => {node.scrollTop=240;});
    await swipe(handle,0,150);
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    await page.waitForURL(base+'/en/');
    assert.equal(await opener.evaluate(node => node===document.activeElement),true,'Dismissal restores focus to the film');

    await openListing();
    await swipe(dialog.locator('.dialog-title'),0,150);
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    await page.waitForURL(base+'/en/');

    await page.goto(base+filmPath+'#showtimes',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#filmDialog[open]');
    await swipe(handle,0,150);
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    await page.waitForURL(base+filmPath);

    await page.setViewportSize({width:1280,height:900});
    await page.goto(base+filmPath+'#showtimes',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#filmDialog[open]');
    assert.equal(await handle.isVisible(),false);
    await swipe(dialog.locator('.dialog-title'),0,150);
    await stillOpen();
    await dialog.locator('.dialog-close').click();
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    assert.deepEqual(errors,[]);
    console.log('Film sheet: touch dismissal, snap-back, cancellation, normal scrolling, focus, URLs, standalone pages and desktop behavior passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error);process.exitCode=1;});
