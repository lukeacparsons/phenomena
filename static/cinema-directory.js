const search=document.getElementById('cinemaSearch');
if(search){
  const rows=[...document.querySelectorAll('#cinemaList > li')];
  const normalize=value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase().replace(/[’']/g,'');
  const entries=rows.map(row=>({row,text:normalize(row.textContent+' '+(row.dataset.search||''))}));
  const status=document.getElementById('cinemaCount'),empty=document.getElementById('cinemaEmpty'),reset=document.getElementById('cinemaReset');
  const language=document.documentElement.lang;
  const nouns={en:['cinema','cinemas'],es:['cine','cines'],ca:['cinema','cinemes']}[language]||['cinema','cinemas'];
  let announcement;
  function filter(){
    const terms=normalize(search.value).trim().split(/\s+/).filter(Boolean);
    let count=0;
    for(const {row,text} of entries){row.hidden=!terms.every(term=>text.includes(term));if(!row.hidden)count++;}
    empty.hidden=count!==0;reset.hidden=!search.value;
    clearTimeout(announcement);
    announcement=setTimeout(()=>{
      status.textContent=count+' '+nouns[count===1?0:1];
      if(search.value)window.dispatchEvent(new CustomEvent('vobarna:search',{detail:{scope:'cinemas',query_length:search.value.length,result_count:count}}));
    },250);
  }
  search.addEventListener('input',event=>{if(!event.isComposing)filter();});
  search.addEventListener('compositionend',filter);
  reset.addEventListener('click',()=>{search.value='';filter();search.focus();});
  document.getElementById('cinemaFilters').hidden=false;
  filter();
}
