import {availabilityFor} from './cinema-service.js';
import {TEXT} from './cinema-copy.js';
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=value=>typeof value==='string'&&(/^(https:\/\/|\/(?!\/))/.test(value))?escapeHTML(value):'';
const RATING_LABELS = {en:{critics:'RT · Critics',audience:'RT · Audience'},es:{critics:'RT · Crítica',audience:'RT · Público'},ca:{critics:'RT · Crítica',audience:'RT · Públic'}};
const DETAIL_LABELS = {
  en:{directedBy:'Directed by',languages:'Original language',reportedLanguages:'Languages',empty:'No upcoming screenings listed.',lastScreening:'Last listed screening'},
  es:{directedBy:'Dirección',languages:'Idioma original',reportedLanguages:'Idiomas',empty:'No hay próximas sesiones anunciadas.',lastScreening:'Última sesión anunciada'},
  ca:{directedBy:'Direcció',languages:'Idioma original',reportedLanguages:'Idiomes',empty:'No hi ha pròximes sessions anunciades.',lastScreening:'Última sessió anunciada'}
};
// Historical context is plain text, never a time link or booking action.
export function lastScreeningMarkup(film,{language='en',cinemas=[],now=Date.now()}={}){
  const last=[film.last_screening,...film.sessions].filter(s=>s&&Date.parse(s.starts_at)<now)
    .sort((a,b)=>Date.parse(b.starts_at)-Date.parse(a.starts_at))[0];
  if(!last)return '';
  const date=new Intl.DateTimeFormat({en:'en-GB',es:'es-ES',ca:'ca-ES'}[language],
    {timeZone:'Europe/Madrid',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(last.starts_at));
  const venue=cinemas.find(c=>c.id===last.cinema_id)?.name;
  return `${DETAIL_LABELS[language].lastScreening}: <time datetime="${escapeHTML(last.starts_at)}">${escapeHTML(date)}</time>${venue?' · '+escapeHTML(venue):''}`;
}
const RATING_PROVIDERS = [
  {id:'rotten_tomatoes',name:'Rotten Tomatoes · Tomatometer',label:'critics',icons:{positive:'rt-fresh.svg',negative:'rt-rotten.svg',empty:'rt-empty.svg'},scale:100,search:title=>'https://www.rottentomatoes.com/search?search='+encodeURIComponent(title)},
  {id:'rotten_tomatoes_audience',parent:'rotten_tomatoes',audience:true,name:'Rotten Tomatoes · Popcornmeter',label:'audience',icons:{positive:'rt-audience-positive.svg',negative:'rt-audience-negative.svg',empty:'rt-audience-empty.svg'},scale:100,search:title=>'https://www.rottentomatoes.com/search?search='+encodeURIComponent(title)},
  {id:'filmaffinity',name:'FilmAffinity',icon:'filmaffinity.png',scale:10,search:title=>'https://www.filmaffinity.com/es/search.php?stext='+encodeURIComponent(title)},
  {id:'imdb',name:'IMDb',icon:'imdb.ico',scale:10,search:title=>'https://www.imdb.com/find/?s=tt&q='+encodeURIComponent(title)}
];
function groupShowtimes(sessions){
  const days=new Map();
  for(const session of [...sessions].sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at))){
    if(!days.has(session.date))days.set(session.date,new Map());
    const venues=days.get(session.date);
    if(!venues.has(session.cinema_id))venues.set(session.cinema_id,[]);
    venues.get(session.cinema_id).push(session);
  }
  return days;
}

// Shared HTML for the crawlable film page and the listing's dialog.
export function filmMarkup(film,{language='en',cinemas=[],selectedSessionId=null,availability={},poster='',page=false,availabilityPending=true,view='all',now=Date.now()}={}){
  const activeSession=selectedSessionId;
  const t=key=>TEXT[language]?.[key]||TEXT.en[key]||key;
  const locale=()=>({en:'en-GB',es:'es-ES',ca:'ca-ES'}[language]||'en-GB');
  const cinema=id=>cinemas.find(item=>item.id===id);
  const cinemaHref=id=>cinema(id)?.urls?.[language]||('/'+language+'/');
  const availabilitySnapshot=()=>availability;
  const seatErrors=availability.errors||new Set(),availabilityFailed=availability.failed;
  const isSoldOut=session=>['booking_closed','sold_out'].includes(availabilityFor(session,availability).status);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const dayHeading=date=>(date===today?t('today')+' · ':'')+new Intl.DateTimeFormat(locale(),{timeZone:'Europe/Madrid',...(date===today?{}:{weekday:'short'}),day:'numeric',month:'short',...(date.slice(0,4)===today.slice(0,4)?{}:{year:'numeric'})}).format(new Date(date+'T12:00:00Z'));
  const showtimeLabel=session=>[session.time,film.title,dayHeading(session.date),cinema(session.cinema_id)?.name||session.cinema_id,...(session.formats||[]),session.version,isSoldOut(session)?t('soldOut'):''].filter(Boolean).join(' · ');
  const tags=session=>[...(session.formats||[]),session.version].filter(Boolean).map(value=>`<span class="tag">${escapeHTML(value)}</span>`).join('');
const age = value => {
  const minutes=Math.max(0,Math.floor((Date.now()-Date.parse(value))/60000));
  if(!Number.isFinite(minutes))return '';
  if(minutes===0)return {en:'just now',es:'ahora mismo',ca:'ara mateix'}[language];
  return language==='es'?`hace ${minutes} min`:language==='ca'?`fa ${minutes} min`:`${minutes} ${minutes===1?'min':'mins'} ago`;
};
function availabilityHTML(session,compact=false){
  const wrap=html=>compact?`<span class="seat-status">${html}</span>`:`<div class="seat-status">${html}</div>`;
  const observation=availabilityFor(session,availabilitySnapshot());
  const value=observation.checked_at?observation:null;
  const soldOut=isSoldOut(session);
  if(compact)return soldOut?wrap(`<span class="seat-count unavailable">${t('soldOut')}</span>`):'';
  if(!value){
    if(session.is_sold_out)return wrap(`<span class="seat-count unavailable">${t('soldOut')}</span>`);
    if(!observation.supported)return wrap(t('yelmoSeats'));
    return wrap(t(availabilityPending?(seatErrors.has(session.id)||availabilityFailed?'unavailable':'checking'):'yelmoSeats'));
  }
  let label='',tone='';
  if(soldOut){label=t('soldOut');tone='unavailable';}
  else if(typeof value.available==='number'){
    label=value.available+' '+t('seats');
    if(value.available<20)tone='low';
  }
  const refreshed=!compact&&value.checked_at?`<span class="seat-age"> · ${escapeHTML(age(value.checked_at))}</span>`:'';
  return wrap(`<span class="seat-count ${tone}">${escapeHTML(label)}</span>${refreshed}`);
}

function dialogShowtime(session){
  const ticketLabel=session.booking_scope==='box_office'?t('boxOffice'):t('tickets');
  const details=session.room?t('room')+' '+session.room:'';
  return `<article class="buyrow${session.id===activeSession?' is-highlighted':''}${isSoldOut(session)?' is-sold-out':''}" data-session="${escapeHTML(session.id)}"${page?` id="${escapeHTML(session.url_fragment)}" data-starts="${escapeHTML(session.starts_at)}"`:""} tabindex="-1" aria-label="${escapeHTML((session.id===activeSession?t('selected')+' · ':'')+showtimeLabel(session))}">
    <div class="buyrow-info"><div class="buyrow-heading"><time class="buyrow-time" datetime="${escapeHTML(session.starts_at)}">${escapeHTML(session.time)}</time><div class="tags">${tags(session)}</div></div>
      <div class="buyrow-details">${details?`<p class="buyrow-room">${escapeHTML(details)}</p>`:''}
        <div class="availability-content" data-availability="${escapeHTML(session.id)}">${availabilityHTML(session)}</div>
      </div>
    </div>
    <a class="btn buyrow-ticket" href="${safeURL(session.booking_url)}" target="_blank" rel="noopener noreferrer" data-ticket-film="${escapeHTML(film.id)}" data-ticket-screening="${escapeHTML(session.id)}" data-ticket-cinema="${escapeHTML(session.cinema_id)}" aria-label="${escapeHTML(ticketLabel+' · '+showtimeLabel(session))}">${ticketLabel}</a>
  </article>`;
}

function scheduleShowtime(session){
  const href=session.urls?.[language]||(film.urls?.[language]&&session.url_fragment?film.urls[language]+'#'+session.url_fragment:
    '/'+language+'/?film='+encodeURIComponent(film.id)+'&screening='+encodeURIComponent(session.id));
  // Static film pages keep a direct booking fallback; JS enhances these links.
  const destination=page?session.booking_url:href;
  const attributes=page?` id="${escapeHTML(session.url_fragment)}" data-starts="${escapeHTML(session.starts_at)}" target="_blank" rel="noopener noreferrer"`:' aria-haspopup="dialog"';
  return `<a class="card-showtime${isSoldOut(session)?' is-sold-out':''}" data-open="${escapeHTML(film.id)}" data-session="${escapeHTML(session.id)}" href="${safeURL(destination)}"${attributes} aria-label="${escapeHTML(showtimeLabel(session))}">
    <time datetime="${escapeHTML(session.starts_at)}">${escapeHTML(session.time)}</time>
    ${session.formats?.length?`<span class="schedule-format">${escapeHTML(session.formats.join(' · '))}</span>`:''}
    <span class="availability-content" data-availability="${escapeHTML(session.id)}" data-compact>${availabilityHTML(session,true)}</span>
  </a>`;
}

function scheduleMarkup(){
  const last=page?lastScreeningMarkup(film,{language,cinemas,now}):'';
  return `<div class="dialog-section showtimes-summary reading-wash"${page?' id="showtimes"':''}>${page?`<h2 class="film-showtimes-heading">${t('showtimes')}</h2>`:`<h3 class="sr-only">${t('showtimes')}</h3>`}
    <p class="film-empty"${film.sessions.length?' hidden':''}>${DETAIL_LABELS[language].empty}</p>
    ${page?`<p class="film-last-screening"${film.sessions.length||!last?' hidden':''}>${last}</p>`:''}
    ${[...groupShowtimes(film.sessions)].map(([date,venues])=>`
      <section class="dialog-day" data-date="${escapeHTML(date)}" aria-label="${escapeHTML(dayHeading(date))}">
        <h3 class="dialog-day-label">${escapeHTML(dayHeading(date))}</h3>
        <div class="schedule-cinemas">${[...venues].map(([id,sessions])=>`
          <div class="schedule-cinema">
            <a class="schedule-cinema-name" href="${safeURL(cinemaHref(id))}">${escapeHTML(cinema(id)?.short||cinema(id)?.name||id)}</a>
            <div class="schedule-times">${sessions.map(scheduleShowtime).join('')}</div>
          </div>`).join('')}</div>
      </section>`).join('')}
  </div>`;
}

function filmRatings(film){
  return `<div class="film-ratings">${RATING_PROVIDERS.map(provider=>{
    const source=film.ratings?.[provider.parent||provider.id];
    const rating=provider.audience?source?.audience:source;
    const available=Number.isFinite(rating?.score)&&rating.score>=0&&rating.score<=provider.scale;
    const score=available?new Intl.NumberFormat(locale(),{minimumFractionDigits:provider.scale===10?1:0,maximumFractionDigits:1}).format(rating.score):'—';
    const suffix=available?(provider.scale===100?'%':'/10'):'';
    const sourceLabel=provider.label?RATING_LABELS[language][provider.label]:provider.name;
    const label=score+suffix+' '+sourceLabel+' · '+provider.name+(provider.audience&&rating?.count_label?' · '+rating.count_label:'');
    const icon=provider.icons?provider.icons[!available?'empty':rating.score<60?'negative':'positive']:provider.icon;
    return `<a class="film-rating" href="${safeURL(rating?.url||source?.url||provider.search(film.english_title||film.original_title||film.title))}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}">
      <span class="rating-value"><img src="/rating-icons/${icon}" alt="" width="24" height="24"><strong>${score}<span class="rating-scale">${suffix}</span></strong></span>
      <span class="rating-source">${sourceLabel}</span>
    </a>`;
  }).join('')}</div>`;
}

function filmLanguages(film){
  const languages=film.details?.languages||[];
  const label=film.details?.language_selection?.evidence==='catalogue_language_list'||film.details?.language_status?.state==='conflict'?'reportedLanguages':'languages';
  return languages.length?`<p class="dialog-languages">${DETAIL_LABELS[language][label]}: ${escapeHTML(languages.join(', '))}</p>`:'';
}

  const details=film.details||{},runtime=details.runtime_minutes||film.runtime_minutes;
  const facts=[film.release_year||details.release_year,runtime?runtime+' '+t('min'):null,...(details.genres||[]).slice(0,3)].filter(Boolean).join(' · ');
  const directors=details.directors?.length?`<p class="dialog-director">${DETAIL_LABELS[language].directedBy} ${escapeHTML(details.directors.join(', '))}</p>`:'';
  const heading=page?'h1':'h2';
  const toolbar=page?'':`<div class="dialog-toolbar"><div class="dialog-drag-handle" aria-hidden="true"></div><button class="dialog-close" type="button" data-close aria-label="${t('close')}">×</button></div>`;
  const title=view==='showtimes'?`<a class="dialog-film-link" href="${safeURL(film.urls?.[language]||'/'+language+'/?film='+encodeURIComponent(film.id))}" data-open="${escapeHTML(film.id)}" data-view="film" aria-haspopup="dialog">${escapeHTML(film.title)}</a>`:escapeHTML(film.title);
  const header=`<div class="dialog-head${page?'':' reading-wash'}">${poster}<div class="dialog-heading${page?' reading-wash':''}"><${heading} class="dialog-title" id="${page?'filmTitle':'dialogTitle'}" tabindex="-1">${title}</${heading}>${['screening','showtimes'].includes(view)?'':`<div class="dialog-intro">${facts?`<p class="dialog-meta">${escapeHTML(facts)}</p>`:''}${directors}${filmLanguages(film)}</div>${filmRatings(film)}`}</div></div>`;
  if(view==='showtimes')return toolbar+header+scheduleMarkup();
  if(view==='film')return toolbar+header+`<div class="dialog-actions reading-wash"><button type="button" class="sheet-showtimes" data-show-film-times>${t('view')} <span aria-hidden="true">→</span></button></div>`;
  if(view==='screening'){
    const session=film.sessions.find(session=>session.id===activeSession);
    if(!session)return toolbar+header+`<p class="dialog-section film-empty reading-wash">${DETAIL_LABELS[language].empty}</p>`;
    return toolbar+header+`<div class="dialog-section screening-summary reading-wash"><p class="screening-date">${escapeHTML(dayHeading(session.date))}</p><h3 class="screening-cinema"><a href="${safeURL(cinemaHref(session.cinema_id))}">${escapeHTML(cinema(session.cinema_id)?.name||session.cinema_id)}</a></h3>${dialogShowtime(session)}</div><div class="dialog-actions reading-wash"><button type="button" class="sheet-showtimes" data-show-film-times>${t('view')} <span aria-hidden="true">→</span></button></div>`;
  }
  if(page)return header+scheduleMarkup();
  return toolbar+header+`
    <div class="dialog-section reading-wash"${page?' id="showtimes"':''}>${page?`<h2 class="sr-only">${t('showtimes')}</h2>`:''}<p class="film-empty"${film.sessions.length?' hidden':''}>${DETAIL_LABELS[language].empty}</p>${[...groupShowtimes(film.sessions)].map(([date,venues])=>`
      <section class="dialog-day" data-date="${escapeHTML(date)}" aria-label="${escapeHTML(dayHeading(date))}">
        <h3 class="dialog-day-label">${escapeHTML(dayHeading(date))}</h3>
        <div class="dialog-cinemas">${[...venues].map(([cinemaId,sessions])=>`
          <section class="dialog-cinema" data-cinema="${escapeHTML(cinemaId)}" aria-label="${escapeHTML(cinema(cinemaId)?.name||cinemaId)}">
            <h4 class="dialog-cinema-name"><a href="${safeURL(cinemaHref(cinemaId))}">${escapeHTML(cinema(cinemaId)?.name||cinemaId)}</a></h4>
            <div class="dialog-showtimes">${sessions.map(dialogShowtime).join('')}</div>
          </section>`).join('')}</div>
      </section>`).join('')}</div>`;
}
