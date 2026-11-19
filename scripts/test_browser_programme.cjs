const assert=require('node:assert/strict');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');

(async()=>{
  const {createSearchIndex,emptySearch,queryFilms}=await import('../static/cinema-search.js');
  const {createCinemaService}=await import('../static/cinema-service.js');
  const {hydrateProgramme}=await import('../static/programme-data.js');
  const source=JSON.parse(fs.readFileSync('static/preview-data/screenings.json'));
  const compact=JSON.parse(execFileSync('.venv/bin/python',['-c',
    'import sys,json;sys.path.insert(0,"scripts");from browser_programme import browser_programme;print(json.dumps(browser_programme(json.load(sys.stdin))))'],
    {input:JSON.stringify(source),maxBuffer:20*1024*1024}));
  const originalIndex=createSearchIndex(source),compactIndex=createSearchIndex(compact),now=Date.now();
  const queries=new Set(['','English','francés','España','IMAX','today','this weekend','2026','70mm']);
  for(const film of source.films){
    for(const word of [film.title,film.original_title,film.details?.directors?.[0],film.details?.cast?.[0],film.details?.search_aliases?.at(-1),film.details?.release_dates?.[0]?.region])if(word)queries.add(word);
  }
  const ids=films=>films.map(film=>[film.id,film.sessions.map(session=>session.id)]);
  for(const query of queries){
    const filters={...emptySearch(),query};
    assert.deepEqual(ids(queryFilms(compact,filters,{now,index:compactIndex})),ids(queryFilms(source,filters,{now,index:originalIndex})),query);
  }
  const service=data=>createCinemaService({getProgramme:()=>data,getAvailability:()=>({sessions:new Map(),errors:new Set()}),
    getView:()=>({language:'en',filters:emptySearch()}),getURL:()=> 'http://localhost/cinemas.html',now:()=>now});
  const before=service(source),after=service(compact);
  assert.deepEqual(after.get_context(),before.get_context());
  for(const film of source.films){
    assert.deepEqual(after.get_film({film_id:film.id}),before.get_film({film_id:film.id}));
    for(const session of film.sessions.slice(0,1))assert.deepEqual(after.get_screening({screening_id:session.id}),before.get_screening({screening_id:session.id}));
  }
  const wire={films:[{urls:{en:'/en/films/dune/',es:'/es/peliculas/dune/'},sessions:[{id:'s',anchor:'#screening-123'}]}]};
  const expanded=hydrateProgramme(wire);
  assert.equal(expanded.films[0].sessions[0].urls.es,'/es/peliculas/dune/#screening-123');
  assert.equal(wire.films[0].sessions[0].urls,undefined,'The smaller browser cache must stay unexpanded');
  console.log(`${queries.size} searches return identical films/screenings; film details, ratings, source references and WebMCP results are unchanged.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
