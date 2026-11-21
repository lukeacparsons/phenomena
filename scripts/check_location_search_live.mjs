// Read-only post-deployment smoke check. Uses one real address and AI lookup.
import assert from 'node:assert/strict';

const base=new URL(process.argv[2]||'https://vobarna.com');
async function request(path,body){
  const response=await fetch(new URL(path,base),{
    ...(body?{method:'POST',headers:{'Content-Type':'application/json',Origin:base.origin},body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(20000)
  });
  assert.equal(response.status,200,`${path} returned ${response.status}; check the deployed version and API routing`);
  if(body)assert.match(response.headers.get('cache-control')||'',/no-store/,`${path} must not be cached`);
  return response;
}

try{
  const health=await (await request('/healthz')).json();
  const module=await request('/location-search.js');
  assert.match(module.headers.get('content-type')||'',/javascript/);
  const {places}=await (await request('/api/geocode',{address:'Carrer de Girona 175, Barcelona'})).json();
  assert(places?.some(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&/Barcelona/i.test(p.label)),'The real geocoder must resolve the Barcelona address');
  const result=await (await request('/api/search',{query:'poblesec',language:'en'})).json();
  assert.match(result.intent?.location_query||'',/poble[\s-]*sec/i,'The live interpreter must recognize Poble-sec');
  assert.notEqual(result.mode,'unavailable');
  console.log(JSON.stringify({origin:base.origin,commit:health.commit,release:health.release,geocoding:'passed',locationIntent:result.intent.location_query}));
}catch(error){console.error(error.message);process.exitCode=1;}
