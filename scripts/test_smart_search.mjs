import test from 'node:test';
import assert from 'node:assert/strict';
import {emptySearch,createSearchIndex,interpretSearch,queryFilms,searchParams,searchFromURL} from '../static/cinema-search.js';
import {emptyIntent,validateIntent,conditionId,parseIntent,filmMatchReason,searchExplanation,intentChips} from '../static/search-intent.js';
import {parseLanguages,screeningAudio} from '../static/screening-language.js';
import {createSmartSearch,rankSemantic,semanticDocument,filmDocument} from '../src/smart-search.mjs';
import {createSmartSearchUI} from '../static/smart-search-ui.js';
import {execFileSync} from 'node:child_process';
import {LANGUAGE_LABELS} from '../static/language-labels.js';

const now=Date.parse('2099-01-01T10:00:00Z');
const session=(id,provider='mooby',time='21:00')=>({id,provider,cinema_id:provider,starts_at:'2099-01-01T'+time+':00+01:00',date:'2099-01-01',time,language:'English',formats:['IMAX']});
const film=(id,extra={})=>({id,title:id,details:{genres:['Comedy'],countries:['France'],languages:['English'],runtime_minutes:110},ratings:{rotten_tomatoes:{score:81,count:100,certified_fresh:true,audience:{score:70}},imdb:{score:7.5}},sessions:[session(id)],...extra});
const programme={generated_at:'2099-01-01T08:00:00Z',cinemas:[{id:'mooby',name:'Balmes',short:'Balmes'},{id:'cinesa',name:'Diagonal Mar',short:'Diagonal Mar'}],films:[
  film('above'),film('boundary',{ratings:{rotten_tomatoes:{score:80,count:100,certified_fresh:false,audience:{score:99}}}}),
  film('few-reviews',{ratings:{rotten_tomatoes:{score:99,count:2}}}),
  film('spanish-french',{details:{genres:['Horror'],countries:['Spain'],languages:['French'],runtime_minutes:150},sessions:[{...session('spanish-french','cinesa'),language:'French'}]}),
  film('unknown',{details:{},ratings:{},sessions:[{...session('unknown'),language:null}]}),
  film('mixed',{sessions:[session('early','mooby','18:00'),session('late','cinesa','21:00')]}),
  film('funny-games',{title:'Funny Games',details:{genres:['Horror']}})
]};
const search=(query,extra={},options={})=>queryFilms(programme,{...emptySearch(),query,...extra},{now,index:createSearchIndex(programme),...options});
const ids=(query,extra)=>search(query,extra).map(f=>f.id).sort();
test('English subtitle searches run locally in all locales and match the same screening',async()=>{
  const p={...programme,cinemas:[{id:'mooby',area:'Barcelona · Eixample'},{id:'cinesa',area:'Sant Cugat del Vallès'}],films:[
    film('spanish',{sessions:[{...session('spanish'),language:'Espanyol,',subtitles:'English'}]}),
    film('mixed',{sessions:[{...session('mixed'),language:'Swedish, French, English',subtitles:'Anglès,'}]}),
    film('english',{sessions:[{...session('english'),language:'English',subtitles:'EN'}]}),
    film('unknown-audio',{details:{},sessions:[{...session('unknown-audio'),language:null,subtitles:'Inglés'}]}),
    film('unknown-subs',{sessions:[{...session('unknown-subs'),language:'French',version:'VOSI',subtitles:null}]}),
    film('partial-subs',{sessions:[{...session('partial-subs'),language:'French',subtitles:'Catalan, unclear'}]}),
    film('split',{sessions:[{...session('french'),language:'French',subtitles:'Spanish'},
      {...session('english-subs','cinesa'),language:'English',subtitles:'English'}]})
  ]};
  const api=createSmartSearch({getProgramme:async()=>p,apiKey:'test',now:()=>now,fetchImpl:()=>assert.fail('Subtitle searches need no model')});
  const results=query=>queryFilms(p,{...emptySearch(),query},{now}).map(f=>f.id).sort();
  for(const query of ['English subtitles','with subtitles in English','VOSI','VOSA','películas con subtítulos en inglés','pel·lícules amb subtítols en anglès']){
    assert.equal((await api.search({query})).mode,'local',query);
    assert.deepEqual(results(query),['english','mixed','spanish','split','unknown-audio'],query);
    assert(!parseIntent(query,{programme:p}).conditions.some(c=>c.field==='language'),query);
  }
  assert.deepEqual(results('foreign language films with English subtitles'),['mixed','spanish']);
  assert.deepEqual(results('in French with English subtitles'),['mixed']);
  assert.deepEqual(results('English subtitles in Barcelona'),['english','mixed','spanish','unknown-audio']);
  assert.deepEqual(results('without English subtitles'),['split']);
  assert.deepEqual(results('in English with Spanish subtitles'),[],'Never join facts across versions');
  const filters={...emptySearch(),query:'in French with English subtitles',ignored_filters:['subtitles:eq:english']};
  assert(queryFilms(p,filters,{now}).some(f=>f.id==='split'),'The subtitle chip is removable');
  const query='foreign language films with English subtitles in Barcelona';
  assert.equal((await api.search({query})).mode,'local');
  assert.deepEqual(results(query),['mixed','spanish']);
  assert.match(intentChips(parseIntent('subtítols en anglès'),'ca')[0].label,/Subtítols anglès/);
});
test('audio derives only from verified original-language evidence for that screening',()=>{
  const f=film('belle',{details:{language_status:{state:'conflict'},language_reports:[{
    status:'ok',evidence:'explicit_original_language',source_url:'https://cinema.example/belle',languages:['Swedish','French','English']}]}});
  const s={...session('belle'),version:'VOSI',language:null,subtitles:'English',source_url:'https://cinema.example/belle'};
  assert.deepEqual(screeningAudio(f,s).codes,['sv','fr','en']);
  for(const change of [{source_url:'https://other.example'}, {version:'dubbed'}, {original_audio:false}])
    assert.deepEqual(screeningAudio(f,{...s,...change}).codes,[]);
  assert.deepEqual(screeningAudio(f,{...s,language:'Spanish'}).codes,['es']);
  assert.deepEqual(parseLanguages('British English / Castellano; Català,').codes,['en','es','ca']);
  assert.equal(parseLanguages('English, unclear').complete,false);
});
test('browser and page language recognition share all collector aliases and audio precedence',()=>{
  const labels=JSON.parse(execFileSync('python3',['-c','import sys,json;sys.path.insert(0,"scripts");from language_names import LABELS;print(json.dumps(LABELS))'],{encoding:'utf8'}));
  assert.deepEqual(LANGUAGE_LABELS,labels,'Regenerate language-labels.js after changing collector labels');
  for(const [code,values] of Object.entries(labels))for(const label of [code,...values.split('|')])assert.deepEqual(parseLanguages(label).codes,[code],label);
  const fixtures=[
    [{}, {language:'English, French',version:'VOSI',subtitles:'English'}],
    [{details:{language_selection:{evidence:'explicit_original_language',source_url:'https://example.com'},original_languages:['es']}}, {version:'VOSI'}],
    [{details:{language_reports:[{status:'ok',evidence:'explicit_original_language',source_url:'https://example.com',languages:['Swedish','English']}],language_status:{state:'conflict'}}}, {version:'VOSI',source_url:'https://example.com'}],
    [{details:{languages:['French']}}, {version:'VOSI',subtitles:'English'}],
    [{}, {language:'other languages',subtitles:'English'}],
  ];
  const expected=JSON.parse(execFileSync('python3',['-c','import sys,json;sys.path.insert(0,"scripts");from screening_languages import screening_audio;print(json.dumps([screening_audio(f,s) for f,s in json.load(sys.stdin)]))'],{input:JSON.stringify(fixtures),encoding:'utf8'}));
  assert.deepEqual(fixtures.map(([f,s])=>({...screeningAudio(f,s),source_url:screeningAudio(f,s).source_url??null})),expected);
});
test('strict rating comparisons preserve boundary, source and unknown values',()=>{
  assert.deepEqual(ids('rt > 80%'),['above','few-reviews','funny-games','mixed','spanish-french']);
  assert(ids('rt >=80').includes('boundary'));
  assert.deepEqual(ids('rt audience >80'),['boundary']);
  assert.deepEqual(ids('good reviews'),['above','boundary','funny-games','mixed','spanish-french']);
  assert.deepEqual(ids('imdb >=7.5').includes('above'),true);
  assert.deepEqual(ids('rt >80% nonsense'),[]);
});
test('origin, language, genres and exclusions use distinct factual fields',()=>{
  assert.deepEqual(ids('from France'),['above','boundary','few-reviews','mixed']);
  assert.deepEqual(ids('in French'),['spanish-french']);
  assert.deepEqual(ids('funny movies'),['above','boundary','few-reviews','mixed']);
  assert.deepEqual(ids('películas divertidas de Francia'),ids('funny movies from France'));
  assert.deepEqual(ids('pel·lícules divertides de França'),ids('funny movies from France'));
  assert(!ids('not horror').includes('unknown'));
  assert.deepEqual(ids('Funny Games'),['funny-games'],'An exact film title must not turn into a genre filter');
});
test('topic phrases do not silently become mandatory genre filters',()=>{
  for(const query of ['civil war','family secrets','action against injustice','civil war movies from France']){
    const plan=parseIntent(query,{programme});
    assert(!plan.conditions.some(c=>c.field==='genre'),query);
    assert(plan.text.includes(query.split(' ')[0]),query);
  }
  assert.deepEqual(parseIntent('war films at mooby',{programme}).conditions.map(c=>c.field).sort(),['genre','provider']);
  assert(parseIntent('civil war not horror',{programme}).conditions.some(c=>c.field==='genre'&&c.op==='ne'&&c.value==='Horror'));
});
test('plots and source authors are searchable even when another title already matches',()=>{
  const p={...programme,films:[
    film('bola',{title:'La bola negra',synopsis:'Una obra inacabada de Federico García Lorca.',details:{genres:['Drama']}}),
    film('lorca',{title:'Lorca, la voz quebrada',details:{source_authors:['Federico García Lorca']}}),
    film('marketing',{synopsis:'Discover reviews, ratings, and trailers for Lorca on Rotten Tomatoes. Stay updated with critic and audience scores today!'})
  ]};
  for(const query of ['lorca','Federico García Lorca']){
    const rows=queryFilms(p,{...emptySearch(),query},{now,index:createSearchIndex(p)});
    assert.deepEqual(rows.map(f=>f.id).sort(),['bola','lorca']);
  }
});
test('qualified producer searches match producing credits, not acting credits',()=>{
  const p={...programme,films:[film('produced',{details:{producers:['Brad Pitt']}}),film('acted',{details:{cast:['Brad Pitt']}}),film('unknown',{details:{}})]};
  for(const query of ['produced by brad pitt','producida por Brad Pitt','produïda per Brad Pitt']){
    const index=createSearchIndex(p),filters={...emptySearch(),query},plan=interpretSearch(p,filters,{index,now});
    assert.equal(plan.text,'');assert.deepEqual(plan.conditions,[{field:'producer',op:'eq',value:'Brad Pitt'}]);
    assert.deepEqual(queryFilms(p,filters,{index,now}).map(f=>f.id),['produced']);
  }
});
test('company associations include distribution while produced by remains a production credit',async()=>{
  const p={...programme,films:[film('produced',{details:{studios:['A24']}}),film('distributed',{details:{studios:['Annapurna Pictures'],distributors:['A24']}}),film('unrelated')]};
  for(const query of ['a24','A24 films','films from A24']){
    const index=createSearchIndex(p),filters={...emptySearch(),query};
    const plan=interpretSearch(p,filters,{index,now});
    assert.equal(plan.text,'');assert.deepEqual(plan.conditions,[{field:'company',op:'eq',value:'A24'}]);
    assert.deepEqual(queryFilms(p,filters,{index,now}).map(f=>f.id).sort(),['distributed','produced']);
    assert.equal(filmMatchReason(p.films[1],plan).label,'Distributed by: A24');
  }
  assert.deepEqual(queryFilms(p,{...emptySearch(),query:'produced by A24'},{now}).map(f=>f.id),['produced']);
  assert.deepEqual(queryFilms(p,{...emptySearch(),query:'distributed by A24'},{now}).map(f=>f.id),['distributed']);
  const api=createSmartSearch({getProgramme:async()=>p,apiKey:'test',now:()=>now,fetchImpl:()=>assert.fail('Known companies need no model')});
  assert.equal((await api.search({query:'a24'})).mode,'local');
});
test('new releases use an explicit current year without requiring unavailable precise dates',async()=>{
  const p={...programme,films:[2098,2099,2100,null].map(year=>film('release-'+year,{release_year:year}))};
  const index=createSearchIndex(p);
  for(const query of ['new releases','latest releases','estrenos','novetats','new releases from France']){
    const filters={...emptySearch(),query},plan=interpretSearch(p,filters,{index,now});
    assert.equal(plan.text,'');assert.deepEqual(plan.unsupported,[]);
    assert.deepEqual(queryFilms(p,filters,{index,now}).map(f=>f.id),['release-2099']);
  }
  assert.equal(interpretSearch(p,{...emptySearch(),query:'new releases'},{index,now:Date.parse('2098-12-31T22:59Z')}).conditions[0].value,'2098');
  assert.equal(interpretSearch(p,{...emptySearch(),query:'new releases'},{index,now:Date.parse('2098-12-31T23:01Z')}).conditions[0].value,'2099');
  assert.deepEqual(parseIntent('new releases this week',{programme:p,today:'2099-01-01'}).conditions,[]);
  const api=createSmartSearch({getProgramme:async()=>p,apiKey:'test',now:()=>now,fetchImpl:()=>assert.fail('New releases need no model')});
  assert.equal((await api.search({query:'new releases'})).mode,'local');
});
test('country match explanations identify co-productions and use recorded source evidence',()=>{
  const f=film('coproduction',{details:{countries:['France','Italy'],country_provenance:[{country:'Italy',sources:[{source:'CNC',source_url:'https://example.com/credits'}]}]}});
  const plan=parseIntent('movies from Italy',{programme});
  assert.deepEqual(filmMatchReason(f,plan),{label:'Co-production: France / Italy',sourceURL:'https://example.com/credits',source:'CNC'});
  assert.equal(searchExplanation(plan),'Includes co-productions');
  assert.equal(filmMatchReason(f,emptyIntent()),null);
});
test('release decades use original years, include both boundaries and exclude unknowns',()=>{
  const p={...programme,films:[1969,1970,1974,1979,1980,null].map(year=>film('year-'+year,{release_year:year,details:{release_dates:[{date:'1975-01-01',kind:'theatrical'}]}}))};
  for(const query of ['70’s released',"70's released",'1970s movies','released in the 1970s']){
    const index=createSearchIndex(p),filters={...emptySearch(),query};
    assert.equal(interpretSearch(p,filters,{index,now}).text,'');
    assert.deepEqual(queryFilms(p,filters,{index,now}).map(f=>f.release_year).sort(),[1970,1974,1979],query);
  }
  assert.deepEqual(queryFilms(p,{...emptySearch(),query:'released in 1974'},{now}).map(f=>f.release_year),[1974]);
  assert.deepEqual(parseIntent('set in the 1970s',{programme:p}).conditions,[]);
  assert.throws(()=>validateIntent({...emptyIntent(),conditions:[{field:'release_year',op:'gte',value:'70'}]},p));
});
test('an unsupported request cannot expand into unrelated catalogue matches',()=>{
  const intent={...emptyIntent(),unsupported:['Wheelchair access is not in the catalogue']};
  assert.deepEqual(search('wheelchair accessible',{}, {intent}),[]);
});
test('black-and-white queries use verified colour metadata and exclude colour or unknown films',async()=>{
  const p={...programme,films:[film('monochrome',{details:{colours:['black-and-white']}}),film('colour',{details:{colours:['color']}}),film('mixed',{details:{colours:['black-and-white','color']}}),film('unknown',{details:{}})]};
  for(const query of ['black and white','black-and-white films','blanco y negro','blanc i negre']){
    assert.deepEqual(queryFilms(p,{...emptySearch(),query},{now}).map(f=>f.id),['monochrome']);
  }
  const api=createSmartSearch({getProgramme:async()=>p,apiKey:'test',now:()=>now,fetchImpl:()=>assert.fail('Verified colour needs no model call')});
  assert.equal((await api.search({query:'black and white'})).mode,'local');
});
test('film knowledge can retrieve a low-vector candidate but cannot bypass factual filters',async()=>{
  const p={...programme,films:[film('known-classic',{details:{countries:['France']}}),film('actor-only',{details:{countries:['Spain']}})]};
  const api=createSmartSearch({getProgramme:async()=>p,apiKey:'test',dimensions:2,now:()=>now,fetchImpl:async(url,opts)=>{
    const body=JSON.parse(opts.body);
    if(url.endsWith('/embeddings'))return {ok:true,json:async()=>({data:body.input.map((text,index)=>({index,embedding:text.includes('guns')?[1,0]:[0,1]}))})};
    assert.equal(JSON.parse(body.input[1].content[0].text).catalogue.length,2);
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...emptyIntent(),semantic_query:'lots of guns',film_matches:[0,1]})}]}]})};
  }});
  const r=await api.search({query:'lots of guns from France'});
  assert.equal(r.semantic_scores.length,2);
  const rows=queryFilms(p,{...emptySearch(),query:'lots of guns from France'},{now,intent:r.intent,semanticScores:r.semantic_scores});
  assert.deepEqual(rows.map(f=>f.id),['known-classic']);
});
test('embedding documents include complementary plots and credits beyond the first eight cast',()=>{
  const doc=filmDocument(film('story',{synopsis:'A family separated by conflict.',details:{synopsis:'Discover reviews, ratings, and trailers for Story on Rotten Tomatoes.',
    synopses:['An unfinished play inspires three generations.'],cast:Array.from({length:15},(_,i)=>'Actor '+i),writers:['Writer'],source_authors:['Author'],based_on:['A play']},sessions:[{...session('story'),synopsis:'Three men in 1932, 1937 and 2017.'}]}));
  for(const text of ['family separated','unfinished play','1937','Actor 14','Writer','Author','A play'])assert(doc.includes(text),text);
  assert(!doc.includes('Discover reviews'));
});
test('large full-dimension embeddings are the default and old small vectors are not reused',async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const cacheDirectory=await mkdtemp(join(tmpdir(),'vobarna-vector-migration-'));
  try{
    await writeFile(join(cacheDirectory,'embeddings.json'),JSON.stringify({model:'text-embedding-3-small',dimensions:512,values:{old:Array(512).fill(1)}}));
    let calls=0;
    const api=createSmartSearch({getProgramme:async()=>programme,apiKey:'test',cacheDirectory,fetchImpl:async(url,opts)=>{
      const body=JSON.parse(opts.body);calls++;
      assert.equal(body.model,'text-embedding-3-large');assert.equal(body.dimensions,3072);
      return {ok:true,json:async()=>({data:body.input.map((_,index)=>({index,embedding:Array(3072).fill(1)}))})};
    }});
    await api.warm();assert.equal(calls,0,'Startup never creates embeddings');
    await api.warm({refresh:true});assert.equal(calls,1);assert.equal(api.status().dimensions,3072);
    await api.warm({refresh:true});assert.equal(calls,1);
  }finally{await rm(cacheDirectory,{recursive:true,force:true});}
});
test('a local topic hit does not prevent the UI from requesting semantic results',async()=>{
  const p={...programme,films:[film('keyword',{synopsis:'A civil war divides a country.'}),film('semantic',{synopsis:'A rebellion tears families apart.'})]};
  let calls=0;
  const ui=createSmartSearchUI({getProgramme:()=>p,getIndex:()=>createSearchIndex(p),getFilters:()=>({...emptySearch(),query:'civil war'}),getLanguage:()=> 'en',onResult:()=>{},onStatus:()=>{},delay:0,
    fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({query:'civil war',intent:{...emptyIntent(),semantic_query:'civil war'},semantic_scores:[{film_id:'keyword',score:.8},{film_id:'semantic',score:.75}],mode:'semantic'})};}});
  ui.update();await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(calls,1);assert.equal(ui.current().semanticScores.length,2);ui.cancel();
});
test('Certified Fresh requires a sourced badge, not a high score',()=>{
  assert.deepEqual(ids('certified fresh'),['above','funny-games','mixed','spanish-french']);
  assert(!ids('certified fresh').includes('few-reviews'));
  assert.deepEqual(ids('not certified fresh'),['boundary']);
});
test('regional cinema reaches AI discovery without invented country or language constraints',async()=>{
  let calls=0;
  const api=createSmartSearch({getProgramme:async()=>programme,apiKey:'test',dimensions:2,now:()=>now,fetchImpl:async(url,opts)=>{
    const body=JSON.parse(opts.body);
    if(url.endsWith('/embeddings'))return {ok:true,json:async()=>({data:body.input.map((_,index)=>({index,embedding:[1,0]}))})};
    calls++;
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...emptyIntent(),semantic_query:'Catalan cinema',sort:'relevance',film_matches:[1,0,4]})}]}]})};
  }});
  for(const query of ['from catalonia','from catalunya','de Cataluña','cinema català','not from Catalonia']){
    const local=parseIntent(query,{programme});
    assert.deepEqual(local.unsupported,[],query);assert.deepEqual(local.conditions,[],query);assert.equal(local.text,query);
  }
  const query='from catalunya rt >80';
  const result=await api.search({query});
  assert.equal(calls,1);assert.equal(result.mode,'semantic');assert.deepEqual(result.intent.unsupported,[]);
  assert.deepEqual(result.intent.conditions,[{field:'rating_rt',op:'gt',value:'80'}]);
  assert.deepEqual(queryFilms(programme,{...emptySearch(),query},{now,intent:result.intent,semanticScores:result.semantic_scores}).map(f=>f.id),['above'],'exact ratings still reject selected films with lower or missing scores');
  assert.equal(searchExplanation(result.intent),'');
  assert.deepEqual(parseIntent('from catalunya in Catalan',{programme}).conditions,[{field:'language',op:'eq',value:'Catalan'}]);
  const offline=createSmartSearch({getProgramme:async()=>programme,apiKey:'',now:()=>now});
  assert.equal((await offline.search({query:'from catalunya'})).mode,'unavailable','only a real provider limitation uses the unavailable state');
});
test('duration, time and chain conditions apply to each matching screening',()=>{
  assert.deepEqual(ids('under two hours from France'),['above','boundary','few-reviews','mixed']);
  const result=search('cinesa after 8pm').find(f=>f.id==='mixed');
  assert.deepEqual(result.sessions.map(s=>s.id),['late']);
  assert(!ids('mooby after 8pm').includes('mixed'));
  assert(search('mooby or cinesa').some(f=>f.id==='mixed'&&f.sessions.length===2));
});
test('removing a parsed filter is shareable and does not change the original query',()=>{
  const filters={...emptySearch(),query:'funny movies rt >80',ignored_filters:[conditionId({field:'rating_rt',op:'gt',value:'80'})]};
  const restored=searchFromURL(searchParams(filters));assert.deepEqual(restored,filters);
  assert(search(restored.query,restored).some(f=>f.id==='boundary'));
  assert(!search(restored.query).some(f=>f.id==='boundary'));
});
test('semantic ranking cannot relax exact constraints',()=>{
  const intent={...emptyIntent(),semantic_query:'uplifting',sort:'relevance',conditions:[{field:'country',op:'eq',value:'France'}]};
  const results=search('uplifting from France',{}, {intent,semanticScores:[{film_id:'spanish-french',score:.9},{film_id:'above',score:.7},{film_id:'boundary',score:.8}]});
  assert.deepEqual(results.map(f=>f.id),['boundary','above']);
  assert.deepEqual(search('uplifting',{}, {intent,semanticScores:[]}),[]);
  assert.equal(rankSemantic([{id:'a'},{id:'b'}],new Map([['a',[1,0]],['b',[0,1]]] ),[1,0]).length,1);
});
test('model interpretations are validated before use',()=>{
  for(const conditions of [[{field:'checkout',op:'eq',value:'yes'}],[{field:'rating_rt',op:'gt',value:'101'}],[{field:'cinema',op:'eq',value:'invented'}],[{field:'date',op:'eq',value:'2099-02-30'}]])assert.throws(()=>validateIntent({...emptyIntent(),conditions},programme));
});
test('AI interprets subjective ratings on the named source without sticky RT defaults',async()=>{
  const p={...programme,films:[film('high-imdb',{ratings:{imdb:{score:9},rotten_tomatoes:{score:20,count:1}}}),film('high-rt',{ratings:{imdb:{score:6},rotten_tomatoes:{score:99,count:100}}})]};
  for(const query of ['highly rated on imdb','good reviews on IMDb','bien valoradas en IMDb','ben valorades a IMDb']){
    assert.deepEqual(interpretSearch(p,{...emptySearch(),query},{index:createSearchIndex(p),now}).conditions,[]);
  }
  let calls=0;
  const intent={...emptyIntent(),conditions:[{field:'rating_imdb',op:'gte',value:'7.5'}],sort:'rating'};
  const api=createSmartSearch({getProgramme:async()=>p,apiKey:'test',dimensions:2,now:()=>now,fetchImpl:async(url,opts)=>{
    const body=JSON.parse(opts.body);
    if(url.endsWith('/embeddings'))return {ok:true,json:async()=>({data:body.input.map((_,index)=>({index,embedding:[1,0]}))})};
    calls++;assert.deepEqual(JSON.parse(body.input[2].content[0].text).deterministic,[]);
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(intent)}]}]})};
  }});
  const result=await api.search({query:'highly rated on imdb'});
  assert.equal(calls,1);assert.equal(result.mode,'interpreted');assert.deepEqual(result.intent.conditions,intent.conditions);
  assert.deepEqual(queryFilms(p,{...emptySearch(),query:'highly rated on imdb'},{index:createSearchIndex(p),now,intent:result.intent}).map(f=>f.id),['high-imdb']);
  const ordered=queryFilms(p,{...emptySearch()},{index:createSearchIndex(p),now,intent:{...intent,conditions:[{field:'rating_imdb',op:'gte',value:'5'}]}});
  assert.deepEqual(ordered.map(f=>f.id),['high-imdb','high-rt']);
});
test('similarity uses a real catalogue synopsis when the reference film is known',()=>{
  const films=[film('amelie',{title:'Amélie',synopsis:'A shy waitress helps the people around her.'})];
  assert.match(semanticDocument('something like Amelie',films),/shy waitress/);
  assert.equal(semanticDocument('uplifting',films),'uplifting');
  assert.equal(semanticDocument('similar to an unknown film',films),'similar to an unknown film');
});

test('AI calls are bounded, coalesced and reset their quota on a new day',async()=>{
  let stamp=now,calls=0;
  const api=createSmartSearch({getProgramme:async()=>programme,apiKey:'test',dimensions:2,dailyLimit:1,now:()=>stamp,fetchImpl:async(url,opts)=>{
    if(url.endsWith('/embeddings'))return {ok:true,json:async()=>({data:JSON.parse(opts.body).input.map((_,index)=>({index,embedding:[1,0]}))})};
    calls++;await new Promise(done=>setTimeout(done,10));
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(emptyIntent())}]}]})};
  }});
  await Promise.all([api.search({query:'uplifting'}),api.search({query:'uplifting'})]);
  assert.equal(calls,1);
  await assert.rejects(api.search({query:'heartwarming'}),{code:'rate_limited'});
  assert.equal((await api.search({query:'rt >80'})).mode,'local');
  stamp+=86400000;await api.search({query:'heartwarming'});assert.equal(calls,2);
});

test('AI interpretation is cached, embeddings are reused, and local constraints survive',async()=>{
  let requests=[];
  const plan={...emptyIntent(),semantic_query:'uplifting',sort:'relevance'};
  const fetchImpl=async(url,opts)=>{
    const body=JSON.parse(opts.body);requests.push({url,body});
    if(url.endsWith('/embeddings'))return {ok:true,json:async()=>({data:body.input.map((_,index)=>({index,embedding:[1,0]}))})};
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}]})};
  };
  const api=createSmartSearch({getProgramme:async()=>programme,apiKey:'test-key',dimensions:2,fetchImpl,now:()=>now});
  await api.warm({refresh:true});const warmRequests=requests.length;
  const first=await api.search({query:'uplifting from France',language:'en'});
  assert(first.intent.conditions.some(c=>c.field==='country'&&c.value==='France'));
  assert.equal(first.mode,'semantic');assert(first.semantic_scores.length);
  const count=requests.length;const second=await api.search({query:'uplifting from France',language:'en'});
  assert.equal(second.cached,true);assert.equal(requests.length,count);
  await api.warm({refresh:true});assert.equal(requests.length,count);assert.equal(count-warmRequests,2);
  assert.equal(requests.find(r=>r.url.endsWith('/responses')).body.reasoning.effort,'low');
  assert.equal(requests.find(r=>r.url.endsWith('/responses')).body.store,false);
});
test('missing credentials and provider failures preserve the local interpretation',async()=>{
  const offline=createSmartSearch({getProgramme:async()=>programme,apiKey:'',now:()=>now});
  assert.equal((await offline.search({query:'uplifting from France'})).mode,'unavailable');
  assert.equal((await offline.search({query:'rt >80'})).mode,'local');
  const failing=createSmartSearch({getProgramme:async()=>programme,apiKey:'test',now:()=>now,fetchImpl:async()=>({ok:false,status:503})});
  await assert.rejects(failing.search({query:'uplifting'}));
});
test('out-of-order smart responses cannot overwrite a newer query or reset',async()=>{
  let filters={...emptySearch(),query:'uplifting'},resolveResponse,updates=0;
  const ui=createSmartSearchUI({getProgramme:()=>programme,getIndex:()=>createSearchIndex(programme),getFilters:()=>filters,getLanguage:()=> 'en',onResult:()=>updates++,onStatus:()=>{},delay:0,
    fetchImpl:()=>new Promise(resolve=>{resolveResponse=resolve;})});
  ui.update();await new Promise(resolve=>setTimeout(resolve,10));
  filters={...emptySearch(),query:'rt >80'};ui.update();
  resolveResponse({ok:true,json:async()=>({query:'uplifting',intent:emptyIntent(),semantic_scores:null,mode:'interpreted'})});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(ui.current(),null);assert.equal(updates,0);ui.cancel();
});
test('semantic responses tolerate films outside a scoped or older browser catalogue',async()=>{
  const ui=createSmartSearchUI({getProgramme:()=>programme,getIndex:()=>createSearchIndex(programme),getFilters:()=>({...emptySearch(),query:'something uplifting'}),getLanguage:()=> 'en',onResult:()=>{},onStatus:()=>{},delay:0,
    fetchImpl:async()=>({ok:true,json:async()=>({query:'something uplifting',intent:{...emptyIntent(),semantic_query:'uplifting'},semantic_scores:[{film_id:'new-film',score:.9},{film_id:'above',score:.8}],mode:'semantic'})})});
  ui.update();await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(ui.current().semanticScores,[{film_id:'above',score:.8}]);ui.cancel();
});
test('cancel clears progress and allows the same interrupted query to be submitted again',async()=>{
  const responses=[],statuses=[];let updates=0;
  const ui=createSmartSearchUI({getProgramme:()=>programme,getIndex:()=>createSearchIndex(programme),getFilters:()=>({...emptySearch(),query:'something uplifting'}),getLanguage:()=> 'en',onResult:()=>updates++,onStatus:status=>statuses.push(status),delay:0,
    fetchImpl:()=>new Promise(resolve=>responses.push(resolve))});
  ui.update();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(statuses.at(-1),'loading');
  ui.cancel();assert.equal(statuses.at(-1),'');
  ui.update();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(responses.length,2);assert.equal(statuses.at(-1),'loading');
  const response={ok:true,json:async()=>({query:'something uplifting',intent:emptyIntent(),semantic_scores:null,mode:'interpreted'})};
  responses[0](response);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(statuses.at(-1),'loading');assert.equal(updates,0);
  responses[1](response);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(statuses.at(-1),'');assert.equal(updates,1);ui.cancel();
});
