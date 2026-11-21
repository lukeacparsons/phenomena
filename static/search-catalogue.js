import {createSearchIndex,emptySearch,interpretSearch,queryFilms,normalise,madridDate} from './cinema-search.js';
import {languageRows,parseLanguages} from './screening-language.js';

const dates=['tonight','this weekend','today','tomorrow'];
// Only exact, still-valid factual suggestions may bypass semantic search.
// Normalising here would conflate distinct constraints such as < and >.
export function isVerifiedSuggestion(rows,query,{now=Date.now()}={}){
  if(typeof query!=='string')return false;
  const text=query.trim(),day=madridDate(now);
  return rows.some(row=>row.query===text&&row.day===day&&row.valid_until>now);
}
const genreLabels={Comedy:'Comedy films',Documentary:'Documentaries',Thriller:'Thriller films',Drama:'Drama films',Horror:'Horror films',Romance:'Romantic films',Animation:'Animated films','Science fiction':'Science fiction films',Family:'Family films'};
const genreAliases={Comedy:['Comedies'],Drama:['Dramas'],Thriller:['Thrillers']};
const countryLabels={France:'French films',Japan:'Japanese films',Spain:'Spanish films',Italy:'Italian films',Germany:'German films','South Korea':'Korean films','United States':'American films','United Kingdom':'British films'};
const lastShowing=films=>Math.max(0,...films.flatMap(f=>f.sessions.map(s=>Date.parse(s.starts_at))).filter(Number.isFinite));
const rankedValues=(films,key)=>{
  const counts=new Map();for(const film of films)for(const value of new Set(film.details?.[key]||[]))counts.set(value,(counts.get(value)||0)+1);
  return [...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a)||a.localeCompare(b));
};

// Rebuilt on programme changes and Madrid-day changes, outside the typing path.
export async function buildCatalogue(programme,now=Date.now()) {
  const index=createSearchIndex(programme),today=madridDate(now);
  const upcoming=queryFilms(programme,emptySearch(),{index,now});
  const people=new Map();
  for(const film of upcoming)for(const [key,role,phrase] of [['directors','Director','directed by'],['cast','Actor','starring']]){
    for(const name of film.details?.[key]||[]){
      const id=role.toLowerCase()+':'+name,until=lastShowing([film]);
      if(people.has(id)){people.get(id).valid_until=Math.max(people.get(id).valid_until,until);continue;}
      people.set(id,{kind:'person',entity_id:id,label:name,query:`Films ${phrase} ${name}`,detail:role,valid_until:until,
        aliases:role==='Director'?[`Films by ${name}`,`Directed by ${name}`,`By ${name}`]:[`Films with ${name}`,`With ${name}`,`Starring ${name}`]});
    }
  }
  const entities=[
    ...upcoming.map(f=>({kind:'film',entity_id:f.id,label:f.title,query:f.title,valid_until:lastShowing([f]),
      aliases:[f.original_title,f.english_title,...f.titles||[]].filter(Boolean),
      detail:['Film',f.release_year,f.details?.directors?.[0]].filter(Boolean).join(' · '),
      poster:f.poster_image?.variants?.[0]?.url||f.poster_url})),
    ...programme.cinemas.flatMap(c=>{
      const films=upcoming.map(f=>({...f,sessions:f.sessions.filter(s=>s.cinema_id===c.id)})).filter(f=>f.sessions.length);
      return films.length?[{kind:'cinema',entity_id:c.id,label:c.short||c.name,query:c.short||c.name,aliases:[c.name],detail:'Cinema · '+c.area,valid_until:lastShowing(films)}]:[];
    }),
    ...people.values()
  ];
  const validation=new Map();
  const validate=query=>{
    if(validation.has(query))return validation.get(query);
    const filters={...emptySearch(),query},intent=interpretSearch(programme,filters,{index,now});
    const eligible=!intent.unsupported.length&&!intent.semantic_query&&!intent.location_query&&!intent.venue_query;
    const rows=eligible?queryFilms(programme,filters,{index,intent,now}):[];
    const result=rows.length?{valid_until:lastShowing(rows),film_count:rows.length}:null;
    validation.set(query,result);return result;
  };
  const proposals=new Map();
  const add=(query,category,aliases=[])=>{
    const key=normalise(query);if(!key||query.length>80)return;
    const old=proposals.get(key);if(old){old.aliases=[...new Set([...old.aliases,...aliases])];return;}
    proposals.set(key,{kind:'query',entity_id:null,query,label:query,category,aliases,source:'precomputed',day:today});
  };
  const languages=rankedValues(upcoming,'languages'),genres=rankedValues(upcoming,'genres'),countries=rankedValues(upcoming,'countries');
  const subtitleCodes=new Set(upcoming.flatMap(f=>f.sessions.flatMap(s=>parseLanguages(s.subtitles).codes)));
  const subtitles=languageRows.filter(row=>subtitleCodes.has(row[1])).map(row=>row[0]);
  const venues=entities.filter(e=>e.kind==='cinema');
  // Empty-input chips leave dates open; typed completions can still add dates.
  for(const query of ['Films in English','Films at Verdi','Japanese films','French films','Films directed by David Lynch','Comedy films','Films at Phenomena','Documentaries','English subtitles','Under 90 minutes'])add(query,'idea');
  for(const date of dates)add('Films '+date,'date',[date,`Movies ${date}`]);
  for(const language of languages){
    const base=`Films in ${language}`;
    add(base,'audio',[`In ${language}`,`${language} audio`,`Movies in ${language}`]);
    for(const date of dates)add(`${base} ${date}`,'audio-date',[`In ${language} ${date}`,`${language} audio ${date}`]);
  }
  for(const language of subtitles){
    const base=`${language} subtitles`;
    add(base,'subtitles',[`Films with ${base}`,`Subtitles in ${language}`]);
    for(const date of dates)add(`${base} ${date}`,'subtitles-date',[`Films with ${base} ${date}`,`Subtitles in ${language} ${date}`]);
  }
  for(const genre of genres){
    const base=genreLabels[genre]||genre+' films';
    add(base,'genre',[genre+' films',...genreAliases[genre]||[]]);
    for(const date of dates)add(`${base} ${date}`,'genre-date',[`${genre} films ${date}`,...(genreAliases[genre]||[]).map(alias=>`${alias} ${date}`)]);
  }
  for(const country of countries){const base=countryLabels[country]||`Films from ${country}`;add(base,'country',[`Films from ${country}`,`From ${country}`]);}
  for(const venue of venues){
    add(`Films at ${venue.label}`,'cinema');
    for(const date of dates)add(`${venue.label} ${date}`,'cinema-date',[`${date} at ${venue.label}`,`Films at ${venue.label} ${date}`]);
    // A bounded set of common two-filter combinations, not every permutation.
    for(const language of languages.slice(0,8))add(`Films in ${language} at ${venue.label}`,'audio-cinema',[`${language} audio at ${venue.label}`,`In ${language} at ${venue.label}`]);
  }
  for(const genre of genres.slice(0,12))for(const language of languages.slice(0,5))add(`${genreLabels[genre]||genre+' films'} in ${language}`,'genre-audio',[`${genre} films in ${language}`]);
  for(const name of rankedValues(upcoming,'directors').slice(0,30))add(`Films directed by ${name}`,'director');
  for(const name of rankedValues(upcoming,'cast').slice(0,24))add(`Films starring ${name}`,'actor');
  for(const film of upcoming.slice(0,30)){
    add(film.title,'film');
    add(`${film.title} in English`,'film-audio');
    add(`${film.title} with English subtitles`,'film-subtitles');
  }
  for(const query of ['Under 90 minutes','Under 2 hours','IMDb above 8','IMDb above 7','Rotten Tomatoes above 80','Films after 20:00','Films before 18:00'])add(query,'limit');
  for(const format of new Set(upcoming.flatMap(f=>f.sessions.flatMap(s=>s.formats||[]))))add(`${format} films`,'format');
  const precomputed=[];let processed=0;
  for(const row of proposals.values()){
    const evidence=validate(row.query);if(evidence)precomputed.push({...row,...evidence});
    // Let local search requests run while rebuilding a changed catalogue.
    if(++processed%16===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const verified=precomputed.map(r=>r.query);
  const semantic=[...new Set(upcoming.flatMap(f=>(f.details?.topics||[]).slice(0,5)).filter(t=>typeof t==='string'&&t.length>3&&t.length<55).map(t=>'Films about '+t))];
  // The menu includes relative dates when typed; the discovery pool leaves
  // dates open and uses every verified kind, not just ten evergreen phrases.
  const ideas=precomputed.filter(r=>!r.category.includes('date')).map(r=>r.query);
  const context={today,timezone:'Europe/Madrid',
    catalogue:upcoming.map(f=>[f.id,f.title,f.release_year,(f.details?.directors||[]).join(', '),(f.details?.genres||[]).join(', ')]),
    entities:entities.filter(e=>e.kind!=='film').map(({kind,entity_id,label,query})=>({kind,entity_id,label,query})),
    verified_searches:verified,semantic_searches:semantic};
  return {programme,index,entities,precomputed,ideas,context,matches:(query,at=Date.now())=>today===madridDate(at)&&Boolean(validate(query)?.valid_until>=at),semantic:new Set(semantic)};
}

// Match every typed word, in order. In particular, never discard "subtitles",
// "about", "not", or a named language just to manufacture a suggestion.
export function suggestionScore(value,draft){
  const text=normalise(value),q=normalise(draft);return normalizedScore(text,text.split(' '),q,q.split(' '));
}
function normalizedScore(text,words,q,typed){
  if(!q)return Infinity;
  if(text===q)return 0;if(text.startsWith(q))return 1;if(text.includes(q))return 2;
  let start=0,gaps=0;
  for(const word of typed){const at=words.findIndex((candidate,i)=>i>=start&&candidate.startsWith(word));if(at<0)return Infinity;gaps+=at-start;start=at+1;}
  return 3+gaps/100;
}
const normalizedRows=new WeakMap();
function prepareRow(row){
  if(!normalizedRows.has(row))normalizedRows.set(row,[...new Set([row.label,row.query,...row.aliases||[]].map(normalise))].map(text=>({text,words:text.split(' ')})));
  return normalizedRows.get(row);
}
export async function prepareCompletionIndex(entities,precomputed){
  let deadline=performance.now()+3;
  for(const row of [...entities,...precomputed]){
    prepareRow(row);
    if(performance.now()>=deadline){await new Promise(resolve=>setTimeout(resolve,0));deadline=performance.now()+3;}
  }
}
function rankedSuggestions(rows,draft,now,limit=7){
  const q=normalise(draft),typed=q.split(' ');
  const ranked=[];
  for(const row of rows){
    if(row.valid_until&&row.valid_until<now)continue;
    let score=Infinity;for(const {text,words} of prepareRow(row)){score=Math.min(score,normalizedScore(text,words,q,typed));if(score===0)break;}
    if(!Number.isFinite(score)||ranked.length===limit&&score>=ranked.at(-1).score)continue;
    const at=ranked.findIndex(item=>item.score>score);
    ranked.splice(at<0?ranked.length:at,0,{row,score});if(ranked.length>limit)ranked.pop();
  }
  return ranked;
}
export function localCompletions(entities,draft,limit=5,now=Date.now()){
  return rankedSuggestions(entities,draft,now,limit).map(({row})=>({...row,source:'catalogue'}));
}
export function instantCompletions(entities,precomputed,draft,{limit=5,now=Date.now()}={}){
  if(!normalise(draft))return [];
  const local=localCompletions(entities,draft,limit,now),today=madridDate(now);
  const phrases=rankedSuggestions(precomputed.filter(r=>r.day===today),draft,now,limit+2).map(({row})=>row);
  const ordered=phrases.length?[...local.slice(0,2),...phrases,...local.slice(2)]:local;
  const result=[],seen=new Set();
  for(const row of ordered){const key=normalise(row.query);if(seen.has(key))continue;seen.add(key);result.push(row);if(result.length===limit)break;}
  return result;
}
export function needsEnrichment(rows,draft){
  return rows.length<3&&!rows.some(r=>r.source==='precomputed'||normalise(r.label)===normalise(draft));
}
