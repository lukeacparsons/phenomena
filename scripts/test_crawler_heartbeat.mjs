import assert from 'node:assert/strict';
import test from 'node:test';
import policy from '../data/crawler-policy.json' with {type:'json'};
import {receiveHeartbeat} from '../src/crawler-heartbeat.mjs';

const now=Date.parse('2026-11-19T20:00:00Z');
const health=()=>({schema_version:1,checked_at:new Date(now).toISOString(),
  cinemas:policy.cinemas.map(c=>({id:c.id,last_success:new Date(now).toISOString(),consecutive_failures:0}))});
const request=(body=health(),token='test-secret',path='/heartbeat',method='POST')=>new Request('https://worker.example'+path,
  {method,headers:{Authorization:'Bearer '+token},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
function env(previous=null){return {HEARTBEAT_TOKEN:'test-secret',writes:[],KV:{get:async()=>previous,
  put:async function(...args){this.writes.push(args)},writes:[]}};}

test('only the authenticated heartbeat route can update the fixed health key',async()=>{
  const e=env();
  for(const r of [request(health(),'wrong'),request(health(),'test-secret','/other'),request(null,'test-secret','/heartbeat','GET')])
    assert((await receiveHeartbeat(r,e,now)).status>=400);
  assert.equal(e.KV.writes.length,0);
  const response=await receiveHeartbeat(request(),e,now);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,checked_at:health().checked_at});
  assert.equal(e.KV.writes[0][0],'vobarna:crawler-health');assert.deepEqual(JSON.parse(e.KV.writes[0][1]),health());
});
test('oversized, malformed, incomplete and duplicate venue reports are rejected',async()=>{
  const e=env();
  for(const body of ['x'.repeat(65537),'not json',{...health(),cinemas:[]},
    {...health(),cinemas:health().cinemas.map(()=>health().cinemas[0])}])
    assert.equal((await receiveHeartbeat(request(body),e,now)).status,400);
  assert.equal(e.KV.writes.length,0);
});
test('stale, future and rolled-back receipts never replace current health',async()=>{
  for(const offset of [-300001,60001]){
    const e=env();assert.equal((await receiveHeartbeat(request({...health(),checked_at:new Date(now+offset).toISOString()}),e,now)).status,400);
    assert.equal(e.KV.writes.length,0);
  }
  const e=env({...health(),checked_at:new Date(now+1000).toISOString()});
  assert.equal((await receiveHeartbeat(request(),e,now)).status,409);assert.equal(e.KV.writes.length,0);
});
test('unhealthy source reports are accepted so the watchdog can alert',async()=>{
  const e=env(),h=health();h.cinemas[0].last_success='2020-01-01T00:00:00Z';h.cinemas[0].consecutive_failures=5;
  assert.equal((await receiveHeartbeat(request(h),e,now)).status,200);
  assert.equal(JSON.parse(e.KV.writes[0][1]).cinemas[0].consecutive_failures,5);
});
test('storage failures are not acknowledged as delivered',async()=>{
  const e=env();e.KV.put=async()=>{throw new Error('private backend diagnostic')};
  const result=await receiveHeartbeat(request(),e,now);
  assert.equal(result.status,503);assert.deepEqual(await result.json(),{error:'storage_unavailable'});
});
