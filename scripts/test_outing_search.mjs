import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchIndex,emptySearch,queryFilms,interpretSearch,searchParams,searchFromURL} from '../static/cinema-search.js';
import {emptyIntent,validateIntent,intentChips} from '../static/search-intent.js';
import {admissionPrice,makeItineraries,observedSeats,estimatedEnd} from '../static/outing-search.js';
import {searchFeedback,venueAnswers,feedbackMarkup} from '../static/search-feedback.js';
import {createSmartSearch} from '../src/smart-search.mjs';

const now=Date.parse('2099-01-01T10:00:00Z'),today='2099-01-01';
const cinemas=[{id:'verdi',name:'Verdi',short:'Verdi',location:{latitude:41.4,longitude:2.15}},{id:'phenomena',name:'Phenomena',short:'Phenomena',location:{latitude:41.45,longitude:2.2}}];
const session=(id,time='18:00',extra={})=>({id,cinema_id:'verdi',provider:'fixture',date:today,time,starts_at:today+'T'+time+':00+01:00',language:'English',source_url:'https://cinema.example/session',formats:[],...extra});
const film=(id,time='18:00',extra={})=>({id,title:id,details:{runtime_minutes:90,genres:['Comedy'],directors:['Jane Example']},sessions:[session(id,time)],...extra});
const programme=films=>({generated_at:'2099-01-01T09:00:00Z',cinemas,films});
const run=(p,query,context={})=>queryFilms(p,{...emptySearch(),query},{now,index:createSearchIndex(p),...context});
const fact=(field,value,extra={})=>({field,value,source_url:'https://source.example/evidence',...extra});
const price=(amount,extra={})=>({amount,currency:'EUR',kind:'general_admission',source_url:'https://cinema.example/tickets',checked_at:'2099-01-01T09:55:00Z',fees:'unknown',...extra});
const seats=(available,extra={})=>({available,kind:'ordinary',checked_at:'2099-01-01T09:55:00Z',...extra});

test('finish windows are distinct from start times, use runtimes and reject unknowns',()=>{
 const p=programme([film('early','18:00'),film('late','21:00'),film('unknown','18:00',{details:{}})]);
 assert.deepEqual(run(p,'finishes before 20:00').map(f=>f.id),['early']);
 for(const q of ['I m free between 18:00 and 20:00','termina antes de las 20:00','acaba abans de les 20:00'])assert.deepEqual(run(p,q).map(f=>f.id),['early'],q);
 assert.equal(run(p,'finishes before 25:00').length,0);
 const midnight=programme([film('late','22:30')]);
 assert.equal(run(midnight,'finishes before 00:30').length,1);
 const plan=interpretSearch(p,{...emptySearch(),query:'finishes before 20:00'},{now});
 assert(plan.conditions.every(c=>c.field!=='start_time'));
});
test('starts soon evaluates current time on each call, without a stale interpretation',()=>{
 const p=programme([film('soon','11:30'),film('later','13:00')]),index=createSearchIndex(p),filters={...emptySearch(),query:'starts in the next 45 minutes'};
 assert.deepEqual(queryFilms(p,filters,{index,now}).map(f=>f.id),['soon']);
 assert.equal(queryFilms(p,filters,{index,now:now+40*60000}).length,0);
});
test('alternatives keep cinema and date together on the same screening',()=>{
 const p=programme([film('first','18:00'),film('second','18:00',{sessions:[session('second','18:00',{cinema_id:'phenomena',date:'2099-01-02',starts_at:'2099-01-02T18:00:00+01:00'})]}),film('wrong','18:00',{sessions:[session('wrong','18:00',{cinema_id:'phenomena'})]})]);
 assert.deepEqual(run(p,'today at Verdi or tomorrow at Phenomena').map(f=>f.id),['first','second']);
 const filters={...emptySearch(),query:'today at Verdi or tomorrow at Phenomena'},plan=interpretSearch(p,filters,{now});
 assert.equal(plan.alternatives.length,2);assert(intentChips(plan).some(c=>c.id==='alternatives'));
 assert.equal(queryFilms(p,{...filters,ignored_filters:['alternatives']},{now}).length,3);
 assert.deepEqual(searchFromURL(searchParams({...filters,ignored_filters:['alternatives']})).ignored_filters,['alternatives']);
});
test('preferences rank eligible screenings and cannot bypass mandatory filters',()=>{
 const p=programme([film('spanish','12:00',{sessions:[session('es','12:00',{language:'Spanish'})]}),film('english','20:00'),film('french','12:00',{sessions:[session('fr','12:00',{language:'French'})]})]);
 assert.deepEqual(run(p,'English preferred, Spanish acceptable').map(f=>f.id),['english','spanish']);
 assert.deepEqual(run(p,'after 15:00 prefer English but Spanish is fine').map(f=>f.id),['english']);
});
test('radius requires a resolved origin and filters actual session cinemas',()=>{
 const p=programme([film('near'),film('far','18:00',{sessions:[session('far','18:00',{cinema_id:'phenomena'})]})]);
 assert.equal(run(p,'within 2 km').length,0);
 assert.deepEqual(run(p,'within 2 km',{origin:cinemas[0].location}).map(f=>f.id),['near']);
 assert.equal(run(p,'20 minutes on foot').length,0);
});
test('admission excludes restricted minimum fares, retains exact/free prices and sorts',()=>{
 const p=programme([film('eight','18:00',{sessions:[session('eight','18:00',{price_data:price(8)})]}),film('free','18:00',{sessions:[session('free','18:00',{price_data:price(0,{kind:'free_admission'})})]}),film('range','18:00',{sessions:[session('range','18:00',{price_data:price(null,{kind:'ticket_type_range',minimum:5,maximum:12,options:[{label:'MEMBER',amount:5}]})})]})]);
 assert.deepEqual(run(p,'under €10').map(f=>f.id).sort(),['eight','free']);
 assert.deepEqual(run(p,'free screenings').map(f=>f.id),['free']);
 assert.deepEqual(run(p,'cheapest').map(f=>f.id),['free','eight','range']);
 assert.equal(admissionPrice({price_data:price(-1)}),null);
});
test('seats must be fresh; totals never prove adjacency or accessibility',()=>{
 const p=programme([film('fresh','18:00',{sessions:[session('fresh','18:00',{seat_data:seats(8)})]}),film('stale','18:00',{sessions:[session('stale','18:00',{seat_data:seats(200,{checked_at:'2098-12-31T09:55:00Z'})})]}),film('together','18:00',{sessions:[session('together','18:00',{seat_data:seats(6,{adjacency_verified:true,max_adjacent:4})})]})]);
 assert.deepEqual(run(p,'not sold out').map(f=>f.id),['fresh','together']);
 assert.deepEqual(run(p,'four seats together').map(f=>f.id),['together']);
 assert.equal(run(p,'not sold out',{availability:{failed:true}}).length,0);
 assert.equal(observedSeats(p.films[1].sessions[0],{now}),null);
});
test('no subtitles and English-only audio require complete explicit evidence',()=>{
 const p=programme([film('none','18:00',{sessions:[session('none','18:00',{subtitles_confirmed_none:true})]}),film('unknown'),film('mixed','18:00',{sessions:[session('mixed','18:00',{language:'English, French',subtitles:'Spanish'})]})]);
 assert.deepEqual(run(p,'no subtitles').map(f=>f.id),['none']);
 assert.deepEqual(run(p,'English only').map(f=>f.id),['none','unknown']);
});
test('awards, events, classifications and content exclusions require scoped evidence',()=>{
 const p=programme([film('verified','18:00',{details:{search_facts:[fact('award',"Palme d'Or"),fact('age_max',7,{territory:'ES'}),fact('content_warning','animal death',{present:false})]},sessions:[session('verified','18:00',{search_facts:[fact('event','q&a',{session_id:'verified'})]})]}),film('unknown')]);
 for(const q of ['Palme d Or winners','suitable for a seven-year-old','no animal deaths','director Q&A'])assert.deepEqual(run(p,q).map(f=>f.id),['verified'],q);
 assert.equal(run(p,'Oscar nominated').length,0);
 const wrongScope=structuredClone(p);wrongScope.films[0].sessions[0].search_facts[0].session_id='other';assert.equal(run(wrongScope,'Q&A').length,0);
});
test('credit relationships use a real reference and do not conflate acting with directing',()=>{
 const p=programme([film('reference','18:00',{title:'Example Film'}),film('directed'),film('acted','18:00',{details:{cast:['Jane Example']}})]);
 assert.deepEqual(run(p,'other films by the director of Example Film').map(f=>f.id),['directed']);
 assert.equal(run(p,'other films by the director of An Unknown Film').length,0);
 assert.deepEqual(run(p,'directed by Jane Example').map(f=>f.id).sort(),['directed','reference']);
});
test('excluded titles and venues stay excluded',()=>{
 const p=programme([film('one'),film('two','18:00',{sessions:[session('two','18:00',{cinema_id:'phenomena'})]})]);
 assert.deepEqual(run(p,'not at Verdi').map(f=>f.id),['two']);
 assert.deepEqual(run(p,'not one').map(f=>f.id),['two']);
});
test('past programmes are explicit and do not enter the normal upcoming results',()=>{
 const p=programme([film('future')]);p.search={films:[film('past','18:00',{sessions:[session('past','18:00',{date:'2098-12-31',starts_at:'2098-12-31T18:00:00+01:00'})]})]};
 assert.deepEqual(run(p,'').map(f=>f.id),['future']);assert.deepEqual(run(p,'what played yesterday').map(f=>f.id),['past']);
});
test('itineraries contain distinct films with sufficient gaps at the same cinema',()=>{
 const p=programme([film('first','13:00'),film('second','17:00'),film('too-close','14:00'),film('elsewhere','17:00',{sessions:[session('elsewhere','17:00',{cinema_id:'phenomena'})]})]);
 const rows=run(p,'two films today with a dinner break');
 const plan=interpretSearch(p,{...emptySearch(),query:'two films today with a dinner break'},{now}),paths=makeItineraries(rows,plan.itinerary);
 assert(paths.length);for(const path of paths){assert.equal(path.length,2);assert.equal(path[0].session.cinema_id,path[1].session.cinema_id);assert(path[1].start-path[0].end>=90*60000);assert.notEqual(path[0].film.id,path[1].film.id);}
 assert(!rows.some(f=>f.id==='elsewhere'));
 const feedback={messages:[],suggestions:[],known:[],venues:[],itineraries:[paths[0]]};
 const html=feedbackMarkup(feedback,{programme:p});
 assert.match(html,/Est\. end <time[^>]*>14:50<\/time>/);
 assert.match(html,/2 h 10 min break/);
 assert.match(html,/Thu, 1 Jan 2099/);
 assert.match(html,/20 minutes to the film runtime for trailers and adverts/);
 const published=structuredClone(feedback);published.itineraries[0][0].session.ends_at=new Date(paths[0][0].end).toISOString();
 assert.match(feedbackMarkup(published,{programme:p}),/>Ends <time[^>]*>14:50<\/time>/);
 for(const language of ['es','ca'])assert.match(feedbackMarkup(feedback,{programme:p,language}),/2 h 10 min de pausa/);
});
test('missing results give explicit changes, spelling suggestions and safe sourced venue answers',()=>{
 const p=programme([film('amelie','18:00',{title:'Amélie'})]);
 p.search={venues:[{id:'verdi',name:'Verdi',official_url:'https://cinema.example',answers:[{topic:'food_belongings',passages:[{text:'Bring water; <script>bad</script>',scope:'Published policy',checked_at:'2099-01-01',sources:[{title:'Cinema FAQ',url:'https://cinema.example/faq'}]}],unresolved:['Check the exact room.']}]}]};
 let filters={...emptySearch(),query:'Ameliee'},index=createSearchIndex(p);
 let result=searchFeedback(p,filters,[],{index,now});assert(result.suggestions.some(s=>s.filters.query==='amelie'));
 filters={...emptySearch(),query:'finishes before 18:30'};result=searchFeedback(p,filters,[],{index,now});assert(result.suggestions.some(s=>s.filters.ignored_filters.includes('finish_time:lt:1110')));
 filters={...emptySearch(),query:'Can I bring a backpack to Verdi?'};result=searchFeedback(p,filters,[],{index,now});assert.equal(result.venues.length,1);
 const html=feedbackMarkup(result,{programme:p});assert(html.includes('https://cinema.example/faq'));assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
});
test('expanded interpretation validates bounds and simple searches need no model',async()=>{
 const p=programme([film('one')]);
 assert.throws(()=>validateIntent({...emptyIntent(),alternatives:[[]]},p));
 assert.throws(()=>validateIntent({...emptyIntent(),preferences:[{conditions:[{field:'price_eur',op:'lt',value:'10'}],weight:100}]},p));
 assert.throws(()=>validateIntent({...emptyIntent(),itinerary:{count:99,min_gap:30,max_gap:180,same_cinema:true}},p));
 const api=createSmartSearch({getProgramme:async()=>p,apiKey:'fixture',now:()=>now,fetchImpl:()=>assert.fail('No API call expected')});
 for(const query of ['finishes before 20:00','under €10','no subtitles','four seats together','English preferred, Spanish acceptable'])assert.equal((await api.search({query})).mode,'local',query);
});

test('semantic historical searches can retrieve retained films outside the current programme',async()=>{
 const p=programme([film('current')]);p.search={films:[film('archived','18:00',{sessions:[session('archived','18:00',{date:'2098-12-31',starts_at:'2098-12-31T18:00:00+01:00'})]})]};
 const api=createSmartSearch({getProgramme:async()=>p,apiKey:'fixture',dimensions:2,now:()=>now,fetchImpl:async(url,request)=>{
  const body=JSON.parse(request.body);
  if(url.endsWith('/embeddings'))return {ok:true,json:async()=>({data:body.input.map((_,index)=>({index,embedding:[1,0]}))})};
  const input=JSON.parse(body.input[1].content[0].text),selected=input.catalogue.find(row=>row[1]==='archived')[0];
  return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...emptyIntent(),text:'',semantic_query:'uplifting',scope:'past',film_matches:[selected]})}]}]})};
 }});
 const result=await api.search({query:'something uplifting yesterday'});
 assert.deepEqual(result.semantic_scores.map(r=>r.film_id),['archived']);
 assert.deepEqual(run(p,'something uplifting yesterday',{intent:result.intent,semanticScores:result.semantic_scores}).map(f=>f.id),['archived']);
});
