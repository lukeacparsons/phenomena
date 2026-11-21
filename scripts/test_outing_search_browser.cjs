const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:18941';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900},geolocation:{latitude:41.4,longitude:2.15},permissions:['geolocation']});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const session=(id,time,extra={})=>({id,cinema_id:'verdi',provider:'fixture',date:'2099-01-01',time,starts_at:'2099-01-01T'+time+':00+01:00',language:'English',formats:[],source_url:'https://cinema.example',booking_url:'https://cinema.example/tickets',...extra});
  const film=(id,title,time,extra={})=>({id,title,urls:{en:'/en/films/'+id+'/'},details:{runtime_minutes:90,genres:['Comedy'],directors:['Jane Example']},sessions:[session(id,time)],...extra});
  const price={amount:8,currency:'EUR',kind:'general_admission',source_url:'https://cinema.example/price',checked_at:'2099-01-01T09:55:00Z',fees:'unknown'};
  const programme={generated_at:'2099-01-01T09:00:00Z',cinemas:[{id:'verdi',name:'Verdi',short:'Verdi',location:{latitude:41.4,longitude:2.15}},{id:'phenomena',name:'Phenomena',short:'Phenomena',location:{latitude:41.45,longitude:2.2}}],films:[
   film('early','Early Film','13:00',{sessions:[session('early','13:00',{price_data:price,subtitles_confirmed_none:true,seat_data:{available:20,kind:'ordinary',checked_at:'2099-01-01T09:55:00Z'}})]}),
   film('late','Late Film','17:00',{sessions:[session('late','17:00',{language:'Spanish'})]}),
   film('tomorrow','Tomorrow Film','18:00',{sessions:[session('tomorrow','18:00',{cinema_id:'phenomena',date:'2099-01-02',starts_at:'2099-01-02T18:00:00+01:00'})]})
  ],search:{films:[film('past','Past Film','18:00',{sessions:[session('past','18:00',{date:'2098-12-31',starts_at:'2098-12-31T18:00:00+01:00'})]})],venues:[{id:'verdi',name:'Verdi',official_url:'https://cinema.example',answers:[{topic:'food_belongings',passages:[{text:'Water is permitted. Ask about bag storage.',scope:'Published policy; check the screening room.',checked_at:'2099-01-01',sources:[{title:'Cinema FAQ',url:'https://cinema.example/faq'}]}],unresolved:['Bag storage is not established.']}]}]}};
  await context.route('**/programme.json',r=>r.fulfill({json:programme}));
  await context.route('**/api/search-suggestions*',r=>r.fulfill({status:503,json:{error:'fixture'}}));
  await context.route('**/api/completions',r=>r.fulfill({json:{query:r.request().postDataJSON().query,suggestions:[]}}));
  await context.route('**/availability.json',r=>r.fulfill({json:{sessions:{},errors:{},refresh_interval_seconds:900}}));
  let apiCalls=0;await context.route('**/api/search',r=>{apiCalls++;return r.fulfill({status:503,json:{error:'unavailable'}});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2099-01-01T10:00:00Z'));
  await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});await page.waitForSelector('#grid[data-enhanced]');
  const search=async query=>{await page.locator('#search').fill(query);await page.locator('#search').press('Enter');await page.waitForFunction(q=>document.getElementById('grid').getAttribute('aria-busy')==='false'&&(new URLSearchParams(location.search).get('q')||'')===q,query);};
  const ids=()=>page.locator('#grid .card[data-film]').evaluateAll(nodes=>nodes.map(n=>n.dataset.film));
  assert.equal(await page.locator('[data-seen-film]').count(),0);
  await search('finishes before 15:00');assert.deepEqual(await ids(),['early']);assert.equal(await page.locator('#searchFeedback').isVisible(),false);
  await search('under €10');assert.deepEqual(await ids(),['early']);assert.match(await page.locator('.search-match').innerText(),/8\.00/);assert.equal(await page.locator('.search-match-source').getAttribute('href'),'https://cinema.example/price');
  await search('today at Verdi or tomorrow at Phenomena');assert.deepEqual(await ids(),['early','late','tomorrow']);
  await page.locator('[data-value="alternatives"]').click();assert.match(page.url(),/skip=alternatives/);
  await search('English preferred, Spanish acceptable');assert.deepEqual(await ids(),['early','tomorrow','late']);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('#grid[data-enhanced]');assert.deepEqual(await ids(),['early','tomorrow','late']);
  await search('no subtitles');assert.deepEqual(await ids(),['early']);
  await search('not sold out');assert.deepEqual(await ids(),['early']);
  await search('four seats together');assert.equal((await ids()).length,0);assert.match(await page.locator('#searchFeedback').innerText(),/adjacent seats/);
  await search('Can I bring a backpack to Verdi?');assert.match(await page.locator('#searchFeedback').innerText(),/Water is permitted/);assert.equal(await page.locator('#searchFeedback a[href="https://cinema.example/faq"]').count(),1);
  await search('two films today with a dinner break');assert.equal(await page.locator('.search-itineraries article').count(),1);assert.deepEqual(await ids(),['early','late']);
  assert.match(await page.locator('.search-itineraries').innerText(),/Est\. end 14:50/);
  assert.equal(await page.locator('.search-outing-break').innerText(),'2 h 10 min break');
  assert.equal(await page.locator('.search-outing-start').first().getAttribute('href'),'/en/films/early/#screening-early');
  assert.equal(await page.locator('.search-outing').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
  await search('what played yesterday');assert.equal(await page.locator('.search-history').count(),1);assert.equal(await page.locator('#grid a[href*="tickets"]').count(),0);
  await search('within 2 km');await page.waitForSelector('#grid .card[data-film="early"]');assert.deepEqual(await ids(),['early','late']);
  await search('finishes before 12:00');assert.equal((await ids()).length,0);await page.locator('[data-search-suggestion]').first().click();assert((await ids()).length>0);
  await page.setViewportSize({width:390,height:844});await search('today at Verdi or tomorrow at Phenomena');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/private/tmp/vobarna-expanded-search/mobile.png'});
  assert.equal(apiCalls,0,'These supported queries run locally');assert.deepEqual(errors,[]);
  console.log('Expanded search browser: practical filters, alternatives, preferences, evidence, itineraries, history, geolocation, recovery, mobile and no seen controls passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
