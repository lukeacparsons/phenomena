import {emptySearch,interpretSearch,queryFilms,normalise,madridDate} from '../static/cinema-search.js';
import {parseLocationQuery,coordinates} from '../static/location-search.js';

const score=row=>Number(row.sessions||0)+Number(row.recent_sessions||0)*0.5+Number(row.ticket_sessions||0)*2+Number(row.screening_sessions||0)*0.5;
const lastShowing=rows=>Math.max(0,...rows.flatMap(f=>f.sessions.map(s=>Date.parse(s.starts_at))).filter(Number.isFinite));

export async function buildInterestSuggestions(cat,snapshot,now=Date.now()){
  const {programme,index}=cat,day=madridDate(now),entries=[],audit=[],seen=new Set();
  const films=new Map(programme.films.map(f=>[f.id,f])),cinemas=new Map(programme.cinemas.map(c=>[c.id,c]));
  const ranked=(key,known)=>(snapshot?.dimensions?.[key]||[]).filter(r=>known.has(r.entity_id)&&r.sessions>=2)
    .map(row=>({...row,score:score(row)})).sort((a,b)=>b.score-a.score||a.entity_id.localeCompare(b.entity_id));
  const popularFilms=ranked('films',films).slice(0,8),popularCinemas=ranked('cinemas',cinemas).slice(0,4);
  const checked=new Map();
  function validate(query,filmId,cinemaId,requiresLocation=false){
    const parsed=parseLocationQuery(query,{titles:index.titles});
    // A location chip promises a search, not nearby availability. Only the
    // non-location part is prevalidated; the device resolves it after tapping.
    if(Boolean(parsed.location)!==requiresLocation||parsed.location&&parsed.location.type!=='device')return null;
    const filters={...emptySearch(),query:parsed.text};
    let rows=checked.get(parsed.text);
    if(!rows){
      const intent=interpretSearch(programme,filters,{index,now});
      if(intent.unsupported.length||intent.notices?.length||intent.semantic_query||intent.location_query||intent.venue_query)return null;
      rows=queryFilms(programme,filters,{index,intent,now});checked.set(parsed.text,rows);
    }
    if(!rows.length||filmId&&rows.some(f=>f.id!==filmId)||cinemaId&&rows.some(f=>f.sessions.some(s=>s.cinema_id!==cinemaId)))return null;
    if(requiresLocation){rows=rows.map(f=>({...f,sessions:f.sessions.filter(s=>coordinates(cinemas.get(s.cinema_id)?.location))})).filter(f=>f.sessions.length);if(!rows.length)return null;}
    return {valid_until:lastShowing(rows),film_count:rows.length,requires_location:requiresLocation};
  }
  function add(query,subject,{filmId,cinemaId,requiresLocation=false}={}){
    const key=normalise(query);if(seen.has(key)||query.length>64)return false;
    const evidence=validate(query,filmId,cinemaId,requiresLocation);if(!evidence)return false;
    const kind=filmId?'film':'cinema',group=kind+':'+subject.entity_id;
    const row={query,label:query,source:'interest',kind,group,day,...evidence};
    entries.push(row);seen.add(key);
    audit.push({...row,score:subject.score,signals:{sessions:subject.sessions,recent_sessions:subject.recent_sessions,ticket_sessions:subject.ticket_sessions,screening_sessions:subject.screening_sessions},derived:true});
    return true;
  }
  for(const subject of popularFilms){
    const film=films.get(subject.entity_id),full=film.title;
    const short=full.split(':')[0].replace(/^The /,'');
    // Shorten only if the actual search engine resolves exclusively to this film.
    const title=short.length>=4&&validate(short,film.id)?short:full;
    add(title+' in English',subject,{filmId:film.id});
    add(title,subject,{filmId:film.id});
    add(title+' with English subtitles',subject,{filmId:film.id});
    add(title+' near me',subject,{filmId:film.id,requiresLocation:true});
    for(const venue of popularCinemas.slice(0,2)){
      const cinema=cinemas.get(venue.entity_id);add(`${title} at ${cinema.short||cinema.name}`,subject,{filmId:film.id,cinemaId:cinema.id});
    }
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  for(const subject of popularCinemas){
    const cinema=cinemas.get(subject.entity_id),name=cinema.short||cinema.name;
    for(const query of [`Films at ${name}`,`Films in English at ${name}`])add(query,subject,{cinemaId:cinema.id});
  }
  // Interleave subjects so a franchise does not monopolise the pool. Preserve
  // a broad selection alongside the early, small-sample popularity signals.
  const groups=new Map();for(const row of entries){if(!groups.has(row.group))groups.set(row.group,[]);groups.get(row.group).push(row);}
  const ordered=[];while([...groups.values()].some(rows=>rows.length))for(const rows of groups.values())if(rows.length)ordered.push(rows.shift());
  const fallback=cat.precomputed.filter(r=>cat.ideas.includes(r.query)&&r.valid_until>now).map(row=>{
    const intent=interpretSearch(programme,{...emptySearch(),query:row.query},{index,now});
    const venue=intent.conditions.find(c=>c.field==='cinema'&&c.op==='eq');
    const subject=intent.conditions.find(c=>['director','actor','genre','country','language','subtitles','format','duration','rating_imdb','rating_rt','start_time'].includes(c.field));
    const film=row.category?.startsWith('film')?queryFilms(programme,{...emptySearch(),query:row.query},{index,intent,now})[0]:null;
    return {...row,source:'catalogue',group:venue?'cinema:'+venue.value:film?'film:'+film.id:subject?subject.field+':'+subject.value:'general:'+row.query};
  });
  for(const row of fallback)if(!seen.has(normalise(row.query)))ordered.push(row);
  return {entries:ordered,audit};
}
