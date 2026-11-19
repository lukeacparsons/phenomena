import {renderFilmDialog,focusSelectedScreening} from './film-dialog.js';
const payload=JSON.parse(document.getElementById('film-dialog-data').textContent);
const {film,cinemas}=payload,language=document.documentElement.lang;
const dialog=document.createElement('dialog');
dialog.id='filmDialog';dialog.setAttribute('aria-labelledby','dialogTitle');
document.body.append(dialog);
const notice=document.getElementById('screeningNotice');
let availability={},opener=null,selected=null,navigating=false,activeFragment=null;
const future=session=>Date.parse(session.starts_at)>=Date.now();
const fragment=()=>location.hash.slice(1);
function paint(){
  renderFilmDialog(dialog,{...film,sessions:film.sessions.filter(future)},
    {language,cinemas,selectedSessionId:selected?.id,availability});
}
function restore(){
  const id=fragment();
  if(dialog.open&&id===activeFragment)return;
  if(id!=='showtimes'&&!id.startsWith('screening-')){
    if(dialog.open){navigating=true;dialog.close();}
    return;
  }
  selected=id==='showtimes'?null:film.sessions.find(session=>session.url_fragment===id);
  if((id!=='showtimes'&&(!selected||!future(selected)))||!film.sessions.some(future)){
    if(dialog.open){navigating=true;dialog.close();}
    notice.hidden=false;notice.focus();
    return;
  }
  notice.hidden=true;navigating=false;activeFragment=id;paint();
  document.querySelectorAll('.lang-switch a[hreflang]').forEach(anchor=>{if(film.urls[anchor.hreflang])anchor.href=film.urls[anchor.hreflang]+'#'+id;});
  if(!dialog.open)dialog.showModal();
  dialog.scrollTop=0;focusSelectedScreening(dialog);
  window.dispatchEvent(new CustomEvent('vobarna:screening-open',{detail:{film_id:film.id,screening_id:selected?.id||null,placement:'information'}}));
}
document.addEventListener('click',event=>{
  const anchor=event.target.closest?.('a.screening-action');
  if(!anchor||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const url=new URL(anchor.href);
  if(url.pathname!==location.pathname)return;
  event.preventDefault();opener=anchor;
  if(location.hash!==url.hash)history.pushState(null,'',url);
  restore();
});
dialog.addEventListener('click',event=>{
  if(event.target.closest('[data-close]'))dialog.close();
  else if(event.target===dialog){
    const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();
  }
});
dialog.addEventListener('close',()=>{
  if(dialog.open)return;
  if(navigating){navigating=false;return;}
  history.replaceState(null,'',location.pathname+location.search);
  document.querySelectorAll('.lang-switch a[hreflang]').forEach(anchor=>{if(film.urls[anchor.hreflang])anchor.href=film.urls[anchor.hreflang];});
  (opener||document.querySelector('a.screening-action'))?.focus({preventScroll:true});
});
window.addEventListener('hashchange',restore);
window.addEventListener('popstate',restore);
// Add action links only after the dialog is available; booking fallback remains.
document.querySelectorAll('.screening-action[hidden]').forEach(anchor=>{anchor.hidden=false;anchor.setAttribute('aria-haspopup','dialog');});
restore();
fetch(document.body.dataset.availabilityUrl,{cache:'no-cache',signal:AbortSignal.timeout(10000)})
  .then(response=>{if(!response.ok)throw new Error('availability');return response.json();})
  .then(snapshot=>{
    availability={sessions:new Map(Object.entries(snapshot.sessions||{})),errors:new Set(Object.keys(snapshot.errors||{})),
      intervalSeconds:snapshot.refresh_interval_seconds,supportedProviders:snapshot.supported_providers};
    // Update only availability text so a user's keyboard position is preserved.
    if(dialog.open){
      const staging=document.createElement('div');
      renderFilmDialog(staging,{...film,sessions:film.sessions.filter(future)},{language,cinemas,selectedSessionId:selected?.id,availability});
      const updates=new Map([...staging.querySelectorAll('[data-availability]')].map(node=>[node.dataset.availability,node]));
      dialog.querySelectorAll('[data-availability]').forEach(node=>{const update=updates.get(node.dataset.availability);if(update)node.replaceChildren(...update.childNodes);});
    }
  }).catch(()=>{});
