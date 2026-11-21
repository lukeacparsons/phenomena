import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {publicServer} from '../src/vobarna-server.mjs';

test('combined suggestion endpoints keep analytics private, validate requests and bypass AI for verified chips',async()=>{
 const programme={generated_at:'fixture',cinemas:[{id:'verdi',name:'Verdi',short:'Verdi',area:'Barcelona'}],films:[{id:'hunger',title:'The Hunger Games: Homeward',details:{languages:['English']},sessions:[{id:'screening',cinema_id:'verdi',starts_at:'2099-01-01T20:00:00+01:00',date:'2099-01-01',time:'20:00',language:'English'}]}]};
 const snapshot={schema:1,to:new Date().toISOString(),dimensions:{films:[{entity_id:'hunger',sessions:20}],cinemas:[],pages:[]}};
 let providerCalls=0;const logs=[];
 const server=publicServer({smartSearchOptions:{getProgramme:async()=>programme,apiKey:'test',fetchImpl:()=>assert.fail('Verified chips cannot call the search provider')},
  suggestionOptions:{interestOptions:{enabled:false,read:async()=>snapshot},completionOptions:{apiKey:'test',logUsage:r=>logs.push(r),fetchImpl:async()=>{providerCalls++;return {ok:true,status:200,json:async()=>({status:'completed',usage:{input_tokens:1200,output_tokens:10,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}},output:[{content:[{type:'output_text',text:'{"suggestions":[]}'}]}]})};}}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 try{
  const response=await fetch(base+'/api/search-suggestions'),cat=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.ok(cat.ideas.includes('Hunger Games in English'));
  for(const key of ['dimensions','context','programme','signals','sessions','recent_sessions','score'])assert.ok(!JSON.stringify(cat).includes('"'+key+'":'),'No private field '+key);
  const result=await post('/api/search',{query:'Hunger Games in English',language:'en'});assert.equal(result.status,200);assert.equal((await result.json()).mode,'local');assert.equal(providerCalls,0);
  assert.equal((await fetch(base+'/api/completions')).status,405);
  assert.equal((await post('/api/completions',{query:'unfamiliar'},{Origin:'https://elsewhere.example'})).status,403);
  assert.equal((await post('/api/completions',{query:'unfamiliar',extra:true})).status,400);
  assert.equal((await post('/api/completions',{query:'x'})).status,400);
  assert.equal((await post('/api/search-suggestions',{})).status,405);
  for(let i=0;i<2;i++){const r=await post('/api/completions',{query:'unfamiliar'});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');await r.json();}
  assert.equal(providerCalls,1);assert.equal(logs.length,1);assert.equal(logs[0].purpose,'autocomplete');
  await server.warmSearch();assert.equal(providerCalls,1,'Startup cache restoration is free');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
