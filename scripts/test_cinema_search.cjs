const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

async function main(){
const searchModule=await import('../static/cinema-search.js');
const serviceModule=await import('../static/cinema-service.js');
const webMCPModule=await import('../static/webmcp.js');
const programmeModule=await import('../static/programme-data.js');
const copyModule=await import('../static/cinema-copy.js');
const listingModule=await import('../static/listing-view.js');
const {filmMarkup}=await import('../static/film-view.js');
const appSource = fs.readFileSync(path.join(__dirname, '../static/cinemas.js'), 'utf8').split('let pressedPoster=null;')[0];
const context = vm.createContext({
  ...searchModule,...serviceModule,...webMCPModule,...programmeModule,...copyModule,...listingModule,observeImages:()=>{},posterMarkup:()=>'',AbortController,URLSearchParams, Intl, Date, location: {search: ''}, document: {body:{dataset:{}},querySelector:()=>null,getElementById: id => id==='grid'?{dataset:{},querySelectorAll:()=>[]}:null,querySelectorAll: () => []},
  navigator: {language: 'en'}, localStorage: {getItem: () => null}
});
const source=appSource.replace(/^import[^\n]*\n/gm,'');
vm.runInContext(source, context);
const dialogContext=vm.createContext({...context,filmMarkup});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/film-dialog.js'),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,''),dialogContext);
function languageMarkup(film){
  dialogContext.film={title:'Test film',sessions:[],...film};dialogContext.dialog={dataset:{},scrollTop:0};
  vm.runInContext('renderFilmDialog(dialog,film)',dialogContext);
  return dialogContext.dialog.innerHTML;
}
const session = (id, formats, bigScreen) => ({id, starts_at: '2099-01-01T19:00:00+01:00', date: '2099-01-01', cinema_id: 'test', formats, big_screen: bigScreen, version: 'VOSE'});
context.fixtures = {
  cinemas: [{id: 'test', name: 'Diagonal Mar', short: 'Diagonal Mar'}],
  films: [
    {id: 'dune', title: 'Dune', titles: ['Dune (VOSE IMAX)'], release_year: 2021,
      details: {directors: ['Denis Villeneuve'], writers: ['Eric Roth'], cast: ['Timothée Chalamet'],
        genres: ['Science fiction'], composers: ['Hans Zimmer'], search_aliases: ['Sci-Fi', 'Ciencia ficción', 'Ciència-ficció'],
        countries: ['United States'], languages: ['English'], studios: ['Legendary'], release_dates: [{date: '2021-09-17', region: 'Spain', kind: 'release'}]},
      sessions: [session('standard', [], false), session('imax', ['IMAX'], true)]},
    {id: 'other', title: 'Another film', titles: [], details: {cinematographers: ['Frederick Elmes'], cast: ['Tim Roth']},
      sessions: [session('other-standard', [], false)]}
  ]
};
vm.runInContext('data=fixtures', context);
function search(query) {
  context.query = query;
  return JSON.parse(vm.runInContext('state.query=query;JSON.stringify(filteredFilms().map(f=>({id:f.id,sessions:f.sessions.map(s=>s.id)})))', context));
}
for (const query of ['Villeneuve', 'Eric Roth', 'Timothee Chalamet', 'Hans Zimmer', 'science fiction', 'sci-fi', 'ciencia ficción', 'ciència-ficció', '2021', 'Spain', 'Legendary', 'English', 'United States']) {
  assert.deepEqual(search(query).map(f => f.id), ['dune'], query);
}
assert.deepEqual(search('Roth').map(f => f.id).sort(), ['dune', 'other']);
assert.deepEqual(search('Eric Roth IMAX'), [{id: 'dune', sessions: ['imax']}]);
assert.deepEqual(search('big screens only Villeneuve'), [{id: 'dune', sessions: ['imax']}]);
assert.equal(search('Villeneuve unknown').length, 0);
assert.equal(search('2099-01-02').length,0);
assert.deepEqual(search('2099-01-01').map(f=>f.id).sort(),['dune','other']);
context.fixtures.films.push({id:'tomorrow',title:'The Day After Tomorrow',titles:[],sessions:[session('tomorrow-session',[],false)]});
assert.deepEqual(search('The Day After Tomorrow').map(f=>f.id),['tomorrow']);
assert.deepEqual(search('"Tomorrow"').map(f=>f.id),['tomorrow']);
assert.deepEqual(search('Frederick Elmes').map(f=>f.id),['other']);
assert(!languageMarkup({}).includes('dialog-languages'));
context.fixtures.films[0].details.languages.push('French','<img src=x onerror=alert(1)>');
const languages = languageMarkup(context.fixtures.films[0]);
assert(languages.includes('Original language: English, French, &lt;img src=x onerror=alert(1)&gt;'));
assert(!languages.includes('<img src=x'));
context.reportedLanguageFilm={details:{languages:['Spanish','English'],language_selection:{evidence:'catalogue_language_list'}}};
assert(languageMarkup(context.reportedLanguageFilm).includes('Languages: Spanish, English'));
assert(!languageMarkup(context.reportedLanguageFilm).includes('Original language:'));
context.conflictingLanguageFilm={details:{languages:['English'],language_status:{state:'conflict'},language_selection:{evidence:'explicit_original_language'}}};
assert(languageMarkup(context.conflictingLanguageFilm).includes('Languages: English'));

// Producer-only credits, including legacy cached aliases, must not match people searches.
context.fixtures.films.push(
  {id:'acting',title:'An acting credit',titles:[],details:{cast:['Brad Pitt'],producers:['Brad Pitt'],search_aliases:['Brad Pitt']},sessions:[session('acting-imax',['IMAX'],true)]},
  {id:'producing',title:'A producing credit',titles:[],details:{cast:['Matt Damon'],producers:['Brad Pitt','Dede Gardner'],search_aliases:['BRÁD PITT','Dede Gardner']},sessions:[session('producing-imax',['IMAX'],true)]},
  {id:'directing',title:'A directing credit',titles:[],details:{directors:['Greta Gerwig'],producers:['Greta Gerwig'],search_aliases:['Greta Gerwig']},sessions:[session('directing-standard',[],false)]}
);
for(const query of ['Brad Pitt','brad','pitt','Brad Pit','Brad Pitt IMAX','Brad Pitt 2099-01-01']){
  assert.deepEqual(search(query).map(f=>f.id),['acting'],query);
}
assert.deepEqual(search('Dede Gardner'),[]);
assert.deepEqual(search('Greta Gerwig').map(f=>f.id),['directing']);
assert.deepEqual(search('Matt Damon').map(f=>f.id),['producing']);
context.fixtures.films.push(
  {id:'catalan-title',title:'La carn',original_title:'La carn',english_title:'The Flesh',titles:['LA CARN','The Flesh'],sessions:[session('ca-session',[],false)]},
  {id:'spanish-title',title:'La bola negra',original_title:'La bola negra',english_title:'The Black Ball',titles:['LA BOLA NEGRA','The Black Ball'],sessions:[session('es-session',[],false)]}
);
for(const [query,id] of [['La carn','catalan-title'],['The Flesh','catalan-title'],['La bola negra','spanish-title'],['The Black Ball','spanish-title']]){
  assert.deepEqual(search(query).map(f=>f.id),[id],query);
}
for(const [lang,expected] of [['en','just now'],['es','ahora mismo'],['ca','ara mateix']]){
  context.lang=lang;
  assert.equal(vm.runInContext('language=lang;age(new Date().toISOString())',context),expected);
}
vm.runInContext("language='en'",context);
assert.equal(vm.runInContext("age('invalid')",context),'');

// Chain searches use screening operators without adding brands to venue labels.
const chainVenues=[
  ['diagonal-mar','Diagonal Mar','cinesa'],['la-farga','La Farga','cinesa'],
  ['balmes','Balmes','mooby'],['bosque','Bosque','mooby'],
  ['maquinista','La Maquinista','yelmo'],['splau','Splau','kinepolis'],
  ['magic','Màgic','ocine-magic'],['gran-via','Gran Via','filmax']
];
const chainProgramme={
  cinemas:chainVenues.map(([id,name])=>({id,name,short:name})),
  films:[{id:'shared-film',title:'Shared film',details:{studios:['Filmax']},sessions:[
    ...chainVenues.map(([id,,provider])=>({...session(id,id==='diagonal-mar'?['IMAX']:[],id==='diagonal-mar'),cinema_id:id,provider,time:'19:00'})),
    {...session('expired',[],false),cinema_id:'balmes',provider:'mooby',starts_at:'2098-12-30T19:00:00+01:00',date:'2098-12-30'}
  ]}]
};
const chainSnapshot=JSON.stringify(chainProgramme),chainIndex=searchModule.createSearchIndex(chainProgramme);
const chainSearch=(query,filters={},index=chainIndex)=>searchModule.queryFilms(chainProgramme,{...searchModule.emptySearch(),...filters,query},
  {index,now:Date.parse('2098-12-31T12:00:00Z')});
const chainSessions=(query,filters,index)=>chainSearch(query,filters,index).flatMap(film=>film.sessions.map(s=>s.id)).sort();
for(const [query,ids] of [
  ['cinesa',['diagonal-mar','la-farga']],['CÍNESA',['diagonal-mar','la-farga']],
  ['mooby',['balmes','bosque']],['MoObY',['balmes','bosque']],['moo',['balmes','bosque']],
  ['yelmo',['maquinista']],['Kinépolis',['splau']],['ocine',['magic']],
  ['Filmax',['gran-via']],['Filmax Shared film',['gran-via']],
  ['cinesa IMAX',['diagonal-mar']],['mooby Balmes',['balmes']],
  ['cinesa 2099-01-01',['diagonal-mar','la-farga']],['cinesa 2099-01-02',[]],
  ['cinesa mooby',[]],['unknown-chain',[]]
]){
  assert.deepEqual(chainSessions(query),ids,query);
  assert.deepEqual(chainSessions(query,{},null),ids,query+' without a cached index');
}
assert.deepEqual(chainSessions('cinesa',{cinema_ids:['la-farga']}),['la-farga']);
assert.deepEqual(chainSessions('cinesa',{formats:['IMAX']}),['diagonal-mar']);
assert.deepEqual(chainSessions('mooby',{cinema_ids:['diagonal-mar']}),[]);
const chainView=listingModule.createListingView({cinemas:chainProgramme.cinemas,today:'2099-01-01'});
const chainMarkup=chainView.bodyMarkup(chainSearch('cinesa')[0]);
assert(chainMarkup.includes('>Diagonal Mar</a>'));
assert(chainMarkup.includes('>La Farga</a>'));
assert(!chainMarkup.toLowerCase().includes('cinesa'));
assert.equal(JSON.stringify(chainProgramme),chainSnapshot,'Search must preserve cinema names and source data');

// Bounded previews must retain access to omitted times, venues and later days.
const previewCinemas=['a','b','c','d','e'].map(id=>({id,name:'Cinema '+id,short:id}));
const previewSession=(cinemaIndex,slot,date='2099-01-01')=>{
  const cinema=previewCinemas[cinemaIndex].id,time=String(11+slot*3).padStart(2,'0')+':'+String(cinemaIndex*10).padStart(2,'0');
  return {id:`${date}-${cinema}-${slot}`,cinema_id:cinema,date,time,starts_at:`${date}T${time}:00+01:00`,formats:[]};
};
const previewFilm=sessions=>({id:'preview',title:'Preview film',urls:{en:'/en/films/preview/'},sessions});
const previewView=listingModule.createListingView({cinemas:previewCinemas,today:'2099-01-01',...listingModule.HOME_CARD_PREVIEW});
const renderedSessions=html=>[...html.matchAll(/data-session="([^"]+)"/g)].map(match=>match[1]);
const compactSessions=[0,1,2].flatMap(cinema=>[0,1,2].map(slot=>previewSession(cinema,slot)));
const compactMarkup=previewView.bodyMarkup(previewFilm([...compactSessions].reverse()));
assert.deepEqual(renderedSessions(compactMarkup),[0,1,2].flatMap(cinema=>[0,1].map(slot=>previewSession(cinema,slot).id)));
assert(compactMarkup.includes('>3 more showtimes</a>'),'Hidden times on the same day must still expose the complete schedule');
assert.equal((compactMarkup.match(/class="card-cinema-more"/g)||[]).length,3);
assert.equal((compactMarkup.match(/>\+1 more<\/a>/g)||[]).length,3,'Each cinema indicates its own omitted time');
assert.deepEqual([...compactMarkup.matchAll(/data-reveal-session="([^"]+)"/g)].map(match=>match[1]),[0,1,2].map(cinema=>previewSession(cinema,2).id));
assert(compactMarkup.includes('<h3 class="card-day-label">Today ·'),'Keep the existing date label');
const broadSessions=[0,1,2,3,4].flatMap(cinema=>[0,1,2].map(slot=>previewSession(cinema,slot)));
const broadFilm=previewFilm([...broadSessions,previewSession(0,0,'2099-01-02')].reverse());
const broadSnapshot=JSON.stringify(broadFilm),broadMarkup=previewView.bodyMarkup(broadFilm);
assert.deepEqual(renderedSessions(broadMarkup),[0,1,2,3].flatMap(cinema=>[0,1,2].map(slot=>previewSession(cinema,slot).id)));
assert(broadMarkup.includes('>4 more showtimes</a>'),'The count includes other venues and later days');
assert(!broadMarkup.includes('class="card-cinema-more"'),'Other venues and dates do not inflate a complete cinema row');
assert.equal(renderedSessions(filmMarkup(broadFilm,{cinemas:previewCinemas,view:'showtimes'})).length,broadFilm.sessions.length);
assert.equal(JSON.stringify(broadFilm),broadSnapshot,'Previewing cannot discard or reorder the source schedule');
const busyVenue=previewFilm(Array.from({length:12},(_,slot)=>({...previewSession(0,0),id:'busy-'+slot,time:`${String(10+slot).padStart(2,'0')}:00`,starts_at:`2099-01-01T${String(10+slot).padStart(2,'0')}:00:00+01:00`})));
assert.equal(renderedSessions(previewView.bodyMarkup(busyVenue)).length,3,'A day with many screenings gets a fuller preview');
assert(previewView.bodyMarkup(busyVenue).includes('>+9 more</a>'));
const completePreview=previewFilm([previewSession(0,0),previewSession(0,1)]);
assert(!previewView.bodyMarkup(completePreview).includes('class="card-more"'),'No more link when all matching sessions fit');
assert(!previewView.bodyMarkup(completePreview).includes('class="card-cinema-more"'));
const laterBreadth=previewFilm([...completePreview.sessions,...broadSessions.map(s=>({...s,id:s.id+'-later',date:'2099-01-02',starts_at:s.starts_at.replace('2099-01-01','2099-01-02')}))]);
assert.equal(renderedSessions(previewView.bodyMarkup(laterBreadth)).length,2,'Later dates must not expand the previewed day');
assert(!previewView.bodyMarkup(laterBreadth).includes('class="card-cinema-more"'),'Later dates alone do not require a local more-times cue');
for(const [language,label] of [['en','1 more showtime'],['es','1 sesión más'],['ca','1 sessió més']]){
  const localized=listingModule.createListingView({language,cinemas:previewCinemas,today:'2099-01-01',...listingModule.HOME_CARD_PREVIEW});
  assert(localized.bodyMarkup(previewFilm([0,1,2].map(slot=>previewSession(0,slot)))).includes(`>${label}</a>`));
  assert(localized.bodyMarkup(previewFilm([0,1,2].map(slot=>previewSession(0,slot)))).includes(`>+1 ${copyModule.TEXT[language].more}</a>`));
}
const venueView=listingModule.createListingView({cinemas:previewCinemas,today:'2099-01-01'});
assert.equal(renderedSessions(venueView.bodyMarkup(previewFilm([...compactSessions.filter(s=>s.cinema_id==='a'),previewSession(0,0,'2099-01-02')]))).length,4,'Cinema-profile previews retain both dates and their full times');

const nameOverlap={cinemas:[{id:'test',name:'Test cinema'}],films:[
  {id:'chain',title:'A film',sessions:[{...session('chain',[],false),provider:'renoir'}]},
  {id:'credit',title:'Another film',details:{directors:['Jean Renoir']},sessions:[session('credit',[],false)]},
  {id:'title',title:'Renoir the painter',sessions:[session('title',['IMAX'],true)]}
]};
for(const [query,ids] of [['renoir',['chain']],['Jean Renoir',['credit']],['Renoir the painter IMAX',['title']]]){
  assert.deepEqual(searchModule.queryFilms(nameOverlap,{...searchModule.emptySearch(),query}).map(film=>film.id),ids,query);
}

// Language terms match either original audio or production origin, in all UI languages.
// Include films with missing metadata and different audio on individual sessions.
const localeFilm=(id,details={},sessions=[session(id,[],false)])=>({id,title:id,titles:[],details,sessions});
const localeProgramme={cinemas:[{id:'test',name:'Test cinema'}],films:[
  localeFilm('spoken-es',{languages:['Spanish'],countries:['Mexico']}),
  localeFilm('origin-es',{languages:['English'],countries:['Spain']}),
  localeFilm('spoken-ca',{languages:['Catalan']}),
  localeFilm('origin-ca',{languages:['English'],countries:['Catalunya']}),
  localeFilm('spoken-fr',{languages:['French'],countries:['Canada']}),
  localeFilm('origin-fr',{languages:['English'],countries:['Francia']}),
  localeFilm('audio-only',{},[
    {...session('audio-es',['IMAX'],true),language:'Español,'},
    {...session('audio-fr',[],false),language:'FR'},
    {...session('audio-ca',[],false),language:'ca'},
    {...session('audio-multi',[],false),language:'Castellano, Japonés, Inglés'},
    {...session('audio-unknown',[],false),subtitles:'Català'}
  ]),
  localeFilm('subtitles-only',{languages:['English'],countries:['United States'],release_dates:[{date:'2021-01-01',region:'Spain'}]},
    [{...session('subtitles',[],false),subtitles:'French',source_version:'English with French subtitles'}]),
  localeFilm('unknown')
]};
const localeSearch=query=>searchModule.queryFilms(localeProgramme,{...searchModule.emptySearch(),query},{now:Date.parse('2098-12-31T12:00:00Z')});
const localeIds=query=>localeSearch(query).map(film=>film.id).sort();
for(const query of ['Spanish','espanol','ESPAÑOL','espanyol','castellano','castellà','span']){
  assert.deepEqual(localeIds(query),['audio-only','origin-es','spoken-es'],query);
}
for(const query of ['Catalan','catalán','catala','català']){
  assert.deepEqual(localeIds(query),['audio-only','origin-ca','spoken-ca'],query);
}
for(const query of ['French','frances','francès','français']){
  assert.deepEqual(localeIds(query),['audio-only','origin-fr','spoken-fr'],query);
}
for(const query of ['France','Francia','França'])assert(localeIds(query).includes('origin-fr'),query);
assert.deepEqual(localeIds('Francia'),['origin-fr']);
assert.deepEqual(localeIds('México'),['spoken-es']);
assert.deepEqual(localeIds('Mexican'),['spoken-es']);
assert.deepEqual(localeIds('Espanya'),['origin-es']);
assert.deepEqual(localeIds('Cataluña'),['origin-ca']);
assert.deepEqual(localeIds('frances Spain'),[]);
assert.deepEqual(localeIds('espanol unknown'),[]);
assert.deepEqual(localeSearch('espanol IMAX 2099-01-01').map(film=>({id:film.id,sessions:film.sessions.map(s=>s.id)})),
  [{id:'audio-only',sessions:['audio-es']}]);
assert.deepEqual(localeSearch('French').find(film=>film.id==='audio-only').sessions.map(s=>s.id),['audio-fr']);
assert.deepEqual(localeSearch('català').find(film=>film.id==='audio-only').sessions.map(s=>s.id),['audio-ca']);
assert.deepEqual(localeSearch('Japanese').map(film=>film.sessions.map(s=>s.id)),[['audio-multi']]);
assert.deepEqual(localeIds('Spanish 2099-01-02'),[]);
for(const [country,language,queries] of [
  ['Germany','Alemán',['German','alemany','Alemania']],
  ['Italy','Italian',['italiano','italià','Italia']],
  ['Portugal','Português',['Portuguese','portugués','portuguès']],
  ['Japan','Japonés',['Japanese','japonès','Japó']],
  ['South Korea','Coreano',['Korean','coreà','Corea del Sud']],
  ['Romania','Rumano',['Romanian','romanès','Rumanía']]
]){
  localeProgramme.films.push(localeFilm('additional',{languages:[language],countries:[country]}));
  for(const query of queries)assert(localeIds(query).includes('additional'),query);
  localeProgramme.films.pop();
}
// Existing UI state uses the same aliases without needing a programme refresh.
const indexedProgramme={cinemas:[{id:'test',name:'Test cinema'}],films:[{
  id:'indexed',title:'The Day After Tomorrow',details:{languages:['Spanish']},
  sessions:[session('indexed-session',['IMAX'],true)]
}]};
const index=searchModule.createSearchIndex(indexedProgramme);
const indexedFilters={...searchModule.emptySearch(),query:'español IMAX'};
assert.deepEqual(searchModule.queryFilms(indexedProgramme,indexedFilters,{index}).map(f=>f.id),['indexed']);
assert.equal(searchModule.parseFilmQuery(indexedProgramme,'The Day After Tomorrow','2099-01-01',index).range,null);
assert.deepEqual(searchModule.queryFilms(indexedProgramme,indexedFilters,{index,now:Date.parse('2099-01-02')}),[]);
const refreshed=JSON.parse(JSON.stringify(indexedProgramme));
refreshed.films[0].details.languages=['French'];
assert.deepEqual(searchModule.queryFilms(refreshed,indexedFilters,{index}),[]);
assert.deepEqual(searchModule.queryFilms(refreshed,{...indexedFilters,query:'francès IMAX'},{index}).map(f=>f.id),['indexed']);
context.fixtures=localeProgramme;
vm.runInContext('data=fixtures',context);
assert.deepEqual(search('espanol IMAX'),[{id:'audio-only',sessions:['audio-es']}]);
// A shared link to a newly included cinema survives an older browser cache.
context.document.getElementById=()=>({value:''});
vm.runInContext(`
  setLanguage=()=>{};restoreLink=()=>{};syncURL=()=>{};startWebMCP=()=>{};
  Object.assign(state,emptySearch(),{cinema_ids:['cinebaix']});
  useProgramme({cinemas:[],films:[]},{cached:true});
`,context);
assert.equal(vm.runInContext('state.cinema_ids[0]',context),'cinebaix');
vm.runInContext("useProgramme({cinemas:[{id:'cinebaix'}],films:[]})",context);
assert.equal(vm.runInContext('state.cinema_ids[0]',context),'cinebaix');
vm.runInContext("useProgramme({cinemas:[],films:[]})",context);
assert.equal(vm.runInContext('state.cinema_ids.length',context),0);
console.log('Film search: credits, language/country aliases, audio vs subtitles, dates, session formats and safe rendering passed.');

}
main().catch(error=>{console.error(error);process.exitCode=1;});
