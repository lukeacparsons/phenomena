const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8789';

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:'chrome'})});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    context.setDefaultTimeout(15000);
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const programme=await (await context.request.get(base+'/programme.json')).json();
    const now=Date.parse(programme.generated_at);
    // Exercise operator matching even when the catalogue only has theatre names.
    for(const cinema of programme.cinemas)cinema.name=cinema.short||cinema.name;
    await context.route('**/programme.json',route=>route.fulfill({json:programme}));
    const page=await context.newPage(),errors=[];
    await page.clock.setFixedTime(new Date(now));
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#grid[data-enhanced] .title-button',{state:'attached'});
    const search=async query=>{
      await page.locator('#search').fill(query);
      await page.waitForFunction(query=>document.getElementById('grid').getAttribute('aria-busy')==='false'&&new URLSearchParams(location.search).get('q')===query,query);
    };
    async function check(query,provider,predicate=()=>true,{exclusive=true}={}){
      await search(query);
      const expected=new Set(programme.films.flatMap(f=>f.sessions.filter(s=>s.provider===provider&&Date.parse(s.starts_at)>=now&&predicate(s)).map(s=>s.id)));
      assert.ok(expected.size>0,query+' fixture must have future screenings');
      const displayed=await page.locator('#grid [data-session]').evaluateAll(nodes=>nodes.map(node=>node.dataset.session));
      assert.ok(displayed.length>0,query+' must show screenings');
      assert.ok(displayed.some(id=>expected.has(id)),query+' must include matching operator screenings');
      if(exclusive)assert.ok(displayed.every(id=>expected.has(id)),query+' must only show matching operator screenings');
      const labels=await page.locator('#grid .card-cinema').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.cinema,name:node.querySelector('.card-cinema-name').textContent})));
      for(const label of labels)assert.equal(label.name,programme.cinemas.find(cinema=>cinema.id===label.id).short);
    }
    for(const [query,provider] of [['cinesa','cinesa'],['MOOBY','mooby'],['Yelmo','yelmo'],['Kinépolis','kinepolis'],['OCINE','ocine-magic'],['Filmax','filmax']])await check(query,provider);
    // Partial words can also match film titles (for example "moon").
    await check('moo','mooby',undefined,{exclusive:false});
    await check('cinesa IMAX','cinesa',s=>(s.formats||[]).includes('IMAX'));
    await check('mooby Balmes','mooby',s=>s.cinema_id==='mooby-balmes');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector('#grid[data-enhanced] .title-button',{state:'attached'});
    assert.equal(await page.locator('#search').inputValue(),'mooby Balmes');
    await check('mooby Balmes','mooby',s=>s.cinema_id==='mooby-balmes');
    await page.setViewportSize({width:390,height:844});
    await check('cinesa','cinesa');
    assert.deepEqual(errors,[]);
    console.log('Chain search: six operators, unbranded cinema names, case/accents, prefixes, formats, venue combinations, shared URLs and mobile passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
