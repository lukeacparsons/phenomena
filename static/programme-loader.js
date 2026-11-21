import {hydrateProgramme} from './programme-data.js';
import {createSearchIndex} from './cinema-search.js';
import {readProgrammeCache,saveProgrammeCache} from './programme-cache.js';

export function prepareProgramme(raw,cinemaId){
  if(!raw||!Array.isArray(raw.films)||!Array.isArray(raw.cinemas))throw Error('Invalid programme');
  let programme=hydrateProgramme(raw);
  if(cinemaId)programme={...programme,cinemas:programme.cinemas.filter(v=>v.id===cinemaId),
    search:{...programme.search,venues:(programme.search?.venues||[]).filter(v=>v.id===cinemaId),films:(programme.search?.films||[]).map(f=>({...f,sessions:f.sessions.filter(s=>s.cinema_id===cinemaId)})).filter(f=>f.sessions.length)},
    films:programme.films.map(f=>({...f,sessions:f.sessions.filter(s=>s.cinema_id===cinemaId)})).filter(f=>f.sessions.length)};
  return {programme,index:createSearchIndex(programme)};
}

// Parse, expand URLs, index and persist in a worker. Small messages keep receiving
// the completed catalogue from becoming another long task on the input thread.
export function createProgrammeLoader({cacheKey,cinemaId=null}){
  let worker,unavailable=false,sequence=0;
  const pending=new Map();
  const fallback=async(operation,text)=>{
    const raw=operation==='cache'?await readProgrammeCache(cacheKey):JSON.parse(text);
    if(!raw)return null;
    if(operation!=='cache')void saveProgrammeCache(cacheKey,raw);
    return prepareProgramme(raw,cinemaId);
  };
  function getWorker(){
    if(worker)return worker;
    worker=new Worker(new URL('./programme-worker.js',import.meta.url),{type:'module'});
    worker.onerror=event=>{
      event.preventDefault();
      unavailable=true;worker.terminate();worker=null;
      for(const job of pending.values())fallback(job.operation,job.text).then(job.resolve,job.reject);
      pending.clear();
    };
    worker.onmessage=({data:message})=>{
      const job=pending.get(message.id);if(!job)return;
      if(message.error){pending.delete(message.id);job.reject(Error('Programme unavailable'));return;}
      if(message.header){job.result=message.header;job.result.index.programme=job.result.programme;job.result.index.cinemas=new Map(job.result.programme.cinemas.map(v=>[v.id,v]));}
      if(message.rows)for(const row of message.rows){
        job.result.index.films.push(row.indexed);
        if(row.current)job.result.programme.films[row.currentPosition]=row.current;
        if(row.archived)job.result.programme.search.films[row.archivePosition]=row.archived;
      }
      if(message.done){pending.delete(message.id);job.resolve(job.result||null);}
    };
    return worker;
  }
  function request(operation,text){
    if(unavailable)return fallback(operation,text);
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      try{const target=getWorker();pending.set(id,{resolve,reject,operation,text});target.postMessage({id,operation,text,cacheKey,cinemaId});}
      catch{pending.delete(id);unavailable=true;fallback(operation,text).then(resolve,reject);}
    });
  }
  return {readCache:()=>request('cache'),prepare:text=>request('prepare',text),destroy(){worker?.terminate();for(const job of pending.values())job.reject(Error('Page closed'));pending.clear();}};
}
