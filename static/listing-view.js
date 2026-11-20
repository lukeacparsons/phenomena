// Shared by the static publication and the browser: one visible listing layout.
import {TEXT} from './cinema-copy.js';
export const HOME_CARD_PREVIEW=Object.freeze({
  cardDayLimit:1,cardCinemaLimit:3,cardTimeLimit:2,
  broadPreview:Object.freeze({minCinemas:4,minShowtimes:12,cinemaLimit:4,timeLimit:3})
});
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=value=>typeof value==='string'&&/^(https:\/\/|\/(?!\/))/.test(value)?escapeHTML(value):'';
export function createListingView({language='en',cinemas=[],today,listingPath='/',cardDayLimit=2,cardCinemaLimit=5,cardTimeLimit=Infinity,broadPreview=null,availabilityHTML=()=>'',isSoldOut=session=>Boolean(session.is_sold_out)}){
  const t=key=>TEXT[language]?.[key]||TEXT.en[key]||key;
  const locale={en:'en-GB',es:'es-ES',ca:'ca-ES'}[language];
  const formatters=new Map();
  const dateParts=(date,options)=>{
    const key=JSON.stringify(options);
    if(!formatters.has(key))formatters.set(key,new Intl.DateTimeFormat(locale,{timeZone:'Europe/Madrid',...options}));
    return formatters.get(key).format(new Date(date));
  };
  const displayDate=date=>dateParts(date+'T12:00:00Z',{weekday:'short',day:'numeric',month:'short',...(date.slice(0,4)!==today.slice(0,4)?{year:'numeric'}:{})});
  const dayHeading=date=>date===today?t('today')+' · '+dateParts(date+'T12:00:00Z',{day:'numeric',month:'short'}):displayDate(date);
  const cinema=id=>cinemas.find(c=>c.id===id);
  const filmHref=film=>film.urls?.[language]||listingPath+'?film='+encodeURIComponent(film.id);
  const cinemaHref=id=>cinema(id)?.urls?.[language]||listingPath+'?cinema='+encodeURIComponent(id);

  function showtimeLabel(session,filmTitle=''){
    return [session.time,filmTitle,displayDate(session.date),cinema(session.cinema_id)?.name||session.cinema_id,...(session.formats||[]),isSoldOut(session)?t('soldOut'):''].filter(Boolean).join(' · ');
  }

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

  function cardShowtimes(film){
    const days=groupShowtimes(film.sessions);
    const firstDay=days.values().next().value;
    // Reflect the breadth of the matching day, not unrelated dates or filters.
    const broad=Boolean(broadPreview&&firstDay&&(firstDay.size>=broadPreview.minCinemas||
      [...firstDay.values()].reduce((total,sessions)=>total+sessions.length,0)>=broadPreview.minShowtimes));
    const cinemaLimit=broad?broadPreview.cinemaLimit:cardCinemaLimit;
    const timeLimit=broad?broadPreview.timeLimit:cardTimeLimit;
    let groups=0,shown=0,html='';
    for(const [date,venues] of [...days].slice(0,cardDayLimit)){
      if(groups>=cinemaLimit)break;
      const heading=dayHeading(date);
      let rows='';
      for(const [cinemaId,sessions] of venues){
        if(groups>=cinemaLimit)break;
        const preview=sessions.slice(0,timeLimit);
        const extra=sessions.length-preview.length;
        const extraLabel=t(extra===1?'moreShowtime':'moreShowtimes').replace('{n}',extra);
        const extraLink=extra?`<a class="card-cinema-more" href="${safeURL(filmHref(film)+'#showtimes')}" data-open="${escapeHTML(film.id)}" data-view="showtimes" data-reveal-session="${escapeHTML(sessions[preview.length].id)}" aria-haspopup="dialog" aria-label="${escapeHTML([extraLabel,film.title,cinema(cinemaId)?.name||cinemaId,heading].join(' · '))}">+${extra} ${t('more')}</a>`:'';
        groups++;shown+=preview.length;
        rows+=`<div class="card-cinema" data-cinema="${escapeHTML(cinemaId)}"><a class="card-cinema-name" href="${safeURL(cinemaHref(cinemaId))}">${escapeHTML(cinema(cinemaId)?.short||cinemaId)}</a><div class="card-times">${preview.map(session=>`<a href="${safeURL(session.urls?.[language]||filmHref(film)+'#showtimes')}" class="card-showtime${isSoldOut(session)?' is-sold-out':''}" data-open="${escapeHTML(film.id)}" data-session="${escapeHTML(session.id)}" aria-haspopup="dialog" aria-label="${escapeHTML(showtimeLabel(session,film.title))}"><time datetime="${escapeHTML(session.starts_at)}">${escapeHTML(session.time)}</time><span class="availability-content" data-availability="${escapeHTML(session.id)}" data-compact>${availabilityHTML(session,true)}</span></a>`).join('')}${extraLink}</div></div>`;
      }
      html+=`<section class="card-day" data-date="${escapeHTML(date)}" aria-label="${escapeHTML(heading)}"><h3 class="card-day-label">${escapeHTML(heading)}</h3><div class="card-cinemas">${rows}</div></section>`;
    }
    const remaining=film.sessions.length-shown;
    const moreLabel=t(remaining===1?'moreShowtime':'moreShowtimes').replace('{n}',remaining);
    return html+(remaining?`<a href="${safeURL(filmHref(film)+'#showtimes')}" class="card-more" data-open="${escapeHTML(film.id)}" data-view="showtimes" aria-haspopup="dialog" aria-label="${escapeHTML(moreLabel+': '+film.title)}">${escapeHTML(moreLabel)}</a>`:'');
  }

  function datesMarkup(films,{range=null,selected="all",hasDateFilter=false}={}){
    const dates=[...new Set(films.flatMap(film=>film.sessions.map(s=>s.date)))].sort();
    const inRange=date=>!range||(date>=range.start&&date<=range.end);
    if(!dates.includes(today)&&inRange(today))dates.unshift(today);
    if(selected!=='all'&&!dates.includes(selected)&&inRange(selected))dates.push(selected);
    dates.sort();
    const html=`<button type="button" class="all-dates" data-date="all" aria-pressed="${!hasDateFilter}">${t('allDates')}</button>`+dates.map(date=>{
      const day=date===today?t('today'):dateParts(date+'T12:00Z',{weekday:'short'});
      const month=dateParts(date+'T12:00Z',{month:'short'})+(date.slice(0,4)!==today.slice(0,4)?' '+date.slice(2,4):'');
      return `<button type="button" data-date="${date}" aria-pressed="${selected===date}"><div class="date-day">${escapeHTML(day)}</div> <div class="date-number">${Number(date.slice(8))}</div> <div class="date-month">${escapeHTML(month)}</div></button>`;
    }).join('');
    return html;
  }

  function bodyMarkup(film,{matchReason=null}={}){
    const reason=matchReason?.label?`<p class="search-match">${escapeHTML(matchReason.label)}${safeURL(matchReason.sourceURL)?` <a class="search-match-source" href="${safeURL(matchReason.sourceURL)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHTML(matchReason.source)}">↗</a>`:''}</p>`:'';
    return `<h2><a href="${safeURL(filmHref(film))}" class="title-button" data-open="${escapeHTML(film.id)}" aria-haspopup="dialog">${escapeHTML(film.title)}</a></h2>${reason}${cardShowtimes(film)}`;
  }
  return {bodyMarkup,datesMarkup,showtimeLabel};
}
