import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestionLanguage,preferredAudioLanguages} from '../static/search-localization.js';
import {buildCatalogue,instantCompletions} from '../static/search-catalogue.js';
import {buildInterestSuggestions} from '../src/search-interest-suggestions.mjs';
import {chooseChips} from '../static/search-chip-selection.js';
import {parseLocationQuery} from '../static/location-search.js';
import {emptySearch,queryFilms,interpretSearch} from '../static/cinema-search.js';
const now=Date.parse('2099-01-01T10:00:00Z');
const session=(id,language,subtitles)=>({id,cinema_id:'verdi',starts_at:'2099-01-01T20:00:00+01:00',date:'2099-01-01',time:'20:00',language,subtitles,formats:[]});
const programme={generated_at:'localized-fixture',cinemas:[{id:'verdi',name:'Verdi',short:'Verdi',area:'Barcelona',location:{latitude:41.4,longitude:2.16}}],films:[
 {id:'train',title:'Night Train',details:{languages:['English','Spanish'],genres:['Comedy'],countries:['France'],directors:['Jane Example'],cast:['Jo Example'],runtime_minutes:80},sessions:[session('en','English','Spanish'),session('es','Spanish','English')]},
 {id:'moon',title:'Paper Moon',details:{languages:['Japanese'],genres:['Drama']},sessions:[session('ja','Japanese','English')]}
]};
const snapshot={dimensions:{films:[{entity_id:'train',sessions:8}],cinemas:[{entity_id:'verdi',sessions:5}]}};

test('selected language wins, browser fallback uses the full preference list',()=>{
 assert.equal(suggestionLanguage('es',['ca-ES','en-GB']),'es');
 assert.equal(suggestionLanguage(null,['fr-FR','ca-ES','en']),'ca');
 assert.equal(suggestionLanguage('ca-ES',['es']),'ca');
 assert.equal(suggestionLanguage(null,['de-DE']),'en');
 assert.deepEqual(preferredAudioLanguages('es',['fr-FR','en-GB','es-ES']),['es','fr','en']);
});
for(const [language,expected] of Object.entries({es:{audio:'Películas en inglés',subtitles:'Subtítulos en inglés',near:'Night Train cerca de mí',cinema:'Películas en Verdi',genre:'Películas de comedia',director:'Películas dirigidas por Jane Example',prefix:'películas en ing'},ca:{audio:'Pel·lícules en anglès',subtitles:'Subtítols en anglès',near:'Night Train a prop meu',cinema:'Pel·lícules a Verdi',genre:'Pel·lícules de comèdia',director:'Pel·lícules dirigides per Jane Example',prefix:'pel·lícules en ang'}})){
 test(language+': localized phrases search the actual catalogue and preserve audio, subtitles and location',async()=>{
  const cat=await buildCatalogue(programme,now,{language}),ideas=await buildInterestSuggestions(cat,snapshot,now);
  const queries=cat.precomputed.map(r=>r.query);
  for(const key of ['audio','subtitles','cinema','genre','director'])assert.ok(queries.includes(expected[key]),expected[key]);
  const run=query=>queryFilms(programme,{...emptySearch(),query},{index:cat.index,now}).flatMap(f=>f.sessions.map(s=>s.id));
  assert.deepEqual(run(expected.audio),['en']);assert.deepEqual(run(expected.subtitles),['es','ja']);
  assert.equal(interpretSearch(programme,{...emptySearch(),query:expected.genre},{index:cat.index,now}).conditions[0].field,'genre');
  const nearby=language==='es'?'Películas cerca de mí':'Pel·lícules a prop meu';
  assert.ok(instantCompletions(cat.entities,[...cat.precomputed,...ideas.entries.filter(r=>r.requires_location)],language==='es'?'cerca de mi':'a prop meu',{now}).some(r=>r.query===nearby));
  assert.ok(ideas.entries.some(r=>r.query===expected.near));assert.equal(parseLocationQuery(expected.near).location.type,'device');
  assert.ok(instantCompletions(cat.entities,cat.precomputed,expected.prefix,{now}).some(r=>r.query===expected.audio));
  assert.ok(!ideas.entries.some(r=>/^(Films\b|Under\b|English subtitles)/.test(r.query)));
  const picked=chooseChips(ideas.entries,{initial:true,now,preferredLanguages:['es','en']}).map(i=>ideas.entries[i]);
  assert.equal(picked[0].audio_language,'es');assert.ok(picked.some(r=>r.audio_language==='en'),'Browser audio preference remains represented alongside the selected locale');assert.equal(new Set(picked.map(r=>r.group)).size,picked.length);
  const person=cat.entities.find(r=>r.entity_id==='director:Jane Example');assert.equal(person.label,'Jane Example');assert.equal(person.query,expected.director);
 });
}
