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
    for(const asset of ['cinemas.js','listing-view.js','film-view.js','film-page.js','cinema-copy.js'])
      await context.route(base+'/'+asset,route=>route.fulfill({path:require('node:path').resolve(__dirname,'../static',asset)}));
    await context.route(base+'/cinemas.css',route=>route.fulfill({path:require('node:path').resolve(__dirname,'../static/cinemas.css')}));
    const page = await context.newPage(), errors = [];
    await page.clock.setFixedTime(new Date());
    page.on('pageerror', error => {errors.push(error.message);console.error('Page error:',error.message);});
    const input = await context.newCDPSession(page);
    const dialog = page.locator('#filmDialog');
    const handle = dialog.locator('.dialog-drag-handle');
    const pause = () => new Promise(resolve => setTimeout(resolve, 25));
    // Real browser touch input exercises scroll arbitration and native cancellation.
    async function swipe(target, dx, dy, {cancel=false, returnToStart=false,inspectDismissal=false}={}) {
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
      const releaseTop=inspectDismissal?await dialog.evaluate(node=>node.getBoundingClientRect().top):null;
      await input.send('Input.dispatchTouchEvent', {type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
      if(inspectDismissal)return dialog.evaluate((node,releaseTop)=>{
        const animations=node.getAnimations({subtree:true}).filter(animation=>animation.effect?.target===node);
        for(const animation of animations){animation.pause();animation.currentTime=0;}
        const firstExitTop=node.getBoundingClientRect().top;
        for(const animation of animations)animation.finish();
        return {releaseTop,firstExitTop};
      },releaseTop);
    }
    console.log('Loading public listing',base);
    await page.goto(base+'/en/', {waitUntil:'domcontentloaded'});
    console.log('Listing HTML loaded.');
    await page.waitForSelector('#grid[data-enhanced] .title-button',{state:'attached',timeout:30000});
    console.log('Public listing loaded.');
    const touchPoster=page.locator('.poster-button').first();
    await touchPoster.scrollIntoViewIfNeeded();
    const posterBox=await touchPoster.boundingBox();
    await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:posterBox.x+posterBox.width/2,y:posterBox.y+posterBox.height/2,id:0}]});
    assert.equal(await touchPoster.locator('img').first().evaluate(node=>getComputedStyle(node).transform),'none','Touch feedback never enlarges artwork');
    assert.equal(await touchPoster.evaluate(node=>getComputedStyle(node).opacity),'0.94','A press gently dims the poster');
    assert.equal(await touchPoster.evaluate(node=>getComputedStyle(node).webkitTapHighlightColor),'rgba(0, 0, 0, 0)','Native tap feedback cannot flash over the poster');
    await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForSelector('#filmDialog[open][data-view=film]');
    assert.equal(await dialog.locator('.dialog-close').evaluate(node=>getComputedStyle(node).webkitTapHighlightColor),'rgba(0, 0, 0, 0)','The close button cannot flash a coloured tap overlay');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    assert.equal(await touchPoster.locator('img').first().evaluate(node=>getComputedStyle(node).transform),'none','Touch hover cannot leave a zoom behind');
    await swipe(touchPoster,0,-100);
    assert.equal(await touchPoster.evaluate(node=>node.classList.contains('is-pressed')),false,'Scrolling cancels poster feedback');
    assert.equal(await dialog.evaluate(node=>node.open),false,'Scrolling a poster does not open it');
    await page.keyboard.press('Tab');
    await touchPoster.focus();
    assert.equal(await touchPoster.evaluate(node=>node.matches(':focus-visible')&&getComputedStyle(node).outlineStyle!=='none'),true,'Keyboard focus remains visible');
    const cinemaMore=page.locator('.card:has(.card-cinema-more)').first().locator('.card-cinema-more').last();
    const revealedId=await cinemaMore.getAttribute('data-reveal-session');
    const cinemaPath=await cinemaMore.locator('xpath=ancestor::div[@class="card-cinema"]').locator('.card-cinema-name').getAttribute('href');
    const cinemaDate=await cinemaMore.locator('xpath=ancestor::section[contains(@class,"card-day")]').getAttribute('data-date');
    assert.ok((await cinemaMore.boundingBox()).height>=44);
    await cinemaMore.scrollIntoViewIfNeeded();
    await cinemaMore.focus();
    const cinemaMoreScroll=await page.evaluate(()=>scrollY);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#filmDialog[open][data-view=showtimes]');
    const revealed=dialog.locator('.card-showtime:focus');
    assert.equal(await revealed.getAttribute('data-session'),revealedId);
    assert.equal(await revealed.locator('xpath=ancestor::section[contains(@class,"dialog-day")]').getAttribute('data-date'),cinemaDate);
    assert.equal(await revealed.locator('xpath=ancestor::div[@class="schedule-cinema"]').locator('.schedule-cinema-name').getAttribute('href'),cinemaPath);
    const revealedBox=await revealed.boundingBox(),headerBox=await dialog.locator('.dialog-head').boundingBox(),dialogBox=await dialog.boundingBox();
    assert.ok(revealedBox.y>=headerBox.y+headerBox.height,'Extra time is visible below the sticky header');
    assert.ok(revealedBox.y+revealedBox.height<=dialogBox.y+dialogBox.height,'Extra time is within the sheet viewport');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#filmDialog[open][data-view=screening]');
    assert.equal(await dialog.locator('.buyrow').getAttribute('data-session'),revealedId);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    assert.equal(await cinemaMore.evaluate(node=>node===document.activeElement),true);
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-cinemaMoreScroll)<3);
    console.log('Per-cinema extra counts reveal the correct day and cinema, with keyboard booking and focus restoration.');
    // Pin a long schedule: the first live card can change as screenings expire,
    // and a short schedule cannot exercise a 400px native-scroll gesture.
    const longFilm=await page.locator('.card:has(.card-more)').evaluateAll(cards=>cards
      .sort((a,b)=>Number(b.querySelector('.card-more').textContent.match(/\d+/)?.[0]||0)-Number(a.querySelector('.card-more').textContent.match(/\d+/)?.[0]||0))[0].dataset.film);
    const card = page.locator(`.card[data-film="${longFilm}"]`);
    const opener = card.locator('.title-button');
    const filmPath = await opener.getAttribute('href');
    const more=card.locator('.card-more');
    await more.scrollIntoViewIfNeeded();
    const listingScroll=await page.evaluate(()=>scrollY);
    await more.click();
    await page.waitForSelector('#filmDialog[open][data-view=showtimes]');
    assert.equal(page.url(),base+filmPath+'#showtimes');
    assert.equal(await page.locator('.card-date-picker,[data-card-date]').count(),0);
    assert.equal(await dialog.locator('.film-ratings,.buyrow-ticket').count(),0,'The schedule contains no film ratings or repeated ticket buttons');
    assert.ok(await dialog.locator('.dialog-day').count()>1);
    const screening=dialog.locator('.dialog-day').nth(1).locator('.card-showtime').first();
    const sessionId=await screening.getAttribute('data-session');
    const screeningPath=await screening.getAttribute('href');
    await screening.scrollIntoViewIfNeeded();
    await screening.focus();
    const scheduleScroll=await dialog.evaluate(node=>node.querySelector('.dialog-surface').scrollTop);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#filmDialog[open][data-view=screening]');
    assert.equal(await dialog.locator('.buyrow').count(),1);
    assert.equal(await dialog.locator('.buyrow').getAttribute('data-session'),sessionId);
    assert.equal(await dialog.locator('.film-ratings').count(),0);
    await page.keyboard.press('Tab');
    assert.equal(await dialog.locator('.buyrow-ticket').evaluate(node=>node===document.activeElement),true);
    await dialog.locator('[data-show-film-times]').click();
    await page.waitForSelector('#filmDialog[data-view=showtimes]');
    assert.ok(Math.abs(await dialog.evaluate(node=>node.querySelector('.dialog-surface').scrollTop)-scheduleScroll)<3,'Returning to the schedule preserves its scroll');
    const historyLength=await page.evaluate(()=>history.length);
    assert.equal(await dialog.locator('.dialog-film-link').getAttribute('href'),filmPath);
    await dialog.locator('.dialog-film-link').focus();
    const detailsScroll=await dialog.evaluate(node=>node.querySelector('.dialog-surface').scrollTop);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#filmDialog[open][data-view=film]');
    assert.equal(page.url(),base+filmPath);
    assert.equal(await page.locator('dialog[open]').count(),1);
    assert.equal(await page.evaluate(()=>history.length),historyLength,'Title switches view within the current modal history entry');
    await dialog.locator('[data-show-film-times]').click();
    await page.waitForSelector('#filmDialog[open][data-view=showtimes]');
    assert.ok(Math.abs(await dialog.evaluate(node=>node.querySelector('.dialog-surface').scrollTop)-detailsScroll)<3,'Film details preserve the schedule position');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    assert.equal(page.url(),base+'/en/');
    assert.equal(await more.evaluate(node=>node===document.activeElement),true);
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-listingScroll)<3,'Dismissal preserves listing scroll');
    await more.click();
    await page.waitForSelector('#filmDialog[open][data-view=showtimes]');
    await page.goBack();
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    await page.goForward();
    await page.waitForSelector('#filmDialog[open][data-view=showtimes]');
    await page.keyboard.press('Escape');
    await page.waitForURL(base+'/en/');
    console.log('Focused schedules, single-screening sheets, keyboard focus and listing position passed.');
    const openListing = async () => {
      await opener.click();
      await page.waitForSelector('#filmDialog[open]');
      await dialog.evaluate(node => {node.querySelector('.dialog-surface').scrollTop=0;});
    };
    const stillOpen = async () => {
      assert.equal(await dialog.evaluate(node => node.open),true);
      assert.equal(await dialog.evaluate(node => node.style.getPropertyValue('--sheet-offset')),'');
    };

    await openListing();
    assert.equal(await dialog.getAttribute('data-view'),'film');
    assert.equal(await dialog.locator('.buyrow').count(),0);
    await swipe(handle,0,20);await stillOpen();
    await swipe(handle,0,150,{cancel:true});await stillOpen();
    await swipe(handle,0,150,{returnToStart:true});await stillOpen();
    await swipe(handle,100,10);await stillOpen();
    console.log('Short pulls, canceled pulls, returning to the start and horizontal swipes passed.');

    // A short landscape viewport still allows normal scrolling within a sheet.
    await page.setViewportSize({width:393,height:320});
    const box = await dialog.boundingBox();
    const contentPoint = {x:box.x+12,y:box.y+Math.min(400,box.height-90),width:1,height:1};
    await swipe(contentPoint,0,-160);
    await page.waitForFunction(() => document.querySelector('#filmDialog .dialog-surface').scrollTop>30);
    assert.equal(await dialog.evaluate(node => node.open),true,'Swiping up scrolls the content');
    await dialog.evaluate(node => {node.querySelector('.dialog-surface').scrollTop=240;});
    await swipe(contentPoint,0,100);
    assert.equal(await dialog.evaluate(node => node.open),true,'Swiping down in the content must not dismiss');

    await dialog.evaluate(node => {node.querySelector('.dialog-surface').scrollTop=240;});
    await swipe(handle,0,150);
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    await page.waitForURL(base+'/en/');
    assert.equal(await opener.evaluate(node => node===document.activeElement),true,'Dismissal restores focus to the film');

    await page.setViewportSize({width:393,height:852});
    await openListing();
    await swipe(dialog.locator('.dialog-title'),0,150);
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    await page.waitForURL(base+'/en/');

    await openListing();
    await dialog.locator('[data-show-film-times]').click();
    await page.waitForSelector('#filmDialog[open][data-view=showtimes]');
    assert.equal(page.url(),base+filmPath+'#showtimes');
    await page.keyboard.press('Escape');
    await page.waitForURL(base+'/en/');

    let showtimesListingScroll;
    const openShowtimes=async()=>{
      await more.scrollIntoViewIfNeeded();
      showtimesListingScroll=await page.evaluate(()=>scrollY);
      await more.click();
      await page.waitForSelector('#filmDialog[open][data-view=showtimes]');
      await dialog.evaluate(node=>{node.querySelector('.dialog-surface').scrollTop=0;});
    };
    const schedulePoint=async()=>{
      const surface=await dialog.boundingBox(),header=await dialog.locator('.dialog-head').boundingBox();
      return {x:surface.x+12,y:header.y+header.height+100,width:1,height:1};
    };
    await openShowtimes();
    await swipe(await schedulePoint(),0,20);await stillOpen();
    await swipe(await schedulePoint(),0,150,{cancel:true});await stillOpen();
    await swipe(await schedulePoint(),0,150,{returnToStart:true});await stillOpen();
    await swipe(await schedulePoint(),100,10);await stillOpen();
    assert.equal(await dialog.evaluate(node=>node.querySelector('.dialog-surface').scrollTop),0,'Returning a pull does not jump the schedule');
    assert.equal(await dialog.locator('.dialog-surface').evaluate(node=>getComputedStyle(node).overscrollBehaviorY),'none','Mobile content does not rubber-band');
    await swipe(await schedulePoint(),0,160);
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    await page.waitForURL(base+'/en/');
    assert.equal(await more.evaluate(node=>node===document.activeElement),true,'Content pull restores the showtimes opener');

    await openShowtimes();
    const touchTime=dialog.locator('.card-showtime').first();
    await swipe(touchTime,0,160);
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    await page.waitForURL(base+'/en/');
    await openShowtimes();
    await dialog.locator('.card-showtime').first().tap();
    await page.waitForSelector('#filmDialog[open][data-view=screening]');
    await page.keyboard.press('Escape');
    await page.waitForURL(base+'/en/');

    await openShowtimes();
    await dialog.evaluate(node=>{node.querySelector('.dialog-surface').scrollTop=400;});
    await swipe(await schedulePoint(),0,100);
    await stillOpen();
    assert.ok(await dialog.evaluate(node=>node.querySelector('.dialog-surface').scrollTop>1),'Scrolling within the schedule stays native');
    await page.keyboard.press('Escape');
    await page.waitForURL(base+'/en/');
    await openShowtimes();
    await dialog.evaluate(node=>{node.querySelector('.dialog-surface').scrollTop=120;});
    // Include the browser's touch slop, but no extra pull large enough to dismiss.
    await swipe(await schedulePoint(),0,140);
    await page.waitForFunction(()=>document.querySelector('#filmDialog .dialog-surface').scrollTop<=1);
    await stillOpen();
    await dialog.evaluate(node=>{node.querySelector('.dialog-surface').scrollTop=80;});
    await swipe(await schedulePoint(),0,340);
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    await page.waitForURL(base+'/en/');
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-showtimesListingScroll)<3,'Scroll-to-dismiss preserves the listing position');
    console.log('Showtimes content pulls, scroll-to-dismiss handoff, cancellation and link taps passed.');

    await page.goto(base+screeningPath,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#filmDialog[open]');
    assert.equal(await dialog.locator('.buyrow').count(),1,'Shared screening links open just that session');
    await swipe(handle,0,150);
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    await page.waitForURL(base+filmPath);

    await page.setViewportSize({width:1280,height:900});
    await page.goto(base+screeningPath,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#filmDialog[open]');
    assert.equal(await handle.isVisible(),false);
    await swipe(dialog.locator('.dialog-title'),0,150);
    await stillOpen();
    await dialog.locator('.dialog-close').click();
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    await page.goto(base+filmPath+'#showtimes',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#filmPage #showtimes .card-showtime[aria-haspopup=dialog]');
    assert.equal(await page.locator('#filmDialog[open]').count(),0,'Standalone schedules use the content already on the page');
    const pageShowtime=page.locator('#filmPage .card-showtime').first();
    await pageShowtime.scrollIntoViewIfNeeded();
    const pageScroll=await page.evaluate(()=>scrollY);
    await pageShowtime.click();
    await page.waitForSelector('#filmDialog[open][data-view=screening]');
    assert.equal(await dialog.locator('.buyrow').count(),1);
    assert.equal(await dialog.locator('.buyrow').getAttribute('data-session'),await pageShowtime.getAttribute('data-session'));
    await page.keyboard.press('Escape');
    assert.equal(await pageShowtime.evaluate(node=>node===document.activeElement),true,'Closing a page screening restores its time link');
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-pageScroll)<2,'Closing preserves the film page position');
    for(const width of [320,390,600,1280]){
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Film page stays within '+width+'px');
      assert.equal(await page.locator('#filmPage .card-showtime').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().height>=44)),true);
    }
    for(const [language,width] of [['en',320],['es',390],['ca',600],['en',1280]]){
      await page.setViewportSize({width,height:844});
      await page.goto(base+'/'+language+'/',{waitUntil:'domcontentloaded'});
      await page.waitForSelector('#grid[data-enhanced] .card-more',{state:'attached'});
      await page.locator('.card-more').first().click();
      await page.waitForSelector('#filmDialog[open][data-view=showtimes]');
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
        assert.equal(await dialog.evaluate(node=>node.scrollWidth>node.clientWidth),false,language+' '+width+' '+theme+' sheet overflow');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        assert.equal(await dialog.locator('.card-showtime').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().height>=44)),true);
        assert.equal(await dialog.evaluate(node=>{
          const header=node.querySelector('.dialog-head'),date=node.querySelector('.dialog-day-label');
          return parseFloat(getComputedStyle(header,'::before').bottom)>=0&&date.getBoundingClientRect().top>=header.getBoundingClientRect().bottom;
        }),true,'The header fade stays above the first date at rest');
      }
    }
    // Inspect deterministic animation frames, not timing-sensitive sleeps.
    await page.emulateMedia({reducedMotion:'no-preference'});
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});
      await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
      await page.waitForSelector('#grid[data-enhanced] .card-more',{state:'attached'});
      await page.locator('.card:has(.card-more) .title-button').first().click();
      await page.waitForSelector('#filmDialog[open][data-view=film]');
      await dialog.evaluate(node=>{for(const animation of node.getAnimations({subtree:true}))animation.finish();});
      const frames=await dialog.evaluate(node=>{
        const rect=element=>{const {x,y,width,height}=element.getBoundingClientRect();return {x,y,width,height};};
        const measure=()=>({box:rect(node),poster:rect(node.querySelector('.dialog-poster'))});
        const before=measure();
        node.querySelector('[data-show-film-times]').click();
        const animations=node.getAnimations({subtree:true});
        for(const animation of animations){animation.pause();animation.currentTime=0;}
        const first=measure();
        for(const animation of animations)animation.currentTime=140;
        const middle=measure();
        for(const animation of animations)animation.finish();
        return {before,first,middle,count:animations.length};
      });
      assert.ok(frames.count>0,'Motion is enabled');
      for(const axis of ['x','y','width','height'])assert.ok(Math.abs(frames.before.poster[axis]-frames.first.poster[axis])<2,'Poster starts where it was: '+axis);
      assert.ok(frames.middle.poster.width<frames.before.poster.width&&frames.middle.poster.width>(width>600?48:36),'Poster passes through an intermediate size');
      assert.equal(frames.first.box.width,frames.before.box.width);
      if(width>600)assert.equal(frames.middle.box.y,frames.before.box.y,'Desktop top edge stays fixed');
      await page.waitForSelector('.dialog-motion-layer',{state:'detached'});
      assert.equal(await dialog.getAttribute('data-view'),'showtimes');
      await dialog.evaluate(node=>{
        node.querySelector('.dialog-film-link').click();
        node.querySelector('[data-show-film-times]').click();
        node.querySelector('.dialog-film-link').click();
        for(const animation of node.getAnimations({subtree:true}))animation.finish();
      });
      await page.waitForSelector('.dialog-motion-layer',{state:'detached'});
      assert.equal(await dialog.getAttribute('data-view'),'film','Rapid view changes settle on the latest choice');
      assert.equal(await dialog.evaluate(node=>node.getAnimations({subtree:true}).length),0);
      await dialog.evaluate(node=>{node.querySelector('[data-show-film-times]').click();node.querySelector('[data-close]').click();});
      await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
      await page.waitForSelector('.dialog-motion-layer',{state:'detached'});
    }
    await page.setViewportSize({width:390,height:844});
    await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#grid[data-enhanced] .poster-button',{state:'attached'});
    const motionPoster=page.locator('.card:has(.card-more) .poster-button').first();
    await motionPoster.scrollIntoViewIfNeeded();
    await motionPoster.focus();
    const motionScroll=await page.evaluate(()=>scrollY);
    const entrance=await motionPoster.evaluate(node=>{
      node.click();
      const sheet=document.querySelector('#filmDialog');
      const animations=sheet.getAnimations({subtree:true}).filter(animation=>animation.effect?.target===sheet);
      for(const animation of animations){animation.pause();animation.currentTime=0;}
      const first=sheet.getBoundingClientRect().top;
      const backdropStart=Number(getComputedStyle(sheet,'::backdrop').opacity);
      for(const animation of animations)animation.currentTime=140;
      const middle=sheet.getBoundingClientRect().top;
      const backdropMiddle=Number(getComputedStyle(sheet,'::backdrop').opacity);
      const durations=animations.map(animation=>animation.effect.getTiming().duration);
      for(const animation of animations)animation.finish();
      return {first,middle,last:sheet.getBoundingClientRect().top,backdropStart,backdropMiddle,durations,height:innerHeight};
    });
    assert.ok(entrance.durations.includes(280),'The mobile entrance lasts 280ms');
    assert.ok(Math.abs(entrance.first-entrance.height)<2,'The sheet starts below the viewport');
    assert.ok(entrance.first>entrance.middle&&entrance.middle>entrance.last,'The sheet slides smoothly into place');
    assert.equal(entrance.backdropStart,0);
    assert.ok(entrance.backdropMiddle>0&&entrance.backdropMiddle<1,'The backdrop fades with the sheet');
    const exit=await dialog.evaluate(node=>{
      const first=node.getBoundingClientRect().top;
      node.querySelector('[data-close]').click();
      const animations=node.getAnimations({subtree:true}).filter(animation=>animation.effect?.target===node);
      for(const animation of animations){animation.pause();animation.currentTime=100;}
      const middle=node.getBoundingClientRect().top;
      const locked=node.open&&getComputedStyle(document.body).overflow==='hidden'&&node.contains(document.activeElement);
      const durations=animations.map(animation=>animation.effect.getTiming().duration);
      for(const animation of animations)animation.finish();
      return {first,middle,locked,durations};
    });
    assert.ok(exit.durations.includes(200),'Dismissal lasts 200ms');
    assert.ok(exit.middle>exit.first,'The sheet slides down before closing');
    assert.ok(exit.locked,'Focus and background scroll stay locked throughout dismissal');
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    assert.equal(await motionPoster.evaluate(node=>node===document.activeElement),true);
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-motionScroll)<2);
    await motionPoster.tap();
    await dialog.evaluate(node=>{for(const animation of node.getAnimations({subtree:true}))animation.finish();});
    const swipeExit=await swipe(handle,0,160,{inspectDismissal:true});
    assert.ok(Math.abs(swipeExit.releaseTop-swipeExit.firstExitTop)<2,'Dismissal continues from the finger release without snapping back');
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    await motionPoster.tap();
    await dialog.evaluate(node=>{
      for(const animation of node.getAnimations({subtree:true}))animation.finish();
      node.querySelector('[data-close]').click();
      node.getBoundingClientRect();
      document.querySelector('.card:has(.card-more) .poster-button').click();
      for(const animation of node.getAnimations({subtree:true}))animation.finish();
    });
    await page.waitForFunction(()=>document.querySelector('#filmDialog').getAnimations({subtree:true}).length===0);
    assert.equal(await dialog.evaluate(node=>node.open&&!node.hasAttribute('data-sheet-closing')),true,'Reopening cancels a pending dismissal');
    await dialog.locator('[data-close]').click();
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForSelector('#filmDialog[open]',{state:'hidden'});
    console.log('Mobile poster press, sheet entry/exit, backdrop fade, scroll/focus restoration, animated swipe and interrupted dismissal passed.');
    await page.locator('.card:has(.card-more) .title-button').first().click();
    await dialog.locator('[data-show-film-times]').click();
    assert.equal(await dialog.evaluate(node=>node.getAnimations({subtree:true}).length),0,'Reduced motion skips transitions');
    assert.equal(await page.locator('.dialog-motion-layer').count(),0);
    assert.deepEqual(errors,[]);
    console.log('Shared title/poster motion, fixed desktop position, rapid changes, closing mid-transition and reduced motion passed.');
    console.log('Film sheet: touch dismissal, snap-back, cancellation, normal scrolling, focus, URLs, standalone pages and desktop behavior passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error);process.exitCode=1;});
