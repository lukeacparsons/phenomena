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
    await context.route('**/programme.json',route=>route.fulfill({json:programme}));
    let apiCalls=0;
    await context.route('**/api/search',async route=>{
      apiCalls++;const {query}=route.request().postDataJSON();
      if(query==='something unavailable')return route.fulfill({status:503,json:{error:'search_unavailable'}});
      return route.fulfill({json:{query,mode:'semantic',intent:{text:'',conditions:[{field:'country',op:'eq',value:'France'}],semantic_query:'uplifting',sort:'relevance',unsupported:[]},semantic_scores:[{film_id:'funny',score:.9},{film_id:'bright',score:.8},{film_id:'paris',score:.7}]}});
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2099-01-01T10:00:00Z'));
    await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#grid[data-enhanced]');
    const search=async query=>{
      await page.locator('#search').fill(query);
      await page.waitForFunction(query=>document.getElementById('grid').getAttribute('aria-busy')==='false'&&(new URLSearchParams(location.search).get('q')||'')===query,query);
    };
    const ids=()=>page.locator('#grid .card[data-film]').evaluateAll(nodes=>nodes.map(n=>n.dataset.film).sort());
    for(const [query,expected] of [['funny movies',['bright','paris']],['rt >80%',['bright','funny']],['certified fresh',['bright','funny']],['from France',['bright','paris']],['Funny Games',['funny']],['mooby',['bright','funny','paris','unknown']]]){
      await search(query);assert.deepEqual(await ids(),expected,query);
    }
    assert.equal(apiCalls,0,'standard searches must not wait for the model');
    await search('funny movies rt >80');
    await page.locator('[data-remove-filter="intent"][data-value="rating_rt:gt:80"]').click();
    assert.deepEqual(await ids(),['bright','paris']);assert.match(page.url(),/skip=/);
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('#grid[data-enhanced]');
    assert.deepEqual(await ids(),['bright','paris'],'removed filter survives a shared URL');
    await search('something uplifting from France');
    await page.waitForSelector('[data-remove-filter="intent"][data-value="semantic"]');
    assert.deepEqual(await ids(),['bright','paris'],'semantics must preserve country and rank eligible films');
    await search('');await search('something uplifting from France');
    await page.waitForSelector('[data-remove-filter="intent"][data-value="semantic"]');assert.equal(apiCalls,1,'repeat search is cached');
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
