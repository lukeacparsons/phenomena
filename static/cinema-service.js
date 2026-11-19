import {emptySearch,inputError,madridDate,matchesFilmId,queryFilms,resolvedSearch,searchParams,validateObject,validateSearch} from './cinema-search.js';

const httpsURL=value=>{try{const url=new URL(value);return url.protocol==='https:'?url.href:null;}catch{return null;}};
const clone=value=>JSON.parse(JSON.stringify(value));
const integer=value=>Number.isInteger(value)&&value>=0?value:null;

export function availabilityFor(session,snapshot={},now=Date.now()){
  const candidates=[snapshot.sessions?.get(session.id),session.seat_data]
    .filter(value=>value&&integer(value.available)!==null&&Number.isFinite(Date.parse(value.checked_at)))
    .sort((a,b)=>Date.parse(b.checked_at)-Date.parse(a.checked_at));
  const value=candidates[0]||null;
  const age=value?Math.max(0,Math.floor((now-Date.parse(value.checked_at))/1000)):null;
  const interval=snapshot.intervalSeconds||900;
  const closed=value?.purchase_open===false;
  const soldOut=value?Boolean(value.is_sold_out||(value.kind==='ordinary'&&value.available===0)):Boolean(session.is_sold_out);
  return {
    status:closed?'booking_closed':soldOut?'sold_out':value?.available>0?'reported_available':'unknown',
    available:value?.available??null,kind:value?.kind??null,
    checked_at:value?.checked_at??null,age_seconds:age,stale:age===null?null:age>interval,
    refresh_failed:Boolean(snapshot.failed||snapshot.errors?.has(session.id)),
    supported:Boolean(value)||(snapshot.supportedProviders||['cinesa','kinepolis','mooby','phenomena','verdi','filmax']).includes(session.provider),
    purchase_open:typeof value?.purchase_open==='boolean'?value.purchase_open:null,
    ...(value?.areas?{areas:clone(value.areas)}:{}),
    ...(integer(value?.wheelchair)!==null?{wheelchair:value.wheelchair}:{}),
    ...(integer(value?.companion)!==null?{companion:value.companion}:{}),
    ...(value?.closed_reason?{closed_reason:value.closed_reason}:{})
  };
}

export function createCinemaService({getProgramme,getAvailability,getView,applySearch,showScreening,getURL,now=Date.now}){
  function programme(){
    const value=getProgramme();
    if(!value)throw inputError('The programme has not loaded. Try again after the page finishes loading.','not_ready');
    return value;
  }
  function link(filters=emptySearch(),filmId=null,screeningId=null){
    const language=getView().language||'en';
    const film=filmId?programme().films.find(f=>matchesFilmId(f,filmId)):null;
    const session=screeningId?film?.sessions.find(s=>s.id===screeningId):null;
    const canonical=session?.urls?.[language]||film?.urls?.[language];
    if(canonical)return new URL(canonical,getURL()).href;
    const url=new URL(getView().listingPath||getURL(),getURL());
    url.search=searchParams(filters,filmId,screeningId).toString();url.hash='';
    return url.href;
  }
  function findFilm(id){
    if(typeof id!=='string'||!id||id.length>256)throw inputError('film_id must be an ID returned by search_screenings.');
    const film=programme().films.find(film=>matchesFilmId(film,id));
    if(!film)throw inputError('Film not found in the current programme. Search again for its current ID.','not_found');
    return film;
  }
  function destinations(film,session=null){
    const canonical=link(emptySearch(),film.id);
    const action=new URL(session?link(emptySearch(),film.id,session.id):canonical);
    if(film.urls?.[getView().language||'en']&&!session)action.hash='showtimes';
    return {canonical_url:canonical,action_url:action.href};
  }
  function findScreening(id){
    if(typeof id!=='string'||!id||id.length>256)throw inputError('screening_id must be an ID returned by search_screenings.');
    for(const film of programme().films){
      const session=film.sessions.find(session=>session.id===id);
      if(session)return {film,session};
    }
    throw inputError('Screening not found in the current programme. Search again for its current ID.','not_found');
  }
  function summary(film,session,time){
    const venue=programme().cinemas.find(cinema=>cinema.id===session.cinema_id);
    return {screening_id:session.id,film_id:film.id,title:film.title,release_year:film.release_year||film.details?.release_year||null,
      cinema_id:session.cinema_id,cinema:venue?.name||session.cinema_id,room:session.room||null,
      starts_at:session.starts_at,date:session.date,time:session.time,timezone:'Europe/Madrid',
      formats:session.formats||[],version:session.version||null,audio_language:session.language||null,subtitles:session.subtitles||null,
      big_screen:session.big_screen===true,availability:availabilityFor(session,getAvailability(),time),
      schedule_fetched_at:session.schedule_fetched_at||null,source_url:httpsURL(session.source_url),
      booking_url:httpsURL(session.booking_url),booking_scope:session.booking_scope||(session.provider==='phenomena'?'event':'unknown'),
      url:link(emptySearch(),film.id,session.id),...destinations(film,session)};
  }
  function search(input={}){
    validateObject(input,[...Object.keys(emptySearch()),'limit','offset']);
    const {limit=20,offset=0,...criteria}=input;
    if(!Number.isInteger(limit)||limit<1||limit>50)throw inputError('limit must be an integer between 1 and 50.');
    if(!Number.isInteger(offset)||offset<0||offset>100000)throw inputError('offset must be an integer between 0 and 100000.');
    const data=programme(),filters=validateSearch(criteria,data),time=now();
    const films=queryFilms(data,filters,{now:time});
    const rows=films.flatMap(film=>film.sessions.map(session=>({film,session})))
      .sort((a,b)=>Date.parse(a.session.starts_at)-Date.parse(b.session.starts_at)||a.session.id.localeCompare(b.session.id));
    return {ok:true,filters,resolved_date_range:resolvedSearch(data,filters,time).range,timezone:'Europe/Madrid',
      total_screenings:rows.length,total_films:films.length,offset,limit,next_offset:offset+limit<rows.length?offset+limit:null,
      programme_generated_at:data.generated_at||null,url:link(filters),
      results:rows.slice(offset,offset+limit).map(({film,session})=>summary(film,session,time))};
  }
  return {
    get_context(input={}){
      validateObject(input,[]);
      const data=programme(),time=now(),view=getView();
      const sessions=data.films.flatMap(film=>film.sessions).filter(session=>Date.parse(session.starts_at)>=time);
      const dates=[...new Set(sessions.map(session=>session.date))].sort();
      return {ok:true,timezone:'Europe/Madrid',today:madridDate(time),language:view.language,
        filters:clone(view.filters),resolved_date_range:resolvedSearch(data,view.filters,time).range,
        active_film_id:view.filmId||null,active_screening_id:view.screeningId||null,url:getURL(),
        cinemas:data.cinemas.map(({id,name,area,big_screen_criteria})=>({id,name,area:area||null,big_screen_criteria:big_screen_criteria||null})),
        formats:[...new Set(sessions.flatMap(session=>session.formats||[]))].sort(),
        programme_generated_at:data.generated_at||null,programme_load_failed:Boolean(view.programmeFailed),
        coverage:{cinema_count:data.cinemas.length,screening_count:sessions.length,first_date:dates[0]||null,last_date:dates.at(-1)||null,
          sources:(data.coverage||[]).map(source=>({provider:source.source,cinema_id:source.cinema_id||null,fetched_at:source.fetched_at||null,
            count:source.count??null,latest_published_date:source.coverage?.latest_published_date||null,truncated_by_window:source.coverage?.truncated_by_window??null}))},
        availability_refresh_interval_seconds:getAvailability().intervalSeconds||900,
        notes:['Coverage is the collected programme for the listed cinemas; unpublished or uncollected dates are unknown.',
          'VOSE means original audio with Spanish subtitles; original audio is not necessarily English.',
          'Seat counts are cached observations. Count kinds differ by provider and do not establish adjacent seats or reserve tickets.',
          'big_screens_only is a curated premium selection including comfort-focused venues, not a measured screen-size ranking.']};
    },
    search_screenings:search,
    get_film(input={}){
      validateObject(input,['film_id']);
      const film=findFilm(input.film_id),details=film.details||{};
      const {search_aliases,...facts}=details;
      return {ok:true,film_id:film.id,title:film.title,original_title:film.original_title||null,english_title:film.english_title||null,
        imdb_id:film.imdb_id||null,release_year:film.release_year||details.release_year||null,
        runtime_minutes:details.runtime_minutes||film.runtime_minutes||null,details:clone(facts),ratings:clone(film.ratings||{}),
        upcoming_screening_count:film.sessions.filter(session=>Date.parse(session.starts_at)>=now()).length,url:link(emptySearch(),film.id),...destinations(film)};
    },
    get_screening(input={}){
      validateObject(input,['screening_id']);
      const {film,session}=findScreening(input.screening_id),time=now();
      return {ok:true,...summary(film,session,time),has_started:Date.parse(session.starts_at)<time};
    },
    set_search(input={}){
      // Compute and validate everything before committing visible state.
      validateObject(input,Object.keys(emptySearch()));
      const result=search(input);
      applySearch(result.filters);
      return {...result,url:getURL()};
    },
    show_screening(input={}){
      validateObject(input,['screening_id']);
      const {film,session}=findScreening(input.screening_id),time=now();
      if(Date.parse(session.starts_at)<time)throw inputError('This screening has started. Search for an upcoming screening.','screening_started');
      if(showScreening(film.id,session.id)===false)throw inputError('The screening is no longer available to show. Search again for an upcoming screening.','screening_started');
      return {ok:true,...summary(film,session,time),url:getURL(),shown:true};
    }
  };
}
