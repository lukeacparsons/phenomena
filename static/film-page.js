import {renderFilmDialog,focusSelectedScreening,getDialogScroller,showFilmDialog,closeFilmDialog} from './film-dialog.js';
import {filmMarkup,lastScreeningMarkup,SUBTITLE_LABELS} from './film-view.js';
import {hasEnglishSubtitles} from './screening-language.js';
const payload=JSON.parse(document.getElementById('film-dialog-data').textContent);
const {film,cinemas}=payload,language=document.documentElement.lang;
const dialog=document.createElement('dialog');
dialog.id='filmDialog';dialog.setAttribute('aria-labelledby','dialogTitle');
document.body.append(dialog);
const notice=document.getElementById('screeningNotice');
const page=document.getElementById('filmPage');
let availability={},opener=null,selected=null,navigating=false,activeFragment=null;
const future=session=>Date.parse(session.starts_at)>=Date.now();
const fragment=()=>location.hash.slice(1);
const subtitleLabels=SUBTITLE_LABELS[language],emptyLabel=page.querySelector('.film-empty').textContent;
const subtitleOnly=()=>new URLSearchParams(location.search).get('subtitles')==='en';
const visibleSession=session=>future(session)&&(!subtitleOnly()||hasEnglishSubtitles(session));
function localeLinks(){
  document.querySelectorAll('.lang-switch a[hreflang]').forEach(anchor=>{
    if(film.urls[anchor.hreflang])anchor.href=film.urls[anchor.hreflang]+(subtitleOnly()?'?subtitles=en':'')+location.hash;
  });
}
function updateSubtitleView(){
  const upcoming=film.sessions.filter(future),matching=upcoming.filter(hasEnglishSubtitles);
  const filtered=subtitleOnly(),allEnglish=matching.length>0&&matching.length===upcoming.length;
  const visible=new Set(upcoming.filter(s=>!filtered||hasEnglishSubtitles(s)).map(s=>s.id));
  page.querySelectorAll('.card-showtime[data-session]').forEach(row=>row.hidden=!visible.has(row.dataset.session));
  page.querySelectorAll('.schedule-cinema,.dialog-day').forEach(section=>section.hidden=!section.querySelector('.card-showtime:not([hidden])'));
  const heading=page.querySelector('.film-showtimes-heading');
  heading.dataset.allLabel||=heading.textContent;
  heading.textContent=filtered||allEnglish?subtitleLabels.label:heading.dataset.allLabel;
  const empty=page.querySelector('.film-empty');empty.hidden=visible.size>0;empty.textContent=filtered?subtitleLabels.empty:emptyLabel;
  const last=page.querySelector('.film-last-screening');
  if(last){
    last.innerHTML=lastScreeningMarkup(film,{language,cinemas});
    last.hidden=upcoming.length>0||!last.innerHTML;
  }
  const control=page.querySelector('[data-subtitle-filter]');
  if(control){
    control.hidden=!filtered&&(!matching.length||allEnglish);
    control.textContent=filtered?subtitleLabels.all:subtitleLabels.label;
    const url=new URL(location.href);url.hash='showtimes';
    if(filtered)url.searchParams.delete('subtitles');else url.searchParams.set('subtitles','en');
    control.href=url.pathname+url.search+url.hash;
  }
  const information=document.getElementById('english-subtitles');
  information?.querySelectorAll('[data-starts]').forEach(row=>row.hidden=Date.parse(row.dataset.starts)<=Date.now());
  const status=information?.querySelector('[data-subtitle-empty]');if(status)status.hidden=matching.length>0;
  localeLinks();
}
// A cached HTML page can outlive a screening. Keep its remaining dates useful.
page?.querySelectorAll('[data-starts]').forEach(row=>{if(Date.parse(row.dataset.starts)<Date.now())row.remove();});
page?.querySelectorAll('.schedule-cinema,.dialog-cinema,.dialog-day').forEach(section=>{if(!section.querySelector('[data-session]'))section.remove();});
if(page)page.querySelector('.film-empty').hidden=film.sessions.some(future);
page?.querySelectorAll('.card-showtime[data-session]').forEach(anchor=>{
  anchor.href='#'+anchor.id;
  anchor.removeAttribute('target');anchor.removeAttribute('rel');
  anchor.setAttribute('aria-haspopup','dialog');
});
function paint(){
  renderFilmDialog(dialog,{...film,sessions:film.sessions.filter(visibleSession)},
    {language,cinemas,selectedSessionId:selected?.id,availability});
}
function restore(){
  updateSubtitleView();
  const id=fragment();
  if(dialog.open&&id===activeFragment)return;
  if(id==='showtimes'){
    if(dialog.open){navigating=true;dialog.close();}
    notice.hidden=true;
    document.getElementById('showtimes')?.scrollIntoView({block:'start',behavior:'instant'});
    return;
  }
  if(id!=='showtimes'&&!id.startsWith('screening-')){
    if(dialog.open){navigating=true;dialog.close();}
    return;
  }
  selected=id==='showtimes'?null:film.sessions.find(session=>session.url_fragment===id);
  if((id!=='showtimes'&&(!selected||!visibleSession(selected)))||!film.sessions.some(visibleSession)){
    if(dialog.open){navigating=true;dialog.close();}
    notice.hidden=false;notice.focus();
    return;
  }
  notice.hidden=true;navigating=false;activeFragment=id;paint();
  showFilmDialog(dialog);
  getDialogScroller(dialog).scrollTop=0;focusSelectedScreening(dialog);
  window.dispatchEvent(new CustomEvent('vobarna:screening-open',{detail:{film_id:film.id,screening_id:selected?.id||null,placement:'information'}}));
}
document.addEventListener('click',event=>{
  const filter=event.target.closest?.('[data-subtitle-filter]');
  if(filter&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){
    event.preventDefault();history.pushState(null,'',filter.href);restore();return;
  }
  const anchor=event.target.closest?.('a.screening-action,#filmPage a.card-showtime[data-session]');
  if(!anchor||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const url=new URL(anchor.href);
  if(url.pathname!==location.pathname)return;
  event.preventDefault();opener=anchor;
  if(location.href!==url.href)history.pushState(null,'',url);
  restore();
});
dialog.addEventListener('click',event=>{
  if(event.target.closest('[data-close]'))closeFilmDialog(dialog);
  else if(event.target.closest('[data-show-film-times]')){
    navigating=true;dialog.close();location.hash='showtimes';restore();
  }
  else if(event.target===dialog){
    const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeFilmDialog(dialog);
  }
});
dialog.addEventListener('close',()=>{
  if(dialog.open)return;
  if(navigating){navigating=false;return;}
  history.replaceState(null,'',location.pathname+location.search);
  localeLinks();
  (opener||document.getElementById('filmTitle')||document.querySelector('a.screening-action'))?.focus({preventScroll:true});
});
window.addEventListener('hashchange',restore);
window.addEventListener('popstate',restore);
setInterval(updateSubtitleView,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateSubtitleView();});
// Add action links only after the dialog is available; booking fallback remains.
document.querySelectorAll('.screening-action[hidden]').forEach(anchor=>{anchor.hidden=false;anchor.setAttribute('aria-haspopup','dialog');});
restore();
function refreshAvailability(){
  const staging=document.createElement('div');
  for(const root of [page,dialog.open?dialog:null]){
    if(!root)continue;
    staging.innerHTML=filmMarkup({...film,sessions:film.sessions.filter(future)},
      {language,cinemas,selectedSessionId:selected?.id,availability,availabilityPending:false,view:root===page?'showtimes':'screening'});
    const updates=new Map([...staging.querySelectorAll('[data-session]')].map(node=>[node.dataset.session,node]));
    root?.querySelectorAll('[data-session]').forEach(row=>{
      const update=updates.get(row.dataset.session);
      if(!update)return;
      row.classList.toggle('is-sold-out',update.classList.contains('is-sold-out'));
      row.setAttribute('aria-label',update.getAttribute('aria-label'));
      const target=row.querySelector('[data-availability]');
      target.replaceChildren(...[...update.querySelector('[data-availability]').childNodes].map(node=>node.cloneNode(true)));
    });
  }
}
fetch(document.body.dataset.availabilityUrl,{cache:'no-cache',signal:AbortSignal.timeout(10000)})
  .then(response=>{if(!response.ok)throw new Error('availability');return response.json();})
  .then(snapshot=>{
    availability={sessions:new Map(Object.entries(snapshot.sessions||{})),errors:new Set(Object.keys(snapshot.errors||{})),
      intervalSeconds:snapshot.refresh_interval_seconds,supportedProviders:snapshot.supported_providers};
    // Update only availability text so a user's keyboard position is preserved.
    refreshAvailability();
  }).catch(()=>{availability={failed:true};refreshAvailability();});
