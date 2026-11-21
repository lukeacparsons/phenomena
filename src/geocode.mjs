import {coordinates,distanceKm} from '../static/location-search.js';
const fail=code=>Object.assign(new Error('Address lookup unavailable'),{code});

// One proxy keeps provider traffic bounded and the public endpoint replaceable.
export function createGeocoder({endpoint=process.env.GEOCODER_URL||'https://photon.komoot.io/api/',fetchImpl=fetch,now=Date.now,minInterval=1100,dailyLimit=1000}={}){
  const cache=new Map(),pending=new Map(),clients=new Map();
  let last=0,day='',calls=0,queue=Promise.resolve();
  async function search(input,{client='local'}={}){
    if(!input||Array.isArray(input)||Object.keys(input).some(k=>k!=='address')||typeof input.address!=='string'||input.address.trim().length<3||input.address.length>300||/[\x00-\x1f]/.test(input.address))throw fail('invalid_input');
    const address=input.address.trim(),key=address.normalize('NFKC').toLowerCase(),stamp=now();
    if(cache.has(key)&&stamp-cache.get(key).at<86400000)return cache.get(key).result;
    if(pending.has(key))return pending.get(key);
    const today=new Date(stamp).toISOString().slice(0,10);if(today!==day){day=today;calls=0;}
    const bucket=clients.get(client)||{at:stamp,count:0};if(stamp-bucket.at>=60000){bucket.at=stamp;bucket.count=0;}
    if(pending.size>=4||calls>=dailyLimit||bucket.count>=15)throw fail('rate_limited');
    bucket.count++;clients.set(client,bucket);if(clients.size>1000)clients.delete(clients.keys().next().value);calls++;
    const work=queue.catch(()=>{}).then(async()=>{
      const wait=last+minInterval-now();if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
      last=now();
      const url=new URL(endpoint);url.search=new URLSearchParams({q:address,lat:'41.3874',lon:'2.1686',limit:'5'}).toString();
      const response=await fetchImpl(url,{headers:{'User-Agent':'VOBarna/1.0 (+https://vobarna.com)','Accept':'application/json'},signal:AbortSignal.timeout(4000)});
      if(!response.ok)throw fail('geocode_unavailable');
      const body=await response.json();if(!Array.isArray(body.features))throw fail('geocode_unavailable');
      const places=[];
      for(const feature of body.features.slice(0,5)){
        const [longitude,latitude]=feature.geometry?.coordinates||[],point=coordinates({latitude,longitude}),p=feature.properties||{};
        if(feature.geometry?.type!=='Point'||!point)continue;
        const label=[...new Set([p.name,[p.street,p.housenumber].filter(Boolean).join(' '),p.postcode,p.city||p.town||p.village,p.country].filter(v=>typeof v==='string'&&v))].join(', ').slice(0,500);
        if(!label||places.some(other=>other.label===label&&distanceKm(other,point)<.05))continue;
        places.push({...point,label});
      }
      const result={places};cache.set(key,{at:now(),result});if(cache.size>500)cache.delete(cache.keys().next().value);return result;
    }).finally(()=>pending.delete(key));
    queue=work;pending.set(key,work);return work;
  }
  return {search};
}
