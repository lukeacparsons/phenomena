const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VOBARNA_PUBLIC_URL||'http://127.0.0.1:8811';
const publication=path.resolve(process.env.VOBARNA_PUBLICATION_ROOT||'.site','current/public');
const output=path.resolve('output/style-audit');
const routes=[
  ['home','/en/'],['today','/en/showtimes/today/'],['tomorrow','/en/showtimes/tomorrow/'],
  ['archive','/en/films/'],['film','/en/films/resident-evil-2026/'],
  ['directory','/en/cinemas/'],['cinema','/en/cinemas/phenomena-experience/'],
  ['guides','/en/guides/'],['formats','/en/guides/cinema-screen-sound-formats/'],
  ['versions','/en/guides/vose-vosc-original-version/'],['discovery','/en/showtimes/english-language/'],
  ['search-guide','/en/guides/how-to-search/'],
  ['discounts','/en/guides/cinema-discount-days-barcelona/'],['programme','/en/programme/'],
  ['about','/en/about/'],['agents','/webmcp/'],['missing','/a-page-that-does-not-exist/'],
  ['spanish','/es/guias/cine-subtitulos-ingles-barcelona/'],['catalan','/ca/cinemes/']
];
function htmlFiles(folder){
  return fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(folder,entry.name);
    return entry.isDirectory()?htmlFiles(file):entry.name.endsWith('.html')?[file]:[];
  });
}
// Every generated document must load the shared design, including less-used routes.
const documents=htmlFiles(publication).filter(file=>fs.readFileSync(file,'utf8').includes('<body'));
for(const file of documents){
  const html=fs.readFileSync(file,'utf8');
  if(!html.includes('class="public-site')&&!html.includes('class="agent-guide'))continue;
  assert.ok(html.includes('href="/ui-components.css"'),path.relative(publication,file)+' must load the components');
}

(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:'chrome'})});
  const report={documents:documents.length,views:[]};
  try{
    const context=await browser.newContext({reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});
      for(const [name,url] of routes){
        const response=await page.goto(base+url,{waitUntil:'domcontentloaded'});
        assert.equal(response.status(),name==='missing'?404:200,name);
        await page.evaluate(()=>document.fonts.ready);
        if(name==='cinema')await page.locator('.venue-disclosure').first().evaluate(node=>node.open=true);
        if(name==='discovery')await page.locator('.discovery-film details').first().evaluate(node=>node.open=true);
        if(name==='cinema')await page.locator('.room').first().scrollIntoViewIfNeeded();
        if(name==='formats')await page.locator('.comparison-room').first().scrollIntoViewIfNeeded();
        if(name==='agents')await page.locator('.guide-tool').first().scrollIntoViewIfNeeded();
        for(const theme of ['light','dark']){
          await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
          const checks=await page.evaluate(()=>{
            const all=selector=>[...document.querySelectorAll(selector)];
            const visible=node=>node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0;
            const flat=all('.card,.content-block,.empty').filter(visible).every(node=>{
              const style=getComputedStyle(node);
              return style.backgroundColor==='rgba(0, 0, 0, 0)'&&parseFloat(style.borderTopWidth)===0;
            });
            const components=all('.room,.comparison-room,.guide-tool').every(node=>node.classList.contains('content-block'));
            const rounded=all('img.poster,img.public-poster,img.dialog-poster').filter(visible).every(node=>getComputedStyle(node).borderRadius==='6px');
            const targets=all('.programme-times a,.venue-list li>a,.guide-contents a,.schedule-cinema-name,.card-showtime,.text-action,.ticket-link').filter(visible);
            return {overflow:document.documentElement.scrollWidth>innerWidth+1,mainWidth:document.querySelector('main').getBoundingClientRect().width,
              flat,components,rounded,touchTargets:innerWidth>600||targets.every(node=>node.getBoundingClientRect().height>=44),
              stylesheet:all('link[rel=stylesheet]').some(node=>node.href.endsWith('/ui-components.css')),
              subtitleCopies:innerWidth>600||all('.logo-subtitle').filter(visible).length<=1};
          });
          const label=`${name} ${width} ${theme}`;
          assert.equal(checks.overflow,false,label+' overflow');
          assert.ok(checks.mainWidth<=1241,label+' width');
          for(const key of ['flat','components','rounded','touchTargets','stylesheet','subtitleCopies'])assert.equal(checks[key],true,label+' '+key);
          await page.screenshot({path:path.join(output,`${name}-${width}-${theme}.png`)});
          report.views.push({name,url,width,theme,...checks});
        }
      }
    }
    await page.goto(base+'/en/',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#grid[data-enhanced]');
    await page.locator('#search').fill('no-such-film-ui-audit-94735');
    await page.waitForSelector('#grid .empty');
    assert.equal(await page.locator('#grid .empty').evaluate(node=>getComputedStyle(node).borderWidth),'0px');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(`Shared styles loaded across ${report.documents} documents; ${report.views.length} desktop/mobile/theme views passed.`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
