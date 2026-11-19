import assert from 'node:assert/strict';
import test from 'node:test';
import {resolvePublicURL} from '../src/public-routing.mjs';
import worker from '../src/vobarna-worker.mjs';

const routes={pages:['/en/','/en/films/dune-1984/','/es/peliculas/dune-1984/'],redirects:{'/en/films/old-dune/':'/en/films/dune-1984/'},
  films:{'source:1984':{en:'/en/films/dune-1984/'}},cinemas:{},screenings:{s1:{en:'/en/films/dune-1984/#screening-s1'}}};
test('legacy identities redirect and unknown entities are real 404s',()=>{
  assert.deepEqual(resolvePublicURL('https://vobarna.com/cinemas.html?film=source%3A1984',routes),{status:308,location:'/en/films/dune-1984/'});
  assert.equal(resolvePublicURL('https://vobarna.com/cinemas.html?film=unknown',routes).status,404);
  assert.equal(resolvePublicURL('https://vobarna.com/en/films/missing/',routes).status,404);
  for(const path of ['/en/','/EN/index.html','/']){
    assert.deepEqual(resolvePublicURL('https://vobarna.com'+path+'?film=source%3A1984&q=dune',routes),{status:308,location:'/en/films/dune-1984/'});
    assert.deepEqual(resolvePublicURL('https://vobarna.com'+path+'?screening=s1',routes),{status:308,location:'/en/films/dune-1984/#screening-s1'});
    assert.equal(resolvePublicURL('https://vobarna.com'+path+'?film=unknown',routes).status,404);
  }
});
test('case, slash, aliases and index.html converge without loops',()=>{
  for(const path of ['/EN/FILMS/DUNE-1984','/en/films/dune-1984/index.html','/en/films/old-dune/'])
    assert.deepEqual(resolvePublicURL('https://vobarna.com'+path,routes),{status:308,location:'/en/films/dune-1984/'});
  assert.equal(resolvePublicURL('https://vobarna.com/en/films/dune-1984/',routes).status,200);
});
test('filter pages are noindex and tracking duplicates remain canonicalizable',()=>{
  assert.equal(resolvePublicURL('https://vobarna.com/en/?q=dune',routes).noindex,true);
  assert.equal(resolvePublicURL('https://vobarna.com/en/?utm_source=test',routes).noindex,false);
});
const env={ASSETS:{async fetch(request){const path=new URL(request.url).pathname;return path==='/routes.json'?Response.json(routes):new Response('<h1>Page</h1>',{headers:{'Content-Type':'text/html'}});}}};
test('worker preserves 404 and noindex semantics even when an asset fallback is 200',async()=>{
  const missing=await worker.fetch(new Request('https://vobarna.com/en/missing/'),env);
  assert.equal(missing.status,404);assert.equal(missing.headers.get('X-Robots-Tag'),'noindex');
  const filtered=await worker.fetch(new Request('https://vobarna.com/en/?q=dune'),env);
  assert.equal(filtered.headers.get('X-Robots-Tag'),'noindex, follow');
});
test('worker cannot invoke a checkout or accept mutations',async()=>{
  const response=await worker.fetch(new Request('https://vobarna.com/api/checkout',{method:'POST'}),env);
  assert.equal(response.status,405);
});
test('only successful content-addressed image responses get immutable caching',async()=>{
  const url='https://vobarna.com/preview-data/images/'+'a'.repeat(64)+'-320.webp';
  const result=await worker.fetch(new Request(url),env);
  assert.equal(result.headers.get('Cache-Control'),'public, max-age=31536000, immutable');
  const missing=await worker.fetch(new Request(url),{ASSETS:{fetch:async()=>new Response('',{status:404})}});
  assert.equal(missing.status,404);assert.notEqual(missing.headers.get('Cache-Control'),result.headers.get('Cache-Control'));
  const mutable=await worker.fetch(new Request('https://vobarna.com/clint-logo.webp'),env);
  assert.notEqual(mutable.headers.get('Cache-Control'),result.headers.get('Cache-Control'));
});
test('bad publication returns temporary unavailability, not an indexed empty page',async()=>{
  const response=await worker.fetch(new Request('https://vobarna.com/en/'),{ASSETS:{fetch:async()=>new Response('',{status:404})}});
  assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'300');
});
test('worker loads only the relevant historical screening shard',async()=>{
 for(const path of ['/cinemas.html','/en/','/EN/index.html']){
  const requested=[];
  const response=await worker.fetch(new Request('https://vobarna.com'+path+'?screening=s1'),{ASSETS:{fetch:async request=>{
    const path=new URL(request.url).pathname;requested.push(path);
    if(path==='/routes.json')return Response.json({...routes,screenings:undefined,screening_shards:true});
    assert.match(path,/^\/route-data\/screenings\/[a-f0-9]{2}\.json$/);
    return Response.json(routes.screenings);
  }}});
  assert.equal(response.status,308);
  assert.equal(response.headers.get('Location'),'https://vobarna.com/en/films/dune-1984/#screening-s1');
  assert.equal(requested.length,2);
 }
});
