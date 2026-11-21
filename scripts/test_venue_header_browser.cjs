const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8765';

(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const context=await browser.newContext({javaScriptEnabled:false});
    context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(15000);
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage();
    const response=await page.goto(base+'/en/cinemas/kinepolis-barcelona-splau/',{waitUntil:'domcontentloaded'});
    assert.equal(response.status(),200);
    const header=await page.locator('.venue-heading').evaluate(node=>node.outerHTML);
    const probe=await context.newPage();
    for(const width of [1440,390]){
      await probe.setViewportSize({width,height:900});
      // A new document may encounter an old or unavailable stylesheet.
      await probe.setContent('<body class="public-site venue-page"><main>'+header+'</main></body>');
      for(const selector of ['.venue-address svg','.venue-website svg']){
        const icon=await probe.locator(selector).evaluate(node=>({width:node.getBoundingClientRect().width,
          height:node.getBoundingClientRect().height,fill:getComputedStyle(node).fill}));
        assert.deepEqual(icon,{width:18,height:18,fill:'none'},`${selector} without CSS at ${width}px`);
      }
      // Recreate the preceding release's wrapper and un-sized address SVG.
      await probe.evaluate(()=>{
        const heading=document.querySelector('.venue-heading');
        const title=heading.querySelector('h1'),address=heading.querySelector('.venue-address');
        const legacy=document.createElement('div');
        legacy.append(title,address);
        heading.replaceChildren(legacy);
        for(const name of ['width','height','fill','stroke','stroke-width'])address.querySelector('svg').removeAttribute(name);
        const actions=document.createElement('div');actions.className='venue-actions';
        actions.innerHTML='<a class="venue-action venue-action-primary" href="https://maps.google.com/">Directions</a><a class="venue-action text-action" href="https://kinepolis.es/">Website</a>';
        heading.append(actions);
      });
      const styles=['cinemas.css','theme.css','ui-components.css','site.css']
        .map(name=>fs.readFileSync(path.resolve(__dirname,'../static',name),'utf8')).join('\n');
      await probe.evaluate(css=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);},styles);
      const legacy=await probe.locator('.venue-address svg').evaluate(node=>({width:node.getBoundingClientRect().width,
        height:node.getBoundingClientRect().height,fill:getComputedStyle(node).fill}));
      assert.deepEqual(legacy,{width:18,height:18,fill:'none'},`Cached header with new CSS at ${width}px`);
      assert.equal(await probe.locator('.venue-action-primary').isVisible(),false);
      assert.equal(await probe.locator('.venue-actions .text-action').isVisible(),true);
      assert.equal(await probe.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    console.log('Cinema header passed: new HTML without CSS and cached HTML with current CSS, desktop and mobile.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
