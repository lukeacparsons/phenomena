const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8791';
(async()=>{
 for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
  const browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const now='2099-01-01T10:00:00Z';await page.clock.install({time:new Date(now)});
   const p={generated_at:now,cinemas:[{id:'verdi',name:'Verdi',short:'Verdi'}],films:['first','second'].map(id=>({id,title:id,sessions:[{id,cinema_id:'verdi',provider:'verdi',date:'2099-01-01',time:'20:00',starts_at:'2099-01-01T20:00:00+01:00',language:'English',version:'VOSE',formats:[]}]}))};
   let version=0,requests=0;
   await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   await page.route('**/programme.json',r=>r.fulfill({json:p}));
   await page.route('**/api/search-suggestions*',r=>r.fulfill({status:503,json:{}}));
   await page.route('**/api/completions',r=>r.fulfill({json:{query:r.request().postDataJSON().query,suggestions:[]}}));
   await page.route('**/api/search',r=>r.fulfill({status:503,json:{}}));
   await page.route('**/availability.json',r=>{requests++;return r.fulfill({json:{sessions:Object.fromEntries(['first','second'].map((id,i)=>[id,{kind:'ordinary',available:i===version?5:0,checked_at:version?new Date(Date.parse(now)+31000).toISOString():now}])),errors:{},refresh_interval_seconds:30}});});
   await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});await page.waitForSelector('.search-idea');
   await page.locator('#search').fill('at least 3 seats');await page.locator('#search').press('Enter');
   await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length===1&&document.querySelector('#grid .card').dataset.film==='first');
   version=1;await page.clock.fastForward(31000);await page.clock.resume();
   await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length===1&&document.querySelector('#grid .card').dataset.film==='second');
   assert.ok(requests>=2);assert.equal(await page.locator('#search').inputValue(),'at least 3 seats');assert.deepEqual(errors,[]);
   console.log(name+': seat changes update active search results without another submission');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
