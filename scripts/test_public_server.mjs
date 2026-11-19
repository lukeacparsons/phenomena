import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,symlink,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {publicServer} from '../src/vobarna-server.mjs';

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
  assert.equal(response.status,302);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match(response.headers.get('location'),/^\/en\/\?date=\d{4}-\d{2}-\d{2}$/);
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
