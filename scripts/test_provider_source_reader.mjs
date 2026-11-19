import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedSource,readProgramme,readBounded} from '../src/provider-source-reader.mjs';
const env={SOURCE_TOKEN:'test-only-token'};
const source='https://barcelona.cines-verdi.com/api/get-events';
function request(url=source,token=env.SOURCE_TOKEN){return new Request('https://reader.example/programme',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({url})});}

test('only approved public programme and ticket information URLs are allowed',()=>{
  for(const url of [source,'https://cinesfilmax.com/el-director','https://www.moobycinemas.com/aribau',
    'https://verdibcn.admit-one.eu/?p=tickets&s=VERDIBCN&perfCode=123&language=esp',
    'https://www.institutfrancais.es/barcelona/evento/film/'])assert(allowedSource(url),url);
  for(const url of ['http://barcelona.cines-verdi.com/api/get-events','https://127.0.0.1/',
    'https://barcelona.cines-verdi.com.evil.example/api/get-events','https://user:pass@barcelona.cines-verdi.com/api/get-events',
    'https://barcelona.cines-verdi.com/admin','https://cinesfilmax.com/checkout','https://cinesfilmax.com/login/',
    'https://verdibcn.admit-one.eu/?p=checkout&perfCode=1','https://verdibcn.admit-one.eu/?p=tickets&perfCode=1&quantity=2',
    'https://www.moobycinemas.com/aribau?admin=1'])assert.equal(allowedSource(url),false,url);
});
test('missing or wrong credentials and oversized requests never contact a provider',async()=>{
  let calls=0;const fetcher=async()=>{calls++;throw new Error('unexpected request');};
  assert.equal((await readProgramme(request(source,'wrong'),env,fetcher)).status,401);
  assert.equal((await readProgramme(request(),{},fetcher)).status,401);
  assert.equal((await readProgramme(new Request('https://reader.example/programme',{method:'POST',headers:{Authorization:'Bearer '+env.SOURCE_TOKEN},body:'x'.repeat(5000)}),env,fetcher)).status,400);
  assert.equal(calls,0);
});
test('upstream GETs receive no caller credentials and carry a fresh acquisition receipt',async()=>{
  const result=await readProgramme(request(),env,async(url,options)=>{
    assert.equal(url,source);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);assert.equal(options.body,undefined);
    return Response.json({result:[]});
  });
  assert.equal(result.status,200);assert.deepEqual(await result.json(),{result:[]});
  assert(Number.isFinite(Date.parse(result.headers.get('x-source-fetched-at'))));
});
test('redirects to another host or to a transaction are rejected',async()=>{
  for(const location of ['https://example.com/','https://barcelona.cines-verdi.com/checkout']){
    let calls=0;const result=await readProgramme(request(),env,async()=>{calls++;return new Response(null,{status:302,headers:{Location:location}});});
    assert.equal(result.status,502);assert.equal(calls,1);
  }
});
test('upstream failures, browser checks and unexpected content types stay failures',async()=>{
  for(const response of [new Response('check',{status:202}),new Response('<title>Robot Challenge Screen</title>',{headers:{'Content-Type':'text/html'}}),new Response('blob',{headers:{'Content-Type':'application/octet-stream'}})]){
    assert.equal((await readProgramme(request(),env,async()=>response)).status,502);
  }
});
test('body reads are bounded and cancel oversized streams',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(16));},cancel(){cancelled=true;}});
  await assert.rejects(readBounded(stream,10));assert(cancelled);
});
