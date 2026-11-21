const assert=require('node:assert/strict');
const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:18793';
const engine=process.env.BROWSER||'chromium';

(async()=>{
  const browser=await engines[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900},permissions:['geolocation'],geolocation:{latitude:41.4,longitude:2.16}});
    await context.addInitScript(()=>{
      window.geoCalls=0;const get=navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition=(...args)=>{window.geoCalls++;return get(...args);};
    });
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const session=(cinema_id,time)=>({id:cinema_id+time,cinema_id,date:'2099-01-01',time,starts_at:'2099-01-01T'+time+':00+01:00',language:'English',formats:[],price_data:{amount:cinema_id==='near'?8:12,currency:'EUR',kind:'general_admission',source_url:'https://cinema.example/tickets',checked_at:'2099-01-01T09:00:00Z'}});
    const programme={generated_at:'2099-01-01T08:00:00Z',cinemas:[
      {id:'far',name:'Far',short:'Far',location:{latitude:41.45,longitude:2.2}},
      {id:'near',name:'Near',short:'Near',location:{latitude:41.4,longitude:2.16}},
      {id:'unknown',name:'Unknown',short:'Unknown'}
    ],films:[
      {id:'far-film',title:'Far Film',details:{genres:['Comedy']},sessions:[session('far','18:00')]},
      {id:'mixed',title:'Mixed Film',details:{genres:['Comedy']},sessions:[session('far','18:00'),session('near','21:00'),session('near','20:00'),session('unknown','17:00')]}
    ]};
    await context.route('**/programme.json',route=>route.fulfill({json:programme}));
    let aiCalls=0,addressCalls=0;
    await context.route('**/api/search',route=>{
      aiCalls++;const {query}=route.request().postDataJSON();
      if(query==='poblesec')return route.fulfill({json:{query,mode:'interpreted',intent:{text:'',conditions:[],semantic_query:'',location_query:'Poble-sec, Barcelona',sort:'soonest',unsupported:[]},semantic_scores:null}});
      return route.fulfill({status:503,json:{error:'unavailable'}});
    });
    await context.route('**/api/geocode',route=>{
      addressCalls++;const {address}=route.request().postDataJSON();
      const places=['Carrer de Girona 175, Barcelona','Poble-sec, Barcelona'].includes(address)?[{latitude:41.4,longitude:2.16,label:address}]:
        [{latitude:41.4,longitude:2.16,label:'Carrer de Balmes 422, Barcelona'},{latitude:41.45,longitude:2.2,label:'Carrer de Balmes 42, Barcelona'}];
      return route.fulfill({json:{places}});
    });
    await context.route('**/api/completions',r=>r.fulfill({json:{query:r.request().postDataJSON().query,suggestions:[]}}));
    await context.route('**/api/search-suggestions',r=>r.fulfill({status:503,json:{error:'fixture'}}));
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2099-01-01T10:00:00Z'));
    await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});await page.waitForSelector('#grid[data-enhanced]');
    const search=async query=>{await page.locator('#search').fill(query);await page.locator('#search').press('Enter');await page.waitForFunction(q=>(new URLSearchParams(location.search).get('q')||'')===q,query);};
    const ready=()=>page.waitForFunction(()=>document.querySelector('#grid .card-distance')&&document.getElementById('locationStatus')?.hidden);
    assert.equal(await page.evaluate(()=>window.geoCalls),0);
    await search('near me');await ready();
    assert.equal(await page.evaluate(()=>window.geoCalls),1);
    assert.deepEqual(await page.locator('#grid .card').evaluateAll(nodes=>nodes.map(n=>n.dataset.film)),['mixed','far-film']);
    assert.deepEqual(await page.locator('[data-film="mixed"] .card-cinema').evaluateAll(nodes=>nodes.map(n=>n.dataset.cinema)),['near','far','unknown']);
    assert.deepEqual(await page.locator('[data-film="mixed"] [data-cinema="near"] time').allTextContents(),['20:00','21:00']);
    assert.match(await page.locator('[data-film="mixed"] .card-distance').first().textContent(),/m/);
    assert.equal(addressCalls,0);assert.equal(aiCalls,0);
    assert.equal(new URL(page.url()).searchParams.get('q'),'near me');
    assert(!page.url().includes('41.4'));
    await page.locator('[data-remove-filter="intent"][data-value="location"]').click();
    assert.equal(await page.locator('.card-distance').count(),0);assert.equal(await page.locator('#locationStatus').isVisible(),false);
    await search('Carrer de Girona 175, Barcelona');await ready();assert.equal(addressCalls,1);
    assert.equal(await page.evaluate(()=>window.geoCalls),1,'addresses do not ask for device location');
    assert.match(await page.locator('#filterChips').textContent(),/Girona 175/);
    for(const query of ['near Carrer de Girona 175, Barcelona less than 10 euros','cerca de Carrer de Girona 175, Barcelona menos de 10 euros','a prop de Carrer de Girona 175, Barcelona menys de 10 euros']){
      await search(query);await ready();
      assert.deepEqual(await page.locator('#grid .card').evaluateAll(nodes=>nodes.map(n=>n.dataset.film)),['mixed']);
      assert.deepEqual(await page.locator('[data-film="mixed"] .card-cinema').evaluateAll(nodes=>nodes.map(n=>n.dataset.cinema)),['near']);
      assert.match(await page.locator('#filterChips').textContent(),/Admission < 10 EUR/);
      assert.equal(addressCalls,1,'the same address is cached; the budget never reaches geocoding');
    }
    await search('comedy near this address: Carrer de Balmes, Barcelona');
    await page.waitForSelector('[data-location-choice="1"]');assert.equal(await page.locator('#grid .card').count(),0);
    assert.equal(await page.locator('#grid .empty, #searchFeedback:visible').count() > 0,false,'unresolved location is not a no-matches result');
    await page.locator('[data-location-choice="1"]').click();await ready();
    assert.equal(await page.locator('[data-film="mixed"] .card-cinema').first().getAttribute('data-cinema'),'far');
    assert.equal(aiCalls,0,'location text does not trigger AI');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('[data-film="mixed"] .card-body').scrollIntoViewIfNeeded();
    await page.screenshot({path:'/private/tmp/vobarna-location-mobile.png',fullPage:false});
    // Revoke the browser permission, rather than replacing the geolocation API.
    await context.clearPermissions();
    await page.clock.setFixedTime(new Date('2099-01-01T10:10:00Z'));
    await search('near me');
    if(engine==='webkit')await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('locationStatus')?.textContent.includes('Location access is blocked'));
    assert.equal(await page.locator('[data-location-retry]').count(),1);assert.equal(await page.locator('#grid .card').count(),0);
    assert.equal(await page.locator('#grid .empty, #searchFeedback:visible').count() > 0,false);
    await context.grantPermissions(['geolocation']);
    await Promise.all([page.waitForEvent('load'),page.locator('[data-location-retry]').click()]);await ready();
    assert.equal(new URL(page.url()).searchParams.get('q'),'near me','permission recovery preserves the search');
    await search('Carrer de Girona 175, Barcelona');await ready();assert.equal(addressCalls,3,'address cache starts fresh after the permission reload');
    await search('');assert.equal(await page.locator('.card-distance').count(),0);
    const permissionCalls=await page.evaluate(()=>window.geoCalls);
    await search('poblesec');await ready();
    assert.match(await page.locator('[data-value="location"]').textContent(),/Poble-sec, Barcelona/);
    assert.equal(new URL(page.url()).searchParams.get('q'),'poblesec');
    assert.equal(await page.evaluate(()=>window.geoCalls),permissionCalls);
    assert.equal(aiCalls,1);
    assert.deepEqual(await page.locator('#grid .card').evaluateAll(nodes=>nodes.map(n=>n.dataset.film)),['mixed','far-film']);
    const beforePrice=addressCalls;
    await search('less than 10 euros');
    assert.equal(await page.locator('[data-value="location"]').count(),0);
    assert.equal(await page.locator('[data-location-choice]').count(),0);
    assert.equal(await page.locator('.card-distance').count(),0);
    assert.equal(addressCalls,beforePrice,'price requests never reach the geocoder');
    assert.equal(aiCalls,1,'the price filter is applied locally');
    await search('poblesec');await ready();assert.equal(aiCalls,1,'cached location intents re-enter nearby search');
    await page.locator('[data-value="location"]').click();assert.equal(await page.locator('.card-distance').count(),0);
    for(const [path,example,word] of [['/en/guides/how-to-search/','near me','straight-line'],['/es/guias/como-buscar/','cerca de mí','línea recta'],['/ca/guies/com-cercar/','a prop meu','línia recta']]){
      await page.goto(base+path,{waitUntil:'domcontentloaded'});assert((await page.locator('main').textContent()).includes(word));
      const link=page.locator('.search-guide-query').filter({hasText:example}).first();assert.equal(new URL(await link.getAttribute('href'),base).searchParams.get('q'),example);
    }
    assert.deepEqual(errors,[]);
    console.log(`Nearby search (${engine}): geolocation grant/deny/retry, mixed address/budget queries, choices, card ordering, chronological times, privacy, mobile and all three guides passed.`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
