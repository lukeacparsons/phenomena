import assert from 'node:assert/strict';
import {buildCatalogue} from '../static/search-catalogue.js';
import {buildInterestSuggestions} from '../src/search-interest-suggestions.mjs';
import {chooseChips} from '../static/search-chip-selection.js';
import {createInterestService} from '../src/search-interest-service.mjs';
import {interestWhere,collectInterest} from '../src/search-interest.mjs';

const now=Date.parse('2026-11-21T12:00:00Z');
const programme={generated_at:'fixture',cinemas:[{id:'verdi',name:'Verdi',short:'Verdi',area:'Barcelona',urls:{en:'/en/cinemas/verdi/'},location:{latitude:41.4,longitude:2.16}}],films:[
  {id:'a',title:'The Night Train: Homeward',urls:{en:'/en/films/night-train/',es:'/es/peliculas/night-train/'},details:{languages:['English'],genres:['Drama']},sessions:[{id:'a1',cinema_id:'verdi',starts_at:'2026-11-21T20:00:00+01:00',date:'2026-11-21',time:'20:00',language:'en',subtitles:'Spanish'}]},
  {id:'b',title:'Paper Moon',details:{languages:['Japanese'],genres:['Comedy']},sessions:[{id:'b1',cinema_id:'verdi',starts_at:'2026-11-22T20:00:00+01:00',date:'2026-11-22',time:'20:00',language:'ja',subtitles:'English'}]},
  {id:'c',title:'Old Film',details:{languages:['English']},sessions:[{id:'c1',cinema_id:'verdi',starts_at:'2026-11-20T20:00:00+01:00',date:'2026-11-20',time:'20:00'}]}
]};
const snapshot={schema:1,to:new Date(now).toISOString(),dimensions:{pages:[],films:[
  {entity_id:'a',sessions:8,recent_sessions:7,ticket_sessions:3},
  {entity_id:'b',sessions:9,recent_sessions:1,ticket_sessions:0},
  {entity_id:'c',sessions:20,recent_sessions:10,ticket_sessions:8},
  {entity_id:'unknown',sessions:1000},
],cinemas:[{entity_id:'verdi',sessions:5,recent_sessions:4,ticket_sessions:2}]}};
const cat=await buildCatalogue(programme,now),built=await buildInterestSuggestions(cat,snapshot,now);
const rows=built.entries,queries=rows.map(r=>r.query);
assert.ok(queries.includes('Night Train in English'));
assert.ok(queries.includes('Night Train near me'));
assert.ok(queries.includes('Paper Moon with English subtitles'));
assert.ok(!queries.includes('Paper Moon in English'),'Subtitles never become audio');
assert.ok(!queries.some(q=>q.includes('Old Film')),'Popular expired films are not offered');
assert.ok(!queries.some(q=>q.includes('unknown')),'Analytics cannot inject titles');
assert.equal(rows[0].query,'Night Train in English','Recent interest and ticket sessions outrank a small raw-session lead');
assert.equal(rows.find(r=>r.query==='Night Train near me').requires_location,true);
const initial=chooseChips(rows,{initial:true,now});
assert.deepEqual(initial.map(i=>rows[i].group),['film:a','cinema:verdi','film:b']);
const shuffled=chooseChips(rows,{previous:initial,random:()=>0.4,now});
assert.equal(new Set(shuffled.map(i=>rows[i].group)).size,shuffled.length,'Randomisation keeps subjects diverse');
assert.ok(shuffled.every(i=>!initial.includes(i)),'No immediately repeated chip');
assert.ok(chooseChips(rows,{now:now+3*86400000}).length===0,'Expired chips cannot be selected');
const cold=await buildInterestSuggestions(cat,null,now);
assert.ok(cold.entries.length>0&&cold.entries.every(r=>r.source==='catalogue'),'No analytics uses verified catalogue suggestions');
const removed=await buildCatalogue({...programme,films:[programme.films[1]]},now);
assert.ok(!(await buildInterestSuggestions(removed,snapshot,now)).entries.some(r=>r.group==='film:a'),'Catalogue removal wins over popularity');

let time=now,calls=0,writes=0,fail=false,release;
const service=createInterestService({path:'unused',enabled:true,getProgramme:async()=>programme,now:()=>time,
  read:async()=>snapshot,write:async()=>{writes++;},collect:async()=>{calls++;if(fail)throw Error('offline');await new Promise(resolve=>{release=resolve;});return {...snapshot,to:new Date(time).toISOString()};}});
await service.start();assert.equal(calls,0,'Fresh disk cache avoids startup network');
time+=3600001;assert.equal(service.status().mode,'stale');
const pending=service.refresh(),same=service.refresh();await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(calls,1,'Concurrent refreshes coalesce');release();await Promise.all([pending,same]);
assert.equal(writes,1);assert.equal(service.status().mode,'fresh');
fail=true;time+=3600001;assert.equal(await service.refresh(),false);assert.ok(service.getSnapshot(),'Temporary outage keeps last good snapshot');
time+=86400001;assert.equal(service.getSnapshot(),null);assert.equal(service.status().mode,'fallback','Old interest cannot live forever');service.stop();

const where=interestWhere(now-96*3600000,now);
for(const marker of ['internal_user','notification_test','is_test','/__analytics-check/','integration-test','placement'])assert.ok(where.includes(marker));
const sql=[];
await collectInterest(programme,{now,request:async(path,options)=>{
  assert.equal(path,'/query/');const q=options.body.query.query;sql.push(q);
  if(q.includes('GROUP BY path'))return {columns:['path'],results:[['/en/films/night-train/'],['/es/peliculas/night-train/']]};
  return {columns:[],results:[]};
}});
const filmSQL=sql.find(q=>q.includes('GROUP BY entity_id')&&q.includes('properties.film_id'));
assert.ok(filmSQL.includes("IN ('/en/films/night-train/','/es/peliculas/night-train/') THEN 'a'"),'Localized pages map to one canonical entity before session aggregation');
assert.ok(filmSQL.includes('uniqExact(properties.$session_id)'),'Counts distinct sessions, not page loads');
console.log('PASS: interest ranking, canonical URL mapping, privacy exclusions, current-screening validation, audio/subtitles, location gating, diversity, expiry/removals, refresh coalescing, last-good cache and fallback.');
