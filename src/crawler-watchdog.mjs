import policy from '../data/crawler-policy.json' with {type:'json'};

export const MONITOR_CRON='*/15 * * * *';
export const HEALTH_KEY='vobarna:crawler-health';
export const ALERT_KEY='vobarna:crawler-alerts';
export const TEST_KEY='vobarna:crawler-monitor-test';
const HOUR=3600000;

function timestamp(value){
  if(typeof value!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/.test(value))return NaN;
  return Date.parse(value);
}

export function evaluateHealth(beacon,now=Date.now(),expected=policy.cinemas){
  const checked=timestamp(beacon?.checked_at);
  const items=beacon?.cinemas;
  if(beacon?.schema_version!==1||!Number.isFinite(checked)||checked>now+300000||!Array.isArray(items)||
      items.length!==expected.length||items.some(v=>!v||typeof v!=='object')||new Set(items.map(v=>v.id)).size!==expected.length||
      expected.some(v=>!items.some(r=>r.id===v.id))){
    return {valid:false,issues:{monitor:{id:'monitor',name:'Crawler health report',severity:'critical',reason:'missing_or_invalid_health_report'}}};
  }
  const issues={};
  if(now-checked>=.75*HOUR)issues.monitor={id:'monitor',name:'Crawler heartbeat',
    severity:now-checked>=4*HOUR?'critical':'warning',reason:'heartbeat_stale'};
  for(const cinema of expected){
    const row=items.find(r=>r.id===cinema.id);
    const last=timestamp(row.last_success),age=(now-last)/HOUR;
    let severity='ok',reason='';
    if(!Number.isFinite(last)||age<-(5/60)){severity='critical';reason='invalid_source_timestamp';}
    else if(age>=cinema.critical_hours){severity='critical';reason='stale';}
    else if(age>=cinema.stale_hours){severity='warning';reason='stale';}
    if(severity==='ok'&&Number.isInteger(row.consecutive_failures)&&row.consecutive_failures>=3){severity='warning';reason='repeated_collection_failure';}
    if(severity!=='ok')issues[cinema.id]={id:cinema.id,name:cinema.name,severity,reason,last_success:row.last_success};
  }
  if(beacon.last_run?.status==='publication_failed')issues.publication={id:'publication',name:'Catalogue publication',severity:'warning',reason:'publication_failed'};
  if(beacon.last_run?.status==='running'&&now-timestamp(beacon.last_run.started_at)>=HOUR){
    issues.publication={id:'publication',name:'Catalogue collection',severity:'warning',reason:'collection_not_finished'};
  }
  return {valid:true,checked_at:beacon.checked_at,issues};
}

function signature(issues){return JSON.stringify(Object.values(issues).map(i=>[i.id,i.severity,i.reason]).sort((a,b)=>a[0].localeCompare(b[0])));}

export function alertPlan(state,evaluation,now=Date.now()){
  const old=state.open||{};
  // A missing/rolled-back heartbeat cannot prove any cinema recovered.
  const issues=evaluation.valid?evaluation.issues:{...old,...evaluation.issues};
  const recovered=Object.keys(old).filter(id=>!issues[id]);
  const changed=signature(issues)!==signature(old);
  const lastSent=timestamp(state.last_sent_at);
  const reminder=Object.keys(issues).length>0&&(!Number.isFinite(lastSent)||now-lastSent>=24*HOUR);
  return {issues,recovered,send:changed||reminder};
}

export function alertText(plan){
  const current=Object.values(plan.issues);
  const lines=[current.length?'VO Barna crawler alert':'VO Barna crawler recovered'];
  for(const issue of current.slice(0,28))lines.push(`${issue.severity.toUpperCase()}: ${issue.name} — ${issue.reason.replaceAll('_',' ')}${issue.last_success?' (last success '+issue.last_success+')':''}`);
  if(current.length>28)lines.push(`And ${current.length-28} other affected cinemas.`);
  if(plan.recovered.length)lines.push(`Recovered: ${plan.recovered.join(', ')}`);
  lines.push('Last valid listings are retained when a collection fails.');
  return lines.join('\n').slice(0,3900);
}

async function boundedJSON(response,limit=65536){
  if(!response.body)throw new Error('Empty response');
  const reader=response.body.getReader();let bytes=0;const parts=[];
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      bytes+=value.byteLength;if(bytes>limit){await reader.cancel();throw new Error('Response too large');}
      parts.push(value);
    }
  }finally{reader.releaseLock();}
  const all=new Uint8Array(bytes);let offset=0;
  for(const part of parts){all.set(part,offset);offset+=part.byteLength;}
  return JSON.parse(new TextDecoder().decode(all));
}

export async function sendTelegram(env,text,fetcher=fetch){
  if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)throw new Error('Telegram not configured');
  const body={chat_id:env.TELEGRAM_CHAT_ID,text,disable_web_page_preview:true};
  if(/^\d+$/.test(String(env.TELEGRAM_TOPIC_ID||'')))body.message_thread_id=Number(env.TELEGRAM_TOPIC_ID);
  const response=await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw new Error('Telegram HTTP failure');}
  const result=await boundedJSON(response);
  if(result.ok!==true)throw new Error('Telegram rejected notification');
  return result.result?.message_id??null;
}

export async function monitorCrawler(env,{now=Date.now(),fetcher=fetch}={}){
  let stored;
  try{stored=await env.KV.get(HEALTH_KEY,'json');}
  catch(error){if(error instanceof SyntaxError)stored=null;else throw error;}
  const previous=await env.KV.get(ALERT_KEY,'json')||{};
  const test=await env.KV.get(TEST_KEY,'json');
  let evaluation=evaluateHealth(stored,now);
  if(evaluation.valid&&timestamp(evaluation.checked_at)<timestamp(previous.last_beacon_at)){
    evaluation={valid:false,issues:{monitor:{id:'monitor',name:'Crawler heartbeat',severity:'critical',reason:'health_report_rolled_back'}}};
  }
  const plan=alertPlan(previous,evaluation,now);
  const state={...previous,last_checked_at:new Date(now).toISOString(),last_beacon_at:evaluation.valid?evaluation.checked_at:previous.last_beacon_at};
  try{
    if(plan.send){
      state.last_message_id=await sendTelegram(env,alertText(plan),fetcher);
      state.open=plan.issues;state.last_sent_at=new Date(now).toISOString();
    }
    if(test?.id&&test.id!==state.last_test_id){
      state.test_message_id=await sendTelegram(env,'VO Barna crawler monitoring is active. This is a test notification, not an outage. Per-cinema stale alerts and recovery messages will arrive in this topic.',fetcher);
      state.last_test_id=test.id;state.test_sent_at=new Date(now).toISOString();
    }
    state.delivery_status='ok';delete state.last_delivery_error;
  }catch(error){
    // Never mark an unsent alert delivered. Retry on the next scheduled check.
    state.delivery_status='failed';state.last_delivery_error=error.name;
    console.error(JSON.stringify({event:'crawler_alert_delivery_failed',type:error.name}));
  }
  await env.KV.put(ALERT_KEY,JSON.stringify(state));
  console.log(JSON.stringify({event:'crawler_watchdog',issues:Object.keys(plan.issues).length,delivery:state.delivery_status}));
  return state;
}
