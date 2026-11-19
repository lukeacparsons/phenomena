import {observeImages,posterMarkup} from './progressive-images.js';
import {availabilityFor} from './cinema-service.js';
import {TEXT} from './cinema-copy.js';
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=value=>typeof value==='string'&&(/^(https:\/\/|\/(?!\/))/.test(value))?escapeHTML(value):'';
const RATING_LABELS = {en:{critics:'RT · Critics',audience:'RT · Audience'},es:{critics:'RT · Crítica',audience:'RT · Público'},ca:{critics:'RT · Crítica',audience:'RT · Públic'}};
const DETAIL_LABELS = {
  en:{directedBy:'Directed by',languages:'Original language',reportedLanguages:'Languages'},
  es:{directedBy:'Dirección',languages:'Idioma original',reportedLanguages:'Idiomas'},
  ca:{directedBy:'Direcció',languages:'Idioma original',reportedLanguages:'Idiomes'}
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

const swipeDialogs = new WeakSet();
function enableSheetDismiss(dialog){
  if(dialog.tagName!=='DIALOG'||swipeDialogs.has(dialog))return;
  swipeDialogs.add(dialog);
  const mobile=matchMedia('(max-width:460px)');
  let gesture=null;
  const reset=()=>{
    gesture=null;
    dialog.classList.remove('is-sheet-dragging');
    dialog.style.removeProperty('--sheet-offset');
  };
  dialog.addEventListener('touchstart',event=>{
    reset();
    if(!mobile.matches||!dialog.open||event.touches.length!==1)return;
    const target=event.target;
    if(target.closest('a,button,input,select,textarea,[contenteditable]'))return;
    const handle=!!target.closest('.dialog-drag-handle');
    if(!handle&&(!target.closest('.dialog-head')||dialog.scrollTop>1))return;
    const touch=event.touches[0];
    gesture={id:touch.identifier,x:touch.clientX,y:touch.clientY,started:event.timeStamp,distance:0,handle};
  },{passive:true});
  dialog.addEventListener('touchmove',event=>{
    if(!gesture)return;
    if(event.touches.length!==1||(!gesture.handle&&dialog.scrollTop>1)){reset();return;}
    const touch=[...event.touches].find(touch=>touch.identifier===gesture.id);
    if(!touch){reset();return;}
    const dx=touch.clientX-gesture.x,dy=touch.clientY-gesture.y;
    // Upward and sideways gestures keep the browser's normal scrolling behavior.
    if(dy<-4||(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>8)){reset();return;}
    if(dy<=0){gesture.distance=0;dialog.style.setProperty('--sheet-offset','0px');return;}
    if(!event.cancelable&&!gesture.handle){reset();return;}
    if(event.cancelable)event.preventDefault();
    gesture.distance=dy;
    dialog.classList.add('is-sheet-dragging');
    dialog.style.setProperty('--sheet-offset',`${dy}px`);
  },{passive:false});
  dialog.addEventListener('touchend',event=>{
    if(!gesture)return;
    const {distance,started}=gesture;
    const threshold=Math.min(120,Math.max(64,dialog.clientHeight*.2));
    const dismiss=event.touches.length===0&&(distance>=threshold||
      (distance>=40&&distance/Math.max(1,event.timeStamp-started)>.5));
    reset();
    if(dismiss&&dialog.open)dialog.close();
  },{passive:true});
  dialog.addEventListener('touchcancel',reset,{passive:true});
  dialog.addEventListener('close',reset);
  mobile.addEventListener('change',reset);
}


// The listing and standalone information pages use the same dialog renderer.
export function renderFilmDialog(dialog,film,{language='en',cinemas=[],selectedSessionId=null,availability={}}={}){
  enableSheetDismiss(dialog);
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
    return wrap(t(seatErrors.has(session.id)||availabilityFailed?'unavailable':'checking'));
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
  return `<article class="buyrow${session.id===activeSession?' is-highlighted':''}${isSoldOut(session)?' is-sold-out':''}" data-session="${escapeHTML(session.id)}" tabindex="-1" aria-label="${escapeHTML((session.id===activeSession?t('selected')+' · ':'')+showtimeLabel(session))}">
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

  const scroll=dialog.scrollTop;
  dialog.dataset.film=film.id;
  const details=film.details||{},runtime=details.runtime_minutes||film.runtime_minutes;
  const facts=[film.release_year||details.release_year,runtime?runtime+' '+t('min'):null,...(details.genres||[]).slice(0,3)].filter(Boolean).join(' · ');
  const directors=details.directors?.length?`<p class="dialog-director">${DETAIL_LABELS[language].directedBy} ${escapeHTML(details.directors.join(', '))}</p>`:'';
  dialog.innerHTML=`<div class="dialog-toolbar"><div class="dialog-drag-handle" aria-hidden="true"></div><button class="dialog-close" type="button" data-close aria-label="${t('close')}">×</button></div>
    <div class="dialog-head">${posterMarkup(film,{className:'dialog-poster'})}<div class="dialog-heading"><h2 class="dialog-title" id="dialogTitle" tabindex="-1">${escapeHTML(film.title)}</h2><div class="dialog-intro">${facts?`<p class="dialog-meta">${escapeHTML(facts)}</p>`:''}${directors}${filmLanguages(film)}</div>${filmRatings(film)}</div></div>
    <div class="dialog-section">${[...groupShowtimes(film.sessions)].map(([date,venues])=>`
      <section class="dialog-day" data-date="${escapeHTML(date)}" aria-label="${escapeHTML(dayHeading(date))}">
        <h3 class="dialog-day-label">${escapeHTML(dayHeading(date))}</h3>
        <div class="dialog-cinemas">${[...venues].map(([cinemaId,sessions])=>`
          <section class="dialog-cinema" data-cinema="${escapeHTML(cinemaId)}" aria-label="${escapeHTML(cinema(cinemaId)?.name||cinemaId)}">
            <h4 class="dialog-cinema-name"><a href="${safeURL(cinemaHref(cinemaId))}">${escapeHTML(cinema(cinemaId)?.name||cinemaId)}</a></h4>
            <div class="dialog-showtimes">${sessions.map(dialogShowtime).join('')}</div>
          </section>`).join('')}</div>
      </section>`).join('')}</div>`;
  dialog.scrollTop=scroll;
  observeImages(dialog);
}

export function focusSelectedScreening(dialog){
  const selected=dialog.querySelector('.buyrow.is-highlighted');
  (selected||dialog.querySelector('#dialogTitle'))?.focus({preventScroll:true});
  if(selected){
    const bottom=selected.getBoundingClientRect().bottom;
    const context=[selected.closest('.dialog-day'),selected.closest('.dialog-cinema'),selected]
      .find(el=>bottom-el.getBoundingClientRect().top<=dialog.clientHeight-96)||selected;
    dialog.scrollTop=context.getBoundingClientRect().top-dialog.getBoundingClientRect().top-64;
  }
}
