import {interpretSearch,madridDate,normalise} from './cinema-search.js';
import {validateIntent} from './search-intent.js';
import {parseLocationQuery} from './location-search.js';

export function createSmartSearchUI({getProgramme,getIndex,getFilters,getLanguage,onResult,onStatus,fetchImpl=fetch,delay=350}){
  const cache=new Map();
  let timer=null,controller=null,key='',result=null,request=0;
  function current(){return result;}
  function cancel(){clearTimeout(timer);timer=null;controller?.abort();controller=null;request++;}
  function update(){
    const programme=getProgramme(),index=getIndex(),filters=getFilters(),language=getLanguage();
    const query=parseLocationQuery(filters.query,{titles:index?.titles}).text;
    const nextKey=JSON.stringify([query,language,programme?.generated_at,madridDate()]);
    if(nextKey===key)return;
    cancel();key=nextKey;result=null;onStatus('');
    if(!programme||!query||query.length<3)return;
    const local=interpretSearch(programme,filters,{index});
    if(local.unsupported.length){onStatus('unsupported',local.unsupported);return;}
    if(!local.text||index.titles.has(normalise(query)))return;
    // A keyword hit must not prevent semantic discovery of other relevant films.
    // Full, known credit names already have a precise local interpretation.
    if(index.people.includes(normalise(local.text)))return;
    if(cache.has(key)){result=cache.get(key);onStatus(result.intent.unsupported.length?'unsupported':'',result.intent.unsupported);onResult();return;}
    const version=request;
    timer=setTimeout(async()=>{
      timer=null;controller=new AbortController();const activeController=controller;
      const deadline=setTimeout(()=>activeController.abort(),6000);onStatus('loading');
      try{
        const response=await fetchImpl('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,language}),signal:activeController.signal});
        if(!response.ok)throw new Error('Search unavailable');
        const body=await response.json();
        if(version!==request)return;
        if(body.query!==query||body.mode==='unavailable')throw new Error('Search unavailable');
        const intent=validateIntent(body.intent,programme);
        const ids=new Set(programme.films.map(f=>f.id));
        if(body.semantic_scores!==null&&(!Array.isArray(body.semantic_scores)||body.semantic_scores.length>1000||body.semantic_scores.some(r=>typeof r?.film_id!=='string'||!Number.isFinite(r.score)||Math.abs(r.score)>1.00001)))throw new Error('Invalid semantic results');
        // A venue page contains a subset, and a publication can change while
        // the request is in flight. Only rank films in the current browser data.
        result={intent,semanticScores:body.semantic_scores?.filter(r=>ids.has(r.film_id))??null};cache.set(key,result);if(cache.size>50)cache.delete(cache.keys().next().value);
        onStatus(intent.unsupported.length?'unsupported':intent.semantic_query&&!body.semantic_scores?.length?'noSemantic':'',intent.unsupported);onResult();
      }catch{
        if(version!==request)return;
        result=null;onStatus('unavailable');onResult();
      }finally{clearTimeout(deadline);if(controller===activeController)controller=null;}
    },delay);
  }
  return {current,update,cancel,reset(){cancel();key='';result=null;onStatus('');}};
}
