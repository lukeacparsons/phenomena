import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLocationQuery,distanceKm,coordinates,createLocationSearchUI} from '../static/location-search.js';
import {emptySearch,createSearchIndex,queryFilms,interpretSearch,parseFilmQuery,searchParams} from '../static/cinema-search.js';
import {createListingView} from '../static/listing-view.js';
import {createSmartSearchUI} from '../static/smart-search-ui.js';
import {createGeocoder} from '../src/geocode.mjs';
import {publicServer} from '../src/vobarna-server.mjs';
import {createSmartSearch,INTENT_SCHEMA} from '../src/smart-search.mjs';
import {emptyIntent,validateIntent} from '../static/search-intent.js';

const now=Date.parse('2099-01-01T10:00:00Z'),origin={latitude:41.4,longitude:2.16};
const session=(cinema_id,time='21:00',date='2099-01-01',language='English')=>({id:cinema_id+time+date,cinema_id,time,date,starts_at:date+'T'+time+':00+01:00',language,formats:[]});
const programme={cinemas:[{id:'far',name:'Far',short:'Far',location:{latitude:41.45,longitude:2.2}},{id:'near',name:'Near',short:'Near',location:origin},{id:'unknown',name:'Unknown',short:'Unknown'}],films:[
  {id:'far-film',title:'Far Film',details:{genres:['Comedy']},sessions:[session('far','18:00')]},
  {id:'mixed',title:'Mixed',details:{genres:['Comedy']},sessions:[session('unknown','17:00'),session('far','18:00'),session('near','21:00'),session('near','20:00'),session('near','15:00','2099-01-02')]},
  {id:'unknown',title:'Unknown',sessions:[session('unknown','16:00')]}
]};
const index=createSearchIndex(programme),filters=query=>({...emptySearch(),query});
const pause=()=>new Promise(r=>setTimeout(r,15));

test('multilingual location syntax, standalone addresses and title protection',()=>{
  for(const q of ['near me','cerca de mí','a prop meu','a prop de mi','nearby','cinemas near me']){
    assert.equal(parseLocationQuery(q).location?.type,'device',q);assert.equal(parseLocationQuery(q).text,'',q);
  }
  for(const q of ['near this address: Carrer de Girona 175, Barcelona','cerca de esta dirección: Carrer de Girona 175, Barcelona','a prop d’aquesta adreça: Carrer de Girona 175, Barcelona','Carrer de Girona 175, Barcelona']){
    assert.equal(parseLocationQuery(q).location?.address,'Carrer de Girona 175, Barcelona',q);
  }
  assert.equal(parseLocationQuery('comedy near Carrer de Girona 175, Barcelona tomorrow').text,'comedy tomorrow');
  assert.equal(parseLocationQuery('near this address').location.address,'');
  assert.equal(parseLocationQuery('Balmes 422 Barcelona').location,null,'unlabelled addresses require interpretation');
  for(const q of ['less than 10 euros','less than 10 euros tomorrow','menos de 10 euros','menys de 10 euros','10 euros','under 90 minutes','90 minutes','2 tickets','80 percent','IMDb 8','films released in 2020'])assert.equal(parseLocationQuery(q).location,null,q);
  assert.equal(parseLocationQuery('nearly Christmas').location,null);
  for(const suffix of ['tomorrow','demà','mañana','after 20:00','in French','en català','rt >80']){
    const parsed=parseLocationQuery('near Carrer de Girona 175, Barcelona '+suffix);
    assert.equal(parsed.location.address,'Carrer de Girona 175, Barcelona');assert.equal(parsed.text,suffix);
  }
  for(const q of ['Dune','rt >80','IMDb 8','1970s films','films from France'])assert.equal(parseLocationQuery(q).location,null,q);
  assert.equal(parseLocationQuery('21 Jump Street',{titles:new Set(['21 jump street'])}).location,null);
  assert.equal(parseLocationQuery('Come Near Me',{titles:new Set(['come near me'])}).location,null);
  const titles=new Set(['near dark','21 jump street']);
  for(const q of ['Near Dark tomorrow','something like Near Dark','21 Jump Street tomorrow'])assert.equal(parseLocationQuery(q,{titles}).location,null,q);
  assert.equal(parseLocationQuery('Near Dark near Carrer de Girona 175, Barcelona',{titles}).text,'Near Dark');
  assert.equal(parseLocationQuery('Near Dark near me',{titles}).text,'Near Dark');
});

test('address-first searches preserve budgets in every locale and keep street numbers intact',()=>{
  for(const [near,price] of [['near','less than 10 euros'],['near','under €10'],['near','below ten euros'],['near','€10 or less'],['cerca de','menos de 10 euros'],['a prop de','menys de 10 euros']]){
    const address='Carrer de Balmes 422, Barcelona',query=near+' '+address+' '+price;
    const parsed=parseLocationQuery(query);
    assert.equal(parsed.location.address,address,query);assert.equal(parsed.text,price,query);
    const plan=interpretSearch(programme,filters(query),{index,now});
    assert(plan.conditions.some(c=>c.field==='price_eur'&&c.value==='10'),query);
    assert.equal(plan.text,'',query);
  }
  for(const query of ['near Carrer de Balmes 422, Barcelona, less than 10 euros','near Carrer de Balmes 422, Barcelona and less than 10 euros','Carrer de Balmes 422, Barcelona less than 10 euros']){
    assert.equal(parseLocationQuery(query).location.address,'Carrer de Balmes 422, Barcelona',query);
  }
  for(const address of ['Carrer del Dos de Maig 280, Barcelona','Carrer de la Diputació 10, Barcelona','Plaça de les Dones del 36, Barcelona'])assert.equal(parseLocationQuery('near '+address).location.address,address);
  const priced={...programme,films:programme.films.map(film=>({...film,sessions:film.sessions.map(s=>({...s,price_data:{amount:s.cinema_id==='near'?12:8,currency:'EUR',kind:'general_admission',source_url:'https://cinema.example/tickets',checked_at:'2099-01-01T09:00:00Z'}}))}))};
  const rows=queryFilms(priced,filters('comedy near Carrer de Balmes 422, Barcelona less than 10 euros tomorrow'),{index:createSearchIndex(priced),now,origin});
  assert.equal(rows.length,0,'the only tomorrow screening exceeds the budget');
  const todayRows=queryFilms(priced,filters('comedy near Carrer de Balmes 422, Barcelona less than 10 euros'),{index:createSearchIndex(priced),now,origin});
  assert.equal(todayRows.length,2);assert(todayRows.every(f=>f.sessions.every(s=>s.price_data.amount<10)));
});

test('distance uses valid coordinates, including zero, with stable great-circle distances',()=>{
  assert.equal(coordinates({latitude:null,longitude:0}),null);
  assert.equal(distanceKm({latitude:91,longitude:0},origin),null);
  assert.equal(distanceKm(origin,origin),0);
  assert(Math.abs(distanceKm({latitude:0,longitude:0},{latitude:0,longitude:1})-111.195)<.01);
  assert(Number.isFinite(distanceKm({latitude:0,longitude:0},{latitude:0,longitude:180})));
});

test('nearby budgets exclude the exact upper bound, unknown prices and restricted discounts',()=>{
  const price={amount:8,currency:'EUR',kind:'general_admission',source_url:'https://cinema.example/tickets',checked_at:'2099-01-01T09:00:00Z'};
  const prices=[price,{...price,amount:10},null,{...price,kind:'minimum',amount:3},{...price,source_url:''},{...price,amount:3,options:[{label:'Member',amount:3},{label:'General',amount:12}]}];
  const p={...programme,films:prices.map((price_data,i)=>({id:'price-'+i,title:'Price '+i,sessions:[{...session('near'),price_data}]}))};
  assert.deepEqual(queryFilms(p,filters('near me less than 10 euros'),{index:createSearchIndex(p),now,origin}).map(f=>f.id),['price-0']);
  assert.deepEqual(queryFilms(p,filters('near me €10 or less'),{index:createSearchIndex(p),now,origin}).map(f=>f.id),['price-0','price-1']);
});

test('distance sorting preserves film filters, dates, unknown cinemas and time order',()=>{
  const search=query=>queryFilms(programme,filters(query),{index,now,origin});
  assert.deepEqual(search('near me').map(f=>f.id),['mixed','far-film','unknown']);
  assert.deepEqual(search('comedy near me').map(f=>f.id),['mixed','far-film']);
  assert.deepEqual(queryFilms(programme,filters('near me'),{index,now}),[],'unresolved proximity must not claim matches');
  assert.deepEqual(queryFilms(programme,{...filters('near me'),ignored_filters:['location']},{index,now}).map(f=>f.id),['unknown','mixed','far-film']);
  const date=search('near Carrer de Girona 175, Barcelona tomorrow');
  assert.equal(date.length,1);assert(date[0].sessions.every(s=>s.date==='2099-01-02'));
  assert.equal(parseFilmQuery(programme,'comedy tomorrow near me','2099-01-01',index).text,'comedy near me');
  assert.equal(interpretSearch(programme,filters('comedy near me'),{index,now}).text,'');
  const view=createListingView({cinemas:programme.cinemas,today:'2099-01-01',origin});
  const html=view.bodyMarkup(search('near me')[0]);
  assert(html.indexOf('data-cinema="near"')<html.indexOf('data-cinema="far"'));
  assert(html.indexOf('data-cinema="far"')<html.indexOf('data-cinema="unknown"'));
  assert(html.indexOf('>20:00<')<html.indexOf('>21:00<'));
  assert.match(html,/card-distance/);assert.match(html,/Distance unavailable/);
  const limited=createListingView({cinemas:programme.cinemas,today:'2099-01-01',origin,cardCinemaLimit:1}).bodyMarkup(search('near me')[0]);
  assert.match(limited,/data-cinema="near"/);assert(!limited.includes('data-cinema="far"'),'sort by distance before applying the preview limit');
  assert.equal(searchParams(filters('near me')).toString(),'q=near+me');
});

test('location UI requests permission only for location searches, ignores stale callbacks and reuses a recent fix',async()=>{
  let query='comedy',success,calls=0;
  const ui=createLocationSearchUI({getQuery:()=>query,getIndex:()=>index,onChange:()=>{},delay:0,
    geolocation:{getCurrentPosition:resolve=>{calls++;success=resolve;}},fetchImpl:()=>assert.fail('Device location must not be sent to a server')});
  ui.update();await pause();assert.equal(calls,0);
  query='near me';ui.update();await pause();assert.equal(calls,1);
  query='comedy';ui.update();success({coords:origin});await pause();assert.equal(ui.current().origin,null);
  query='near me';ui.update();await pause();assert.deepEqual(ui.current().origin,origin);assert.equal(calls,1);
  ui.cancel();
});

test('permission denial, unavailable geolocation, timeout, ambiguity and stale geocoding',async()=>{
  const unavailable=createLocationSearchUI({getQuery:()=> 'near me',getIndex:()=>index,onChange:()=>{},delay:0,geolocation:null});
  unavailable.update();await pause();assert.equal(unavailable.current().status,'unsupported');unavailable.cancel();
  for(const [code,status] of [[1,'denied'],[2,'locationFailed'],[3,'timeout']]){
    const ui=createLocationSearchUI({getQuery:()=> 'near me',getIndex:()=>index,onChange:()=>{},delay:0,geolocation:{getCurrentPosition:(_,reject)=>reject({code})}});
    ui.update();await pause();assert.equal(ui.current().status,status);assert.equal(ui.current().origin,null);ui.cancel();
  }
  let query='Carrer de Girona 175, Barcelona',resolve;
  const ui=createLocationSearchUI({getQuery:()=>query,getIndex:()=>index,onChange:()=>{},delay:0,fetchImpl:()=>new Promise(r=>resolve=r)});
  ui.update();await pause();query='Dune';ui.update();resolve({ok:true,json:async()=>({places:[{...origin,label:'Old address'}]})});await pause();assert.equal(ui.current().origin,null);
  query='Carrer de Balmes 422, Barcelona';ui.update();await pause();resolve({ok:true,json:async()=>({places:[{...origin,label:'One'},{latitude:41.5,longitude:2.2,label:'Two'}]})});await pause();
  assert.equal(ui.current().status,'choose');assert.equal(ui.current().origin,null);ui.select(1);assert.equal(ui.current().label,'Two');
  ui.cancel();
});

test('addresses are stripped before AI requests while film constraints remain',async()=>{
  let sent;
  const ui=createSmartSearchUI({getProgramme:()=>programme,getIndex:()=>index,getFilters:()=>filters('something uplifting near Carrer de Girona 175, Barcelona'),getLanguage:()=> 'en',onResult:()=>{},onStatus:()=>{},delay:0,
    fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);return {ok:false};}});
  ui.update();await pause();assert.equal(sent.query,'something uplifting');ui.cancel();
});

test('LLM location intent enters geocoding without inventing coordinates or weakening film constraints',async()=>{
  const intent={...emptyIntent(),location_query:'Poble-sec, Barcelona',conditions:[{field:'genre',op:'eq',value:'Comedy'}]};
  assert(INTENT_SCHEMA.required.includes('location_query'));
  const api=createSmartSearch({getProgramme:async()=>programme,apiKey:'test',dimensions:2,now:()=>now,fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);
    if(url.endsWith('/embeddings'))return {ok:true,json:async()=>({data:body.input.map((_,index)=>({index,embedding:[1,0]}))})};
    assert.equal(JSON.parse(body.input[2].content[0].text).query,'comedy in poblesec');
    assert.match(body.input[0].content[0].text,/location_query/);
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...intent,film_matches:[]})}]}]})};
  }});
  const result=await api.search({query:'comedy in poblesec'});
  assert.equal(result.intent.location_query,'Poble-sec, Barcelona');assert.equal(result.semantic_scores,null);
  assert.deepEqual(queryFilms(programme,filters('comedy in poblesec'),{index,now,intent:result.intent}),[],'wait for real coordinates');
  assert.deepEqual(queryFilms(programme,filters('comedy in poblesec'),{index,now,intent:result.intent,origin}).map(f=>f.id),['mixed','far-film']);
  const removed=queryFilms(programme,{...filters('comedy in poblesec'),ignored_filters:['location']},{index,now,intent:result.intent});
  assert.equal(removed.length,2);assert(removed.every(f=>f.distance_km===undefined));
  for(const location_query of [null,{},'x'.repeat(301),'invalid\nplace'])assert.throws(()=>validateIntent({...emptyIntent(),location_query},programme));
});

test('inferred location is geocoded only after interpretation and clears for price searches',async()=>{
  let query='poblesec',intent=null,ignored=[],calls=0;
  const ui=createLocationSearchUI({getQuery:()=>query,getIndex:()=>index,getIntent:()=>intent,getIgnored:()=>ignored,onChange:()=>{},delay:0,
    geolocation:{getCurrentPosition:()=>assert.fail('Named places do not request device permission')},fetchImpl:async(_,options)=>{
      calls++;assert.deepEqual(JSON.parse(options.body),{address:'Poble-sec, Barcelona'});
      return {ok:true,json:async()=>({places:[{...origin,label:'el Poble-sec, Barcelona'}]})};
    }});
  ui.update();await pause();assert.equal(calls,0);
  intent={...emptyIntent(),location_query:'Poble-sec, Barcelona'};ui.update();await pause();assert.equal(calls,1);assert.deepEqual(ui.current().origin,origin);
  ignored=['location'];ui.update();assert.equal(ui.current().location,null);
  query='less than 10 euros';intent=null;ignored=[];ui.update();await pause();assert.equal(calls,1);assert.equal(ui.current().origin,null);
  const plan=interpretSearch(programme,filters(query),{index,now});assert(plan.conditions.some(c=>c.field==='price_eur'&&c.op==='lt'&&c.value==='10'));
  ui.cancel();
});

test('geocoder validates input/results, coalesces calls, caches and bounds traffic',async()=>{
  let calls=0;
  const api=createGeocoder({minInterval:0,dailyLimit:2,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url.searchParams.get('q'),'Carrer de Girona 175, Barcelona');assert.match(options.headers['User-Agent'],/VOBarna/);
    return {ok:true,json:async()=>({features:[{geometry:{type:'Point',coordinates:[2.1646,41.3996]},properties:{street:'Carrer de Girona',housenumber:'175',city:'Barcelona'}},{geometry:{type:'Point',coordinates:[999,999]},properties:{name:'Bad'}}]})};
  }});
  const request={address:'Carrer de Girona 175, Barcelona'};
  const [a,b]=await Promise.all([api.search(request),api.search(request)]);assert.deepEqual(a,b);assert.equal(a.places.length,1);
  await api.search(request);assert.equal(calls,1);
  for(const input of [null,[],{address:'x'},{address:'x'.repeat(301)},{address:'ok address',url:'https://example.com'}])await assert.rejects(api.search(input),e=>e.code==='invalid_input');
  const limited=createGeocoder({minInterval:0,dailyLimit:0});await assert.rejects(limited.search(request),e=>e.code==='rate_limited');
});

test('geocoding endpoint is same-origin POST-only, bounded and never cacheable',async t=>{
  const server=publicServer({geocoderOptions:{minInterval:0,fetchImpl:async()=>({ok:true,json:async()=>({features:[]})})}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/api/geocode';
  const post=(data,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  const response=await post({address:'Carrer de Girona 175, Barcelona'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{places:[]});
  assert.equal((await fetch(url)).status,405);
  assert.equal((await post({address:'Barcelona'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await post({address:'Barcelona'},{'Content-Type':'text/plain'})).status,415);
  assert.equal((await post({address:'x'.repeat(5000)})).status,400);
});
