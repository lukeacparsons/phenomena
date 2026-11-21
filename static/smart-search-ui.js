import {interpretSearch,madridDate,normalise} from './cinema-search.js';
import {validateIntent} from './search-intent.js';
import {parseLocationQuery} from './location-search.js';

export function createSmartSearchUI({getProgramme,getIndex,getFilters,getLanguage,onResult,onStatus,onMetrics=()=>{},fetchImpl=fetch,delay=350,isPrecomputedQuery=()=>false}){
  const cache=new Map();
  let timer=null,controller=null,key='',result=null,request=0;
  function current(){return result;}
  function cancel(){clearTimeout(timer);timer=null;controller?.abort();controller=null;request++;key='';onStatus('');}
  function update(){
    const programme=getProgramme(),index=getIndex(),filters=getFilters(),language=getLanguage();
    const query=parseLocationQuery(filters.query,{titles:index?.titles}).text;
    const precomputed=Boolean(programme&&isPrecomputedQuery(filters.query,programme));
    const nextKey=JSON.stringify([query,language,programme?.generated_at,madridDate(),precomputed]);
    if(nextKey===key)return;
    cancel();key=nextKey;result=null;
    if(!programme||!query||query.length<3)return;
    const local=interpretSearch(programme,filters,{index});
    if(local.unsupported.length){onStatus('unsupported',local.unsupported);return;}
    if(precomputed&&!local.semantic_query&&!local.venue_query)return;
    if(!local.text||index.titles.has(normalise(query)))return;
    // A keyword hit must not prevent semantic discovery of other relevant films.
    // Full, known credit names already have a precise local interpretation.
    if(index.people.includes(normalise(local.text)))return;
    function report(outcome,duration,cacheHit){
      // Counts and fixed outcomes only: the query/intent can contain addresses.
      // Telemetry must never change the search result if a consumer fails.
      try{onMetrics({outcome,duration_ms:Math.max(0,Math.round(duration)),query_length:query.length,
        semantic_result_count:result?.semanticScores?.length??null,
        unsupported_count:result?.intent.unsupported.length??0,cache_hit:cacheHit});}catch{}
    }
    const outcome=()=>result.intent.unsupported.length?'unsupported':result.intent.semantic_query&&!result.semanticScores?.length?'no_semantic_results':'success';
    if(cache.has(key)){result=cache.get(key);onStatus(result.intent.unsupported.length?'unsupported':'',result.intent.unsupported);onResult();report(outcome(),0,true);return;}
    const version=request;
    onStatus('loading');
    timer=setTimeout(async()=>{
      timer=null;controller=new AbortController();const activeController=controller;
      const started=performance.now();
      const deadline=setTimeout(()=>activeController.abort(),6000);
      try{
        const response=await fetchImpl('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,language}),signal:activeController.signal});
        if(!response.ok)throw new Error('Search unavailable');
        const body=await response.json();
        if(version!==request)return;
        if(body.query!==query||body.mode==='unavailable')throw new Error('Search unavailable');
        const intent=validateIntent(body.intent,programme);
        const ids=new Set([...programme.films,...(programme.search?.films||[])].map(f=>f.id));
        if(body.semantic_scores!==null&&(!Array.isArray(body.semantic_scores)||body.semantic_scores.length>1000||body.semantic_scores.some(r=>typeof r?.film_id!=='string'||!Number.isFinite(r.score)||Math.abs(r.score)>1.00001)))throw new Error('Invalid semantic results');
        // A venue page contains a subset, and a publication can change while
        // the request is in flight. Only rank films in the current browser data.
        result={intent,semanticScores:body.semantic_scores?.filter(r=>ids.has(r.film_id))??null};cache.set(key,result);if(cache.size>50)cache.delete(cache.keys().next().value);
        onStatus(intent.unsupported.length?'unsupported':intent.semantic_query&&!body.semantic_scores?.length?'noSemantic':'',intent.unsupported);onResult();
        report(outcome(),performance.now()-started,false);
      }catch{
        if(version!==request)return;
        result=null;onStatus('unavailable');onResult();
        report(activeController.signal.aborted?'timeout':'unavailable',performance.now()-started,false);
      }finally{clearTimeout(deadline);if(controller===activeController)controller=null;}
    },delay);
  }
  return {current,update,cancel,reset(){cancel();key='';result=null;}};
}
