import {evaluateHealth,HEALTH_KEY} from './crawler-watchdog.mjs';
import {readBounded} from './provider-source-reader.mjs';

const encoder=new TextEncoder();
async function authorized(request,secret){
  if(!secret)return false;
  const header=request.headers.get('Authorization')||'';
  if(header.length>256)return false;
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const signature=await crypto.subtle.sign('HMAC',key,encoder.encode('Bearer '+secret));
  return crypto.subtle.verify('HMAC',key,signature,encoder.encode(header));
}

export async function receiveHeartbeat(request,env,now=Date.now()){
  const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(!await authorized(request,env.HEARTBEAT_TOKEN))return reply({error:'unauthorized'},401);
  if(request.method!=='POST'||new URL(request.url).pathname!=='/heartbeat')return reply({error:'not_found'},404);
  let health;
  try{
    health=JSON.parse(new TextDecoder().decode(await readBounded(request.body,65536)));
    const age=now-Date.parse(health.checked_at);
    if(!evaluateHealth(health,now).valid||!Number.isFinite(age)||age < -60000||age>300000)
      return reply({error:'invalid_health'},400);
  }catch{return reply({error:'invalid_health'},400);}
  // A single collector lease prevents competing writers. KV consistency is
  // still best effort; the watchdog independently rejects regressing receipts.
  try{
    const previous=await env.KV.get(HEALTH_KEY,'json');
    if(previous&&Date.parse(previous.checked_at)>Date.parse(health.checked_at))return reply({error:'older_health'},409);
    await env.KV.put(HEALTH_KEY,JSON.stringify(health));
    return reply({ok:true,checked_at:health.checked_at});
  }catch(error){
    console.error(JSON.stringify({event:'heartbeat_write_failed',type:error.name}));
    return reply({error:'storage_unavailable'},503);
  }
}

export default {fetch(request,env){return receiveHeartbeat(request,env);}};
