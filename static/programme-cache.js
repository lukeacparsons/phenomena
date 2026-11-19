// Keep the catalogue off the synchronous, small localStorage budget.
const oldKeys=['vobarna-public-programme-v1','barcelona-cinema-programme-v1'];
let database;
function openDatabase(){
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('vobarna-programme',1);
    const timer=setTimeout(()=>reject(new Error('Catalogue cache timed out')),2000);
    request.onupgradeneeded=()=>request.result.createObjectStore('catalogues');
    request.onerror=()=>{clearTimeout(timer);reject(request.error);};
    request.onblocked=()=>{clearTimeout(timer);reject(new Error('Catalogue cache blocked'));};
    request.onsuccess=()=>{
      clearTimeout(timer);
      const db=request.result;
      db.onversionchange=()=>{db.close();database=null;};
      resolve(db);
    };
  }).catch(error=>{database=null;throw error;});
  return database;
}
async function transaction(mode,run){
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('catalogues',mode);
    const request=run(tx.objectStore('catalogues'));
    tx.oncomplete=()=>resolve(request.result);
    tx.onabort=()=>reject(tx.error||new Error('Catalogue cache aborted'));
    tx.onerror=()=>reject(tx.error);
  });
}
const valid=value=>value&&Array.isArray(value.films)&&Array.isArray(value.cinemas);
export async function readProgrammeCache(key){
  try{
    const value=await transaction('readonly',store=>store.get(key));
    if(valid(value))return value;
  }catch{}
  // Migrate only the matching catalogue: the legacy version has different URLs.
  try{
    const value=JSON.parse(localStorage.getItem(key));
    return valid(value)?value:null;
  }catch{return null;}
}
export async function saveProgrammeCache(key,value){
  if(!valid(value))return false;
  try{
    await transaction('readwrite',store=>store.put(value,key));
    for(const oldKey of oldKeys){try{localStorage.removeItem(oldKey);}catch{}}
    return true;
  }catch{
    // Restricted browsers can still cache a catalogue after evicting stale copies.
    try{
      for(const oldKey of oldKeys)if(oldKey!==key)localStorage.removeItem(oldKey);
      localStorage.setItem(key,JSON.stringify(value));
      return true;
    }catch{return false;}
  }
}
