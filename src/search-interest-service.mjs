import {readFile} from 'node:fs/promises';
import {saveJSON} from './private-json.mjs';
import {collectInterest} from './search-interest.mjs';

export function validSnapshot(value){
  return value?.schema===1&&Number.isFinite(Date.parse(value.to))&&['films','cinemas','pages'].every(key=>Array.isArray(value.dimensions?.[key]));
}

// One background refresh per hour. Requests only read an in-memory snapshot.
export function createInterestService({getProgramme,path,enabled=Boolean(process.env.POSTHOG_API_KEY),
  collect=collectInterest,now=Date.now,intervalMs=3600000,maxStaleMs=86400000,
  read=async()=>JSON.parse(await readFile(path,'utf8')),write=value=>saveJSON(path,value),onUpdate=()=>{}}){
  let snapshot,inflight,timer,lastAttempt=0,lastError=null;
  const usable=()=>validSnapshot(snapshot)&&now()>=Date.parse(snapshot.to)&&now()-Date.parse(snapshot.to)<maxStaleMs;
  const getSnapshot=()=>usable()?snapshot:null;
  async function refresh(){
    if(inflight)return inflight;if(!enabled)return false;
    lastAttempt=now();
    inflight=(async()=>{
      try{
        const next=await collect(await getProgramme(),{now:now()});
        if(!validSnapshot(next))throw Error('Invalid aggregate');
        await write(next);snapshot=next;lastError=null;
        await onUpdate();return true;
      }catch{lastError='PostHog refresh unavailable';return false;}
      finally{inflight=null;}
    })();return inflight;
  }
  return {getSnapshot,refresh,
    status:()=>({enabled,mode:!usable()?'fallback':now()-Date.parse(snapshot.to)<intervalMs?'fresh':'stale',
      last_success:snapshot?.to||null,last_attempt:lastAttempt?new Date(lastAttempt).toISOString():null,
      next_refresh:enabled?new Date((lastAttempt||Date.parse(snapshot?.to)||now())+intervalMs).toISOString():null,
      window_hours:96,refresh_minutes:intervalMs/60000,max_stale_hours:maxStaleMs/3600000,error:lastError}),
    async start(){
      try{const saved=await read();if(validSnapshot(saved))snapshot=saved;}catch{}
      if(!enabled)return;
      const tick=()=>{if(now()-Math.max(lastAttempt,Date.parse(snapshot?.to)||0)>=intervalMs)void refresh();};
      tick();timer=setInterval(tick,60000);timer.unref?.();
    },
    stop(){clearInterval(timer);}
  };
}
