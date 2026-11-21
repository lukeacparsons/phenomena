import {hydrateProgramme} from './programme-data.js';
import {createListingView,HOME_CARD_PREVIEW} from './listing-view.js';
import {discoveryGroups,discoveryTotals} from './discovery-view.js';
import {observeImages} from './progressive-images.js';
import {renderFilmDialog,showFilmDialog,closeFilmDialog,focusSelectedScreening,getDialogScroller,prepareFilmTransition} from './film-dialog.js';

const root=document.querySelector('[data-discovery-kind]');
const payload=document.getElementById('discovery-data');
if(root&&payload){
  const data=hydrateProgramme(JSON.parse(payload.textContent));
  const language=document.documentElement.lang,labels=data.labels;
  const madrid=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'});
  const dateControl=root.querySelector('.dates'),cinemaControl=root.querySelector('[data-guide-cinema]');
  const groupControl=root.querySelector('[data-guide-group]');
  const results=root.querySelector('.discovery-results'),count=root.querySelector('.discovery-count');
  const dialog=document.createElement('dialog');
  dialog.id='filmDialog';dialog.setAttribute('aria-labelledby','dialogTitle');document.body.append(dialog);
  let date='all',cinema='',group='',groups={},active=null,opener=null,closingFromHistory=false;
  let showtimesScroll=0,showtimesSession=null,returnURL=location.pathname+location.search;
  const renderedBodies=new WeakMap();
  const makeView=()=>createListingView({language,cinemas:data.cinemas,today:madrid.format(Date.now()),...HOME_CARD_PREVIEW});
  const stale=()=>['english','weekend','gracia','eixample','discounts'].includes(root.dataset.discoveryKind)&&madrid.format(Date.now())!==root.dataset.discoveryDate;
  const matchingFilm=(id,key)=>groups[key]?.find(film=>film.id===id);
  function readFilters(){
    const params=new URLSearchParams(location.search);
    date=params.get('date')||'all';cinema=cinemaControl?(params.get('cinema')||''):'';group=groupControl?(params.get('section')||''):'';
    if(cinemaControl)cinemaControl.value=cinema;if(groupControl)groupControl.value=group;
    dateControl.querySelectorAll('[data-date]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.date===date)));
  }
  function saveFilters(){
    const url=new URL(location.href);
    for(const [key,value] of [['date',date==='all'?'':date],['cinema',cinema],['section',group]]){
      if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);
    }
    history.replaceState(null,'',url);refresh();
  }
  function refresh(){
    const expired=stale();
    results.hidden=expired;root.querySelector('.discovery-stale').hidden=!expired;
    root.querySelector('.guide-controls').hidden=expired;
    if(expired){if(dialog.open)closeFilmDialog(dialog);return;}
    groups=discoveryGroups(data,{date,cinema});
    const view=makeView();
    for(const section of root.querySelectorAll('.discovery-group')){
      const films=groups[section.id]||[],byId=new Map(films.map(film=>[film.id,film]));
      const empty=section.querySelector('.discovery-group-empty');
      if(empty)empty.hidden=films.length>0;
      section.hidden=(group&&group!==section.id)||(!films.length&&!empty);
      for(const card of section.querySelectorAll('.card')){
        const film=byId.get(card.dataset.film);card.hidden=!film;
        if(film){const body=card.querySelector('.card-body'),html=view.bodyMarkup(film);if(renderedBodies.get(body)!==html){body.innerHTML=html;renderedBodies.set(body,html);}}
      }
    }
    const totals=discoveryTotals(group?{[group]:groups[group]||[]}:groups);
    const label=root.dataset.countTemplate.replace('{films}',totals.films).replace('{sessions}',totals.sessions);
    if(count&&count.textContent!==label)count.textContent=label;
    root.querySelector('.discovery-empty').hidden=totals.sessions>0;
    document.querySelectorAll('.guide-sources [data-starts]').forEach(row=>row.hidden=Date.parse(row.dataset.starts)<=Date.now());
    if(dialog.open&&active){
      const film=matchingFilm(active.id,active.group);
      if(!film||(active.session&&!film.sessions.some(s=>s.id===active.session)))closeFilmDialog(dialog);
      else if(active.view==='showtimes')dialog.querySelectorAll('.card-showtime').forEach(a=>{if(Date.parse(a.querySelector('time')?.dateTime)<=Date.now())a.hidden=true;});
    }
    observeImages(root);
  }
  function screeningFacts(film){
    if(active.view!=='screening')return;
    const session=film.sessions.find(s=>s.id===active.session);if(!session)return;
    const block=document.createElement('div');block.className='guide-session-facts';
    for(const [label,value] of [[labels.audio,session.guide_audio],[labels.subtitles,session.guide_subtitles]]){
      const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=label+': ';
      p.append(strong,document.createTextNode(value||labels.unknown));block.append(p);
    }
    dialog.querySelector('.screening-summary')?.append(block);
  }
  function paint({restoreScroll=false,reveal=null}={}){
    const film=matchingFilm(active.id,active.group);if(!film)return false;
    if(active.session&&!film.sessions.some(s=>s.id===active.session))return false;
    const animate=prepareFilmTransition(dialog,film.id,active.view);
    renderFilmDialog(dialog,film,{language,cinemas:data.cinemas,view:active.view,selectedSessionId:active.session,availability:{failed:true},availabilityPending:false});
    screeningFacts(film);showFilmDialog(dialog);getDialogScroller(dialog).scrollTop=0;focusSelectedScreening(dialog);
    if(restoreScroll&&active.view==='showtimes'){
      getDialogScroller(dialog).scrollTop=showtimesScroll;
      [...dialog.querySelectorAll('[data-session]')].find(a=>a.dataset.session===showtimesSession)?.focus({preventScroll:true});
    }
    if(reveal){
      const target=[...dialog.querySelectorAll('.card-showtime')].find(a=>a.dataset.session===reveal);
      if(target){
        const scroller=getDialogScroller(dialog),header=dialog.querySelector('.dialog-head');
        const available=scroller.clientHeight-header.getBoundingClientRect().height-16;
        const bottom=target.getBoundingClientRect().bottom;
        const context=[target.closest('.dialog-day'),target.closest('.schedule-cinema'),target].find(n=>n&&bottom-n.getBoundingClientRect().top<=available)||target;
        scroller.scrollTop+=context.getBoundingClientRect().top-header.getBoundingClientRect().bottom-8;
        target.focus({preventScroll:true});
      }
    }
    animate();return true;
  }
  function open(id,key,{session=null,view=session?'screening':'film',reveal=null}={}){
    const film=matchingFilm(id,key);if(!film||session&&!film.sessions.some(s=>s.id===session))return false;
    const wasOpen=dialog.open;
    if(wasOpen&&active.view==='showtimes'){showtimesScroll=getDialogScroller(dialog).scrollTop;showtimesSession=session;}
    if(!wasOpen){returnURL=location.pathname+location.search+location.hash;showtimesScroll=0;showtimesSession=null;}
    active={id,group:key,session,view};
    if(!paint({restoreScroll:wasOpen&&view==='showtimes',reveal}))return false;
    const hash=new URLSearchParams({film:id,group:key,view,...(session?{screening:session}:{})});
    history[wasOpen?'replaceState':'pushState']({guideDialog:true,returnURL},'',location.pathname+location.search+'#'+hash);
    window.dispatchEvent(new CustomEvent('vobarna:screening-open',{detail:{film_id:id,screening_id:session,placement:'information'}}));
    return true;
  }
  function restore(){
    const hash=new URLSearchParams(location.hash.slice(1));
    if(hash.has('film')){
      const view=hash.get('view')||'film';
      if(!['film','showtimes','screening'].includes(view))return;
      active={id:hash.get('film'),group:hash.get('group'),view,session:hash.get('screening')};
      if(paint())return;
    }
    if(dialog.open){closingFromHistory=true;dialog.close();}
  }
  root.querySelector('.discovery-reload').addEventListener('click',()=>location.reload());
  dateControl.addEventListener('click',event=>{
    const button=event.target.closest('[data-date]');if(!button)return;
    date=button.dataset.date;
    dateControl.querySelectorAll('[data-date]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    saveFilters();
  });
  cinemaControl?.addEventListener('change',()=>{cinema=cinemaControl.value;saveFilters();});
  groupControl?.addEventListener('change',()=>{group=groupControl.value;saveFilters();});
  document.addEventListener('click',event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const anchor=event.target.closest('a[data-open]');
    if(anchor&&(root.contains(anchor)||dialog.contains(anchor))){
      const key=anchor.closest('.discovery-group')?.id||active?.group;
      if(open(anchor.dataset.open,key,{session:anchor.dataset.session,view:anchor.dataset.view|| (anchor.dataset.session?'screening':'film'),reveal:anchor.dataset.revealSession})){
        event.preventDefault();if(root.contains(anchor))opener=anchor;
      }
    }
    if(event.target.closest('[data-show-film-times]')&&dialog.contains(event.target))open(active.id,active.group,{view:'showtimes'});
  });
  dialog.addEventListener('click',event=>{
    if(event.target.closest('[data-close]'))closeFilmDialog(dialog);
    else if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeFilmDialog(dialog);}
  });
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    if(closingFromHistory)closingFromHistory=false;
    else if(history.state?.guideDialog)history.back();
    else history.replaceState(null,'',returnURL);
    if(opener?.isConnected)opener.focus({preventScroll:true});
  });
  root.querySelector('.guide-controls').hidden=false;
  readFilters();refresh();restore();
  window.addEventListener('popstate',()=>{readFilters();refresh();restore();});
  window.addEventListener('hashchange',restore);
  setInterval(refresh,30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('pageshow',refresh);
}
