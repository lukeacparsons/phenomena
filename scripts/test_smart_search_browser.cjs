const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:18793';

(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const session=id=>({id:'session-'+id,cinema_id:'balmes',provider:'mooby',date:'2099-01-01',time:'21:00',starts_at:'2099-01-01T21:00:00+01:00',language:'French',formats:[]});
    const film=(id,title,genre,country,score,badge)=>({id,title,details:{genres:[genre],countries:[country],languages:['French'],runtime_minutes:100},ratings:score?{rotten_tomatoes:{score,count:100,certified_fresh:badge}}:{},sessions:[session(id)]});
    const programme={generated_at:'2099-01-01T08:00:00Z',timezone:'Europe/Madrid',cinemas:[{id:'balmes',name:'Balmes',short:'Balmes'}],films:[
      film('bright','Bright Afternoon','Comedy','France',90,true),film('paris','Paris Nights','Comedy','France',80,false),
      film('funny','Funny Games','Horror','Spain',95,true),film('unknown','Unknown','','',null,null)]};
    programme.films[0].ratings.imdb={score:8};programme.films[3].ratings.imdb={score:9};
    programme.films[0].release_year=1970;programme.films[1].release_year=1979;programme.films[2].release_year=1980;
    programme.films[0].details.colours=['black-and-white'];programme.films[1].details.colours=['color'];
    programme.films[3].release_year=2099;
    programme.films[0].sessions[0].subtitles='English';
    programme.films[1].sessions[0].subtitles='Spanish';
    programme.films[0].details.distributors=['A24'];programme.films[1].details.studios=['A24'];
    programme.films[0].details.countries=['France','Italy'];
    programme.films[0].details.country_provenance=[{country:'Italy',sources:[{source:'CNC',source_url:'https://example.com/credits'}]}];
    await context.route('**/programme.json',route=>route.fulfill({json:programme}));
    let apiCalls=0;
    await context.route('**/api/search',async route=>{
      apiCalls++;const {query}=route.request().postDataJSON();
      if(query==='highly rated on imdb')return route.fulfill({json:{query,mode:'interpreted',intent:{text:'',conditions:[{field:'rating_imdb',op:'gte',value:'7.5'}],semantic_query:'',sort:'rating',unsupported:[]},semantic_scores:null}});
      if(query==='something unavailable')return route.fulfill({status:503,json:{error:'search_unavailable'}});
      if(query==='from catalunya')return route.fulfill({json:{query,mode:'semantic',intent:{text:'',conditions:[],semantic_query:'Catalan cinema',sort:'relevance',unsupported:[]},semantic_scores:[{film_id:'bright',score:.9}]}});
      return route.fulfill({json:{query,mode:'semantic',intent:{text:'',conditions:[{field:'country',op:'eq',value:'France'}],semantic_query:'uplifting',sort:'relevance',unsupported:[]},semantic_scores:[{film_id:'funny',score:.9},{film_id:'bright',score:.8},{film_id:'paris',score:.7}]}});
    });
    await context.route('**/api/completions',r=>r.fulfill({json:{query:r.request().postDataJSON().query,suggestions:[]}}));
    await context.route('**/api/search-suggestions',r=>r.fulfill({status:503,json:{error:'fixture'}}));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2099-01-01T10:00:00Z'));
    await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#grid[data-enhanced]');
    const search=async query=>{
      await page.locator('#search').fill(query);await page.locator('#search').press('Enter');
      await page.waitForFunction(query=>document.getElementById('grid').getAttribute('aria-busy')==='false'&&(new URLSearchParams(location.search).get('q')||'')===query,query);
    };
    const ids=()=>page.locator('#grid .card[data-film]').evaluateAll(nodes=>nodes.map(n=>n.dataset.film).sort());
    for(const [query,expected] of [['funny movies',['bright','paris']],['rt >80%',['bright','funny']],['certified fresh',['bright','funny']],['from France',['bright','paris']],['Funny Games',['funny']],['mooby',['bright','funny','paris','unknown']]]){
      await search(query);assert.deepEqual(await ids(),expected,query);
    }
    await search('70’s released');assert.deepEqual(await ids(),['bright','paris']);
    await search('black and white');assert.deepEqual(await ids(),['bright']);
    await search('new releases');assert.deepEqual(await ids(),['unknown']);
    assert.match(await page.locator('#filterChips').textContent(),/Released 2099/);
    assert.equal(await page.locator('#searchStatus').isVisible(),false);
    await search('a24');assert.deepEqual(await ids(),['bright','paris']);
    assert.match(await page.locator('#filterChips').textContent(),/Company A24/);
    assert.match(await page.locator('[data-film="bright"] .search-match').textContent(),/Distributed by: A24/);
    await search('produced by A24');assert.deepEqual(await ids(),['paris']);
    await search('movies from Italy');assert.deepEqual(await ids(),['bright']);
    assert.match(await page.locator('#searchExplanation').textContent(),/Includes co-productions/);
    assert.match(await page.locator('.search-match').textContent(),/Co-production: France \/ Italy/);
    assert.equal(await page.locator('.search-match-source').getAttribute('href'),'https://example.com/credits');
    await page.locator('[data-remove-filter="intent"][data-value="country:eq:italy"]').click();
    assert.equal(await page.locator('.search-match').count(),0,'removed country filter removes match explanation');
    assert.equal(apiCalls,0,'standard searches must not wait for the model');
    for(const query of ['English subtitles','foreign language films with English subtitles','VOSI','subtítulos en inglés','subtítols en anglès']){
      await search(query);assert.deepEqual(await ids(),['bright']);
      assert.match(await page.locator('#filterChips').textContent(),/Subtitles English/);
    }
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('#grid[data-enhanced]');
    assert.deepEqual(await ids(),['bright'],'subtitle constraints survive sharing/reload');
    await page.locator('[data-remove-filter="intent"][data-value="subtitles:eq:english"]').click();
    assert.equal((await ids()).length,4,'the subtitle chip can be removed');
    assert.equal(apiCalls,0,'subtitle searches never go to the model');
    await search('from catalunya');
    await page.waitForSelector('[data-remove-filter="intent"][data-value="semantic"]');
    assert.deepEqual(await ids(),['bright']);
    assert.equal(await page.locator('#searchStatus').isVisible(),false);
    assert.equal(await page.locator('#searchExplanation').isVisible(),false);
    assert.equal(apiCalls,1,'regional discovery reaches the AI despite absent regional metadata');
    await search('highly rated on imdb');
    await page.waitForSelector('[data-remove-filter="intent"][data-value="rating_imdb:gte:7 5"]');
    assert.deepEqual(await ids(),['bright','unknown']);
    assert.equal(await page.locator('[data-remove-filter="intent"][data-value^="rating_rt"]').count(),0);
    assert.equal(await page.locator('[data-remove-filter="intent"][data-value^="reviews_rt"]').count(),0);
    await search('funny movies rt >80');
    await page.locator('[data-remove-filter="intent"][data-value="rating_rt:gt:80"]').click();
    assert.deepEqual(await ids(),['bright','paris']);assert.match(page.url(),/skip=/);
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('#grid[data-enhanced]');
    assert.deepEqual(await ids(),['bright','paris'],'removed filter survives a shared URL');
    await search('something uplifting from France');
    await page.waitForSelector('[data-remove-filter="intent"][data-value="semantic"]');
    assert.deepEqual(await ids(),['bright','paris'],'semantics must preserve country and rank eligible films');
    await search('');await search('something uplifting from France');
    await page.waitForSelector('[data-remove-filter="intent"][data-value="semantic"]');assert.equal(apiCalls,3,'repeat search is cached');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'/private/tmp/vobarna-smart-search-mobile.png'});
    await page.locator('[data-remove-filter="intent"][data-value="semantic"]').click();
    assert.deepEqual(await ids(),['bright','paris']);
    await search('something unavailable');
    await page.waitForFunction(()=>document.getElementById('searchStatus').textContent.includes('temporarily unavailable'));
    await search('rt >=80');assert.deepEqual(await ids(),['bright','funny','paris']);
    assert.equal(await page.locator('#searchStatus').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('Smart search browser: instant filters, badges, title protection, shareable chips, semantic constraints, caching, mobile and provider failure passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
