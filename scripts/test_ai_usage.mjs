import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {estimateUsageCost,usageRecord,requestAIJSON,createUsageLogger} from '../src/ai-usage.mjs';

const at='2026-11-21T12:00:00Z';
const rates={model:'gpt-6.2-sol',tier:'ultrafast',input:10000,output:100,read:6000,write30:2000,write12:0,at};
test('cost estimate replaces ordinary input with cache rates without double-counting',()=>{
  assert.equal(estimateUsageCost(rates),.0318); // .012 input + .0018 reads + .015 writes + .003 output
  assert.equal(estimateUsageCost({...rates,write30:0,write12:2000}),.0468);
  assert.equal(estimateUsageCost({...rates,at:'2027-03-01T08:00:00Z'}),.0636);
  assert.equal(estimateUsageCost({...rates,model:'text-embedding-3-large',input:10000,output:0,read:0,write30:0}),.0013);
  assert.equal(estimateUsageCost({...rates,model:'unknown'}),null);
  assert.equal(estimateUsageCost({...rates,tier:'unknown'}),null);
  assert.equal(estimateUsageCost({...rates,write30:9000}),null);
  assert.equal(estimateUsageCost({...rates,input:null}),null);
  assert.equal(estimateUsageCost({...rates,input:300000,read:0,write30:0}),3.6045);
});
test('records actual provider tier, cache lifetime and request ID without request text',()=>{
  const record=usageRecord({purpose:'search',operation:'interpretation',at,duration:12,body:{model:'gpt-6.2-sol',service_tier:'ultrafast',input:'private query'},
    data:{model:'gpt-6.2-sol',service_tier:'standard',usage:{input_tokens:10000,output_tokens:100,input_tokens_details:{cached_tokens:6000,cache_write_tokens:2000,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:2000}},output_tokens_details:{reasoning_tokens:50}}},
    response:{status:200,headers:new Headers({'x-request-id':'req-test'})}});
  assert.equal(record.estimated_cost_usd,.0156);assert.equal(record.cache_write_12h_tokens,2000);
  assert.equal(record.reasoning_tokens,50);assert.equal(record.provider_request_id,'req-test');
  assert.ok(!JSON.stringify(record).includes('private query'));
});
test('provider errors and timeouts record unknown cost rather than zero',async()=>{
  const logs=[],options={apiKey:'secret',endpoint:'responses',body:{model:'gpt-6.2-sol',input:'private query'},timeoutMs:100,purpose:'autocomplete',operation:'completion',logUsage:r=>logs.push(r)};
  await assert.rejects(requestAIJSON({...options,fetchImpl:async()=>({ok:false,status:429,json:async()=>({error:{message:'private query'}})})}),{providerStatus:429});
  await assert.rejects(requestAIJSON({...options,fetchImpl:async()=>{throw new Error('timeout');}}));
  assert.equal(logs.length,2);
  for(const row of logs){assert.equal(row.usage_reported,false);assert.equal(row.estimated_cost_usd,null);assert.equal(row.input_tokens,null);}
  assert.ok(!JSON.stringify(logs).includes('secret'));assert.ok(!JSON.stringify(logs).includes('private query'));
});
test('concurrent usage records persist as private, valid JSONL',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'vobarna-ai-usage-'));
  try{
    const file=join(directory,'usage.jsonl'),logger=createUsageLogger({file,logger:()=>{}});
    await Promise.all(Array.from({length:12},(_,i)=>logger({event:'ai_usage',attempt:i})));
    const rows=(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(r=>r.attempt),Array.from({length:12},(_,i)=>i));
    assert.equal((await stat(file)).mode&0o777,0o600);
  }finally{await rm(directory,{recursive:true,force:true});}
});
