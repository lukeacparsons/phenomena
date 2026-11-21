import {appendFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

// Public list prices checked 2026-11-21. Estimates, not billing reconciliation.
// Unknown models/tiers deliberately have no dollar estimate. Raw usage remains.
export function estimateUsageCost({model,tier,input,output,read,write30,write12,at}){
  if([input,output,read,write30,write12].some(n=>!Number.isFinite(n)||n<0)||read+write30+write12>input)return null;
  if(model==='text-embedding-3-large'||model==='text-embedding-3-small')return input*(model.endsWith('large')?0.13:0.02)/1e6;
  if(!/^gpt-6\.2-sol(?:-\d{4}-\d{2}-\d{2})?$/.test(model))return null;
  const speed={standard:1,default:1,fast:2,priority:2,ultrafast:Date.parse(at)<Date.parse('2027-03-01T08:00:00Z')?3:6}[tier];
  if(!speed)return null;
  const inputRate=2*speed*(input>272000?2:1),outputRate=10*speed*(input>272000?1.5:1);
  return ((input-read-write30-write12)*inputRate+read*inputRate*0.05+write30*inputRate*1.25+write12*inputRate*2.5+output*outputRate)/1e6;
}
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
export function usageRecord({purpose,operation,body,data,response,duration,attempt=1,at=new Date().toISOString()}){
  const usage=data?.usage,details=usage?.input_tokens_details||{},lifetimes=details.cache_write_tokens_details;
  const input=count(usage?.input_tokens??usage?.prompt_tokens),output=usage?count(usage.output_tokens??0):null;
  const read=usage?count(details.cached_tokens??0):null,write=usage?count(details.cache_write_tokens??0):null;
  const write30=lifetimes?count(lifetimes.ttl_30m_tokens):body.prompt_cache_options?.ttl==='12h'?0:write;
  const write12=lifetimes?count(lifetimes.ttl_12h_tokens):body.prompt_cache_options?.ttl==='12h'?write:0;
  const model=typeof data?.model==='string'?data.model:body.model,tier=data?.service_tier||body.service_tier||'standard';
  const estimate=write!==null&&write30!==null&&write12!==null&&write30+write12===write?
    estimateUsageCost({model,tier,input,output,read,write30,write12,at}):null;
  return {event:'ai_usage',at,purpose,operation,model,requested_model:body.model,service_tier:tier,
    provider_status:response?.status??null,provider_request_id:response?.headers?.get?.('x-request-id')||null,
    attempt,duration_ms:Math.round(duration),usage_reported:Boolean(usage),
    input_tokens:input,output_tokens:output,cache_read_tokens:read,cache_write_tokens:write,
    cache_write_30m_tokens:write30,cache_write_12h_tokens:write12,
    reasoning_tokens:count(usage?.output_tokens_details?.reasoning_tokens),
    estimated_cost_usd:estimate===null?null:Number(estimate.toFixed(9)),price_basis:'openai-public-list-2026-11-21'};
}
export function createUsageLogger({file,logger=console.info}={}){
  let pending=Promise.resolve();
  return async record=>{
    const line=JSON.stringify(record);logger(line);
    if(file){
      pending=pending.catch(()=>{}).then(async()=>{await mkdir(dirname(file),{recursive:true});await appendFile(file,line+'\n',{mode:0o600});});
      try{await pending;}catch{console.error(JSON.stringify({event:'ai_usage_log_failed'}));}
    }
  };
}
const defaultLogger=createUsageLogger({file:process.env.AI_USAGE_LOG});
// Record every provider attempt, including retries, invalid model output and
// errors. Missing usage stays null; never invent zero cost after a timeout.
export async function requestAIJSON({fetchImpl=fetch,apiKey,endpoint,body,timeoutMs,purpose,operation,attempt,logUsage=defaultLogger}){
  const start=performance.now();let response,data;
  try{
    response=await fetchImpl('https://api.openai.com/v1/'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
    data=typeof response.json==='function'?await response.json():null;
    if(!response.ok)throw Object.assign(new Error('Search provider unavailable'),{code:'provider_unavailable',status:response.status,providerStatus:response.status});
    return data;
  }finally{
    try{await logUsage(usageRecord({purpose,operation,body,data,response,duration:performance.now()-start,attempt}));}
    catch{console.error(JSON.stringify({event:'ai_usage_log_failed'}));}
  }
}
