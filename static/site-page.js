import './progressive-images.js';
// Public detail pages remain complete when this small enhancement is unavailable.
function markPastScreenings(){
const now=Date.now();
for(const row of document.querySelectorAll('[data-starts]:not(.buyrow):not(.past-screening)')){
  if(Date.parse(row.dataset.starts)<now){
    row.classList.add('past-screening');
    const label={en:'This screening has started',es:'Esta sesión ya ha empezado',ca:'Aquesta sessió ja ha començat'}[document.documentElement.lang]||'This screening has started';
    const note=document.createElement('p');note.className='fineprint';note.textContent=label;
    row.querySelector('th')?.append(note);
  }
}
}
markPastScreenings();
window.addEventListener('vobarna:languagechange',markPastScreenings);
import './ticket-events.js';
import './cinema-directory.js';
if(document.getElementById('film-dialog-data'))void import('./film-page.js');

// Direct links into the research still reveal the relevant disclosure.
function revealFragment(){
  let id;
  try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}
  const target=id&&document.getElementById(id);
  if(!target)return;
  for(let parent=target.parentElement;parent;parent=parent.parentElement){
    if(parent.tagName==='DETAILS')parent.open=true;
  }
  target.scrollIntoView({block:'start',behavior:'instant'});
}
window.addEventListener('hashchange',revealFragment);
if(location.hash)revealFragment();
