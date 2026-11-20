// Small opt-in live benchmark. Never writes or prints API credentials.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {INTENT_SCHEMA,INTERPRETER_INSTRUCTIONS} from '../src/smart-search.mjs';
import {validateIntent} from '../static/search-intent.js';
const programme=JSON.parse(await readFile('static/preview-data/screenings.json','utf8'));
const models=process.argv.slice(2).length?process.argv.slice(2):['gpt-6-luna','gpt-6.2-sol'];
const cases=[
  {query:'Something uplifting at Mooby, but not horror',check:p=>Boolean(p.semantic_query)&&p.conditions.some(c=>c.field==='genre'&&c.op==='ne')&&p.conditions.some(c=>c.field==='provider'&&c.value==='mooby')},
  {query:'Una comedia producida en Francia, con RT por encima de 80 y menos de dos horas',check:p=>p.conditions.some(c=>c.field==='country'&&c.value==='France')&&p.conditions.some(c=>c.field==='rating_rt'&&c.op==='gt'&&c.value==='80')&&p.conditions.some(c=>c.field==='duration'&&c.value==='120')},
  {query:'Una pel·lícula semblant a Amélie, demà després de les 20:00',check:p=>Boolean(p.semantic_query)&&p.conditions.some(c=>c.field==='start_time'&&c.value==='1200')&&p.conditions.some(c=>c.field==='date')}
];
const context={today:'2026-11-20',providers:[...new Set(programme.films.flatMap(f=>f.sessions.map(s=>s.provider)))],cinemas:programme.cinemas.map(c=>({id:c.id,name:c.name,short:c.short})),formats:['IMAX','Dolby Atmos','35mm','70mm']};
const results=[];
for(const sample of cases){
  await Promise.all(models.map(async model=>{
    const start=performance.now();
    try{
      const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({model,service_tier:model.includes('sol')?'ultrafast':'fast',reasoning:{effort:model.includes('sol')?'low':'none'},store:false,max_output_tokens:900,instructions:INTERPRETER_INSTRUCTIONS,input:JSON.stringify({...context,query:sample.query,deterministic:[]}),text:{format:{type:'json_schema',name:'cinema_search',strict:true,schema:INTENT_SCHEMA}}})});
      const data=await response.json();
      if(!response.ok||data.status!=='completed')throw new Error('HTTP '+response.status+' '+(data.error?.code||data.status));
      const plan=validateIntent(JSON.parse(data.output.flatMap(i=>i.content||[]).filter(i=>i.type==='output_text').map(i=>i.text).join('')),programme);
      results.push({model,query:sample.query,ms:Math.round(performance.now()-start),passed:sample.check(plan),plan});
    }catch(error){results.push({model,query:sample.query,ms:Math.round(performance.now()-start),passed:false,error:error.message});}
  }));
}
await mkdir('output/smart-search',{recursive:true});
await writeFile('output/smart-search/model-benchmark.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
if(!models.some(model=>results.filter(r=>r.model===model).every(r=>r.passed)))process.exitCode=1;
