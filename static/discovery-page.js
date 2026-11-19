// Keep the readable HTML useful while a page remains open. No programme fetch
// or homepage filter changes: selection and source facts come from the build.
const root=document.querySelector('[data-discovery-kind]');
if(root){
  const madrid=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'});
  const rows=[...root.querySelectorAll('[data-discovery-film]')];
  const results=root.querySelector('.discovery-results');
  const count=root.querySelector('.discovery-count');
  function refresh(){
    const now=Date.now();
    // A dated rolling list must not silently become yesterday's "today".
    const stale=root.dataset.discoveryKind!=='subtitles'&&madrid.format(now)!==root.dataset.discoveryDate;
    results.hidden=stale;
    root.querySelector('.discovery-stale').hidden=!stale;
    if(stale)return;
    for(const row of rows)row.hidden=Date.parse(row.dataset.starts)<=now;
    const upcoming=rows.filter(row=>!row.hidden);
    const label=root.dataset.countTemplate.replace('{films}',new Set(upcoming.map(row=>row.dataset.discoveryFilm)).size).replace('{sessions}',upcoming.length);
    if(count.textContent!==label)count.textContent=label;
    root.querySelector('.discovery-empty').hidden=upcoming.length>0;
    for(const film of root.querySelectorAll('.discovery-film')){
      const total=[...film.querySelectorAll('[data-discovery-film]')].filter(row=>!row.hidden).length;
      film.hidden=total===0;
      film.querySelector('.discovery-film-count').textContent=`(${total})`;
    }
    for(const group of root.querySelectorAll('.discovery-group'))group.hidden=![...group.querySelectorAll('[data-discovery-film]')].some(row=>!row.hidden);
  }
  root.querySelector('.discovery-reload').addEventListener('click',()=>location.reload());
  refresh();
  setInterval(refresh,30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('pageshow',refresh);
}
