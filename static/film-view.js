import {availabilityFor} from './cinema-service.js';
import {TEXT} from './cinema-copy.js';
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=value=>typeof value==='string'&&(/^(https:\/\/|\/(?!\/))/.test(value))?escapeHTML(value):'';
const RATING_LABELS = {en:{critics:'RT · Critics',audience:'RT · Audience'},es:{critics:'RT · Crítica',audience:'RT · Público'},ca:{critics:'RT · Crítica',audience:'RT · Públic'}};
const DETAIL_LABELS = {
  en:{directedBy:'Directed by',languages:'Original language',reportedLanguages:'Languages',empty:'No upcoming screenings listed.'},
  es:{directedBy:'Dirección',languages:'Idioma original',reportedLanguages:'Idiomas',empty:'No hay próximas sesiones anunciadas.'},
  ca:{directedBy:'Direcció',languages:'Idioma original',reportedLanguages:'Idiomes',empty:'No hi ha pròximes sessions anunciades.'}
};
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
export function filmMarkup(film,{language='en',cinemas=[],selectedSessionId=null,availability={},poster='',page=false,availabilityPending=true}={}){
  const activeSession=selectedSessionId;
  const t=key=>TEXT[language]?.[key]||TEXT.en[key]||key;
  const locale=()=>({en:'en-GB',es:'es-ES',ca:'ca-ES'}[language]||'en-GB');
  const cinema=id=>cinemas.find(item=>item.id===id);
  const cinemaHref=id=>cinema(id)?.urls?.[language]||('/'+language+'/');
  const availabilitySnapshot=()=>availability;
  const seatErrors=availability.errors||new Set(),availabilityFailed=availability.failed;
  const isSoldOut=session=>['booking_closed','sold_out'].includes(availabilityFor(session,availability).status);
  const dayHeading=date=>new Intl.DateTimeFormat(locale(),{timeZone:'Europe/Madrid',weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(new Date(date+'T12:00:00Z'));
  const showtimeLabel=session=>[session.time,film.title,dayHeading(session.date),cinema(session.cinema_id)?.name||session.cinema_id,...(session.formats||[]),isSoldOut(session)?t('soldOut'):''].filter(Boolean).join(' · ');
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
  return `${page?'':`<div class="dialog-toolbar"><div class="dialog-drag-handle" aria-hidden="true"></div><button class="dialog-close" type="button" data-close aria-label="${t('close')}">×</button></div>`}
    <div class="dialog-head">${poster}<div class="dialog-heading"><${heading} class="dialog-title" id="${page?'filmTitle':'dialogTitle'}" tabindex="-1">${escapeHTML(film.title)}</${heading}><div class="dialog-intro">${facts?`<p class="dialog-meta">${escapeHTML(facts)}</p>`:''}${directors}${filmLanguages(film)}</div>${filmRatings(film)}</div></div>
    <div class="dialog-section"${page?' id="showtimes"':''}>${page?`<h2 class="sr-only">${t('showtimes')}</h2>`:''}<p class="film-empty"${film.sessions.length?' hidden':''}>${DETAIL_LABELS[language].empty}</p>${[...groupShowtimes(film.sessions)].map(([date,venues])=>`
      <section class="dialog-day" data-date="${escapeHTML(date)}" aria-label="${escapeHTML(dayHeading(date))}">
        <h3 class="dialog-day-label">${escapeHTML(dayHeading(date))}</h3>
        <div class="dialog-cinemas">${[...venues].map(([cinemaId,sessions])=>`
          <section class="dialog-cinema" data-cinema="${escapeHTML(cinemaId)}" aria-label="${escapeHTML(cinema(cinemaId)?.name||cinemaId)}">
            <h4 class="dialog-cinema-name"><a href="${safeURL(cinemaHref(cinemaId))}">${escapeHTML(cinema(cinemaId)?.name||cinemaId)}</a></h4>
            <div class="dialog-showtimes">${sessions.map(dialogShowtime).join('')}</div>
          </section>`).join('')}</div>
      </section>`).join('')}</div>`;
}
