import test from 'node:test';
import assert from 'node:assert/strict';
import {screeningAudio} from '../static/screening-language.js';
import {createSearchIndex,emptySearch,queryFilms,interpretSearch} from '../static/cinema-search.js';

const source='https://www.cinebaix.cat/pellicula/wild-horse-nine';
const report={source:'cinema',source_url:source,status:'ok',evidence:'explicit_original_language',languages:['Catalan','Spanish']};
const now=Date.parse('2099-01-01T10:00:00Z');
const session=(id,provider,language)=>({id,provider,cinema_id:provider,date:'2099-01-02',time:'19:00',starts_at:'2099-01-02T19:00:00+01:00',version:'VOSE',source_url:source,language});
const programme={cinemas:[{id:'verdi',name:'Verdi',short:'Verdi'},{id:'cinebaix',name:'CineBaix',short:'CineBaix'}],films:[
 {id:'wild',title:'Wild Horse Nine',details:{languages:['English'],language_status:{state:'conflict'},language_reports:[report]},sessions:[session('wild-baix','cinebaix'),session('wild-verdi','verdi','English')]},
 {id:'catalan',title:'Catalan fixture',details:{},sessions:[session('catalan-baix','cinebaix','Catalan'),session('catalan-verdi','verdi','Catalan')]}
]};

test('old version legends cannot match Catalan audio, including cached single-source selections',()=>{
 const film=structuredClone(programme.films[0]);
 assert.deepEqual(screeningAudio(film,film.sessions[0]).codes,[]);
 film.details={languages:['Catalan','Spanish'],language_status:{state:'supported'},language_selection:report,language_reports:[report]};
 assert.deepEqual(screeningAudio(film,film.sessions[0]).codes,[]);
 assert.deepEqual(screeningAudio(film,{...film.sessions[0],language:'Catalan'}).codes,['ca']);
 film.details.language_reports=[{...report,parser_version:5,languages:['Catalan']}];
 assert.deepEqual(screeningAudio(film,film.sessions[0]).codes,['ca']);
});

test('audio and cinema restrictions apply together to the same screening in every locale',()=>{
 const index=createSearchIndex(programme);
 for(const query of ['Films in Catalan at Verdi','Películas en catalán en Verdi','Pel·lícules en català a Verdi']){
  const filters={...emptySearch(),query};const plan=interpretSearch(programme,filters,{now,index});
  assert(plan.conditions.some(c=>c.field==='language'&&c.value==='Catalan'),query);
  assert(plan.conditions.some(c=>c.field==='provider'&&c.value==='verdi'),query);
  const rows=queryFilms(programme,filters,{index,now});
  assert.deepEqual(rows.map(f=>f.id),['catalan'],query);
  assert.deepEqual(rows[0].sessions.map(s=>s.id),['catalan-verdi'],query);
 }
 const rows=queryFilms(programme,{...emptySearch(),query:'Films in Catalan'},{index,now});
 assert.deepEqual(rows.map(f=>f.id),['catalan']);
});
