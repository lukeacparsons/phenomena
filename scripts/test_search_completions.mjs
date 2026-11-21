import assert from 'node:assert/strict';
import {createCompletionService} from '../src/search-completion.mjs';
let calls=0;const requests=[],usage=[],locales=[];
const entity={kind:'film',entity_id:'film:1',label:'Known Film',query:'Known Film'};
const cat={programme:{generated_at:'2026-11-21'},context:{today:'2026-11-21',catalogue:[],entities:[],verified_searches:[],semantic_searches:[]},entities:[entity],matches:q=>q==='English subtitles',semantic:new Set(['Films about family secrets'])};
const service=createCompletionService({getCatalogue:async language=>{locales.push(language);return cat;},apiKey:'test-only',logUsage:row=>usage.push(row),fetchImpl:async(_url,options)=>{
  calls++;const request=JSON.parse(options.body);assert.equal(request.store,false);assert.equal(request.text.format.strict,true);
  requests.push(request);
  return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({suggestions:[
    {kind:'film',entity_id:'invented',label:'Invented',query:'Invented'},
    {kind:'film',entity_id:'film:1',label:'Known Film',query:'Changed by model'},
    {kind:'query',entity_id:null,label:'English subtitles',query:'English subtitles'},
    {kind:'query',entity_id:null,label:'English subtitles',query:'English subtitles'},
    {kind:'query',entity_id:null,label:'No factual matches',query:'No factual matches'}
  ]})}]}]})};
}});
const first=await service.complete({query:'Eng'});assert.deepEqual(first.suggestions.map(s=>s.query),['Known Film','English subtitles']);
const cached=await service.complete({query:'Eng'});assert.equal(cached.cached,true);assert.equal(calls,1);
await Promise.all([service.complete({query:'En'}),service.complete({query:'En'})]);assert.equal(calls,2,'coalesces concurrent identical requests');
assert.deepEqual(requests[0].input[0],requests[1].input[0],'Stable autocomplete prefix is identical across queries');
assert.equal(requests[0].instructions,undefined);
assert.equal(requests[0].input[0].content[0].prompt_cache_breakpoint.mode,'explicit');
assert.equal(requests[0].input[1].content[0].prompt_cache_breakpoint,undefined,'Changing catalogue retrieval is outside the cache');
assert.notEqual(requests[0].input[1].content[0].text,requests[1].input[1].content[0].text);
assert.equal(usage.length,2);assert.ok(usage.every(row=>row.purpose==='autocomplete'&&row.estimated_cost_usd===null));
await service.complete({query:'cinema',language:'ca'});assert.equal(locales.at(-1),'ca');assert.equal(JSON.parse(requests.at(-1).input[1].content[0].text).language,'ca');
await assert.rejects(service.complete({query:'x'}));await assert.rejects(service.complete({query:'valid',language:'invalid'}));
console.log('PASS: entity validation, canonical labels, factual validation, deduplication, cache, coalescing, input limits.');
