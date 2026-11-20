// Run against the existing local preview with an installed Playwright and Chrome.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_TEST_URL||'http://127.0.0.1:8765/cinemas.html';
const localOrigin=new URL(base).origin;
const makeSession=(id,cinemaId,formats,extra={})=>({id,cinema_id:cinemaId,provider:'mooby',room:'2',date:'2099-01-01',time:'20:00',starts_at:'2099-01-01T20:00:00+01:00',formats,version:'VOSE',big_screen:formats.includes('IMAX'),booking_url:'https://cinema.example/'+id,booking_scope:'session',...extra});
const programme={generated_at:'2098-12-31T12:00:00Z',cinemas:[{id:'balmes',name:'Balmes',short:'Balmes'},{id:'diagonal',name:'Diagonal Mar',short:'Diagonal Mar'}],films:[
  {id:'imdb:dune',title:'Dune',titles:['Dune (VOSE IMAX)'],details:{directors:['Denis Villeneuve'],languages:['English'],genres:['Science fiction']},sessions:[makeSession('imax','diagonal',['IMAX']),makeSession('standard','balmes',[])]},
  {id:'imdb:other',title:'Another film',titles:[],details:{languages:['French']},sessions:[makeSession('other','balmes',[])]}
]};
const availability={sessions:{imax:{kind:'ordinary',available:23,checked_at:new Date().toISOString()}},errors:{},refresh_interval_seconds:900,supported_providers:['mooby']};

async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:'chrome'}),
    args:['--enable-experimental-web-platform-features','--enable-features=WebMCPTesting']});
  try{
    const context=await browser.newContext();
    context.setDefaultTimeout(15000);
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==localOrigin)return route.abort();
      if(url.pathname==='/preview-data/programme.json')return route.fulfill({json:programme});
      if(url.pathname==='/api/preview/availability')return route.fulfill({json:availability});
      return route.continue();
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('.card');
    const native=await page.evaluate(()=>({register:typeof document.modelContext?.registerTool,getTools:typeof document.modelContext?.getTools,execute:typeof document.modelContext?.executeTool,userAgent:navigator.userAgent}));
    assert.equal(native.getTools,'function','Native document.modelContext.getTools is unavailable: '+JSON.stringify(native));
    await page.waitForFunction(async()=> (await document.modelContext.getTools()).filter(tool=>['get_context','search_screenings','get_film','get_screening','set_search','show_screening'].includes(tool.name)).length===6);
    console.log('Native WebMCP registration verified; checking tool workflows.');
    async function call(name,input={}){
      return page.evaluate(async({name,input})=>{
        const tool=(await document.modelContext.getTools()).find(tool=>tool.name===name);
        let result=await document.modelContext.executeTool(tool,input);
        if(typeof result==='string')result=JSON.parse(result);
        return result.structuredContent;
      },{name,input});
    }
    const initialURL=page.url();
    const found=await call('search_screenings',{query:'Villeneuve',formats:['IMAX']});
    assert.equal(found.ok,true);assert.equal(found.total_screenings,1);assert.equal(found.results[0].screening_id,'imax');
    assert.equal(page.url(),initialURL);assert.equal(await page.locator('.card').count(),2);
    const film=await call('get_film',{film_id:found.results[0].film_id});assert.equal(film.title,'Dune');
    const detail=await call('get_screening',{screening_id:'imax'});assert.equal(detail.booking_url,'https://cinema.example/imax');
    assert.equal(detail.price,null);assert.equal(detail.audio_language,null);
    await call('set_search',{query:'Another film',cinema_ids:['balmes']});
    assert.equal(await page.locator('.card').count(),1);assert.equal(await page.locator('#search').inputValue(),'Another film');
    assert.equal(await page.locator('.filter-chip').count(),1);
    const shown=await call('show_screening',{screening_id:'imax'});
    assert.equal(shown.shown,true);assert.equal(await page.locator('#filmDialog').evaluate(el=>el.open),true);
    assert.equal(await page.locator('.buyrow.is-highlighted').getAttribute('data-session'),'imax');
    assert.equal(await page.locator('.buyrow.is-highlighted a').getAttribute('href'),'https://cinema.example/imax');
    const deepURL=page.url();assert.equal(new URL(deepURL).searchParams.get('screening'),'imax');
    const invalid=await call('show_screening',{screening_id:'missing'});assert.equal(invalid.ok,false);assert.equal(page.url(),deepURL);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector('.buyrow.is-highlighted');
    assert.equal(await page.locator('#dialogTitle').textContent(),'Dune');
    assert.equal(await page.locator('.buyrow.is-highlighted').getAttribute('data-session'),'imax');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!new URL(location.href).searchParams.has('screening'));
    assert.equal((await call('get_context')).active_screening_id,null);
    await page.locator('.filter-chip').click();assert.equal(new URL(page.url()).searchParams.has('cinemas'),false);
    await call('set_search',{formats:['IMAX'],cinema_ids:['diagonal'],date_from:'2099-01-01',date_to:'2099-01-01'});
    assert.equal(await page.locator('.filter-chip').count(),3);assert.equal(await page.locator('.card-showtime').count(),1);
    await page.getByRole('button',{name:'ES',exact:true}).click();
    assert.equal(await page.locator('html').getAttribute('lang'),'es');
    assert.equal((await call('get_context')).language,'es');
    await page.setViewportSize({width:390,height:844});
    await call('show_screening',{screening_id:'imax'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'/private/tmp/vobarna-webmcp-mobile.png'});
    await page.keyboard.press('Escape');
    await call('set_search',{});
    await page.setViewportSize({width:1280,height:900});
    await page.screenshot({path:'/private/tmp/vobarna-webmcp-desktop.png'});
    assert.equal(await page.locator('.card').count(),2);
    assert.equal((await call('get_context')).filters.query,'');
    await page.goto(base+'?screening=missing',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#linkNotice:not([hidden])');
    assert.equal(await page.locator('#filmDialog').evaluate(el=>el.open),false);
    assert.equal(new URL(page.url()).searchParams.has('screening'),false);
    // An old browser cache must not discard a selection only present in fresh data.
    await page.evaluate(async value=>{
      const {saveProgrammeCache}=await import('/programme-cache.js');
      await saveProgrammeCache('barcelona-cinema-programme-v1',{...value,generated_at:'old',films:[value.films[1]]});
    },programme);
    await page.goto(base+'?film=imdb%3Adune&screening=imax',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('.buyrow.is-highlighted');
    assert.equal(await page.locator('#dialogTitle').textContent(),'Dune');
    // Conversely, an open cached session removed by a refresh must not linger.
    const originalFilms=programme.films;
    programme.films=[originalFilms[1]];programme.generated_at='2099-01-01T01:00:00Z';
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector('#linkNotice:not([hidden])');
    assert.equal(await page.locator('#filmDialog').evaluate(el=>el.open),false);
    assert.equal((await call('search_screenings')).total_screenings,1);
    programme.films=originalFilms;programme.generated_at='2099-01-01T02:00:00Z';
    assert.deepEqual(errors,[]);
    // Feature absence and rejected registration must preserve normal interaction.
    for(const failure of ['absent','reject']){
      const fallback=await context.newPage();
      await fallback.addInitScript(mode=>Object.defineProperty(document,'modelContext',{value:mode==='absent'?undefined:{registerTool(){return Promise.reject(new Error('Test registration failure'));}},configurable:true}),failure);
      const fallbackErrors=[];fallback.on('pageerror',error=>fallbackErrors.push(error.message));
      await fallback.goto(base,{waitUntil:'domcontentloaded'});
      await fallback.waitForSelector('.card');
      await fallback.locator('#search').fill('Villeneuve IMAX');
      await fallback.waitForFunction(()=>document.querySelectorAll('.card').length===1&&document.querySelectorAll('.card-showtime').length===1);
      assert.equal(await fallback.locator('.card').count(),1);assert.equal(await fallback.locator('.card-showtime').count(),1);
      await fallback.locator('.card-showtime').click();
      assert.equal(await fallback.locator('#dialogTitle').textContent(),'Dune');
      assert.deepEqual(fallbackErrors,[]);await fallback.close();
    }
    console.log('Fixture and fallback checks passed; checking the collected programme.');
    const liveContext=await browser.newContext();
    liveContext.setDefaultTimeout(15000);
    await liveContext.route('**/*',route=>new URL(route.request().url()).origin===localOrigin?route.continue():route.abort());
    const live=await liveContext.newPage(),liveErrors=[];
    live.on('pageerror',error=>liveErrors.push(error.message));
    await live.goto(base,{waitUntil:'domcontentloaded'});
    await live.waitForSelector('.card');
    await live.waitForFunction(async()=> (await document.modelContext.getTools()).length===6);
    const liveResult=await live.evaluate(async()=>{
      const tools=await document.modelContext.getTools();
      const call=async(name,input)=>{const result=await document.modelContext.executeTool(tools.find(tool=>tool.name===name),input);return (typeof result==='string'?JSON.parse(result):result).structuredContent;};
      const found=await call('search_screenings',{limit:1});
      if(!found.results.length)throw new Error('No upcoming screenings in the collected programme.');
      const row=found.results[0];
      const shown=await call('show_screening',{screening_id:row.screening_id});
      return {total:found.total_screenings,filmCount:found.total_films,screeningId:row.screening_id,shown:shown.shown,bookingURL:row.booking_url};
    });
    assert.equal(liveResult.shown,true);
    assert.equal(await live.locator('.buyrow.is-highlighted').getAttribute('data-session'),liveResult.screeningId);
    assert.equal(await live.locator('.buyrow.is-highlighted .buyrow-ticket').getAttribute('href'),liveResult.bookingURL);
    await live.screenshot({path:'/private/tmp/vobarna-webmcp-live.png'});
    assert.deepEqual(liveErrors,[]);
    console.log('Collected programme:',JSON.stringify(liveResult));
    console.log('Native WebMCP: six tools discovered and executed; read-only search, visible filters, hidden screening, invalid input, reloadable links, dialog close, languages, mobile layout and unsupported/failed registration passed.');
    console.log('Browser:',native.userAgent);
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
