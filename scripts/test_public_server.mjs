import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,symlink,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {publicServer} from '../src/vobarna-server.mjs';

test('date HTML rolls over without rebuilding and isolates indexing, caches and empty dates',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'vobarna-dates-')),root=join(dir,'one/public');
  const routes={origin:'https://vobarna.com',pages:['/en/','/en/showtimes/today/','/en/showtimes/tomorrow/'],redirects:{},films:{},cinemas:{},date_views:{version:1,dates:['2026-11-19','2026-11-20','2026-11-21']}};
  await mkdir(join(root,'en'),{recursive:true});await mkdir(join(root,'date-views/en'),{recursive:true});
  await writeFile(join(root,'routes.json'),JSON.stringify(routes));
  await writeFile(join(root,'en/index.html'),'<h1>General programme</h1>');await writeFile(join(root,'404.html'),'<h1>Not found</h1>');
  for(const kind of ['today','tomorrow','date'])await writeFile(join(root,'date-views/en',kind+'.txt'),`<title>${kind} __VOBARNA_DATE__</title>__VOBARNA_DATE_LISTING__`);
  for(const day of routes.date_views.dates)await writeFile(join(root,'date-views/en',day+'.txt'),'<p>Screenings on '+day+'</p>');
  await writeFile(join(root,'date-views/en/empty.txt'),'<p>Not collected</p>');
  await symlink('one',join(dir,'current'));
  let instant=new Date('2026-11-19T22:59:59Z');
  const server=publicServer({publication:dir,now:()=>instant});await new Promise(done=>server.listen(0,'127.0.0.1',done));
  t.after(async()=>{await new Promise(done=>server.close(done));await rm(dir,{recursive:true,force:true});});
  const get=(path,options={})=>fetch('http://127.0.0.1:'+server.address().port+path,{redirect:'manual',...options});
  let response=await get('/en/showtimes/today/');
  assert.equal(response.status,200);assert.equal(response.headers.get('x-robots-tag'),null);
  assert.equal(response.headers.get('cache-control'),'public, max-age=1');
  assert.match(await response.text(),/today 2026-11-19.*Screenings on 2026-11-19/);
  const etag=response.headers.get('etag');
  assert.equal((await get('/en/showtimes/today/',{headers:{'If-None-Match':etag}})).status,304);
  instant=new Date('2026-11-19T23:00:00Z');
  response=await get('/en/showtimes/today/',{headers:{'If-None-Match':etag}});
  assert.equal(response.status,200);assert.match(await response.text(),/today 2026-11-20.*Screenings on 2026-11-20/);
  response=await get('/en/showtimes/tomorrow/');assert.match(await response.text(),/tomorrow 2026-11-21.*Screenings on 2026-11-21/);
  response=await get('/en/?date=2026-11-21');assert.equal(response.headers.get('x-robots-tag'),'noindex, follow');
  assert.match(await response.text(),/date 2026-11-21.*Screenings on 2026-11-21/);
  response=await get('/en/?date=2026-12-31');assert.equal(response.status,200);assert.match(await response.text(),/2026-12-31.*Not collected/);
  response=await get('/en/?date=2026-02-30');assert.equal(response.status,404);
  response=await get('/en/');assert.equal(response.headers.get('x-robots-tag'),null);assert.match(await response.text(),/General programme/);
  response=await get('/en/showtimes/today/',{method:'HEAD'});assert.equal(response.status,200);assert.equal(await response.text(),'');
  assert.equal((await get('/date-views/en/today.txt')).status,404);
  assert.equal((await get('/%64ate-views/en/today.txt')).status,404);
});

test('production origin preserves routing, cache isolation and atomic releases',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'vobarna-origin-'));
  const routes={origin:'https://vobarna.com',pages:['/en/','/en/films/dune-1984/'],redirects:{},films:{old:{en:'/en/films/dune-1984/'}},cinemas:{},screening_shards:true};
  const shard=createHash('sha256').update('s1').digest('hex').slice(0,2);
  const namedImage='/preview-data/images/dune-poster-'+'b'.repeat(64)+'-320.webp';
  for(const name of ['one','two']){
    const root=join(dir,name,'public');
    for(const path of ['en/films/dune-1984','preview-data/images','route-data/screenings'])await mkdir(join(root,path),{recursive:true});
    for(const [path,value] of Object.entries({'routes.json':JSON.stringify(routes),'en/index.html':`<h1>${name}</h1>`+'x'.repeat(2000),'en/films/dune-1984/index.html':'<h1>Dune</h1>','404.html':'<h1>Not found</h1>','programme.json':'{}',['route-data/screenings/'+shard+'.json']:JSON.stringify({s1:{en:'/en/films/dune-1984/#screening-s1'}}),['preview-data/images/'+'a'.repeat(64)+'-320.webp']:'image'}))await writeFile(join(root,path),value);
  }
  await writeFile(join(dir,'one/public',namedImage),'image');
  await symlink('one',join(dir,'current'));
  const server=publicServer({publication:dir,indexNowKey:'test-indexnow-key'});await new Promise(done=>server.listen(0,'127.0.0.1',done));
  t.after(async()=>{await new Promise(done=>server.close(done));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const get=(path,opts={})=>fetch(base+path,{redirect:'manual',...opts});
  let response=await get('/en/');assert.equal(response.status,200);assert.match(await response.text(),/<h1>one/);assert.equal(response.headers.get('content-encoding'),'gzip');
  const etag=response.headers.get('etag');
  const keyResponse=await get('/test-indexnow-key.txt');
  assert.equal(keyResponse.status,200);assert.equal(await keyResponse.text(),'test-indexnow-key');
  assert.equal(keyResponse.headers.get('x-robots-tag'),'noindex');
  assert.equal((await get('/wrong-indexnow-key.txt')).status,404);
  response=await get('/en/',{headers:{'If-None-Match':etag}});assert.equal(response.status,304);
  response=await get('/en/',{method:'HEAD'});assert.equal(response.status,200);assert.equal(await response.text(),'');
  response=await get('/en/?q=dune');assert.equal(response.headers.get('x-robots-tag'),'noindex, follow');
  response=await get('/en/showtimes/today/');
  assert.equal(response.status,404); // Older publications without day pages do not invent a redirect.
  response=await get('/en/?utm_source=check');assert.equal(response.headers.get('x-robots-tag'),null);
  for(const [path,target] of [['/','/en/'],['/EN/index.html','/en/'],['/cinemas.html?film=old','/en/films/dune-1984/'],['/en/?screening=s1','/en/films/dune-1984/#screening-s1']]){
    response=await get(path);assert.equal(response.status,301);assert.equal(response.headers.get('location'),target);
  }
  for(const path of ['/en/unknown/','/cinemas.html?film=unknown','/missing.png','/.env','/routes.json/../../package.json']){
    response=await get(path);assert.equal(response.status,404);assert.equal(response.headers.get('x-robots-tag'),'noindex');assert.equal(response.headers.get('cache-control'),'no-store');
  }
  response=await get('/en/',{method:'POST'});assert.equal(response.status,405);
  const www=await new Promise((done,reject)=>{const req=request(base+'/en/',{headers:{Host:'www.vobarna.com'}},r=>{r.resume();done(r);});req.on('error',reject);req.end();});
  assert.equal(www.statusCode,301);assert.equal(www.headers.location,'https://vobarna.com/en/');
  response=await get('/en/',{headers:{'X-Forwarded-Host':'evil.example'}});assert.equal(response.status,200);
  response=await get('/programme.json');assert.equal(response.headers.get('cache-control'),'public, max-age=60');assert.equal(response.headers.get('x-robots-tag'),'noindex');
  response=await get('/preview-data/images/'+'a'.repeat(64)+'-320.webp');assert.match(response.headers.get('cache-control'),/immutable/);
  response=await get(namedImage);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/immutable/);
  await symlink('two',join(dir,'next'));await rename(join(dir,'next'),join(dir,'current'));
  response=await get('/en/');assert.match(await response.text(),/<h1>two/);
  await symlink('absent',join(dir,'next'));await rename(join(dir,'next'),join(dir,'current'));
  response=await get('/en/');assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
  response=await get('/healthz');assert.equal(response.status,503);
});

test('search endpoint accepts bounded same-origin JSON and keeps failures private',async t=>{
  const programme={cinemas:[],films:[]};
  const server=publicServer({smartSearchOptions:{apiKey:'',getProgramme:async()=>programme}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  t.after(()=>new Promise(done=>server.close(done)));
  const base='http://127.0.0.1:'+server.address().port;
  const post=(body,headers={})=>fetch(base+'/api/search',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  let response=await post({query:'rt >80',language:'en'},{Origin:'https://vobarna.com'});
  assert.equal(response.status,200);assert.equal((await response.json()).mode,'local');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('x-robots-tag'),'noindex');
  response=await post({query:'something uplifting'});assert.equal((await response.json()).mode,'unavailable');
  assert.equal((await fetch(base+'/api/search')).status,405);
  assert.equal((await post({query:'uplifting'},{Origin:'https://another.example'})).status,403);
  assert.equal((await post({query:'uplifting'},{'Content-Type':'text/plain'})).status,415);
  for(const body of ['{',JSON.stringify({query:'x'.repeat(5000)}),{query:'uplifting',model:'arbitrary'},{query:'uplifting',language:'invalid'}]){
    response=await post(body);assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'invalid_input'});
  }
});
