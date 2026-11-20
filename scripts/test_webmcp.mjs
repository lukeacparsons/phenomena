import assert from 'node:assert/strict';
import {test} from 'node:test';
import {emptySearch,madridDate,queryFilms,searchFromURL,searchParams,validateSearch} from '../static/cinema-search.js';
import {availabilityFor,createCinemaService} from '../static/cinema-service.js';
import {createWebMCPTools} from '../static/webmcp.js';
import {registerWebMCP} from '../static/webmcp-registration.js';
import {hydrateProgramme} from '../static/programme-data.js';

const NOW=Date.parse('2026-11-19T18:00:00Z');
test('stored prices are not exposed by frontend tools',()=>{
  const session={price_data:{currency:'EUR',minimum:6,maximum:10,kind:'ticket_type_range',scope:'session',fees:'unknown',source_url:'https://cinema.example/',checked_at:'2026-11-19T18:00:00Z'}};
  const app=setup();app.data.films[0].sessions[0].price_data=session.price_data;
  const result=app.service.get_screening({screening_id:'imax'});
  assert.equal(result.price,undefined);assert.equal(result.price_data,undefined);
  assert.equal(result.room,'2');assert.equal(result.availability.available,2);
  assert.deepEqual(app.data.films[0].sessions[0].price_data,session.price_data);
});
const session=(id,cinemaId,formats,date='2026-11-21',extra={})=>({id,cinema_id:cinemaId,provider:cinemaId==='yelmo'?'yelmo':'mooby',room:'2',
  film_id:'provider-local-id',starts_at:date+'T20:00:00+01:00',date,time:'20:00',formats,version:'VOSE',big_screen:formats.includes('IMAX'),
  booking_url:'https://cinema.example/tickets/'+id,booking_scope:'session',schedule_fetched_at:'2026-11-19T17:00:00Z',...extra});
function setup(){
  let data={generated_at:'2026-11-19T17:30:00Z',cinemas:[{id:'balmes',name:'Balmes'},{id:'diagonal',name:'Diagonal Mar'},{id:'yelmo',name:'Yelmo'}],
    films:[{id:'imdb:dune',title:'Dune',release_year:2021,titles:['Dune (VOSE IMAX)'],details:{directors:['Denis Villeneuve'],genres:['Science fiction'],languages:['English']},
      ratings:{imdb:{score:8,scale:10,checked_at:'2026-11-18T12:00:00Z',url:'https://www.imdb.com/title/tt1160419/'}},
      sessions:[session('imax','diagonal',['IMAX']),session('standard','balmes',[]),session('atmos','balmes',['Dolby Atmos']),session('old','balmes',[],'2026-11-18')]},
    {id:'imdb:tomorrow',title:'The Day After Tomorrow',titles:[],sessions:[session('tomorrow','yelmo',[],'2026-11-22')]},
    {id:'imdb:dune1984',title:'Dune (1984)',release_year:1984,titles:['Dune'],sessions:[session('classic','balmes',['35mm'],'2026-11-20',{price_eur:9})]}],coverage:[]};
  const availability={sessions:new Map([['imax',{kind:'ordinary',available:2,checked_at:'2026-11-19T17:30:00Z'}]]),errors:new Set(),intervalSeconds:900};
  let view={filters:emptySearch(),language:'en',filmId:null,screeningId:null},url='https://vobarna.example/cinemas.html';
  const service=createCinemaService({getProgramme:()=>data,getAvailability:()=>availability,getView:()=>view,getURL:()=>url,now:()=>NOW,
    applySearch:filters=>{view={...view,filters,filmId:null,screeningId:null};url='https://vobarna.example/cinemas.html?'+searchParams(filters);},
    showScreening:(filmId,screeningId)=>{view={...view,filmId,screeningId};url='https://vobarna.example/cinemas.html?'+searchParams(view.filters,filmId,screeningId);}});
  const tools=new Map(createWebMCPTools(service).map(tool=>[tool.name,tool]));
  return {service,tools,availability,get data(){return data;},set data(value){data=value;},get view(){return view;},get url(){return url;}};
}

test('search is read-only, session-specific, paginated and chains exact IDs',()=>{
  const app=setup();
  const before=JSON.stringify(app.view),url=app.url;
  const result=app.service.search_screenings({query:'Villeneuve this weekend',formats:['imax'],limit:1});
  assert.deepEqual(result.results.map(row=>row.screening_id),['imax']);
  assert.equal(result.results[0].film_id,'imdb:dune');
  assert.equal(result.results[0].availability.stale,true);
  assert.equal(result.results[0].price,undefined);
  assert.equal(result.results[0].audio_language,null);
  assert.deepEqual(result.resolved_date_range,{start:'2026-11-21',end:'2026-11-22'});
  assert.equal(JSON.stringify(app.view),before);assert.equal(app.url,url);
  assert.equal(app.service.search_screenings({cinema_ids:['balmes'],formats:['IMAX']}).total_screenings,0);
  assert.equal(app.service.search_screenings({formats:['IMAX','Dolby Atmos']}).total_screenings,0);
  assert.equal(app.service.search_screenings({cinema_ids:['balmes','diagonal']}).total_screenings,4);
  const first=app.service.search_screenings({limit:2}),second=app.service.search_screenings({limit:2,offset:first.next_offset});
  assert.equal(first.total_screenings,5);assert.equal(first.results[0].screening_id,'classic');
  assert.equal(new Set([...first.results,...second.results].map(row=>row.screening_id)).size,4);
  assert.equal(app.service.search_screenings({offset:100}).results.length,0);
  assert.equal(app.service.get_film({film_id:result.results[0].film_id}).ratings.imdb.score,8);
});

test('merged film IDs continue to resolve existing links and tool results',()=>{
  const app=setup();
  app.data.films[0].merged_ids=['renoir:old-title'];
  assert.equal(app.service.get_film({film_id:'renoir:old-title'}).film_id,'imdb:dune');
  assert.equal(app.service.get_screening({screening_id:'imax'}).film_id,'imdb:dune');
});

test('localized permanent film and screening URLs survive title changes and merged IDs',()=>{
  const app=setup();
  const film=app.data.films[0];
  film.urls={en:'/en/films/dune-2021/',es:'/es/peliculas/dune-2021/',ca:'/ca/pellicules/dune-2021/'};
  film.merged_ids=['provider:old'];
  film.title='A corrected title';
  film.sessions[0].anchor='#screening-dff376593c7d1b25';
  const data=hydrateProgramme(app.data);
  for(const language of ['en','es','ca']){
    let url='https://vobarna.com'+film.urls[language],view={...app.view,language,listingPath:`/${language}/`};
    const service=createCinemaService({getProgramme:()=>data,getAvailability:()=>app.availability,
      getView:()=>view,getURL:()=>url,now:()=>NOW,
      applySearch:filters=>{view={...view,filters,filmId:null,screeningId:null};url='https://vobarna.com'+view.listingPath+'?'+searchParams(filters);},
      showScreening:(filmId,screeningId)=>{view={...view,filmId,screeningId};url='https://vobarna.com'+data.films[0].sessions[0].urls[language];}});
    const filmURL='https://vobarna.com'+film.urls[language],screeningURL=filmURL+film.sessions[0].anchor;
    assert.equal(service.get_film({film_id:film.id}).canonical_url,filmURL);
    assert.equal(service.get_film({film_id:film.id}).action_url,filmURL+'#showtimes');
    assert.equal(service.get_screening({screening_id:'imax'}).canonical_url,filmURL);
    assert.equal(service.get_screening({screening_id:'imax'}).action_url,screeningURL);
    const result=service.search_screenings({query:'Villeneuve',formats:['IMAX']});
    assert.equal(result.url,`https://vobarna.com/${language}/?q=Villeneuve&format=IMAX`);
    assert.equal(result.results[0].url,screeningURL);
    assert.equal(service.get_film({film_id:'imdb:dune'}).url,filmURL);
    assert.equal(service.get_film({film_id:'provider:old'}).url,filmURL);
    const screening=service.get_screening({screening_id:'imax'});
    assert.equal(screening.url,screeningURL);
    assert.equal(screening.booking_url,film.sessions[0].booking_url);
    assert.equal(service.show_screening({screening_id:'imax'}).url,screeningURL);
    assert.equal(service.get_context().url,screeningURL);
    assert.equal(service.set_search({query:'Villeneuve'}).url,`https://vobarna.com/${language}/?q=Villeneuve`);
    assert.equal(service.get_context().active_screening_id,null);
  }
});

test('language and country aliases are shared by read-only and visible searches',async()=>{
  const app=setup();
  assert.equal(app.service.search_screenings({query:'inglés'}).total_screenings,3);
  app.data.films[0].details.countries=['France'];
  const result=await app.tools.get('search_screenings').execute({query:'francés this weekend',formats:['IMAX']});
  assert.deepEqual(result.results.map(row=>row.screening_id),['imax']);
  assert.equal(app.view.filters.query,'');
  const visible=await app.tools.get('set_search').execute({query:'French IMAX'});
  assert.deepEqual(visible.results.map(row=>row.screening_id),['imax']);
  assert.equal(new URL(app.url).searchParams.get('q'),'French IMAX');
});

test('set_search replaces filters; show_screening resolves hidden sessions; invalid actions are atomic',async()=>{
  const app=setup();
  await app.tools.get('set_search').execute({query:'The Day After Tomorrow'});
  assert.equal(app.view.filters.query,'The Day After Tomorrow');
  const shown=await app.tools.get('show_screening').execute({screening_id:'imax'});
  assert.equal(shown.shown,true);assert.equal(app.view.screeningId,'imax');
  assert.equal(new URL(shown.url).searchParams.get('screening'),'imax');
  const before=JSON.stringify(app.view),url=app.url;
  for(const input of [null,[],{query:12},{date_from:'2026-02-30'},{date_from:'2026-11-22',date_to:'2026-11-21'},
    {cinema_ids:['no-such-cinema']},{formats:['unknown']},{big_screens_only:'yes'},{query:'x'.repeat(501)},{unexpected:true}]){
    const result=await app.tools.get('set_search').execute(input);
    assert.equal(result.ok,false,JSON.stringify(input));assert.equal(result.error.code,'invalid_input');
    assert.equal(JSON.stringify(app.view),before);assert.equal(app.url,url);
  }
  for(const id of ['missing','old','https://other.example']){
    assert.equal((await app.tools.get('show_screening').execute({screening_id:id})).ok,false);
    assert.equal(JSON.stringify(app.view),before);
  }
  const aborted=new AbortController();aborted.abort();
  assert.equal((await app.tools.get('set_search').execute({}, {signal:aborted.signal})).error.code,'cancelled');
  assert.equal(JSON.stringify(app.view),before);
  await app.tools.get('set_search').execute({});
  assert.deepEqual(app.view.filters,emptySearch());assert.equal(app.view.screeningId,null);
});

test('natural dates, title protection, explicit ranges and Madrid calendar boundaries',()=>{
  const app=setup();
  assert.equal(app.service.search_screenings({query:'The Day After Tomorrow'}).results[0].screening_id,'tomorrow');
  assert.equal(app.service.search_screenings({query:'"Tomorrow"'}).results[0].screening_id,'tomorrow');
  assert.deepEqual(app.service.search_screenings({query:'Villeneuve dissabte'}).results.map(row=>row.screening_id).sort(),['atmos','imax','standard']);
  assert.equal(app.service.search_screenings({query:'Villeneuve mañana'}).total_screenings,0);
  assert.equal(app.service.search_screenings({query:'Villeneuve tomorrow',date_from:'2026-11-21',date_to:'2026-11-21'}).total_screenings,3);
  const futureRange={...emptySearch(),query:'Villeneuve tomorrow',date_from:'2026-11-21',date_to:'2026-11-21'};
  assert.equal(queryFilms(app.data,futureRange,{now:NOW,ignoreExplicitDates:true})[0].sessions.length,3);
  assert.equal(madridDate(Date.parse('2026-11-19T23:30:00Z')),'2026-11-20');
  assert.equal(madridDate(Date.parse('2026-03-28T23:30:00Z')),'2026-03-29');
  assert.equal(madridDate(Date.parse('2026-03-29T22:30:00Z')),'2026-03-30');
  assert.equal(queryFilms(app.data,{...emptySearch(),query:'2021'}).length,1);
});

test('availability distinguishes unknown, stale, closed, count kind and source failures',()=>{
  const app=setup();
  const unknown=app.service.get_screening({screening_id:'tomorrow'});
  assert.equal(unknown.availability.status,'unknown');assert.equal(unknown.availability.available,null);
  assert.equal(unknown.availability.supported,false);assert.equal(unknown.price,undefined);
  app.availability.errors.add('imax');
  assert.equal(app.service.get_screening({screening_id:'imax'}).availability.refresh_failed,true);
  const s=session('seat','balmes',[]);
  const status=value=>availabilityFor({...s,seat_data:{checked_at:'2026-11-19T17:59:00Z',...value}},{},NOW);
  assert.equal(status({kind:'ordinary',available:0}).status,'sold_out');
  assert.equal(status({kind:'reported_total',available:0}).status,'unknown');
  assert.equal(status({kind:'area_counts',available:0}).status,'unknown');
  assert.equal(status({kind:'ordinary',available:5,purchase_open:false}).status,'booking_closed');
  assert.equal(status({kind:'ordinary',available:5}).stale,false);
  assert.equal(status({kind:'ordinary',available:0,wheelchair:2,companion:1}).wheelchair,2);
  assert.equal(status({kind:'ordinary',available:0,wheelchair:2,companion:1}).available,0);
  assert.equal(status({kind:'ordinary',available:-1}).available,null);
  const newest=availabilityFor({...s,seat_data:{kind:'ordinary',available:9,checked_at:'2026-11-19T17:59:00Z'}},
    {sessions:new Map([['seat',{kind:'ordinary',available:1,checked_at:'2026-11-19T17:00:00Z'}]])},NOW);
  assert.equal(newest.available,9);
  const classic=app.service.get_screening({screening_id:'classic'});
  assert.equal(classic.price,undefined);
  const record=app.data.films[0].sessions[0];record.booking_url='javascript:alert(1)';
  assert.equal(app.service.get_screening({screening_id:'imax'}).booking_url,null);
});

test('links round-trip structured filters and stable selection IDs',()=>{
  const app=setup();
  const filters={...emptySearch(),query:'Timothée Chalamet',date_from:'2026-11-21',date_to:'2026-11-22',cinema_ids:['balmes','diagonal'],formats:['IMAX'],big_screens_only:true};
  const params=searchParams(filters,'imdb:dune','mooby:29:123');
  assert.deepEqual(validateSearch(searchFromURL(params),app.data),filters);
  assert.equal(params.get('film'),'imdb:dune');assert.equal(params.get('screening'),'mooby:29:123');
  const exact={...emptySearch(),date_from:'2026-11-21',date_to:'2026-11-21'};
  assert.equal(searchParams(exact).get('date'),'2026-11-21');
  assert.deepEqual(searchFromURL(searchParams(exact)),exact);
  assert.equal(searchFromURL(new URLSearchParams('date=2026-02-30')).date_from,null);
});

test('tools see refreshed programme and return useful errors while data is unavailable',async()=>{
  const app=setup();
  app.data={...app.data,films:[]};
  assert.equal((await app.tools.get('search_screenings').execute({})).total_screenings,0);
  assert.equal((await app.tools.get('get_film').execute({film_id:'imdb:dune'})).error.code,'not_found');
  app.data=null;
  assert.equal((await app.tools.get('get_context').execute({})).error.code,'not_ready');
  assert.equal((await app.tools.get('search_screenings').execute({limit:0})).error.code,'invalid_input');
});

test('registration is optional, annotates actions, rolls back failures and cleans up',async(t)=>{
  // Registration fixtures must not send artificial calls to the connected account.
  t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:204}));
  const app=setup(),registered=new Map();
  assert.equal(await registerWebMCP(undefined,app.service),null);
  const registry={registerTool(tool,{signal}){registered.set(tool.name,tool);signal.addEventListener('abort',()=>registered.delete(tool.name),{once:true});return Promise.resolve();}};
  const stop=await registerWebMCP(registry,app.service);
  assert.equal(registered.size,6);
  assert.equal(registered.get('search_screenings').annotations.readOnlyHint,true);
  assert.equal(registered.get('set_search').annotations.readOnlyHint,false);
  assert.equal(registered.get('get_film').annotations.untrustedContentHint,true);
  const context=await registered.get('get_context').execute({});
  assert.deepEqual(context.structuredContent,app.service.get_context({}));
  assert.equal(context.isError,false);
  assert.deepEqual(JSON.parse(context.content[0].text),context.structuredContent);
  const invalid=await registered.get('get_film').execute({film_id:'missing'});
  assert.equal(invalid.isError,true);
  assert.equal(invalid.structuredContent.error.code,'not_found');
  assert.deepEqual(JSON.parse(invalid.content[0].text),invalid.structuredContent);
  const cancel=new AbortController();cancel.abort();
  const cancelled=await registered.get('set_search').execute({}, {signal:cancel.signal});
  assert.equal(cancelled.isError,true);
  assert.equal(cancelled.structuredContent.error.code,'cancelled');
  stop();assert.equal(registered.size,0);
  for(const asyncFailure of [false,true]){
    let errors=0;
    const broken={registerTool(tool,options){
      if(registered.size===2){if(asyncFailure)return Promise.reject(new Error('failed'));throw new Error('failed');}
      return registry.registerTool(tool,options);
    }};
    assert.equal(await registerWebMCP(broken,app.service,{onError:()=>errors++}),null);
    assert.equal(errors,1);assert.equal(registered.size,0);
  }
  const lifecycle=new AbortController();
  await registerWebMCP(registry,app.service,{signal:lifecycle.signal});
  lifecycle.abort();assert.equal(registered.size,0);
});
