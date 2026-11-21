const assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8791';
(async()=>{
 for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
  const browser=await engine.launch({headless:true});
  try{
   for(const scenario of ['submit','edit','worker-fallback']){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
    await context.route(/\/api\/(search|completions)$/,r=>r.fulfill({json:{query:r.request().postDataJSON().query,suggestions:[]}}));
    if(scenario==='worker-fallback')await context.route('**/programme-worker.js',r=>r.abort());
    let release;const gate=new Promise(resolve=>release=resolve);
    await context.route('**/programme.json',async r=>{await gate;await r.continue();});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});await page.waitForSelector('.search-composer');
    const input=page.locator('#search');await input.fill('English');await input.press('Enter');
    if(scenario==='edit')await input.fill('French');
    release();await page.evaluate(()=>window.vobarnaProgramme);
    assert.equal(await input.inputValue(),scenario==='edit'?'French':'English');
    assert.equal(new URL(page.url()).searchParams.get('q'),scenario==='edit'?null:'English');
    if(scenario==='edit'){await input.press('Enter');assert.equal(new URL(page.url()).searchParams.get('q'),'French');}
    assert.ok(await page.locator('#grid .card').count()>0);
    await input.dispatchEvent('compositionstart');await input.fill('pheno');
    assert.equal(await input.getAttribute('aria-expanded'),'false');
    await input.dispatchEvent('compositionend');await page.locator('.search-option').first().waitFor();
    await input.press('ArrowDown');await input.press('Enter');assert.match(await input.inputValue(),/Phenomena/i);
    assert.deepEqual(errors,[]);await context.close();
   }
   console.log(name+': early Enter, edits during loading, IME, keyboard selection and worker fallback passed');
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
