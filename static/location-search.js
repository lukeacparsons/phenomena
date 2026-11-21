// Location is resolved separately from film interpretation. Device coordinates
// remain in memory and never enter a query URL or the AI search request.
const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const clean=value=>value.replace(/^[\s,;:]+|[\s,;:]+$/g,'').trim();
const filler=value=>clean(value).replace(/\s+/g,' ').replace(/^(?:show me\s+)?(?:films?|movies?|cinemas?|pel[ií]culas?|cines?|pel·l[ií]cules?|cinemes?)\s*$/iu,'');
// Only unmistakable street syntax bypasses interpretation. Bare place names
// and unlabelled addresses go to the model; numbers alone are not addresses.
const street=/^(?:(?:carrer|calle|avinguda|avenida|av\.?|ronda|rambla|passeig|paseo|plaça|plaza|travessera|carretera|c\/)\s|\d{1,4}\s+(?:carrer|calle|avinguda|avenida|ronda|rambla|passeig|paseo|plaça|plaza)\b|\d{1,4}\s+[\p{L}'’ .-]+\s+(?:street|road|avenue|lane|st\.?|rd\.?)\b)/iu;
// A following constraint belongs to film search, including when the address
// comes first. Require a comparison/value so street names and numbers survive.
const amount='(?:\\d+(?:[.,]\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|un|una|uno|dos|dues|tres|cuatro|quatre|cinco|cinc|seis|sis|siete|set|ocho|vuit)(?=$|[^\\p{L}\\p{N}])';
const comparison='(?:after|before|under|below|less than|more than|at most|at least|within|menos de|menys de|a menos de|a menys de|antes de|abans de|despu[eé]s de|despr[eé]s de)\\s+(?:€\\s*)?'+amount;
const tail=new RegExp('[\\s,;]+(?:(?:and|with|y|con|i|amb)\\s+)?(?=(?:(?:today|tomorrow|tonight|this weekend|hoy|mañana|avui|demà|este fin de semana|aquest cap de setmana|in (?:english|french|spanish|catalan)|en (?:inglés|francés|castellano|catalán|anglès|francès|català)|imdb)(?=$|[^\\p{L}\\p{N}])|'+comparison+'|€\\s*'+amount+'\\s+(?:or less|maximum|m[aá]ximo|m[aà]xim)\\b|rt\\s*[<>]))','iu');

export function parseLocationQuery(query,{titles}={}){
  const text=String(query||'').trim();
  if(!text||titles?.has(fold(text)))return {text,location:null};
  // Protect named films even with dates or other constraints: “Near Dark
  // tomorrow” and “21 Jump Street” are not addresses. Masking keeps offsets.
  const words=[...text.matchAll(/[\p{L}\p{N}]+/gu)].map(m=>({value:fold(m[0]),start:m.index,end:m.index+m[0].length}));
  let masked=text,hasTitle=false;
  for(const title of titles||[]){
    const tokens=title.split(' ');if(tokens.length<2)continue;
    for(let i=0;i<=words.length-tokens.length;i++){
      if(!tokens.every((token,j)=>token===words[i+j].value))continue;
      const start=words[i].start,end=words[i+tokens.length-1].end;
      masked=masked.slice(0,start)+' '.repeat(end-start)+masked.slice(end);hasTitle=true;
    }
  }
  const me=/\b(?:near\s+me|nearby|cerca\s+de\s+m[ií]|a\s+prop\s+meu|a\s+prop\s+de\s+mi)(?=$|[^\p{L}\p{N}])/iu.exec(masked);
  if(me)return {text:filler(text.slice(0,me.index)+' '+text.slice(me.index+me[0].length)),location:{type:'device',address:'',clause:me[0]}};
  const near=/\b(?:near\b(?:\s+(?:this|the)\s+address)?|cerca\s+de(?:\s+(?:esta|la)\s+direcci[oó]n)?|a\s+prop\s+(?:de(?:\s+(?:aquesta|la)\s+adreça)?|d['’](?:aquesta\s+adreça)?))\s*:?\s*/iu.exec(masked);
  if(hasTitle&&!near)return {text,location:null};
  let address=near?text.slice(near.index+near[0].length):text;
  if(!near&&!street.test(text))return {text,location:null};
  const split=tail.exec(address),suffix=split?address.slice(split.index):'';
  if(split)address=address.slice(0,split.index);
  address=clean(address).replace(/^["“]|["”]$/g,'');
  const clause=near?text.slice(near.index,near.index+near[0].length)+(address||''):address;
  return {text:filler((near?text.slice(0,near.index):'')+' '+suffix),location:{type:'address',address,clause}};
}

export function coordinates(value){
  return value&&Number.isFinite(value.latitude)&&Math.abs(value.latitude)<=90&&Number.isFinite(value.longitude)&&Math.abs(value.longitude)<=180?{latitude:value.latitude,longitude:value.longitude}:null;
}
export function distanceKm(a,b){
  if(!coordinates(a)||!coordinates(b))return null;
  const radians=value=>value*Math.PI/180;
  const h=Math.sin(radians(b.latitude-a.latitude)/2)**2+Math.cos(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.sin(radians(b.longitude-a.longitude)/2)**2;
  return 6371.0088*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));
}
export function cinemaDistances(cinemas,origin){
  return new Map(cinemas.map(cinema=>[cinema.id,distanceKm(origin,cinema.location)]));
}
export function formatDistance(km,language='en'){
  if(!Number.isFinite(km))return {en:'Distance unavailable',es:'Distancia no disponible',ca:'Distància no disponible'}[language];
  return km<1?new Intl.NumberFormat(language).format(Math.max(10,Math.round(km*100)*10))+' m':new Intl.NumberFormat(language,{maximumFractionDigits:1}).format(km)+' km';
}

export function createLocationSearchUI({getQuery,getIndex,getIntent=()=>null,getIgnored=()=>[],onChange,fetchImpl=fetch,geolocation=globalThis.navigator?.geolocation,delay=600}){
  let key='',state={location:null,origin:null,status:''},timer,controller,version=0,device=null,devicePending=null;
  const cache=new Map();
  function cancel(){clearTimeout(timer);controller?.abort();controller=null;version++;}
  function current(){return state;}
  function update({retry=false}={}){
    const parsed=parseLocationQuery(getQuery(),{titles:getIndex()?.titles});
    const inferred=getIntent()?.location_query;
    const location=getIgnored().includes('location')?null:parsed.location||(inferred?{type:'address',address:inferred,clause:''}:null);
    const next=JSON.stringify(location&&[location.type,location.address]);
    if(next===key&&!retry)return;
    cancel();key=next;
    state={location,origin:null,status:location?(location.type==='device'?'locating':location.address?'geocoding':'addressNeeded'):''};
    if(!location||state.status==='addressNeeded'){onChange();return;}
    const request=version;
    const finish=(values)=>{if(request!==version)return;state={...state,...values};onChange();};
    onChange();
    timer=setTimeout(async()=>{
      try{
        if(location.type==='device'){
          if(!geolocation)throw Object.assign(new Error(),{code:'unsupported'});
          if(!device||Date.now()-device.at>300000){
            devicePending??=new Promise((resolve,reject)=>geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,maximumAge:300000,timeout:10000})).finally(()=>{devicePending=null;});
            const position=await devicePending;
            const point=coordinates(position.coords);
            if(!point)throw new Error('Invalid location');
            device={...point,at:Date.now()};
          }
          finish({origin:coordinates(device),status:'ready',label:''});return;
        }
        let places=cache.get(location.address);
        if(!places){
          const active=new AbortController();controller=active;
          const deadline=setTimeout(()=>active.abort(),7000);
          try{
            const response=await fetchImpl('/api/geocode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:location.address}),signal:active.signal});
            if(!response.ok)throw new Error('Address lookup unavailable');
            const body=await response.json();
            if(!Array.isArray(body.places)||body.places.length>5||body.places.some(p=>!coordinates(p)||typeof p.label!=='string'||p.label.length>500))throw new Error('Invalid places');
            places=body.places;cache.set(location.address,places);
            if(cache.size>30)cache.delete(cache.keys().next().value);
          }finally{clearTimeout(deadline);if(controller===active)controller=null;}
        }
        // Let the visitor choose when the provider returns several addresses.
        finish(places.length===1?{origin:coordinates(places[0]),label:places[0].label,status:'ready'}:{places,status:places.length?'choose':'notFound'});
      }catch(error){finish({status:location.type==='device'?(error.code===1?'denied':error.code===3?'timeout':error.code==='unsupported'?'unsupported':'locationFailed'):'geocodeFailed'});}
    },delay);
  }
  function select(index){const place=state.places?.[index];if(!place)return;state={...state,origin:coordinates(place),label:place.label,status:'ready'};onChange();}
  return {current,update,cancel,select,reset(){cancel();key='';state={location:null,origin:null,status:''};}};
}

export const LOCATION_COPY={
  en:{nearMe:'Near me',near:'Near',locating:'Allow location access in your browser to find nearby cinemas…',geocoding:'Finding this address…',addressNeeded:'Enter an address after “near”, for example: near Carrer de Balmes 422, Barcelona.',choose:'Choose the address you mean:',notFound:'No address found. Try the street, number and city.',denied:'Location access is blocked. Allow it in your browser settings, then retry, or type an address.',timeout:'Your location took too long to arrive. Retry or type an address.',unsupported:'Location is unavailable in this browser. Type an address instead.',locationFailed:'Could not find your location. Retry or type an address.',geocodeFailed:'Address lookup is temporarily unavailable. Retry in a moment.',retry:'Retry'},
  es:{nearMe:'Cerca de mí',near:'Cerca de',locating:'Permite el acceso a tu ubicación en el navegador para encontrar cines cercanos…',geocoding:'Buscando esta dirección…',addressNeeded:'Escribe una dirección después de «cerca de», por ejemplo: cerca de Carrer de Balmes 422, Barcelona.',choose:'Elige la dirección que buscas:',notFound:'No se encontró la dirección. Prueba con la calle, el número y la ciudad.',denied:'El acceso a la ubicación está bloqueado. Permítelo en los ajustes del navegador y reintenta, o escribe una dirección.',timeout:'La ubicación ha tardado demasiado. Reintenta o escribe una dirección.',unsupported:'Este navegador no permite obtener la ubicación. Escribe una dirección.',locationFailed:'No se pudo obtener tu ubicación. Reintenta o escribe una dirección.',geocodeFailed:'La búsqueda de direcciones no está disponible. Reintenta en un momento.',retry:'Reintentar'},
  ca:{nearMe:'A prop meu',near:'A prop de',locating:'Permet l’accés a la ubicació al navegador per trobar cinemes propers…',geocoding:'Cercant aquesta adreça…',addressNeeded:'Escriu una adreça després d’«a prop de», per exemple: a prop de Carrer de Balmes 422, Barcelona.',choose:'Tria l’adreça que cerques:',notFound:'No s’ha trobat l’adreça. Prova amb el carrer, el número i la ciutat.',denied:'L’accés a la ubicació està bloquejat. Permet-lo als ajustos del navegador i torna-ho a provar, o escriu una adreça.',timeout:'La ubicació ha trigat massa. Torna-ho a provar o escriu una adreça.',unsupported:'Aquest navegador no permet obtenir la ubicació. Escriu una adreça.',locationFailed:'No s’ha pogut obtenir la ubicació. Torna-ho a provar o escriu una adreça.',geocodeFailed:'La cerca d’adreces no està disponible. Torna-ho a provar d’aquí a un moment.',retry:'Torna-ho a provar'}
};
