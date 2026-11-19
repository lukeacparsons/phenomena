import test from 'node:test';
import assert from 'node:assert/strict';
import policy from '../data/crawler-policy.json' with {type:'json'};
import {evaluateHealth,alertPlan,monitorCrawler,sendTelegram,HEALTH_KEY,ALERT_KEY,TEST_KEY} from '../src/crawler-watchdog.mjs';

const NOW=Date.parse('2026-11-19T12:00:00Z');
function beacon(){return {schema_version:1,checked_at:new Date(NOW).toISOString(),cinemas:policy.cinemas.map(c=>({id:c.id,last_success:new Date(NOW).toISOString(),consecutive_failures:0}))};}
function kv(initial={}){const records=structuredClone(initial);return {records,async get(k){return structuredClone(records[k]??null);},async put(k,v){records[k]=JSON.parse(v);}};}
const telegram={TELEGRAM_BOT_TOKEN:'dummy-test-token',TELEGRAM_CHAT_ID:'test-chat',TELEGRAM_TOPIC_ID:'123'};
function success(){return Response.json({ok:true,result:{message_id:5}});}

test('staleness uses individual source dates; empty programmes remain healthy',()=>{
  const b=beacon();assert.deepEqual(evaluateHealth(b,NOW).issues,{});
  b.cinemas[0].last_success=new Date(NOW-6*3600000).toISOString();
  assert.equal(evaluateHealth(b,NOW).issues[b.cinemas[0].id].severity,'warning');
  b.cinemas[0].last_success=new Date(NOW-24*3600000).toISOString();
  assert.equal(evaluateHealth(b,NOW).issues[b.cinemas[0].id].severity,'critical');
});
test('dead publisher, missing cinema, naive and future timestamps are detected',()=>{
  const b=beacon();b.checked_at=new Date(NOW-3600000).toISOString();
  assert.equal(evaluateHealth(b,NOW).issues.monitor.reason,'heartbeat_stale');
  b.cinemas.pop();assert.equal(evaluateHealth(b,NOW).valid,false);
  const malformed=beacon();malformed.cinemas[0]=null;assert.equal(evaluateHealth(malformed,NOW).valid,false);
  const bad=beacon();bad.cinemas[0].last_success='2026-11-19T12:00:00';
  assert.equal(evaluateHealth(bad,NOW).issues[bad.cinemas[0].id].severity,'critical');
  bad.checked_at=new Date(NOW+3600000).toISOString();assert.equal(evaluateHealth(bad,NOW).valid,false);
});
test('three failures alert, a single transient failure does not',()=>{
  const b=beacon();b.cinemas[0].consecutive_failures=1;assert.deepEqual(evaluateHealth(b,NOW).issues,{});
  b.cinemas[0].consecutive_failures=3;assert.equal(Object.values(evaluateHealth(b,NOW).issues)[0].reason,'repeated_collection_failure');
});
test('a collector stuck or killed mid-run is detected even with a live publisher',()=>{
  const b=beacon();b.last_run={status:'running',started_at:new Date(NOW-3600000).toISOString()};
  assert.equal(evaluateHealth(b,NOW).issues.publication.reason,'collection_not_finished');
});
test('malformed health JSON triggers an alert instead of crashing the monitor',async()=>{
  const storage=kv();const original=storage.get;
  storage.get=async key=>{if(key===HEALTH_KEY)throw new SyntaxError('invalid JSON');return original(key);};
  const state=await monitorCrawler({...telegram,KV:storage},{now:NOW,fetcher:async()=>success()});
  assert.equal(state.open.monitor.reason,'missing_or_invalid_health_report');
});
test('alerts deduplicate, escalate, remind daily and recover once',()=>{
  const issue={id:'a',name:'A',severity:'warning',reason:'stale'};
  let plan=alertPlan({}, {valid:true,issues:{a:issue}},NOW);assert.equal(plan.send,true);
  const state={open:plan.issues,last_sent_at:new Date(NOW).toISOString()};
  assert.equal(alertPlan(state,{valid:true,issues:{a:issue}},NOW+3600000).send,false);
  assert.equal(alertPlan(state,{valid:true,issues:{a:issue}},NOW+24*3600000).send,true);
  assert.equal(alertPlan(state,{valid:true,issues:{a:{...issue,severity:'critical'}}},NOW+1000).send,true);
  plan=alertPlan(state,{valid:true,issues:{}},NOW+1000);assert.deepEqual(plan.recovered,['a']);assert.equal(plan.send,true);
  assert.equal(alertPlan({open:{},last_sent_at:new Date(NOW).toISOString()},{valid:true,issues:{}},NOW+2000).send,false);
});
test('an invalid beacon cannot produce false recoveries',()=>{
  const old={open:{a:{id:'a',severity:'warning',reason:'stale'}}};
  const plan=alertPlan(old,evaluateHealth(null,NOW),NOW);
  assert.deepEqual(plan.recovered,[]);assert(plan.issues.a);assert(plan.issues.monitor);
});
test('Telegram HTTP and API-level failures are both failures',async()=>{
  for(const response of [new Response('bad',{status:429}),Response.json({ok:false}),new Response('bad json')]){
    await assert.rejects(sendTelegram(telegram,'Test',async()=>response));
  }
  await assert.rejects(sendTelegram(telegram,'Test',async()=>new Response('x'.repeat(70000))));
});
test('failed delivery is retried without falsely marking the issue sent',async()=>{
  const b=beacon();b.cinemas[0].consecutive_failures=3;
  const env={...telegram,KV:kv({[HEALTH_KEY]:b})};
  let calls=0;
  await monitorCrawler(env,{now:NOW,fetcher:async()=>{calls++;return Response.json({ok:false});}});
  assert.equal(env.KV.records[ALERT_KEY].last_sent_at,undefined);
  assert.equal(env.KV.records[ALERT_KEY].open,undefined);
  await monitorCrawler(env,{now:NOW+1000,fetcher:async()=>{calls++;return success();}});
  assert.equal(calls,2);assert.equal(env.KV.records[ALERT_KEY].delivery_status,'ok');
  await monitorCrawler(env,{now:NOW+2000,fetcher:async()=>{throw new Error('Duplicate send');}});
  assert.equal(env.KV.records[ALERT_KEY].delivery_status,'ok');
});
test('rollback of a heartbeat is detected and preserves open issues',async()=>{
  const env={...telegram,KV:kv({[HEALTH_KEY]:beacon(),[ALERT_KEY]:{last_beacon_at:new Date(NOW+1000).toISOString(),open:{a:{id:'a',name:'A',severity:'warning',reason:'stale'}}}})};
  const state=await monitorCrawler(env,{now:NOW+2000,fetcher:async()=>success()});
  assert(state.open.a);assert.equal(state.open.monitor.reason,'health_report_rolled_back');
});
test('setup test reaches the existing chat/topic and is sent only once',async()=>{
  const env={...telegram,KV:kv({[HEALTH_KEY]:beacon(),[TEST_KEY]:{id:'setup-1'}})};
  let calls=0;
  const fetcher=async(url,options)=>{
    calls++;assert.equal(url,'https://api.telegram.org/botdummy-test-token/sendMessage');
    const body=JSON.parse(options.body);assert.equal(body.chat_id,'test-chat');assert.equal(body.message_thread_id,123);
    assert.match(body.text,/test notification, not an outage/);return success();
  };
  await monitorCrawler(env,{now:NOW,fetcher});await monitorCrawler(env,{now:NOW+1000,fetcher});
  assert.equal(calls,1);assert.equal(env.KV.records[ALERT_KEY].last_test_id,'setup-1');
});
