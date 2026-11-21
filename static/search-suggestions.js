import {instantCompletions,needsEnrichment,isVerifiedSuggestion,prepareCompletionIndex} from './search-catalogue.js';
import {chooseChips} from './search-chip-selection.js';
import {madridDate,normalise} from './cinema-search.js';

const COPY={en:{shuffle:'Show other suggested searches',search:'Search for',suggestions:'Search suggestions',available:'suggestions available. Use the arrow keys to choose.'},
  es:{shuffle:'Mostrar otras búsquedas sugeridas',search:'Buscar',suggestions:'Sugerencias de búsqueda',available:'sugerencias disponibles. Usa las flechas para elegir.'},
  ca:{shuffle:'Mostra altres cerques suggerides',search:'Cerca',suggestions:'Suggeriments de cerca',available:'suggeriments disponibles. Fes servir les fletxes per triar.'}};
const svg=paths=>`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${paths}</svg>`;
const searchIcon=svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>');
const shuffleIcon=svg('<path d="m18 3 3 3-3 3M18 15l3 3-3 3M3 6h3c5 0 7 12 12 12h3M3 18h3c2 0 3-2 5-5m2-2c2-3 3-5 5-5h3"/>');
const el=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;return node;};
function onSelection(button,select){
  let pointerType='';
  // WebKit can report a touch-generated click as mouse; retain its pointerdown.
  button.addEventListener('pointerdown',event=>{pointerType=event.pointerType;});
  button.addEventListener('pointercancel',()=>{pointerType='';});
  button.addEventListener('click',event=>{
    const touch=event.detail>0&&(['touch','pen'].includes(pointerType)||['touch','pen'].includes(event.pointerType));
    pointerType='';select(touch);
  });
}

// The same accepted search box drives the full site's search, URL and results.
// Typing edits the menu; Enter or selecting a suggestion submits one search.
export function createSearchSuggestionsUI({input,getProgramme,getLanguage,getQuery,onSubmit,onDraft=()=>{},scoped=false,fetchImpl=fetch}){
  const label=input.closest('.search'),row=label.parentElement,composer=el('div','search-composer');
  label.before(composer);composer.append(label);
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls','searchCompletionOptions');input.setAttribute('aria-expanded','false');
  const menu=el('div','search-completions'),options=el('div','search-options');options.id='searchCompletionOptions';options.setAttribute('role','listbox');menu.hidden=true;menu.append(options);composer.append(menu);
  const area=el('div','search-suggestions'),shuffle=el('button','search-shuffle'),chips=el('div','search-ideas'),announcement=el('div','sr-only');
  shuffle.type='button';shuffle.innerHTML=shuffleIcon;area.append(chips,shuffle);area.hidden=true;row.after(area);announcement.setAttribute('aria-live','polite');area.after(announcement);
  let catalogue,programme,refreshing,draft=getQuery()||input.value,open=false,active=-1,candidates=[],slots=[],composing=false,timer,controller,version=0,destroyed=false,menuFrame,menuTask,clearTimer,pendingSubmission;
  input.value=draft;
  const cache=new Map(),events=new AbortController(),on=(target,type,fn)=>target.addEventListener(type,fn,{signal:events.signal});
  const seen=new Set();try{for(const query of JSON.parse(sessionStorage.getItem('vobarna-suggestion-rotation')||'[]'))if(typeof query==='string')seen.add(query);}catch{}
  function choose(previous=[],initial=false){
    const result=chooseChips(catalogue.idea_details,{previous,initial,seen});
    try{sessionStorage.setItem('vobarna-suggestion-rotation',JSON.stringify([...seen].slice(-2000)));}catch{}
    return result;
  }
  const copy=()=>COPY[getLanguage()]||COPY.en;
  const cancel=()=>{clearTimeout(timer);controller?.abort();controller=null;version++;};
  const cancelMenu=()=>{cancelAnimationFrame(menuFrame);clearTimeout(menuTask);clearTimeout(clearTimer);};
  const local=()=>instantCompletions(catalogue?.entities||[],catalogue?.precomputed||[],draft);
  const isVerified=query=>programme===getProgramme()&&isVerifiedSuggestion([...(catalogue?.precomputed||[]),...(catalogue?.idea_details||[])],query);
  function renderChips(){
    const rows=catalogue?.idea_details||[];area.hidden=Boolean(draft)||!slots.some(i=>rows[i]);if(draft)return;
    shuffle.setAttribute('aria-label',copy().shuffle);shuffle.title=copy().shuffle;chips.replaceChildren();
    for(const i of slots){const idea=rows[i];if(!idea)continue;const b=el('button','search-idea');b.type='button';b.textContent=idea.query;b.setAttribute('aria-label',copy().search+' '+idea.query);onSelection(b,touch=>submit(idea.query,{touch}));chips.append(b);}
    chips.scrollLeft=0;
  }
  function renderMenu(){
    const visible=open&&Boolean(draft.trim())&&candidates.length>0;
    menu.hidden=!visible;composer.classList.toggle('is-open',visible);input.setAttribute('aria-expanded',String(visible));input.removeAttribute('aria-activedescendant');options.replaceChildren();options.setAttribute('aria-label',copy().suggestions);
    if(!visible)return;
    const renderedDraft=draft;
    candidates.forEach((item,i)=>{
      const button=el('button','search-option');button.type='button';button.id='searchCompletion'+i;button.setAttribute('role','option');button.setAttribute('aria-selected',String(active===i));
      if(item.poster){const image=el('img','search-option-poster');image.src=item.poster;image.alt='';button.append(image);}
      else{const icon=el('span','search-option-icon');icon.innerHTML=searchIcon;button.append(icon);}
      const text=el('span','search-option-copy'),title=el('span','search-option-title');
      const fold=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),start=fold(item.label).indexOf(fold(draft.trim()));
      if(start<0)title.textContent=item.label;
      else{const before=el('strong',''),after=el('strong','');before.textContent=item.label.slice(0,start);after.textContent=item.label.slice(start+draft.trim().length);title.append(before,document.createTextNode(item.label.slice(start,start+draft.trim().length)),after);}
      text.append(title);if(item.detail){const detail=el('span','search-option-detail');detail.textContent=item.detail;text.append(detail);}button.append(text);
      button.addEventListener('pointerdown',e=>{if(e.isPrimary&&e.button===0){cancelMenu();cancel();}});
      button.addEventListener('mousedown',e=>{if(e.button===0)e.preventDefault();});
      onSelection(button,touch=>{if(renderedDraft===draft)submit(item.query,{touch});});options.append(button);
    });
    if(active>=0){
      input.setAttribute('aria-activedescendant','searchCompletion'+active);
      const option=options.children[active];
      if(option.offsetTop<menu.scrollTop)menu.scrollTop=option.offsetTop;
      else if(option.offsetTop+option.offsetHeight>menu.scrollTop+menu.clientHeight)menu.scrollTop=option.offsetTop+option.offsetHeight-menu.clientHeight;
    }
    announcement.textContent=candidates.length+' '+copy().available;
  }
  function enrich(immediate=candidates){
    cancel();const query=draft.trim(),language=getLanguage();if(!catalogue||query.length<2||!needsEnrichment(immediate,query))return;
    const key=catalogue.version+':'+madridDate()+':'+language+':'+query;
    const apply=body=>{
      if(query!==draft.trim()||!open||active!==-1||options.contains(document.activeElement))return;
      const combined=[...local(),...body.suggestions];candidates=combined.filter((r,i)=>combined.findIndex(o=>normalise(o.query)===normalise(r.query))===i).slice(0,5);renderMenu();
    };
    if(cache.has(key)){apply(cache.get(key));return;}
    const request=version;
    timer=setTimeout(async()=>{
      controller=new AbortController();const current=controller,deadline=setTimeout(()=>current.abort(),5500);
      try{
        const response=await fetchImpl('/api/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,language}),signal:current.signal});
        if(!response.ok)return;const body=await response.json();if(request!==version||body.query!==query||!Array.isArray(body.suggestions))return;
        cache.set(key,body);if(cache.size>100)cache.delete(cache.keys().next().value);apply(body);
      }catch{}finally{clearTimeout(deadline);if(controller===current)controller=null;}
    },180);
  }
  function sync(){pendingSubmission=null;cancelMenu();cancel();draft=getQuery()||'';input.value=draft;open=false;active=-1;candidates=[];renderChips();renderMenu();}
  function submit(query,{touch=false}={}){
    const value=(query??(active>=0?candidates[active]?.query:input.value)??'').trim();
    cancelMenu();cancel();draft=value;input.value=value;open=false;active=-1;renderMenu();renderChips();
    if(!getProgramme()){pendingSubmission={value,touch};return;}
    pendingSubmission=null;onSubmit(value);
    // Touch selections show the results without reopening the software keyboard.
    // Keyboard and mouse selections retain the combobox focus for further edits.
    if(touch)input.blur();else input.focus({preventScroll:true});
    open=false;cancel();renderMenu();
  }
  function changed(){
    pendingSubmission=null;cancelMenu();cancel();draft=input.value;active=-1;open=true;candidates=[];onDraft(draft);
    // Let the native text/caret paint before matching or touching the menu DOM.
    menuFrame=requestAnimationFrame(()=>{menuTask=setTimeout(()=>{
      if(composing||!open||options.contains(document.activeElement))return;
      candidates=local();renderChips();renderMenu();if(draft)enrich();
    },0);});
    // Clearing an already-empty committed search needs no catalogue rendering.
    // A new keystroke cancels a pending reset of the previous submitted search.
    if(!draft&&getQuery())clearTimer=setTimeout(()=>{if(!draft)onSubmit('');},80);
  }
  async function fallbackCatalogue(){
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./search-catalogue-worker.js',import.meta.url),{type:'module'});
      const finish=(error,value)=>{clearTimeout(deadline);worker.terminate();error?reject(Error('Catalogue unavailable')):resolve(value);};
      const deadline=setTimeout(()=>finish(true),20000);
      worker.onerror=()=>finish(true);worker.onmessage=({data})=>finish(data.error,data);
      worker.postMessage({url:document.body.dataset.siteLang?'/programme.json':'/preview-data/screenings.json',cinemaId:scoped||null,now:Date.now()});
    });
  }
  async function refresh(){
    if(refreshing||!getProgramme()||destroyed)return refreshing;
    const p=getProgramme();
    refreshing=(async()=>{
      let next;
      try{if(scoped)throw Error('Scoped catalogue');const response=await fetchImpl('/api/search-suggestions');if(!response.ok)throw Error('Unavailable');next=await response.json();if(next.generated_at!==p.generated_at)throw Error('Publication changed');}
      catch{try{next=await fallbackCatalogue();}catch{return;}}
      if(destroyed||p!==getProgramme())return;
      if(catalogue?.version===next.version&&programme===p){if(slots.some(i=>next.idea_details[i]?.valid_until<Date.now())){slots=choose([],true);renderChips();}return;}
      await prepareCompletionIndex(next.entities,next.precomputed);
      if(destroyed||p!==getProgramme())return;
      const queries=slots.map(i=>catalogue?.idea_details?.[i]?.query);catalogue=next;programme=p;cancel();cache.clear();
      const keep=queries.map(q=>next.idea_details.findIndex(r=>r.query===q&&r.valid_until>Date.now()));
      slots=keep.length===3&&keep.every(i=>i>=0)?keep:choose([],true);renderChips();
      if(open&&active===-1&&!options.contains(document.activeElement))changed();
    })().finally(()=>{refreshing=null;if(p!==getProgramme()&&!destroyed)void refresh();});
    return refreshing;
  }
  on(input,'input',()=>{if(!composing)changed();});on(input,'search',()=>{if(input.value!==draft)changed();});
  on(input,'compositionstart',()=>{pendingSubmission=null;composing=true;cancelMenu();cancel();open=false;renderMenu();});on(input,'compositionend',()=>{composing=false;changed();});
  on(input,'focus',()=>{open=true;active=-1;candidates=local();renderMenu();enrich();if(catalogue?.day!==madridDate())void refresh();});
  on(input,'keydown',event=>{
    if(composing||event.isComposing)return;
    if(event.key==='Enter'){event.preventDefault();submit();}
    else if(event.key==='Escape'){event.preventDefault();cancel();open=false;active=-1;input.value=draft;renderMenu();}
    else if(['ArrowDown','ArrowUp'].includes(event.key)&&draft.trim()){
      event.preventDefault();open=true;if(!candidates.length)candidates=local();const total=candidates.length+1;
      active=((active+1+(event.key==='ArrowDown'?1:-1)+total)%total)-1;input.value=active>=0?candidates[active].query:draft;input.setSelectionRange(input.value.length,input.value.length);renderMenu();
    }
  });
  on(composer,'focusout',event=>{if(composer.contains(event.relatedTarget))return;queueMicrotask(()=>{if(!composer.contains(document.activeElement)){open=false;active=-1;input.value=draft;cancel();renderMenu();}});});
  on(document,'pointerdown',event=>{if(!composer.contains(event.target)){open=false;active=-1;input.value=draft;cancel();renderMenu();}});
  on(options,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();input.focus();open=false;active=-1;cancel();renderMenu();}});
  on(shuffle,'click',()=>{slots=choose(slots);renderChips();announcement.textContent=slots.map(i=>catalogue.idea_details[i]?.query).join(', ');});
  on(document,'visibilitychange',()=>{if(!document.hidden)void refresh();});
  const interval=setInterval(()=>{if(!document.hidden)void refresh();},300000);
  requestAnimationFrame(()=>{if(matchMedia('(pointer:fine)').matches&&!input.value&&document.activeElement===document.body&&!location.hash)input.focus({preventScroll:true});});
  return {sync,refresh,isVerified,ready(){if(pendingSubmission){const {value,touch}=pendingSubmission;submit(value,{touch});}},destroy(){destroyed=true;cancelMenu();cancel();clearInterval(interval);events.abort();}};
}
