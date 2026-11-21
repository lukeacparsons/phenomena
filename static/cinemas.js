import {TEXT} from './cinema-copy.js';
import {createListingView,HOME_CARD_PREVIEW} from './listing-view.js';
import {renderFilmDialog,focusSelectedScreening,getDialogScroller,prepareFilmTransition,showFilmDialog,closeFilmDialog} from './film-dialog.js';
import './ticket-events.js';
import {observeImages,posterMarkup} from './progressive-images.js';
import {createProgrammeLoader} from './programme-loader.js';
import {emptySearch,matchesFilmId,parseFilmQuery,queryFilms,searchFromURL,searchParams,validateSearch,interpretSearch} from './cinema-search.js';
import {intentChips,filmMatchReason,searchExplanation} from './search-intent.js';
import {createSmartSearchUI} from './smart-search-ui.js';
import {createSearchSuggestionsUI} from './search-suggestions.js';
import {suggestionLanguage} from './search-localization.js';
import {searchFeedback,feedbackMarkup,searchCopy} from './search-feedback.js';
import {createLocationSearchUI,LOCATION_COPY} from './location-search.js';
import {availabilityFor,createCinemaService} from './cinema-service.js';
import {registerWebMCP} from './webmcp-registration.js';
import {installLanguageNavigation} from './language-navigation.js';

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = value => typeof value === 'string' && (/^https:\/\//.test(value) || /^\/(?!\/)/.test(value)) ? escapeHTML(value) : '';
let language=suggestionLanguage(null,navigator.languages||[navigator.language]);
try { language=suggestionLanguage(localStorage.getItem('barcelona-cinema-language'),navigator.languages||[navigator.language]); } catch {}
const publicLanguage=document.body.dataset.siteLang;
const listingCinemaId=document.body.dataset.cinemaId;
if(TEXT[publicLanguage])language=publicLanguage;
let listingPath=location.pathname;
const listingDate=document.body.dataset.listingDate;
const dateKind=document.body.dataset.dateKind;
const relativeDate=dateKind==='today'||dateKind==='tomorrow';
const dateHeading=document.querySelector('.date-heading');
const originalDateHeading=dateHeading?.querySelector('h1,h2')?.textContent;
let restoringHistory=false;
let listingTitle=document.title;
const listingLanguageLinks=[...document.querySelectorAll('.lang-switch a[hreflang]')].map(node=>({node,href:node.getAttribute('href')}));
const readListingMetadata=()=>[...document.querySelectorAll('link[rel="canonical"],link[hreflang],meta[property="og:url"],meta[property="og:title"]')].map(node=>({node,value:node.getAttribute(node.tagName==='LINK'?'href':'content')}));
let listingMetadata=publicLanguage?readListingMetadata():[];
const t = key => TEXT[language][key] || TEXT.en[key] || key;
const locale = () => ({en:'en-GB',es:'es-ES',ca:'ca-ES'}[language]);
const dateFormatters=new Map(),dateLabels=new Map();
const dateParts = (date, options) => {
  const key=locale()+JSON.stringify(options);
  if(!dateFormatters.has(key))dateFormatters.set(key,new Intl.DateTimeFormat(locale(),{timeZone:'Europe/Madrid',...options}));
  return dateFormatters.get(key).format(new Date(date));
};
const todayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'});
const todayISO = () => todayFormatter.format(new Date());
const displayDate = date => {
  const year=todayISO().slice(0,4),key=language+date+year;
  if(!dateLabels.has(key))dateLabels.set(key,dateParts(date+'T12:00:00Z',{weekday:'short',day:'numeric',month:'short',...(date.slice(0,4)!==year?{year:'numeric'}:{})}));
  return dateLabels.get(key);
};
const params = new URLSearchParams(location.search);
const state = searchFromURL(params);
if(relativeDate&&!params.has('date')&&!params.has('from')&&!params.has('to'))state.date_from=state.date_to=listingDate;
if(!params.has('q')&&$('search')?.value)state.query=$('search').value;
let pendingLink=params.has('film')||params.has('screening')?{filmId:params.get('film'),screeningId:params.get('screening')}:null;
let legacyCinema=params.get('cinema');
let data=null,visible=[],activeFilm=null,activeSession=null;
let activeView='film',showtimesScroll=0,showtimesSession=null;
let searchIndex=null,searchFrame=0,searchTimer=0,resultAnnouncement=0,suggestionsUI=null,updatingControllers=false,resultsPending=false,searchPending=false;
const smartSearchUI=typeof window==='undefined'?null:createSmartSearchUI({
  getProgramme:()=>data,getIndex:()=>searchIndex,getFilters:()=>state,getLanguage:()=>language,
  isPrecomputedQuery:query=>suggestionsUI?.isVerified(query),
  onMetrics:detail=>window.dispatchEvent(new CustomEvent('vobarna:smart-search',{detail})),
  onResult:()=>{locationSearchUI?.update();refreshResults();if($('filmDialog')?.open)renderDialog();},
  onStatus:(kind,unsupported=[])=>{
    searchPending=kind==='loading';
    $('grid')?.setAttribute('aria-busy',String(searchPending));
    let status=$('searchStatus');
    if(!status){status=document.createElement('p');status.id='searchStatus';status.className='search-status';status.setAttribute('role','status');$('searchActiveControls')?.after(status);}
    const messages={en:{loading:'Thinking about your search…',unavailable:'Smart search is temporarily unavailable. Showing keyword matches.',noSemantic:'No close matches for this description.',unsupported:'Could not apply: '},es:{loading:'Pensando en tu búsqueda…',unavailable:'La búsqueda inteligente no está disponible. Mostramos coincidencias por palabras.',noSemantic:'No hay coincidencias cercanas para esta descripción.',unsupported:'No se pudo aplicar: '},ca:{loading:'Pensant en la teva cerca…',unavailable:'La cerca intel·ligent no està disponible. Mostrem coincidències per paraules.',noSemantic:'No hi ha coincidències properes per a aquesta descripció.',unsupported:'No s’ha pogut aplicar: '}};
    const regional={en:'The catalogue does not yet identify films produced in Catalunya.',es:'El catálogo todavía no identifica las películas producidas en Catalunya.',ca:'El catàleg encara no identifica les pel·lícules produïdes a Catalunya.'};
    status.textContent=(messages[language][kind]||'')+(kind==='unsupported'?unsupported.map(item=>item==='origin:Catalunya'?regional[language]:item).join(' · '):'');status.hidden=!kind;
    // Transient progress uses the icon's existing space; durable notices remain visible.
    status.classList.toggle('sr-only',searchPending);
    $('search')?.closest('.search')?.classList.toggle('is-searching',searchPending);
  }
});
const locationSearchUI=typeof window==='undefined'?null:createLocationSearchUI({
  getQuery:()=>state.query,getIndex:()=>searchIndex,getIntent:()=>smartSearchUI?.current()?.intent,getIgnored:()=>state.ignored_filters,
  onChange:()=>{if(data)refreshResults();}
});
const CARD_BATCH_SIZE=32;
let cardLimit=CARD_BATCH_SIZE;
const cardNodes=new Map([...$('grid').querySelectorAll('.card[data-film]')].map(node=>[node.dataset.film,{node,body:node.querySelector('.card-body').innerHTML,adopted:true}]));
// Preserve the publication's first view until an explicit search/date action.
// Passed showtimes are disabled in place; dialogs and agent tools still use real time.
const initialOrder=new Map([...cardNodes.keys()].map((id,index)=>[id,index]));
const publishedAt=Date.parse($('grid').dataset.listingAsOf);
let initialViewTime=publicLanguage&&!searchParams(state).size&&Number.isFinite(publishedAt)?publishedAt:null;
let cachedProgramme=null,viewCache=null;
const listingView=()=>{
  const today=todayISO(),cinemas=data?.cinemas,origin=locationSearchUI?.current().origin;
  if(viewCache?.language!==language||viewCache?.today!==today||viewCache?.cinemas!==cinemas||viewCache?.origin!==origin)
    viewCache={language,today,cinemas,origin,view:createListingView({language,cinemas,today,listingPath,...(listingCinemaId?{}:HOME_CARD_PREVIEW),origin,availabilityHTML,isSoldOut})};
  return viewCache.view;
};
const seats = new Map(), seatErrors = new Set();
let availabilityLoading=false,availabilityFailed=false,programmeFailed=false;
let availabilityInterval=900,supportedProviders=['cinesa','kinepolis','mooby','phenomena','verdi','filmax'];
let availabilityTimer=0,availabilityDue=0,availabilityETag=null,availabilityRefreshing=false;
let webMCPStarted=false,webMCPCleanup=null;
const lifecycle=new AbortController();
const PROGRAMME_CACHE=publicLanguage?'vobarna-public-programme-v1':'barcelona-cinema-programme-v1', SEATS_CACHE='barcelona-cinema-seats-v1';
const programmeLoader=createProgrammeLoader({cacheKey:PROGRAMME_CACHE,cinemaId:listingCinemaId||null});
const readCache = key => {try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
const saveCache = (key,value) => {try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
const cinema = id => data.cinemas.find(c=>c.id===id);
const filmHref = film => film.urls?.[language] || location.pathname+'?film='+encodeURIComponent(film.id);
const plural = (n,singular,multiple) => `${n} ${t(n===1?singular:multiple)}`;
const future = session => Date.parse(session.starts_at)>=Date.now();
const tags = (session,includeVersion=true) => [...(session.formats||[]).map(format=>`<span class="tag tag-format">${escapeHTML(format)}</span>`),includeVersion&&session.version?`<span class="tag tag-version">${escapeHTML(session.version)}</span>`:''].join('');

function syncURL(push=false){
  if(restoringHistory)return;
  const filmId=pendingLink?.filmId||activeFilm,screeningId=pendingLink?.screeningId||activeSession;
  const film=publicLanguage&&data?.films.find(f=>matchesFilmId(f,filmId));
  const session=film?.sessions.find(s=>s.id===screeningId);
  const canonical=session?.urls?.[language]||(film?.urls?.[language]?film.urls[language]+(activeView==='showtimes'?'#showtimes':''):null);
  const query=searchParams(state,...(publicLanguage?[]:[filmId,screeningId]));
  const defaultDate=relativeDate&&query.size===1&&query.get('date')===listingDate;
  if(defaultDate)query.delete('date');
  const viewPath=listingDate&&!defaultDate?`/${language}/`:listingPath;
  const listingHash=listingCinemaId&&location.pathname===listingPath?location.hash:'';
  const url=canonical||viewPath+(query.size?'?'+query.toString():'')+listingHash;
  const view=publicLanguage?{listingPath,filters:state,filmId,screeningId,filmView:activeView}:null;
  if(url!==location.pathname+location.search+location.hash||JSON.stringify(history.state?.vobarna)!==JSON.stringify(view)){
    history[push?'pushState':'replaceState'](view?{vobarna:view}:null,'',url);
    window.dispatchEvent(new Event('vobarna:navigation'));
  }
  if(publicLanguage){
    const changedDate=listingDate&&selectedDate()!==listingDate;
    document.title=film?film.title+' | VO Barna':changedDate?document.body.dataset.programmeHeading+' | VO Barna':listingTitle;
    if(dateHeading){
      const heading=changedDate?document.body.dataset.programmeHeading:originalDateHeading;
      dateHeading.querySelector('h1,h2').textContent=heading;
      const mainHeading=document.querySelector('main > h1');
      if(mainHeading)mainHeading.textContent=heading;
      const description=dateHeading.querySelector('p');
      if(description)description.hidden=Boolean(changedDate);
      const complete=document.querySelector('details#complete-programme');
      if(complete)complete.hidden=changedDate||Boolean(state.query)||state.cinema_ids.length>0||state.formats.length>0||state.big_screens_only;
    }
    for(const {node,href} of listingLanguageLinks){
      const localePath=film?.urls?.[node.hreflang];
      node.setAttribute('href',localePath?localePath+(session?.urls?.[node.hreflang]?.split('#')[1]?'#'+session.urls[node.hreflang].split('#')[1]:activeView==='showtimes'?'#showtimes':''):listingDate&&!defaultDate?`/${node.hreflang}/`+(query.size?'?'+query.toString():''):href+(query.size?'?'+query.toString():'')+listingHash);
    }
    for(const {node,value} of listingMetadata){
      const attr=node.tagName==='LINK'?'href':'content';
      const lang=node.hreflang==='x-default'?'en':node.hreflang||language;
      const next=film?.urls?.[lang];
      if(!next&&listingDate&&!defaultDate){
        const path=`/${lang}/`+(selectedDate()!=='all'?'?date='+selectedDate():'');
        node.setAttribute(attr,node.getAttribute('property')==='og:title'?document.title:new URL(path,value).href);
        continue;
      }
      node.setAttribute(attr,next?(node.getAttribute('property')==='og:title'?document.title:new URL(next,value).href):value);
    }
  }
}

function parsedSearch(){
  return parseFilmQuery(data,state.query,todayISO(),searchIndex);
}

function filteredFilms(ignoreDate=false){
  const films=queryFilms(data,state,{ignoreExplicitDates:ignoreDate,index:searchIndex,now:initialViewTime??Date.now(),...smartSearchUI?.current(),origin:locationSearchUI?.current().origin,availability:availabilitySnapshot()});
  if(initialViewTime!==null)films.sort((a,b)=>(initialOrder.get(a.id)??Infinity)-(initialOrder.get(b.id)??Infinity));
  return films;
}

function selectedDate(){
  return state.date_from&&state.date_from===state.date_to?state.date_from:'all';
}

function availabilitySnapshot(){
  return {sessions:seats,errors:seatErrors,failed:availabilityFailed,intervalSeconds:availabilityInterval,supportedProviders};
}

function refreshLiveSearch(){
  if(!data||!state.query||document.hidden||editingSearch()||searchTimer||searchFrame)return false;
  const plan=interpretSearch(data,state,{index:searchIndex,intent:smartSearchUI?.current()?.intent});
  const liveFields=new Set(['starts_within','seats_available','seats_together','wheelchair_seats','occupancy_percent','booking_open']);
  const conditions=[...plan.conditions,...(plan.alternatives||[]).flat(),...(plan.preferences||[]).flatMap(p=>p.conditions)];
  if(plan.sort!=='seats'&&!conditions.some(c=>liveFields.has(c.field)))return false;
  scheduleSearchWork(()=>refreshResults({cooperative:true}));
  return true;
}

function closeFilm({animate=false}={}){
  if(animate){pendingLink=null;closeFilmDialog($('filmDialog'));return;}
  activeFilm=null;activeSession=null;pendingLink=null;activeView='film';
  $('filmDialog').close();syncURL();
}

function editingSearch(){
  return $('search').value.trim()!==state.query&&document.activeElement?.closest('.search-composer');
}
function updateSearchControllers(){
  updatingControllers=true;
  try{smartSearchUI?.update();locationSearchUI?.update();}finally{updatingControllers=false;}
}
function scheduleSearchWork(work){
  searchFrame=requestAnimationFrame(()=>{
    searchFrame=0;searchTimer=setTimeout(()=>{searchTimer=0;work();},0);
  });
}
function refreshResults({cooperative=document.activeElement===$('search'),onRendered=()=>{}}={}){
  if(updatingControllers)return;
  // Catalogue/availability updates must not rebuild results beneath an active
  // draft. The existing results stay usable; submit or leaving the box flushes.
  if(editingSearch()){resultsPending=true;return;}
  resultsPending=false;
  const matches=filteredFilms(true);
  if(cooperative){
    $('grid').setAttribute('aria-busy','true');
    // Automatic searches yield between matching, date controls and cards so
    // another keystroke can cancel the remaining work before it blocks paint.
    scheduleSearchWork(()=>{
      buildDates(matches);
      scheduleSearchWork(()=>{render(state.date_from||state.date_to?filteredFilms():matches);onRendered();});
    });
    return;
  }
  buildDates(matches);
  render(state.date_from||state.date_to?filteredFilms():matches);
  onRendered();
}

function cancelSearchRender(){
  if(searchTimer){clearTimeout(searchTimer);searchTimer=0;}
  if(searchFrame){cancelAnimationFrame(searchFrame);searchFrame=0;}
}

function applySearch(filters,{automatic=false}={}){
  initialViewTime=null;
  cancelSearchRender();
  const next=validateSearch(filters,data,searchIndex);
  if(next.query!==state.query)next.ignored_filters=[];
  cardLimit=CARD_BATCH_SIZE;
  Object.assign(state,next);
  $('linkNotice').hidden=true;
  closeFilm();
  if(!automatic){
    if($('search').value!==state.query)$('search').value=state.query;
    suggestionsUI?.sync();
  }
  const onRendered=()=>window.dispatchEvent(new CustomEvent('vobarna:search',{detail:{scope:'films',query_length:state.query.length,
    result_count:visible.length,screening_count:visible.reduce((sum,film)=>sum+film.sessions.length,0),
    cinema_count:state.cinema_ids.length,has_date_filter:Boolean(state.date_from||state.date_to)}}));
  if(automatic){
    scheduleSearchWork(()=>{
      updateSearchControllers();
      scheduleSearchWork(()=>refreshResults({cooperative:true,onRendered}));
    });
  }else{
    updateSearchControllers();
    refreshResults({cooperative:false,onRendered});
  }
}

function renderFilterChips(){
  const labels={en:{remove:'Remove',big:'Big screens only',from:'From',to:'Until'},es:{remove:'Quitar',big:'Solo pantallas grandes',from:'Desde',to:'Hasta'},ca:{remove:'Treu',big:'Només pantalles grans',from:'Des de',to:'Fins a'}}[language];
  const chips=[];
  const nearby=locationSearchUI?.current();
  if(nearby?.location){const copy=LOCATION_COPY[language];chips.push({field:'intent',value:'location',label:nearby.location.type==='device'?copy.nearMe:copy.near+' '+(nearby.label||nearby.location.address)});}
  // A single date is already highlighted on the film strip.
  if((state.date_from||state.date_to)&&state.date_from!==state.date_to){
    const label=[state.date_from?labels.from+' '+displayDate(state.date_from):'',state.date_to?labels.to+' '+displayDate(state.date_to):''].filter(Boolean).join(' · ');
    chips.push({field:'dates',value:'',label});
  }
  for(const id of state.cinema_ids)chips.push({field:'cinema_ids',value:id,label:cinema(id)?.name||id});
  for(const format of state.formats)chips.push({field:'formats',value:format,label:format});
  if(state.big_screens_only)chips.push({field:'big_screens_only',value:'',label:labels.big});
  if(data){
    const plan=interpretSearch(data,state,{index:searchIndex,intent:smartSearchUI?.current()?.intent});
    for(const chip of intentChips(plan,language,data))chips.push({field:'intent',value:chip.id,label:chip.label});
  }
  $('filterChips').hidden=!chips.length;
  $('filterChips').innerHTML=chips.map(({field,value,label})=>`<button type="button" class="filter-chip" data-remove-filter="${field}" data-value="${escapeHTML(value)}" aria-label="${escapeHTML(labels.remove+' '+label)}">${escapeHTML(label)} <span aria-hidden="true">×</span></button>`).join('');
  let explanation=$('searchExplanation');
  if(!explanation){explanation=document.createElement('p');explanation.id='searchExplanation';explanation.className='search-explanation';$('searchActiveControls').after(explanation);}
  explanation.textContent=data&&state.query.trim()?searchExplanation(interpretSearch(data,state,{index:searchIndex,intent:smartSearchUI?.current()?.intent}),language):'';
  explanation.hidden=!explanation.textContent;
  renderLocationStatus();
}

function updateDateFades(){
  const strip=$('dates');
  const width=parseFloat(getComputedStyle(strip).getPropertyValue('--date-bleed'))||0;
  const remaining=strip.scrollWidth-strip.clientWidth-strip.scrollLeft;
  strip.style.setProperty('--date-fade-left',Math.min(width,Math.max(0,strip.scrollLeft))+'px');
  strip.style.setProperty('--date-fade-right',Math.min(width,Math.max(0,remaining))+'px');
}

function buildDates(films=filteredFilms(true)){
  const html=listingView().datesMarkup(films,{range:state.date_from||state.date_to?null:parsedSearch().range,
    selected:selectedDate(),hasDateFilter:Boolean(state.date_from||state.date_to)});
  if($('dates').innerHTML!==html){
    const scroll=$('dates').scrollLeft;
    $('dates').innerHTML=html;
    $('dates').scrollLeft=scroll;
    requestAnimationFrame(updateDateFades);
  }
}

function renderLocationStatus(){
  const nearby=locationSearchUI?.current();
  if(!nearby?.location&&!$('locationStatus'))return;
  let region=$('locationStatus');
  if(!region){region=document.createElement('div');region.id='locationStatus';region.className='location-status';$('searchActiveControls').after(region);}
  region.hidden=!nearby?.location||nearby.status==='ready';
  if(region.hidden){region.replaceChildren();return;}
  const copy=LOCATION_COPY[language],retry=['denied','timeout','locationFailed','geocodeFailed'].includes(nearby.status);
  const message=copy[nearby.status]||'';
  region.innerHTML=`<p role="status">${escapeHTML(message)}</p>`+
    (nearby.status==='choose'?`<div class="location-choices">${nearby.places.map((p,i)=>`<button type="button" class="btn btn-secondary" data-location-choice="${i}">${escapeHTML(p.label)}</button>`).join('')}</div>`:'')+
    (retry?`<button type="button" class="btn btn-secondary" data-location-retry>${escapeHTML(copy.retry)}</button>`:'');
}


function imageMarkup(film,dialog=false){
  if(dialog)return posterMarkup(film,{className:'dialog-poster'});
  return `${posterMarkup(film)}<div class="poster-placeholder" ${film.poster_url?'hidden':''}>${escapeHTML(film.title)}</div>`;
}

function isSoldOut(session){
  return ['booking_closed','sold_out'].includes(availabilityFor(session,availabilitySnapshot()).status);
}
function showtimeLabel(session,filmTitle=''){
  return listingView().showtimeLabel(session,filmTitle);
}

function markStartedShowtimes(){
  const label={en:'This screening has started',es:'Esta sesión ya ha comenzado',ca:'Aquesta sessió ja ha començat'}[language];
  for(const link of document.querySelectorAll('.card-showtime')){
    const started=Date.parse(link.querySelector('time')?.dateTime)<Date.now();
    if(started===link.classList.contains('is-started'))continue;
    link.classList.toggle('is-started',started);
    if(started){link.setAttribute('aria-disabled','true');link.title=label;}
    else{link.removeAttribute('aria-disabled');link.removeAttribute('title');}
  }
}

function render(films=filteredFilms()){
  if(!data)return;
  visible=films;
  const total=visible.reduce((n,film)=>n+film.sessions.length,0);
  clearTimeout(resultAnnouncement);
  if(searchPending)$('resultCount').textContent='';
  else resultAnnouncement=setTimeout(()=>{$('resultCount').textContent=plural(visible.length,'film','films')+' · '+plural(total,'screening','screenings');},250);
  $('clearFilters').hidden=!$('search').value&&!state.query&&!state.date_from&&!state.date_to&&!state.cinema_ids.length&&!state.formats.length&&!state.big_screens_only;
  renderFilterChips();
  const plan=interpretSearch(data,state,{index:searchIndex,intent:smartSearchUI?.current()?.intent});
  let feedback=$('searchFeedback');
  if(!feedback){feedback=document.createElement('section');feedback.id='searchFeedback';feedback.className='search-feedback';feedback.setAttribute('aria-live','polite');$('searchActiveControls').after(feedback);}
  const locationUnresolved=locationSearchUI?.current().location&&!locationSearchUI.current().origin;
  const feedbackHTML=state.query.trim()&&!locationUnresolved&&!(searchPending&&!visible.length)?feedbackMarkup(searchFeedback(data,state,visible,{index:searchIndex,intent:plan,language,origin:locationSearchUI?.current().origin,availability:availabilitySnapshot()}),{language,programme:data,listingPath}):'';
  if(feedback.innerHTML!==feedbackHTML)feedback.innerHTML=feedbackHTML;
  feedback.hidden=!feedbackHTML;
  $('moreFilms').hidden=visible.length<=cardLimit;
  $('grid').setAttribute('aria-busy',String(searchPending));
  $('grid').dataset.enhanced='true';
  if(locationUnresolved||(searchPending&&!visible.length)){$('grid').replaceChildren();return;}
  if(plan.venue_query){$('grid').replaceChildren();return;}
  if(plan.scope==='past'&&visible.length){
    $('grid').innerHTML=visible.slice(0,cardLimit).map(film=>`<article class="search-history"><h2><a href="${safeURL(film.urls?.[language])}">${escapeHTML(film.title)}</a></h2><p>${escapeHTML(searchCopy(language).past)}</p><ul>${film.sessions.map(s=>`<li>${escapeHTML(s.date+' · '+s.time+' · '+(cinema(s.cinema_id)?.short||s.cinema_id))}</li>`).join('')}</ul></article>`).join('');return;
  }
  if(!visible.length){
    $('grid').innerHTML=`<div class="empty"><h2>${t('noMatches')}</h2><p>${t('emptyHint')}</p><button type="button" class="btn btn-secondary" data-reset>${t('reset')}</button></div>`;
    return;
  }
  const view=listingView();
  const nodes=visible.slice(0,cardLimit).map(film=>{
    const body=view.bodyMarkup(film,{matchReason:filmMatchReason(film,plan,language)});
    let cached=cardNodes.get(film.id);
    if(!cached){
      const node=document.createElement('article');
      node.className='card';node.dataset.film=film.id;node.dataset.open=film.id;
      node.innerHTML=`<a href="${safeURL(filmHref(film))}" class="poster-button" data-open="${escapeHTML(film.id)}" aria-haspopup="dialog" aria-label="${escapeHTML(t('moreInfo')+': '+film.title)}">${imageMarkup(film)}</a><div class="card-body">${body}</div>`;
      cached={node,body};cardNodes.set(film.id,cached);
    }else{
      if(cached.body!==body){
        // HTML parsing normalizes boolean attributes; compare that form once.
        const template=document.createElement('template');template.innerHTML=body;
        if(!cached.adopted||cached.body!==template.innerHTML)cached.node.querySelector('.card-body').replaceChildren(template.content);
        cached.body=body;
      }
      cached.adopted=false;
      const poster=cached.node.querySelector('.poster-button');
      if((poster.querySelector('img')?.dataset.imageSource||'')!==(film.poster_url||''))poster.innerHTML=imageMarkup(film);
      const href=filmHref(film);
      if(poster.getAttribute('href')!==href)poster.setAttribute('href',href);
      poster.setAttribute('aria-label',t('moreInfo')+': '+film.title);
      poster.setAttribute('aria-haspopup','dialog');
    }
    return cached.node;
  });
  const grid=$('grid'),wanted=new Set(nodes);
  let changed=false;
  for(const child of [...grid.children])if(!wanted.has(child)){child.remove();changed=true;}
  let cursor=grid.firstElementChild;
  for(const node of nodes){
    if(node!==cursor){grid.insertBefore(node,cursor);changed=true;}
    cursor=node.nextElementSibling;
  }
  observeImages(grid);
  if(changed)updateSeatDisplays(grid);
  markStartedShowtimes();
}

function setLanguage(next,{preserveDraft=false}={}){
  language=TEXT[next]?next:'en';
  document.documentElement.lang=language;
  try { localStorage.setItem('barcelona-cinema-language',language); } catch {}
  document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));
  document.querySelectorAll('[data-lang]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.lang===language)));
  $('search').placeholder=t('searchPlaceholder');
  if(!preserveDraft)suggestionsUI?.sync();
  $('search').setAttribute('aria-label',t('search'));
  $('dates').setAttribute('aria-label',t('screeningDates'));
  if(data){
    updateSearchControllers();
    refreshResults();
    if($('filmDialog').open)renderDialog();
  }
}

function availabilityHTML(session,compact=false){
  const wrap=html=>compact?`<span class="seat-status">${html}</span>`:`<div class="seat-status">${html}</div>`;
  const observation=availabilityFor(session,availabilitySnapshot());
  const value=observation.checked_at?observation:null;
  const soldOut=isSoldOut(session);
  if(compact)return soldOut?wrap(`<span class="seat-count unavailable">${t('soldOut')}</span>`):'';
  if(!value){
    if(session.is_sold_out)return wrap(`<span class="seat-count unavailable">${t('soldOut')}</span>`);
    if(!observation.supported)return wrap(t('yelmoSeats'));
    return wrap(t(seatErrors.has(session.id)||availabilityFailed?'unavailable':'checking'));
  }
  let label='',tone='';
  if(soldOut){label=t('soldOut');tone='unavailable';}
  else if(typeof value.available==='number'){
    label=value.available+' '+t('seats');
    if(value.available<20)tone='low';
  }
  return wrap(`<span class="seat-count ${tone}">${escapeHTML(label)}</span>`);
}

function renderDialog(){
  const source=data?.films.find(f=>f.id===activeFilm);
  if(!source)return;
  const filtered=visible.find(f=>f.id===activeFilm);
  const candidate=filtered&&(!activeSession||filtered.sessions.some(session=>session.id===activeSession))?filtered:source;
  const film={...candidate,sessions:candidate.sessions.filter(future)};
  renderFilmDialog($('filmDialog'),film,{language,cinemas:data.cinemas,selectedSessionId:activeSession,availability:availabilitySnapshot(),view:activeView});
}

function openFilm(id,sessionId=null,{push=true,view=sessionId?'screening':'film',restoreScroll=false,revealSession=null}={}){
  const film=data?.films.find(film=>matchesFilmId(film,id));
  if(!film||!film.sessions.some(future)||(sessionId&&!film.sessions.some(session=>session.id===sessionId&&future(session))))return false;
  if(searchTimer||searchFrame){
    if(parseFilmQuery(data,state.query,todayISO(),searchIndex).range){state.date_from=null;state.date_to=null;}
    cancelSearchRender();refreshResults();
  }
  $('linkNotice').hidden=true;
  const dialog=$('filmDialog');
  const animateTransition=prepareFilmTransition(dialog,film.id,view);
  if(dialog.open&&activeFilm===film.id&&activeView==='showtimes'){showtimesScroll=getDialogScroller(dialog).scrollTop;showtimesSession=sessionId;}
  else if(!dialog.open||activeFilm!==film.id){showtimesScroll=0;showtimesSession=null;}
  pendingLink=null;activeFilm=film.id;activeSession=sessionId;activeView=view;renderDialog();
  showFilmDialog(dialog);
  getDialogScroller(dialog).scrollTop=0;syncURL(push);
  focusSelectedScreening(dialog);
  if(view==='showtimes'&&restoreScroll){
    [...dialog.querySelectorAll('.card-showtime')].find(link=>link.dataset.session===showtimesSession)?.focus({preventScroll:true});
    getDialogScroller(dialog).scrollTop=showtimesScroll;
  }
  if(view==='showtimes'&&revealSession){
    const target=[...dialog.querySelectorAll('.card-showtime')].find(link=>link.dataset.session===revealSession);
    if(target){
      const scroller=getDialogScroller(dialog),header=dialog.querySelector('.dialog-head');
      const available=scroller.clientHeight-header.getBoundingClientRect().height-16;
      const bottom=target.getBoundingClientRect().bottom;
      // Keep the date and cinema in view whenever they fit above the extra time.
      const context=[target.closest('.dialog-day'),target.closest('.schedule-cinema'),target]
        .find(node=>node&&bottom-node.getBoundingClientRect().top<=available)||target;
      scroller.scrollTop+=context.getBoundingClientRect().top-header.getBoundingClientRect().bottom-8;
      target.focus({preventScroll:true});
    }
  }
  animateTransition();
  window.dispatchEvent(new CustomEvent('vobarna:screening-open',{detail:{film_id:film.id,screening_id:sessionId,placement:'listing'}}));
  return true;
}

function updateSeatDisplays(root=document){
  if(!data)return;
  markStartedShowtimes();
  const sessions=new Map(data.films.flatMap(film=>film.sessions.map(session=>[session.id,session])));
  root.querySelectorAll('[data-availability]').forEach(el=>{
    const session=sessions.get(el.dataset.availability);
    if(!session)return;
    const html=availabilityHTML(session,el.hasAttribute('data-compact'));
    if(el.innerHTML!==html)el.innerHTML=html;
    const button=el.closest('.card-showtime');
    if(button){
      button.classList.toggle('is-sold-out',isSoldOut(session));
      button.setAttribute('aria-label',showtimeLabel(session,data.films.find(f=>f.id===button.dataset.open)?.title));
    }
    const row=el.closest('.buyrow');
    if(row){
      row.classList.toggle('is-sold-out',isSoldOut(session));
      row.setAttribute('aria-label',(row.classList.contains('is-highlighted')?t('selected')+' · ':'')+showtimeLabel(session,data.films.find(f=>f.id===activeFilm)?.title));
    }
  });
}

async function loadAvailability(){
  if(availabilityLoading||!data||document.hidden||Date.now()<availabilityDue)return;
  clearTimeout(availabilityTimer);
  availabilityLoading=true;
  try{
    const response=await fetch(document.body.dataset.availabilityUrl||'/api/preview/availability',{
      cache:'no-cache',headers:availabilityETag?{'If-None-Match':availabilityETag}:{},signal:AbortSignal.timeout(10000)
    });
    const etag=response.headers.get('ETag');
    if(response.status===304||(response.ok&&etag&&etag===availabilityETag)){
      availabilityFailed=false;
      return;
    }
    if(!response.ok)throw new Error('Unavailable');
    const snapshot=await response.json();
    if(!snapshot.sessions||!snapshot.errors)throw new Error('Invalid seat data');
    for(const [id,value] of Object.entries(snapshot.sessions)){
      if(Number.isInteger(value.available)&&value.available>=0&&Number.isFinite(Date.parse(value.checked_at)))seats.set(id,value);
    }
    if(Number.isFinite(snapshot.refresh_interval_seconds)&&snapshot.refresh_interval_seconds>0)availabilityInterval=snapshot.refresh_interval_seconds;
    availabilityRefreshing=snapshot.refreshing===true;
    availabilityETag=etag;
    if(Array.isArray(snapshot.supported_providers))supportedProviders=snapshot.supported_providers;
    seatErrors.clear();
    Object.keys(snapshot.errors).forEach(id=>seatErrors.add(id));
    saveCache(SEATS_CACHE,snapshot.sessions);
    availabilityFailed=false;
  }catch{availabilityFailed=true;}
  finally{
    availabilityLoading=false;updateSeatDisplays();refreshLiveSearch();
    // Check active refreshes sooner; idle snapshots follow the source's cadence.
    const delay=availabilityFailed?60000:availabilityRefreshing?30000:Math.max(30000,Math.min(availabilityInterval*1000,15*60*1000));
    availabilityDue=Date.now()+delay;
    availabilityTimer=setTimeout(loadAvailability,delay);
  }
}

function reset(){
  applySearch(emptySearch());
  $('dates').scrollLeft=0;
}

function useProgramme(prepared,{cached=false}={}){
  data=prepared.programme;
  searchIndex=prepared.index;
  void suggestionsUI?.refresh();
  smartSearchUI?.reset();
  locationSearchUI?.reset();
  dateLabels.clear();
  if((searchTimer||searchFrame)&&parseFilmQuery(data,state.query,todayISO(),searchIndex).range){state.date_from=null;state.date_to=null;}
  cancelSearchRender();
  if(activeFilm){
    const current=data.films.find(film=>matchesFilmId(film,activeFilm));
    if(current)activeFilm=current.id;
    if(!current||!current.sessions.some(session=>future(session)&&(!activeSession||session.id===activeSession))){
      const previous={filmId:activeFilm,screeningId:activeSession};
      closeFilm();pendingLink=previous;
    }
  }
  if(legacyCinema){
    const venue=cinema(legacyCinema);
    if(venue)state.cinema_ids=[...new Set([...state.cinema_ids,venue.id])];
    if(venue||!cached)legacyCinema=null;
  }
  // An older browser cache may not contain a newly added cinema or format.
  // Only the current fetched catalogue can invalidate a shared filter URL.
  if(!cached){try{Object.assign(state,validateSearch(state,data,searchIndex));}catch{Object.assign(state,emptySearch(),{query:state.query});}}
  if(!suggestionsUI)$('search').value=state.query;
  if(publicLanguage){
    const filters=document.querySelector('.filters[hidden]');
    if(filters)filters.hidden=false;
  }
  setLanguage(language,{preserveDraft:true});
  restoreLink(false);syncURL();
  startWebMCP();
  suggestionsUI?.ready();
}

// A slow connection that keeps delivering the catalogue must be allowed to
// finish: a fixed deadline left slow phones without search. Only a stalled
// download is abandoned.
const PROGRAMME_STALL=20000;
async function fetchProgramme(){
  const controller=new AbortController();
  let timer=0;
  const watch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),PROGRAMME_STALL);};
  watch();
  try{
    const response=await fetch(document.body.dataset.programmeUrl||'/preview-data/programme.json',{cache:'no-cache',signal:controller.signal});
    if(!response.ok)throw new Error('Programme unavailable');
    if(!response.body)return await response.text();
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let text='';
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      watch();text+=decoder.decode(value,{stream:true});
    }
    return text+decoder.decode();
  }finally{clearTimeout(timer);}
}

let programmeLoad=null;
// Refresh timers and returning tabs must not stack requests behind a slow one.
function load(){return programmeLoad||=loadProgramme().finally(()=>{programmeLoad=null;});}

async function loadProgramme(){
  try{
    const next=await programmeLoader.prepare(await fetchProgramme());
    programmeFailed=false;
    if(!data||next.programme.generated_at!==data.generated_at)useProgramme(next);
    restoreLink(true);
    loadAvailability();
  }catch{
    programmeFailed=true;
    if(!data&&cachedProgramme)useProgramme(cachedProgramme,{cached:true});
    restoreLink(true);
    $('grid').setAttribute('aria-busy','false');
    if(!data){$('resultCount').textContent=t('loadFail');if(!publicLanguage)$('grid').innerHTML=`<div class="empty" role="alert"><h2>${t('loadFail')}</h2><p>${t('loadHint')}</p><button type="button" class="btn" data-retry>${t('reload')}</button></div>`;}
  }
}

function restoreLink(final){
  if(!pendingLink||!data)return;
  const {filmId,screeningId,filmView}=pendingLink;
  const film=screeningId?data.films.find(f=>f.sessions.some(s=>s.id===screeningId&&future(s))):data.films.find(f=>matchesFilmId(f,filmId)&&f.sessions.some(future));
  if(film&&(!filmId||matchesFilmId(film,filmId))){openFilm(film.id,screeningId,{push:false,view:filmView});return;}
  if(final){
    pendingLink=null;syncURL();
    $('linkNotice').textContent={en:'This film or screening is no longer in the upcoming programme. Search for another session.',es:'Esta película o sesión ya no está en la próxima cartelera. Busca otra sesión.',ca:'Aquesta pel·lícula o sessió ja no és a la propera cartellera. Cerca una altra sessió.'}[language];
    $('linkNotice').hidden=false;
  }
}

const cinemaService=createCinemaService({
  getProgramme:()=>data,getAvailability:availabilitySnapshot,
  getView:()=>({filters:state,language,listingPath,programmeFailed,filmId:$('filmDialog').open?activeFilm:null,screeningId:$('filmDialog').open?activeSession:null}),
  applySearch,showScreening:openFilm,getURL:()=>location.href
});

function showMoreFilms(){
  if(searchTimer||searchFrame||cardLimit>=visible.length)return;
  cardLimit+=CARD_BATCH_SIZE;
  render(visible);
}

function startWebMCP(){
  if(webMCPStarted||!data)return;
  webMCPStarted=true;
  const onError=error=>console.warn('VO Barna WebMCP registration failed:',error);
  webMCPTrial().then(()=>registerWebMCP(document.modelContext,cinemaService,{signal:lifecycle.signal,onError}))
    .then(cleanup=>{webMCPCleanup=cleanup;}).catch(onError);
}

// The third-party origin-trial script loads without blocking the page. Only
// tool registration waits for it, and continues if it cannot be fetched.
function webMCPTrial(){
  const script=document.querySelector('script[data-webmcp-trial]');
  if(!script||script.dataset.webmcpTrial)return Promise.resolve();
  return new Promise(resolve=>{for(const type of ['load','error'])script.addEventListener(type,resolve,{once:true});});
}

// Touch browsers do not consistently expose :active while a finger is down.
// Pointer cancellation clears feedback as soon as native scrolling takes over.
let pressedPoster=null;
function clearPosterPress(){pressedPoster?.classList.remove('is-pressed');pressedPoster=null;}
document.addEventListener('pointerdown',event=>{
  clearPosterPress();
  if(!event.isPrimary||event.pointerType==='mouse')return;
  pressedPoster=event.target.closest('.poster-button');
  pressedPoster?.classList.add('is-pressed');
},{passive:true});
for(const type of ['pointerup','pointercancel'])document.addEventListener(type,clearPosterPress,{passive:true});
for(const type of ['blur','pagehide'])window.addEventListener(type,clearPosterPress);

document.addEventListener('click',event=>{
  const showtime=event.target.closest('.card-showtime');
  if(showtime&&Date.parse(showtime.querySelector('time')?.dateTime)<Date.now()){event.preventDefault();markStartedShowtimes();return;}
  const anchor=event.target.closest('a');
  if(anchor&&(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey))return;
  if(anchor?.hasAttribute('data-search-suggestion')){event.preventDefault();applySearch(searchFromURL(new URL(anchor.href).searchParams));return;}
  if(event.target.closest('[data-show-film-times]')){
    openFilm(activeFilm,null,{push:false,view:'showtimes',restoreScroll:true});
    return;
  }
  if(anchor?.hasAttribute('data-programme-session')){
    // The compact HTML already has the canonical screening URL. Reuse its hash
    // instead of repeating provider/session identifiers thousands of times.
    const filmId=anchor.closest('[data-programme-film]')?.dataset.programmeFilm;
    const film=data?.films.find(film=>film.id===filmId);
    const session=film?.sessions.find(session=>session.anchor===new URL(anchor.href).hash);
    if(session&&openFilm(film.id,session.id))event.preventDefault();
    return;
  }
  if(anchor&&!anchor.hasAttribute('data-open'))return;
  const card=event.target.closest('a[data-open]');
  if(card){if(openFilm(card.dataset.open,card.dataset.session,{push:!$('filmDialog').open,view:card.dataset.view,revealSession:card.dataset.revealSession})&&anchor)event.preventDefault();return;}
  const button=event.target.closest('button');
  if(!button)return;
  if(button.hasAttribute('data-location-choice'))locationSearchUI.select(Number(button.dataset.locationChoice));
  else if(button.hasAttribute('data-location-retry')){
    // WebKit retains a denied geolocation decision for the document lifetime.
    // Reload after the visitor changes permission; the query stays in the URL.
    if(locationSearchUI.current().status==='denied')window.location.reload();
    else locationSearchUI.update({retry:true});
  }
  else if(button.dataset.lang)setLanguage(button.dataset.lang);
  else if(button.dataset.date&&!data){
    initialViewTime=null;state.date_from=state.date_to=button.dataset.date==='all'?null:button.dataset.date;
    $('dates').querySelectorAll('[data-date]').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));
  }
  else if(button.dataset.date){const parsed=parsedSearch(),date=button.dataset.date==='all'?null:button.dataset.date;applySearch({...state,query:parsed.range?parsed.text:state.query,date_from:date,date_to:date});}
  else if(button.hasAttribute('data-remove-filter')){
    const field=button.dataset.removeFilter,next={...state};
    if(field==='dates'){next.date_from=null;next.date_to=null;}
    else if(field==='big_screens_only')next.big_screens_only=false;
    else if(field==='intent')next.ignored_filters=[...new Set([...(state.ignored_filters||[]),button.dataset.value])];
    else if(['cinema_ids','formats'].includes(field))next[field]=state[field].filter(value=>value!==button.dataset.value);
    applySearch(next);
  }
  else if(button.hasAttribute('data-close'))closeFilm({animate:true});
  else if(button.hasAttribute('data-reset')||button.id==='clearFilters')reset();
  else if(button.hasAttribute('data-retry'))load();
});
suggestionsUI=createSearchSuggestionsUI({input:$('search'),getProgramme:()=>data,getLanguage:()=>language,getQuery:()=>state.query,scoped:listingCinemaId||null,
  onDraft:draft=>{if(searchTimer||searchFrame)resultsPending=true;cancelSearchRender();smartSearchUI?.cancel();if(draft)$('clearFilters').hidden=false;},
  onSubmit:(query,options)=>{
    // Submitting the phrase again reapplies every named constraint, including
    // ones removed as chips during the previous search.
    const next={...state,query,ignored_filters:[]};
    if(parseFilmQuery(data,query,todayISO(),searchIndex).range){next.date_from=null;next.date_to=null;}
    applySearch(next,options);
  }
});
document.addEventListener('focusout',()=>{
  queueMicrotask(()=>{if(resultsPending&&!editingSearch())refreshResults();});
});
document.addEventListener('keydown',event=>{
  if(event.key!=='/'||event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
  event.preventDefault();
  closeFilm();
  $('search').focus();$('search').select();
});
$('dates').addEventListener('scroll',updateDateFades,{passive:true});
$('filmDialog').addEventListener('close',()=>{
  if(!$('filmDialog').open){activeFilm=null;activeSession=null;activeView='film';syncURL();}
});
window.addEventListener('popstate',event=>{
  const view=event.state?.vobarna;
  if(publicLanguage&&view?.listingPath===listingPath){
    restoringHistory=true;
    try{
      applySearch(view.filters);
      pendingLink=view.filmId||view.screeningId?{filmId:view.filmId,screeningId:view.screeningId,filmView:view.filmView}:null;
      restoreLink(true);
    }finally{restoringHistory=false;}
    syncURL();
    return;
  }
  const params=new URLSearchParams(location.search);
  const next=searchFromURL(params);
  if(relativeDate&&location.pathname===listingPath&&!params.size)next.date_from=next.date_to=listingDate;
  if(!data){Object.assign(state,next);pendingLink={filmId:params.get('film'),screeningId:params.get('screening')};return;}
  try{applySearch(next);}catch{applySearch(emptySearch());}
  pendingLink=params.has('film')||params.has('screening')?{filmId:params.get('film'),screeningId:params.get('screening')}:null;
  restoreLink(true);
});
window.addEventListener('pagehide',event=>{if(!event.persisted){lifecycle.abort();webMCPCleanup?.();programmeLoader.destroy();suggestionsUI?.destroy();}});
new ResizeObserver(updateDateFades).observe($('dates'));
document.fonts.addEventListener('loadingdone',updateDateFades);
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{
  if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeFilm({animate:true});}
}));
document.addEventListener('error',event=>{
  if(event.target instanceof HTMLImageElement&&!event.target.hasAttribute('data-image-source')){event.target.hidden=true;const fallback=event.target.parentElement.querySelector('.poster-placeholder');if(fallback)fallback.hidden=false;}
},true);
const moreFilms=document.createElement('button');
moreFilms.id='moreFilms';moreFilms.type='button';moreFilms.className='btn btn-secondary';
moreFilms.dataset.i18n='moreFilms';moreFilms.hidden=true;
moreFilms.addEventListener('click',showMoreFilms);
$('grid').after(moreFilms);
if('IntersectionObserver' in window){
  const observer=new IntersectionObserver(entries=>{
    if(entries.some(entry=>entry.isIntersecting))showMoreFilms();
  },{rootMargin:'600px 0px'});
  observer.observe(moreFilms);
}
// Date-scoped pages retain their route-specific navigation.
if(publicLanguage&&!listingDate)installLanguageNavigation({
  ready:()=>Boolean(data)&&!$('filmDialog').open,
  getLanguage:()=>language,
  commit:(page,historyView)=>{
    listingPath=page.path;listingTitle=page.title;listingMetadata=readListingMetadata();
    // Both paths and metadata must belong to the new locale before any render
    // or dialog can write history again.
    restoringHistory=true;
    try{
      cancelSearchRender();
      setLanguage(page.language);
      if(historyView){
        applySearch(historyView.filters);
        pendingLink=historyView.filmId||historyView.screeningId?{filmId:historyView.filmId,screeningId:historyView.screeningId,filmView:historyView.filmView}:null;
        restoreLink(true);
      }
    }finally{restoringHistory=false;}
    syncURL();
  }
});
setLanguage(language);
try{
  for(const [id,value] of Object.entries(readCache(SEATS_CACHE)||{})){
    if(Number.isInteger(value.available)&&value.available>=0&&Number.isFinite(Date.parse(value.checked_at)))seats.set(id,value);
  }
}catch{data=null;}
// Read cache and network concurrently; a late cache must never replace fresh data.
void programmeLoader.readCache().then(cached=>{
  cachedProgramme=cached;
  const matchesPublication=!publicLanguage||cached?.programme.generated_at===$('grid').dataset.programmeGenerated;
  if(!data&&cached&&(matchesPublication||programmeFailed)){
    try{useProgramme(cached,{cached:true});loadAvailability();}catch{data=null;}
  }
}).catch(()=>{});
markStartedShowtimes();
setInterval(()=>{if(!document.hidden&&!refreshLiveSearch())markStartedShowtimes();},15000);
// Deferred decoration (static/theme.js) waits for this first attempt.
window.vobarnaProgramme=load();loadAvailability();
setInterval(()=>{if(!document.hidden)load();},5*60*1000);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)clearTimeout(availabilityTimer);
  else{
    load();
    clearTimeout(availabilityTimer);
    availabilityTimer=setTimeout(loadAvailability,Math.max(0,availabilityDue-Date.now()));
  }
});

// Relative-date pages follow Madrid midnight, including a restored background tab.
function refreshRelativeDate(){
  if(!relativeDate||document.hidden||location.pathname!==listingPath||$('filmDialog').open)return;
  const day=new Date(todayISO()+'T12:00:00Z');
  if(dateKind==='tomorrow')day.setUTCDate(day.getUTCDate()+1);
  if(day.toISOString().slice(0,10)!==listingDate)location.reload();
}
if(relativeDate){
  refreshRelativeDate();
  setInterval(refreshRelativeDate,30000);
  window.addEventListener('pageshow',refreshRelativeDate);
  window.addEventListener('vobarna:navigation',refreshRelativeDate);
  document.addEventListener('visibilitychange',refreshRelativeDate);
}
