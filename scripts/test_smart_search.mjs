import test from 'node:test';
import assert from 'node:assert/strict';
import {emptySearch,createSearchIndex,interpretSearch,queryFilms,searchParams,searchFromURL} from '../static/cinema-search.js';
import {emptyIntent,validateIntent,conditionId,parseIntent} from '../static/search-intent.js';
import {createSmartSearch,rankSemantic,semanticDocument} from '../src/smart-search.mjs';
import {createSmartSearchUI} from '../static/smart-search-ui.js';

const now=Date.parse('2099-01-01T10:00:00Z');
const session=(id,provider='mooby',time='21:00')=>({id,provider,cinema_id:provider,starts_at:'2099-01-01T'+time+':00+01:00',date:'2099-01-01',time,language:'English',formats:['IMAX']});
const film=(id,extra={})=>({id,title:id,details:{genres:['Comedy'],countries:['France'],languages:['English'],runtime_minutes:110},ratings:{rotten_tomatoes:{score:81,count:100,certified_fresh:true,audience:{score:70}},imdb:{score:7.5}},sessions:[session(id)],...extra});
const programme={generated_at:'2099-01-01T08:00:00Z',cinemas:[{id:'mooby',name:'Balmes',short:'Balmes'},{id:'cinesa',name:'Diagonal Mar',short:'Diagonal Mar'}],films:[
  film('above'),film('boundary',{ratings:{rotten_tomatoes:{score:80,count:100,certified_fresh:false,audience:{score:99}}}}),
  film('few-reviews',{ratings:{rotten_tomatoes:{score:99,count:2}}}),
  film('spanish-french',{details:{genres:['Horror'],countries:['Spain'],languages:['French'],runtime_minutes:150},sessions:[{...session('spanish-french','cinesa'),language:'French'}]}),
  film('unknown',{details:{},ratings:{},sessions:[{...session('unknown'),language:null}]}),
  film('mixed',{sessions:[session('early','mooby','18:00'),session('late','cinesa','21:00')]}),
  film('funny-games',{title:'Funny Games',details:{genres:['Horror']}})
]};
const search=(query,extra={},options={})=>queryFilms(programme,{...emptySearch(),query,...extra},{now,index:createSearchIndex(programme),...options});
const ids=(query,extra)=>search(query,extra).map(f=>f.id).sort();
test('strict rating comparisons preserve boundary, source and unknown values',()=>{
  assert.deepEqual(ids('rt > 80%'),['above','few-reviews','funny-games','mixed','spanish-french']);
  assert(ids('rt >=80').includes('boundary'));
  assert.deepEqual(ids('rt audience >80'),['boundary']);
  assert.deepEqual(ids('good reviews'),['above','boundary','funny-games','mixed','spanish-french']);
  assert.deepEqual(ids('imdb >=7.5').includes('above'),true);
  assert.deepEqual(ids('rt >80% nonsense'),[]);
});
test('origin, language, genres and exclusions use distinct factual fields',()=>{
  assert.deepEqual(ids('from France'),['above','boundary','few-reviews','mixed']);
  assert.deepEqual(ids('in French'),['spanish-french']);
  assert.deepEqual(ids('funny movies'),['above','boundary','few-reviews','mixed']);
  assert.deepEqual(ids('películas divertidas de Francia'),ids('funny movies from France'));
  assert.deepEqual(ids('pel·lícules divertides de França'),ids('funny movies from France'));
  assert(!ids('not horror').includes('unknown'));
  assert.deepEqual(ids('Funny Games'),['funny-games'],'An exact film title must not turn into a genre filter');
});
test('Certified Fresh requires a sourced badge, not a high score',()=>{
  assert.deepEqual(ids('certified fresh'),['above','funny-games','mixed','spanish-french']);
  assert(!ids('certified fresh').includes('few-reviews'));
  assert.deepEqual(ids('not certified fresh'),['boundary']);
});
test('regional production requests do not become countries or service outages',async()=>{
  const api=createSmartSearch({getProgramme:async()=>programme,apiKey:'test',now:()=>now,fetchImpl:()=>assert.fail('Unsupported regional metadata needs no model call')});
  const result=await api.search({query:'from catalunya'});
  assert.equal(result.mode,'local');assert.deepEqual(result.intent.unsupported,['origin:Catalunya']);
  assert.deepEqual(result.intent.conditions,[]);assert.deepEqual(ids('from catalunya'),[]);
});
test('duration, time and chain conditions apply to each matching screening',()=>{
  assert.deepEqual(ids('under two hours from France'),['above','boundary','few-reviews','mixed']);
  const result=search('cinesa after 8pm').find(f=>f.id==='mixed');
  assert.deepEqual(result.sessions.map(s=>s.id),['late']);
  assert(!ids('mooby after 8pm').includes('mixed'));
  assert(search('mooby or cinesa').some(f=>f.id==='mixed'&&f.sessions.length===2));
});
test('removing a parsed filter is shareable and does not change the original query',()=>{
  const filters={...emptySearch(),query:'funny movies rt >80',ignored_filters:[conditionId({field:'rating_rt',op:'gt',value:'80'})]};
  const restored=searchFromURL(searchParams(filters));assert.deepEqual(restored,filters);
  assert(search(restored.query,restored).some(f=>f.id==='boundary'));
  assert(!search(restored.query).some(f=>f.id==='boundary'));
});
test('semantic ranking cannot relax exact constraints',()=>{
  const intent={...emptyIntent(),semantic_query:'uplifting',sort:'relevance',conditions:[{field:'country',op:'eq',value:'France'}]};
  const results=search('uplifting from France',{}, {intent,semanticScores:[{film_id:'spanish-french',score:.9},{film_id:'above',score:.7},{film_id:'boundary',score:.8}]});
  assert.deepEqual(results.map(f=>f.id),['boundary','above']);
  assert.deepEqual(search('uplifting',{}, {intent,semanticScores:[]}),[]);
  assert.equal(rankSemantic([{id:'a'},{id:'b'}],new Map([['a',[1,0]],['b',[0,1]]] ),[1,0]).length,1);
});
test('model interpretations are validated before use',()=>{
  for(const conditions of [[{field:'checkout',op:'eq',value:'yes'}],[{field:'rating_rt',op:'gt',value:'101'}],[{field:'cinema',op:'eq',value:'invented'}],[{field:'date',op:'eq',value:'2099-02-30'}]])assert.throws(()=>validateIntent({...emptyIntent(),conditions},programme));
});
test('AI interprets subjective ratings on the named source without sticky RT defaults',async()=>{
  const p={...programme,films:[film('high-imdb',{ratings:{imdb:{score:9},rotten_tomatoes:{score:20,count:1}}}),film('high-rt',{ratings:{imdb:{score:6},rotten_tomatoes:{score:99,count:100}}})]};
  for(const query of ['highly rated on imdb','good reviews on IMDb','bien valoradas en IMDb','ben valorades a IMDb']){
    assert.deepEqual(interpretSearch(p,{...emptySearch(),query},{index:createSearchIndex(p),now}).conditions,[]);
  }
  let calls=0;
  const intent={...emptyIntent(),conditions:[{field:'rating_imdb',op:'gte',value:'7.5'}],sort:'rating'};
  const api=createSmartSearch({getProgramme:async()=>p,apiKey:'test',dimensions:2,now:()=>now,fetchImpl:async(url,opts)=>{
    const body=JSON.parse(opts.body);
    if(url.endsWith('/embeddings'))return {ok:true,json:async()=>({data:body.input.map((_,index)=>({index,embedding:[1,0]}))})};
    calls++;assert.deepEqual(JSON.parse(body.input).deterministic,[]);
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(intent)}]}]})};
  }});
  const result=await api.search({query:'highly rated on imdb'});
  assert.equal(calls,1);assert.equal(result.mode,'interpreted');assert.deepEqual(result.intent.conditions,intent.conditions);
  assert.deepEqual(queryFilms(p,{...emptySearch(),query:'highly rated on imdb'},{index:createSearchIndex(p),now,intent:result.intent}).map(f=>f.id),['high-imdb']);
  const ordered=queryFilms(p,{...emptySearch()},{index:createSearchIndex(p),now,intent:{...intent,conditions:[{field:'rating_imdb',op:'gte',value:'5'}]}});
  assert.deepEqual(ordered.map(f=>f.id),['high-imdb','high-rt']);
});
test('similarity uses a real catalogue synopsis when the reference film is known',()=>{
  const films=[film('amelie',{title:'Amélie',synopsis:'A shy waitress helps the people around her.'})];
  assert.match(semanticDocument('something like Amelie',films),/shy waitress/);
  assert.equal(semanticDocument('uplifting',films),'uplifting');
  assert.equal(semanticDocument('similar to an unknown film',films),'similar to an unknown film');
});

test('AI calls are bounded, coalesced and reset their quota on a new day',async()=>{
  let stamp=now,calls=0;
  const api=createSmartSearch({getProgramme:async()=>programme,apiKey:'test',dimensions:2,dailyLimit:1,now:()=>stamp,fetchImpl:async(url,opts)=>{
    if(url.endsWith('/embeddings'))return {ok:true,json:async()=>({data:JSON.parse(opts.body).input.map((_,index)=>({index,embedding:[1,0]}))})};
    calls++;await new Promise(done=>setTimeout(done,10));
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(emptyIntent())}]}]})};
  }});
  await Promise.all([api.search({query:'uplifting'}),api.search({query:'uplifting'})]);
  assert.equal(calls,1);
  await assert.rejects(api.search({query:'heartwarming'}),{code:'rate_limited'});
  assert.equal((await api.search({query:'rt >80'})).mode,'local');
  stamp+=86400000;await api.search({query:'heartwarming'});assert.equal(calls,2);
});

test('AI interpretation is cached, embeddings are reused, and local constraints survive',async()=>{
  let requests=[];
  const plan={...emptyIntent(),semantic_query:'uplifting',sort:'relevance'};
  const fetchImpl=async(url,opts)=>{
    const body=JSON.parse(opts.body);requests.push({url,body});
    if(url.endsWith('/embeddings'))return {ok:true,json:async()=>({data:body.input.map((_,index)=>({index,embedding:[1,0]}))})};
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}]})};
  };
  const api=createSmartSearch({getProgramme:async()=>programme,apiKey:'test-key',dimensions:2,fetchImpl,now:()=>now});
  await api.warm();const warmRequests=requests.length;
  const first=await api.search({query:'uplifting from France',language:'en'});
  assert(first.intent.conditions.some(c=>c.field==='country'&&c.value==='France'));
  assert.equal(first.mode,'semantic');assert(first.semantic_scores.length);
  const count=requests.length;const second=await api.search({query:'uplifting from France',language:'en'});
  assert.equal(second.cached,true);assert.equal(requests.length,count);
  await api.warm();assert.equal(requests.length,count);assert.equal(count-warmRequests,2);
  assert.equal(requests.find(r=>r.url.endsWith('/responses')).body.reasoning.effort,'none');
  assert.equal(requests.find(r=>r.url.endsWith('/responses')).body.store,false);
});
test('missing credentials and provider failures preserve the local interpretation',async()=>{
  const offline=createSmartSearch({getProgramme:async()=>programme,apiKey:'',now:()=>now});
  assert.equal((await offline.search({query:'uplifting from France'})).mode,'unavailable');
  assert.equal((await offline.search({query:'rt >80'})).mode,'local');
  const failing=createSmartSearch({getProgramme:async()=>programme,apiKey:'test',now:()=>now,fetchImpl:async()=>({ok:false,status:503})});
  await assert.rejects(failing.search({query:'uplifting'}));
});
test('out-of-order smart responses cannot overwrite a newer query or reset',async()=>{
  let filters={...emptySearch(),query:'uplifting'},resolveResponse,updates=0;
  const ui=createSmartSearchUI({getProgramme:()=>programme,getIndex:()=>createSearchIndex(programme),getFilters:()=>filters,getLanguage:()=> 'en',onResult:()=>updates++,onStatus:()=>{},delay:0,
    fetchImpl:()=>new Promise(resolve=>{resolveResponse=resolve;})});
  ui.update();await new Promise(resolve=>setTimeout(resolve,10));
  filters={...emptySearch(),query:'rt >80'};ui.update();
  resolveResponse({ok:true,json:async()=>({query:'uplifting',intent:emptyIntent(),semantic_scores:null,mode:'interpreted'})});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(ui.current(),null);assert.equal(updates,0);ui.cancel();
});
test('semantic responses tolerate films outside a scoped or older browser catalogue',async()=>{
  const ui=createSmartSearchUI({getProgramme:()=>programme,getIndex:()=>createSearchIndex(programme),getFilters:()=>({...emptySearch(),query:'something uplifting'}),getLanguage:()=> 'en',onResult:()=>{},onStatus:()=>{},delay:0,
    fetchImpl:async()=>({ok:true,json:async()=>({query:'something uplifting',intent:{...emptyIntent(),semantic_query:'uplifting'},semantic_scores:[{film_id:'new-film',score:.9},{film_id:'above',score:.8}],mode:'semantic'})})});
  ui.update();await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(ui.current().semanticScores,[{film_id:'above',score:.8}]);ui.cancel();
});
