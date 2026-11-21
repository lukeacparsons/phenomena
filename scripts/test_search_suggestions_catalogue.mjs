import assert from 'node:assert/strict';
import {buildCatalogue,instantCompletions,needsEnrichment,isVerifiedSuggestion} from '../static/search-catalogue.js';
import {emptySearch,queryFilms} from '../static/cinema-search.js';
const now=Date.parse('2026-11-21T12:00:00Z');
const programme={generated_at:'fixture',cinemas:[{id:'verdi',name:'Verdi',short:'Verdi',area:'Barcelona'},{id:'phenomena',name:'Phenomena',short:'Phenomena',area:'Barcelona'}],films:[
  {id:'a',title:'Night Train',titles:['Tren de nit'],release_year:2026,details:{languages:['English'],directors:['Renée Dupont'],cast:['Brad Pitt'],genres:['Drama'],countries:['France'],runtime_minutes:85},sessions:[{id:'a1',cinema_id:'verdi',starts_at:'2026-11-21T20:00:00+01:00',date:'2026-11-21',time:'20:00',language:'en',subtitles:'Spanish',formats:['35mm']}]},
  {id:'b',title:'Paper Moon',details:{languages:['Japanese'],directors:['Yuki Sato'],cast:[],genres:['Comedy'],countries:['Japan'],runtime_minutes:120},sessions:[{id:'b1',cinema_id:'phenomena',starts_at:'2026-11-22T20:00:00+01:00',date:'2026-11-22',time:'20:00',language:'ja',subtitles:'English',formats:[]}]}
]};
const cat=await buildCatalogue(programme,now),phrases=cat.precomputed.map(r=>r.query);
assert.equal(isVerifiedSuggestion(cat.precomputed,' Films in English ',{now}),true);
assert.equal(isVerifiedSuggestion(cat.precomputed,'Films about identity',{now}),false);
assert.equal(isVerifiedSuggestion(cat.precomputed,'Films in English',{now:Date.parse('2026-11-21T19:00:01Z')}),false,'Expired phrases cannot bypass the model');
assert.equal(isVerifiedSuggestion(cat.precomputed,'Comedy films',{now:Date.parse('2026-11-22T10:00:00Z')}),false,'Old-day validation cannot bypass the model');
assert.equal(isVerifiedSuggestion([{query:'rating < 80',day:'2026-11-21',valid_until:now+60000}],'rating > 80',{now}),false,'Do not normalise away comparison operators');
for(const query of ['Films in English tonight','Verdi tonight','English subtitles tomorrow','Comedy films','Films in Japanese at Phenomena'])assert.ok(phrases.includes(query),query);
for(const query of ['English subtitles tonight','Films in Japanese at Verdi','Comedy films tonight'])assert.ok(!phrases.includes(query),'No invented combination: '+query);
for(const row of cat.precomputed)assert.ok(queryFilms(programme,{...emptySearch(),query:row.query},{index:cat.index,now}).length,'Every precomputed search has real matches: '+row.query);
const complete=q=>instantCompletions(cat.entities,cat.precomputed,q,{now});
assert.ok(complete('english subt').length);assert.ok(complete('english subt').every(r=>r.query.includes('subtitles')),'Never substitute audio for subtitles');
assert.equal(complete('films about family').length,0,'Never substitute family genre for a topic');
assert.equal(complete('not in english').length,0,'Never discard negation');
assert.equal(complete('with brad p')[0].query,'Films starring Brad Pitt');
assert.equal(complete('directed by renee')[0].query,'Films directed by Renée Dupont');
assert.equal(complete('tren de')[0].label,'Night Train','Alternate titles');
assert.equal(needsEnrichment(complete('english subt'),'english subt'),false);
assert.equal(needsEnrichment(complete('something unsettling'),'something unsettling'),true);
assert.equal(instantCompletions(cat.entities,cat.precomputed,'Verdi tonight',{now:Date.parse('2026-11-21T19:00:01Z')}).length,0,'Expires after last matching screening');
assert.equal(instantCompletions([],cat.precomputed,'tomorrow',{now:Date.parse('2026-11-22T10:00:00Z')}).length,0,'Relative dates expire at Madrid midnight');
const updated=await buildCatalogue({...programme,films:[programme.films[0]]},now);
assert.ok(!updated.precomputed.some(r=>r.query==='English subtitles'),'Catalogue removals remove suggestions');
console.log('PASS: verified combinations, audio/subtitle separation, topic and negation preservation, actor/director roles, alternate titles, expiry, catalogue removal, and LLM fallback.');
