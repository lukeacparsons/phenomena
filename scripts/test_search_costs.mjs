import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSmartSearch} from '../src/smart-search.mjs';
import {createSmartSearchUI} from '../static/smart-search-ui.js';
import {emptyIntent} from '../static/search-intent.js';
import {createSearchIndex,emptySearch,queryFilms} from '../static/cinema-search.js';

const now=Date.parse('2099-01-01T10:00:00Z');
const programme={generated_at:'fixture',cinemas:[{id:'verdi',name:'Verdi',short:'Verdi'}],films:[{
  id:'hunger',title:'The Hunger Games: Mockingjay',details:{genres:['Drama']},synopsis:'A civil war divides a country.',
  sessions:[{id:'one',cinema_id:'verdi',starts_at:'2099-01-01T20:00:00+01:00',date:'2099-01-01',time:'20:00',language:'English'}]
}]};
const response=plan=>({ok:true,status:200,json:async()=>({status:'completed',usage:{input_tokens:10000,output_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:8000}},output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}]})});
const embeddings=body=>({ok:true,status:200,json:async()=>({usage:{prompt_tokens:100},data:body.input.map((_,index)=>({index,embedding:[1,0]}))})});
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));

test('trusted precomputed phrases bypass the backend provider; arbitrary keyword hits still use it',async()=>{
  let calls=0;const logs=[];
  const api=createSmartSearch({getProgramme:async()=>programme,apiKey:'test',dimensions:2,now:()=>now,
    isPrecomputedQuery:q=>q==='Hunger Games in English',logUsage:r=>logs.push(r),
    fetchImpl:async(url,options)=>{calls++;return url.endsWith('/embeddings')?embeddings(JSON.parse(options.body)):response({...emptyIntent(),semantic_query:'civil war',film_matches:[0]});}});
  const result=await api.search({query:'Hunger Games in English'});
  assert.equal(result.mode,'local');assert.equal(calls,0);assert.equal(logs.length,0);
  assert.deepEqual(queryFilms(programme,{...emptySearch(),query:result.query},{now,intent:result.intent}).map(f=>f.id),['hunger']);
  assert.equal((await api.search({query:'civil war'})).mode,'semantic');assert.ok(calls>0);
  await assert.rejects(api.search({query:'civil war',isPrecomputedQuery:true}),{code:'invalid_input'},'Clients cannot opt arbitrary queries out of interpretation');
});
test('selecting a verified phrase cancels late semantic results and makes no new browser request',async()=>{
  let query='civil war',finish,calls=0,updates=0,valid=true;
  const ui=createSmartSearchUI({getProgramme:()=>programme,getIndex:()=>createSearchIndex(programme),getFilters:()=>({...emptySearch(),query}),getLanguage:()=> 'en',delay:0,
    isPrecomputedQuery:q=>valid&&q==='Hunger Games in English',onStatus:()=>{},onResult:()=>updates++,
    fetchImpl:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  ui.update();await pause();assert.equal(calls,1);
  query='Hunger Games in English';ui.update();await pause();assert.equal(calls,1);
  finish({ok:true,json:async()=>({query:'civil war',mode:'semantic',intent:{...emptyIntent(),semantic_query:'civil war'},semantic_scores:[{film_id:'hunger',score:1}]})});
  await pause();assert.equal(ui.current(),null);assert.equal(updates,0,'Old model response cannot replace local results');
  valid=false;ui.update();await pause();assert.equal(calls,2,'Expired validation is not retained in the browser key');ui.cancel();
});
test('changing query, language and day reuses the stable prefix; changing catalogue invalidates it',async()=>{
  const requests=[];let p=programme,stamp=now;
  const api=createSmartSearch({getProgramme:async()=>p,apiKey:'test',dimensions:2,now:()=>stamp,logUsage:()=>{},fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);if(url.endsWith('/embeddings'))return embeddings(body);
    requests.push(body);return response({...emptyIntent(),semantic_query:'family conflict',film_matches:[0]});
  }});
  await api.search({query:'family secrets',language:'en'});stamp+=86400000;
  await api.search({query:'complicated families',language:'ca'});
  assert.deepEqual(requests[0].input.slice(0,2),requests[1].input.slice(0,2));
  assert.notDeepEqual(requests[0].input[2],requests[1].input[2]);
  for(const body of requests){
    assert.equal(body.instructions,undefined,'Reusable instructions belong before the cache boundary');
    assert.deepEqual(body.prompt_cache_options,{mode:'explicit',ttl:'30m'});
    assert.equal(body.input[1].role,'user','Catalogue stays reference data');
    assert.ok(body.input[1].content[0].prompt_cache_breakpoint);
    assert.equal(body.input[2].content[0].prompt_cache_breakpoint,undefined,'Unique tails are never cache writes');
  }
  p={...programme,films:[{...programme.films[0],title:'Updated title'}]};
  await api.search({query:'family secrets',language:'en'});
  assert.notDeepEqual(requests[0].input[1],requests[2].input[1]);
});
test('startup only restores disk cache; explicit warm-up and retries have distinct usage records',async()=>{
  const cacheDirectory=await mkdtemp(join(tmpdir(),'vobarna-search-costs-'));
  try{
    let requests=0;const logs=[];
    const options={getProgramme:async()=>programme,apiKey:'test',dimensions:2,now:()=>now,cacheDirectory,logUsage:r=>logs.push(r)};
    const api=createSmartSearch({...options,fetchImpl:async(url,options)=>{
      const body=JSON.parse(options.body);if(url.endsWith('/embeddings'))return embeddings(body);
      requests++;return response(requests===1?{bad:'invalid intent'}:{...emptyIntent(),semantic_query:'uplifting',film_matches:[0]});
    }});
    await api.warm();assert.equal(logs.length,0);
    await api.warm({refresh:true});assert.ok(logs.every(r=>r.purpose==='warmup'));
    const restored=createSmartSearch({...options,fetchImpl:()=>assert.fail('Restoring saved vectors cannot call the provider')});
    await restored.warm();assert.ok(restored.status().cached_documents>0);
    await api.search({query:'uplifting'});assert.equal(requests,2);
    const attempts=logs.filter(r=>r.operation==='interpretation');
    assert.deepEqual(attempts.map(r=>[r.purpose,r.attempt]),[['search',1],['search',2]]);
    assert.ok(attempts.every(r=>r.usage_reported&&r.estimated_cost_usd>0));
    const count=logs.length;await api.search({query:'uplifting'});assert.equal(logs.length,count,'Application-cache hits create no provider usage');
  }finally{await rm(cacheDirectory,{recursive:true,force:true});}
});
