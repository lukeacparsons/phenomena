// Tiny previews are in the HTML/data. Only nearby posters enter this queue.
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=value=>typeof value==='string'&&(/^(https:\/\/|\/(?!\/))/.test(value))?value:'';
const placeholder='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/%3E';
const loadedImages=new Map();

export function posterMarkup(film,{className='poster',alt=''}={}){
  const source=safeURL(film.poster_url);
  if(!source)return '';
  const optimized=film.poster_image?.source===film.poster_url?film.poster_image:null;
  const variants=optimized?.variants?.filter(item=>safeURL(item.url)&&Number.isFinite(item.width)&&item.width>0)||[];
  const preview=/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(optimized?.preview)?optimized.preview:placeholder;
  const width=optimized?.width||Number(film.poster_width)||600,height=optimized?.height||Number(film.poster_height)||900;
  const loaded=loadedImages.get(source);
  const ready=loaded&&variants.some(v=>v.url===loaded.url&&v.width===loaded.width)?loaded:null;
  return `<img class="${escapeHTML(className)} progressive-image${ready?'':' is-preview'}" src="${escapeHTML(ready?.url||preview)}" ${ready?`data-image-width="${ready.width}"`:''} width="${width}" height="${height}" style="--poster-ratio:${width}/${height};aspect-ratio:${width}/${height}" alt="${escapeHTML(alt)}" decoding="async" data-image-source="${escapeHTML(source)}" data-image-variants="${escapeHTML(JSON.stringify(variants))}">`;
}

const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
const tracked=new Map(),nearby=new Set();
let active=0,observer,frame=0;
function policy(){
  if(connection?.saveData||['slow-2g','2g'].includes(connection?.effectiveType))return {limit:1,maxWidth:160,margin:0};
  if(connection?.effectiveType==='3g')return {limit:2,maxWidth:320,margin:120};
  return {limit:4,maxWidth:960,margin:240};
}
function desired(state,width){
  const target=Math.min(policy().maxWidth,Math.ceil(width*Math.min(devicePixelRatio||1,2)));
  return state.variants.find(item=>item.width>=target)||state.variants.at(-1)||{url:state.image.dataset.imageSource,width:target};
}
// `src` has no effect while the browser is choosing from `srcset`.
function useSource(image,url){
  image.removeAttribute('srcset');image.removeAttribute('sizes');
  image.src=url;
}
function distance(rect){return Math.max(0,rect.top-innerHeight,-rect.bottom);}
function queue(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;pump();});}

async function load(state,variant,visible){
  active++;state.loading=true;
  const loader=new Image();
  loader.decoding='async';loader.fetchPriority=visible?'high':'low';
  try{
    await new Promise((resolve,reject)=>{
      loader.onload=resolve;loader.onerror=reject;loader.src=variant.url;
    });
    // Keep the preview until the sharper image can be painted without a blank frame.
    try{await loader.decode();}catch{}
    if((loadedImages.get(state.image.dataset.imageSource)?.width||0)<variant.width)loadedImages.set(state.image.dataset.imageSource,variant);
    if(state.image.isConnected){
      // Keep the decoded image underneath a brief fade, without changing its box.
      let previous;
      if(state.image.complete&&state.image.naturalWidth&&state.image.closest('.poster-button')&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
        state.image.parentElement.querySelector('.poster-transition')?.remove();
        previous=document.createElement('span');
        previous.className='poster-transition';previous.setAttribute('aria-hidden','true');
        previous.style.backgroundImage=`url(${JSON.stringify(state.image.currentSrc||state.image.src)})`;
        if(state.image.classList.contains('is-preview'))previous.style.filter='blur(2px)';
        state.image.after(previous);
      }
      useSource(state.image,variant.url);
      state.image.classList.remove('is-preview');
      state.image.dataset.imageWidth=String(variant.width);
      state.loadedWidth=variant.width;
      if(previous){
        const fade=previous.animate([{opacity:1},{opacity:0}],{duration:150,easing:'ease-out'});
        fade.finished.catch(()=>{}).finally(()=>previous.remove());
      }
    }
  }catch{
    // Keep the preview on failure. A connection change/online event allows retry.
    state.failed.add(variant.url);
  }finally{
    loader.onload=loader.onerror=null;
    state.loading=false;active--;queue();
  }
}

function pump(){
  const {limit,margin}=policy();
  const candidates=[];
  for(const image of nearby){
    const state=tracked.get(image);
    if(!image.isConnected){observer?.unobserve(image);tracked.delete(image);nearby.delete(image);continue;}
    if(!state||state.loading)continue;
    // The browser is still fetching, or deferring, its own choice from HTML.
    if(image.hasAttribute('srcset')&&!image.complete)continue;
    const rect=image.getBoundingClientRect();
    if(!rect.width||!rect.height||rect.right<=0||rect.left>=innerWidth||distance(rect)>margin)continue;
    const variant=desired(state,rect.width);
    if(state.loadedWidth>=variant.width||state.failed.has(variant.url))continue;
    candidates.push({state,variant,distance:distance(rect),top:Math.abs(rect.top)});
  }
  candidates.sort((a,b)=>a.distance-b.distance||a.top-b.top);
  for(const item of candidates){
    if(active>=limit)break;
    void load(item.state,item.variant,item.distance===0);
  }
}

function observe(){
  observer?.disconnect();nearby.clear();
  if('IntersectionObserver' in window){
    observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(entry.isIntersecting)nearby.add(entry.target);else nearby.delete(entry.target);
      }
      queue();
    },{rootMargin:`${policy().margin}px 0px`});
  }
  for(const image of tracked.keys()){
    if(!image.isConnected){tracked.delete(image);continue;}
    if(observer)observer.observe(image);else nearby.add(image);
  }
  queue();
}

export function observeImages(root=document){
  for(const image of root.querySelectorAll('img[data-image-source]')){
    if(tracked.has(image))continue;
    let variants=[];
    try{variants=JSON.parse(image.dataset.imageVariants).filter(v=>safeURL(v.url)&&Number.isFinite(v.width)&&v.width>0).sort((a,b)=>a.width-b.width);}catch{}
    const state={image,variants,loading:false,loadedWidth:Number(image.dataset.imageWidth)||0,failed:new Set()};
    tracked.set(image,state);
    // Include thumbnails loaded natively from HTML in the shared image cache.
    const remember=()=>{
      if(!image.naturalWidth)return;
      const current=variants.find(variant=>new URL(variant.url,location.href).href===image.currentSrc);
      if(!current)return;
      state.loadedWidth=Math.max(state.loadedWidth,current.width);
      image.dataset.imageWidth=String(state.loadedWidth);
      image.style.removeProperty('background');
      if((loadedImages.get(image.dataset.imageSource)?.width||0)<current.width)loadedImages.set(image.dataset.imageSource,current);
      queue();
    };
    image.addEventListener('load',remember);
    if(image.complete)remember();
    if(image.dataset.imagePreview){
      const failed=()=>{
        // An eager HTML thumbnail must retain the inline preview if it fails.
        if(image.getAttribute('src')!==variants[0]?.url)return;
        useSource(image,image.dataset.imagePreview);image.classList.add('is-preview');
        state.loadedWidth=0;queue();
      };
      image.addEventListener('error',failed,{once:true});
      if(image.complete&&!image.naturalWidth)failed();
    }
  }
  observe();
}

addEventListener('scroll',queue,{passive:true,capture:true});
addEventListener('resize',queue,{passive:true});
function retry(){for(const state of tracked.values())state.failed.clear();observe();}
connection?.addEventListener('change',retry);
addEventListener('online',retry);
addEventListener('pageshow',queue);
observeImages();
