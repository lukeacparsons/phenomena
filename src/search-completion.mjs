import {completionPrompt,completionSchema} from './search-completion-prompt.mjs';
import {normalise} from '../static/cinema-search.js';
import {requestAIJSON} from './ai-usage.mjs';

// Retrieve a small relevant slice for autocomplete; full semantic retrieval is
// performed by the production search backend after a selection is submitted.
function completionContext(cat,query){
  const q=normalise(query),words=q.split(' ').filter(w=>w.length>1&&!['films','film','movies','movie','in','at','the','about','with','some'].includes(w));
  const score=value=>{const s=normalise(value);return (s.startsWith(q)?20:s.includes(q)?10:0)+words.reduce((n,w)=>n+(s.split(' ').some(t=>t.startsWith(w))?3:0),0);};
  const rank=(rows,text,limit)=>rows.map((row,i)=>({row,i,score:score(text(row))})).sort((a,b)=>b.score-a.score||a.i-b.i).slice(0,limit).map(r=>r.row);
  return {today:cat.context.today,timezone:cat.context.timezone,
    catalogue:rank(cat.context.catalogue,row=>row.join(' '),10),
    entities:rank(cat.context.entities,row=>row.label,12),
    verified_searches:rank(cat.context.verified_searches,row=>row,24),
    semantic_searches:rank(cat.context.semantic_searches,row=>row,24)};
}

export function createCompletionService({getCatalogue,apiKey=process.env.OPENAI_API_KEY,
  model=process.env.COMPLETION_MODEL||'gpt-6.2-sol',tier=process.env.COMPLETION_SERVICE_TIER||'ultrafast',fetchImpl=fetch,logUsage}={}) {
  const cache=new Map(),pending=new Map();let active=0,minute=0,calls=0;
  const status=()=>({enabled:Boolean(apiKey),model,tier,cached:cache.size});
  async function complete({query,language='en'}={}) {
    if(typeof query!=='string'||query.trim().length<2||query.length>200||!['en','es','ca'].includes(language))throw Object.assign(new Error('Invalid input'),{status:400});
    if(!apiKey)throw Object.assign(new Error('Autocomplete unavailable'),{status:503});
    query=query.trim();const cat=await getCatalogue();
    const key=JSON.stringify([cat.version||cat.programme.generated_at,cat.context.today,query,language]);
    if(cache.has(key)){
      const saved=cache.get(key),now=Date.now();
      const suggestions=saved.suggestions.filter(row=>row.kind==='query'?(cat.semantic.has(row.query)||cat.matches(row.query)):
        cat.entities.some(e=>e.entity_id===row.entity_id&&(!e.valid_until||e.valid_until>=now)));
      return {...saved,suggestions,cached:true};
    }
    if(pending.has(key))return pending.get(key);
    const nowMinute=Math.floor(Date.now()/60000);if(minute!==nowMinute){minute=nowMinute;calls=0;}
    if(active>=3||calls>=60)throw Object.assign(new Error('Autocomplete busy'),{status:429});
    active++;calls++;
    const work=(async()=>{
      const start=performance.now();
      const body=await requestAIJSON({fetchImpl,apiKey,endpoint:'responses',timeoutMs:5000,logUsage,purpose:'autocomplete',operation:'completion',
        body:{model,service_tier:tier,reasoning:{effort:model.includes('sol')?'low':'none'},store:false,max_output_tokens:700,
          prompt_cache_options:{mode:'explicit',ttl:'30m'},
          input:[
            {role:'developer',content:[{type:'input_text',text:completionPrompt,prompt_cache_breakpoint:{mode:'explicit'}}]},
            {role:'user',content:[{type:'input_text',text:JSON.stringify({...completionContext(cat,query),language,partial_query:query})}]}
          ],
          text:{format:{type:'json_schema',name:'cinema_completions',strict:true,schema:completionSchema}}}
      });
      if(body.status!=='completed')throw new Error('Incomplete autocomplete');
      const parsed=JSON.parse(body.output?.flatMap(o=>o.content||[]).filter(o=>o.type==='output_text').map(o=>o.text).join('')||'null');
      if(!Array.isArray(parsed?.suggestions)||parsed.suggestions.length>5)throw new Error('Invalid autocomplete');
      const suggestions=[],seen=new Set();
      for(const item of parsed.suggestions){
        if(typeof item.query!=='string'||typeof item.label!=='string'||item.query.length>200||item.label.length>80)continue;
        let row;
        if(item.kind!=='query'){
          row=cat.entities.find(e=>e.kind===item.kind&&e.entity_id===item.entity_id&&(!e.valid_until||e.valid_until>=Date.now()));
          if(!row||row.label!==item.label)continue;
        } else {
          if(item.entity_id!==null||item.label!==item.query)continue;
          if(!cat.semantic.has(item.query)&&!cat.matches(item.query))continue;
          row={kind:'query',query:item.query,label:item.label,entity_id:null};
        }
        const normalized=normalise(row.query);if(!normalized||seen.has(normalized)||normalized===normalise(query))continue;
        seen.add(normalized);suggestions.push({...row,source:'llm'});
      }
      const result={query,suggestions,model,elapsed_ms:Math.round(performance.now()-start),cached:false};
      cache.set(key,result);if(cache.size>250)cache.delete(cache.keys().next().value);
      console.log(JSON.stringify({event:'completion',count:suggestions.length,ms:result.elapsed_ms,model}));
      return result;
    })().finally(()=>{active--;pending.delete(key);});
    pending.set(key,work);return work;
  }
  return {complete,status};
}
