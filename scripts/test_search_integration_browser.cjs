const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {mkdirSync,writeFileSync}=require('node:fs');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8791';
const output=process.env.SEARCH_CHECK_OUTPUT||'/private/tmp/vobarna-combined-search';mkdirSync(output,{recursive:true});
const chipStyle=el=>{const style=getComputedStyle(el);return Object.fromEntries(['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','paddingTop','paddingBottom','paddingLeft','paddingRight','borderTopWidth','borderRadius','minHeight','color'].map(key=>[key,style[key]]));};
(async()=>{
 const {emptyIntent}=await import('../static/search-intent.js');const reports=[];
 for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   const calls=[];let semanticFilm;
   await context.route(/\/api\/(search|completions)$/,async route=>{
    const {query}=route.request().postDataJSON(),path=new URL(route.request().url()).pathname;calls.push({path,query});
    if(path==='/api/completions')return route.fulfill({json:{query,suggestions:[]}});
    return route.fulfill({json:{query,mode:'semantic',intent:{...emptyIntent(),semantic_query:query},semantic_scores:[{film_id:semanticFilm,score:1}]}});
   });
   await context.addInitScript(()=>{let seed=12345;Math.random=()=>((seed=seed*16807%2147483647)-1)/2147483646;window.locationCalls=0;navigator.geolocation.getCurrentPosition=fn=>{window.locationCalls++;fn({coords:{latitude:41.39,longitude:2.16}});};});
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('.search-idea',{timeout:45000});
   const input=page.locator('#search'),reset=page.locator('#clearFilters'),chips=page.locator('.search-idea'),shuffle=page.locator('.search-shuffle');
   assert.equal(await input.inputValue(),'');assert.equal(await input.getAttribute('placeholder'),'Search films, cinemas…');assert.equal(await input.evaluate(el=>el===document.activeElement),false,'Touch entry does not summon the keyboard');
   assert.equal(await page.locator('.search').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
   const initial=await chips.allTextContents();assert.equal(initial.length,3);
   const programme=await page.evaluate(()=>fetch('/programme.json').then(r=>r.json()));semanticFilm=programme.films[0].id;
   for(const query of initial){
    await page.getByRole('button',{name:'Search for '+query,exact:true}).tap();
    assert.equal(await input.inputValue(),query);assert.ok(await page.locator('#grid .card').count()>0);
    assert.equal(await input.evaluate(el=>el===document.activeElement),false,'Tapping a suggestion leaves focus out of the input');
    assert.equal(new URL(page.url()).searchParams.get('q'),query);await reset.tap();
   }
   const anchor=await shuffle.boundingBox(),seen=new Set(initial);let nearby=false;
   for(let i=0;i<100;i++){
    const previous=await chips.allTextContents();await shuffle.tap();const next=await chips.allTextContents(),box=await shuffle.boundingBox();
    assert.ok(next.every(q=>!previous.includes(q)));for(const q of next){assert.ok(!seen.has(q),'No repeat during the rotation');seen.add(q);}assert.equal(box.x,anchor.x);assert.equal(box.y,anchor.y);
    if(next.includes('Hunger Games near me')){nearby=true;break;}
   }
   assert.ok(nearby);assert.equal(await page.evaluate(()=>window.locationCalls),0);
   await page.getByRole('button',{name:'Search for Hunger Games near me',exact:true}).tap();
   await page.waitForFunction(()=>window.locationCalls===1&&document.querySelector('#grid .card'));
   assert.equal(await input.inputValue(),'Hunger Games near me');await reset.tap();
   await input.fill('hunger games in');await page.getByRole('option',{name:'Hunger Games in English',exact:true}).tap();
   assert.equal(await input.evaluate(el=>el===document.activeElement),false,'Tapping a completion dismisses input focus');
   assert.equal(await input.inputValue(),'Hunger Games in English');assert.ok(await page.locator('[data-remove-filter="intent"]').count()>0);
   await page.locator('[data-remove-filter="intent"]').first().tap();assert.ok(new URL(page.url()).searchParams.has('skip'));await reset.tap();
   await input.fill('pheno');const first=await page.locator('.search-option-title').first().textContent();await input.press('ArrowDown');await input.press('Enter');assert.equal(await input.inputValue(),first);assert.ok(await input.evaluate(el=>el===document.activeElement),'Keyboard selection retains focus');await reset.tap();
   await input.fill('pheno');await page.locator('.search-option').first().waitFor();await input.press('Tab');await page.keyboard.press('Enter');assert.equal(await input.inputValue(),first);await reset.tap();
   await page.waitForTimeout(500);assert.deepEqual(calls,[],'Verified chips, menu and filters make no model-capable requests');
   const layout=()=>page.evaluate(()=>{
    const box=selector=>document.querySelector(selector).getBoundingClientRect();
    return {inputWidth:box('.search').width,inputHeight:box('.search').height,inputFont:getComputedStyle(document.querySelector('#search')).fontSize,
     resultTop:box('#results').top+scrollY,ideas:[...document.querySelectorAll('.search-idea')].map(e=>({height:e.getBoundingClientRect().height,font:getComputedStyle(e).fontSize,top:e.getBoundingClientRect().top})),
     shuffleRight:box('.search-shuffle').right,searchRight:box('.search').right,overflow:document.documentElement.scrollWidth-innerWidth};
   });
   for(const width of [320,390,430,600,1280]){
    await page.setViewportSize({width,height:844});const before=await layout();assert.ok(before.overflow<=0,'No overflow at '+width);
    const suggestionStyle=await chips.first().evaluate(chipStyle);
    assert.equal(before.inputHeight,48);assert.equal(before.inputFont,'16px');
    for(const idea of before.ideas){assert.equal(idea.height,44);assert.equal(idea.font,'14px');}
    if(width<=600){
     assert.equal(before.shuffleRight,before.searchRight);
     for(const idea of before.ideas)assert.equal(idea.top,before.ideas[0].top);
    }
    await input.fill('Under 90 minutes');await input.press('Enter');
    assert.match(await page.locator('#filterChips').textContent(),/Under 90 min/);
    assert.deepEqual(await page.locator('.filter-chip').first().evaluate(chipStyle),suggestionStyle,'Suggestions and filters have identical typography and sizing at '+width);
    const after=await layout();assert.equal(after.inputWidth,before.inputWidth,'Applying a filter retains the full input width');
    if(width<=600)assert.ok(Math.abs(after.resultTop-before.resultTop)<=1,'Selecting one filter preserves result position at '+width);
    await reset.tap();
   }
   await page.setViewportSize({width:390,height:540});await input.fill('french');await page.locator('.search-option').first().waitFor();
   const count=await page.locator('.search-option').count();for(let i=0;i<count;i++)await input.press('ArrowDown');
   assert.ok(await page.evaluate(()=>{const menu=document.querySelector('.search-completions').getBoundingClientRect(),option=document.querySelector('.search-option[aria-selected=true]').getBoundingClientRect();return option.top>=menu.top&&option.bottom<=menu.bottom+1;}),'Arrow navigation reveals options within the scrolling menu');
   await input.press('Escape');await reset.tap();
   await page.setViewportSize({width:390,height:844});
   for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});await page.screenshot({path:output+'/'+name+'-'+colorScheme+'.png',fullPage:false});}
   for(let i=0;i<20;i++){await shuffle.tap();for(const q of await chips.allTextContents()){assert.ok(!seen.has(q),'Twenty further randomisations stay fresh');seen.add(q);}}
   const query='films about an imagined lighthouse';await input.fill(query);await page.waitForTimeout(350);assert.equal(calls.filter(c=>c.path==='/api/search').length,0,'Typing only edits the menu');
   await input.press('Enter');await page.waitForFunction(id=>document.querySelectorAll('#grid .card').length===1&&document.querySelector('#grid .card')?.dataset.film===id,semanticFilm);
   assert.equal(calls.filter(c=>c.path==='/api/search').length,1,'Submitting unfamiliar input retains semantic search');
   assert.deepEqual(errors,[]);reports.push({browser:name,initial,verifiedRequests:0,uniqueSuggestionsShown:seen.size,nearby:true,filters:true,keyboard:true,semantic:true,themes:true});
   for(const [locale,placeholder] of [['es','Busca películas, cines…'],['ca','Cerca pel·lícules, cinemes…']]){
    await page.goto(base+'/'+locale+'/',{waitUntil:'domcontentloaded'});await page.waitForSelector('.search-idea');
    assert.equal(await input.getAttribute('placeholder'),placeholder);
    await page.setViewportSize({width:320,height:844});
    await input.fill('French films under 120 minutes with English subtitles');await input.press('Enter');
    assert.ok(await page.locator('.filter-chip').count()>=2);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Long filters and translated Reset fit at 320px');
    assert.equal(await page.locator('#searchFeedback').evaluate(el=>el.parentElement.className),'filters','Feedback remains below the controls');
    await page.screenshot({path:output+'/'+name+'-'+locale+'-filters.png',fullPage:false});
    await reset.tap();
   }
   const desktopContext=await browser.newContext({viewport:{width:1280,height:900}});
   await desktopContext.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   await desktopContext.route(/\/api\/(search|completions)$/,route=>route.fulfill({status:503,json:{}}));
   const desktop=await desktopContext.newPage();desktop.on('pageerror',error=>errors.push(error.message));
   await desktop.goto(base+'/en/',{waitUntil:'domcontentloaded'});await desktop.waitForSelector('.search-idea');
   const desktopInput=desktop.locator('#search');
   assert.ok(await desktopInput.evaluate(el=>el===document.activeElement),'Desktop retains initial keyboard focus');
   const desktopWidth=(await desktop.locator('.search').boundingBox()).width;
   await desktop.locator('.search-idea').first().click();
   assert.ok(await desktopInput.evaluate(el=>el===document.activeElement),'Mouse selection retains focus');
   assert.equal((await desktop.locator('.search').boundingBox()).width,desktopWidth);
   for(const colorScheme of ['light','dark']){
    await desktop.emulateMedia({colorScheme});await desktop.locator('#clearFilters').click();
    const suggestionStyle=await desktop.locator('.search-idea').first().evaluate(chipStyle);
    assert.ok(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await desktop.screenshot({path:output+'/'+name+'-desktop-'+colorScheme+'.png',fullPage:false});
    await desktopInput.fill('Under 90 minutes');await desktopInput.press('Enter');
    assert.deepEqual(await desktop.locator('.filter-chip').first().evaluate(chipStyle),suggestionStyle,'Desktop suggestions and filters share type, padding and text colour');
    assert.ok(await desktop.locator('.filter-chip').evaluate(el=>el.getBoundingClientRect().height===44&&getComputedStyle(el).fontSize==='14px'));
    await desktop.screenshot({path:output+'/'+name+'-desktop-'+colorScheme+'-selected.png',fullPage:false});
   }
   assert.deepEqual(errors,[]);reports.at(-1).desktop=true;
   await desktopContext.close();
  }finally{await browser.close();}
 }
 writeFileSync(output+'/results.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
