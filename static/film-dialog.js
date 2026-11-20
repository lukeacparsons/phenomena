import {observeImages,posterMarkup} from './progressive-images.js';
import {filmMarkup} from './film-view.js';
const swipeDialogs = new WeakSet();
const dialogTransitions = new WeakMap();
export function getDialogScroller(dialog){
  return dialog.querySelector?.('.dialog-surface')||dialog;
}

// Capture before rendering, then animate after the caller restores scroll/focus.
// Availability refreshes and initial opens do not run this transition.
export function prepareFilmTransition(dialog,filmId,nextView){
  dialogTransitions.get(dialog)?.();
  const views=['film','showtimes'];
  if(!dialog.open||dialog.dataset.film!==filmId||dialog.dataset.view===nextView||
    !views.includes(dialog.dataset.view)||!views.includes(nextView)||typeof dialog.animate!=='function')return ()=>{};
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  if(reducedMotion.matches)return ()=>{};
  const box=dialog.getBoundingClientRect();
  const snapshot=selector=>{
    const element=dialog.querySelector(selector);
    if(!element)return null;
    const rect=element.getBoundingClientRect();
    if(!rect.width||!rect.height)return null;
    return {element,rect,x:rect.left-box.left,y:rect.top-box.top};
  };
  const title=snapshot('.dialog-title'),poster=snapshot('.dialog-poster');
  const content=['.dialog-intro','.film-ratings','.dialog-section','.dialog-actions']
    .map(snapshot).filter(item=>item&&item.rect.bottom>box.top&&item.rect.top<box.bottom);
  const titleStyle=title&&getComputedStyle(title.element);
  const titleFont=titleStyle&&parseFloat(titleStyle.fontSize);
  const titleCopy=title&&document.createElement('div');
  if(titleCopy){
    titleCopy.className='dialog-motion-title';titleCopy.textContent=title.element.textContent;
    for(const property of ['font','lineHeight','letterSpacing','padding','textAlign','textWrap'])titleCopy.style[property]=titleStyle[property];
    const textStyle=getComputedStyle(title.element.querySelector('a')||title.element);
    for(const property of ['textDecoration','textUnderlineOffset'])titleCopy.style[property]=textStyle[property];
  }
  const contentCopies=content.map(item=>{
    const clone=item.element.cloneNode(true);
    clone.removeAttribute('id');clone.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    return {...item,clone};
  });
  return ()=>{
    if(!dialog.open||dialog.dataset.film!==filmId||dialog.dataset.view!==nextView)return;
    const targetBox=dialog.getBoundingClientRect();
    const targetTitle=dialog.querySelector('.dialog-title'),targetPoster=dialog.querySelector('.dialog-poster');
    const targetTitleRect=targetTitle?.getBoundingClientRect(),targetPosterRect=targetPoster?.getBoundingClientRect();
    const targetFont=targetTitle&&parseFloat(getComputedStyle(targetTitle).fontSize);
    const layer=document.createElement('div');
    layer.className='dialog-motion-layer';layer.inert=true;layer.setAttribute('aria-hidden','true');
    const place=(node,item)=>{
      Object.assign(node.style,{left:item.x+'px',top:item.y+'px',width:item.rect.width+'px',height:item.rect.height+'px'});
      layer.append(node);
    };
    const animations=[],controller=new AbortController();
    const motion={duration:280,easing:'cubic-bezier(.4,0,.2,1)'};
    const animate=(node,keyframes,options=motion)=>animations.push(node.animate(keyframes,options));
    for(const item of contentCopies){
      place(item.clone,item);
      animate(item.clone,[{opacity:1},{opacity:0}],{duration:120,easing:'ease-out',fill:'forwards'});
    }
    if(title&&targetTitleRect&&titleCopy){
      place(titleCopy,title);
      const x=targetTitleRect.left-targetBox.left,y=targetTitleRect.top-targetBox.top;
      const scale=titleFont/targetFont;
      animate(titleCopy,[{transform:'none',opacity:1},{transform:`translate(${x-title.x}px,${y-title.y}px) scale(${1/scale})`,opacity:0}],motion);
      animate(targetTitle,[{transform:`translate(${title.x-x}px,${title.y-y}px) scale(${scale})`,opacity:0},{transform:'none',opacity:1}],motion);
    }
    if(poster&&targetPosterRect){
      const x=targetPosterRect.left-targetBox.left,y=targetPosterRect.top-targetBox.top;
      animate(targetPoster,[{transform:`translate(${poster.x-x}px,${poster.y-y}px) scale(${poster.rect.width/targetPosterRect.width},${poster.rect.height/targetPosterRect.height})`},{transform:'none'}],motion);
    }
    for(const element of dialog.querySelectorAll('.dialog-intro,.film-ratings,.dialog-section,.dialog-actions'))
      animate(element,[{opacity:0},{opacity:1}],{duration:200,delay:80,easing:'ease-out',fill:'backwards'});
    dialog.append(layer);
    if(Math.abs(box.height-targetBox.height)>.5)
      animate(dialog,[{height:box.height+'px'},{height:targetBox.height+'px'}],motion);
    let finished=false;
    const cleanup=()=>{
      if(finished)return;finished=true;
      controller.abort();animations.forEach(animation=>animation.cancel());layer.remove();
      if(dialogTransitions.get(dialog)===cleanup)dialogTransitions.delete(dialog);
    };
    dialogTransitions.set(dialog,cleanup);
    dialog.addEventListener('close',cleanup,{once:true,signal:controller.signal});
    window.addEventListener('resize',cleanup,{once:true,signal:controller.signal});
    reducedMotion.addEventListener('change',cleanup,{once:true,signal:controller.signal});
    Promise.allSettled(animations.map(animation=>animation.finished)).then(cleanup);
  };
}

function enableSheetDismiss(dialog){
  if(dialog.tagName!=='DIALOG'||swipeDialogs.has(dialog))return;
  swipeDialogs.add(dialog);
  const mobile=matchMedia('(max-width:600px)');
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
    if(!handle&&(!target.closest('.dialog-head')||getDialogScroller(dialog).scrollTop>1))return;
    const touch=event.touches[0];
    gesture={id:touch.identifier,x:touch.clientX,y:touch.clientY,started:event.timeStamp,distance:0,handle};
  },{passive:true});
  dialog.addEventListener('touchmove',event=>{
    if(!gesture)return;
    if(event.touches.length!==1||(!gesture.handle&&getDialogScroller(dialog).scrollTop>1)){reset();return;}
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


export function renderFilmDialog(dialog,film,options={}){
  dialogTransitions.get(dialog)?.();
  enableSheetDismiss(dialog);
  const scroll=getDialogScroller(dialog).scrollTop;
  dialog.dataset.film=film.id;
  const view=options.view||(options.selectedSessionId?'screening':'film');
  dialog.dataset.view=view;
  dialog.innerHTML='<div class="dialog-surface">'+filmMarkup(film,{...options,view,poster:posterMarkup(film,{className:'dialog-poster'})})+'</div>';
  getDialogScroller(dialog).scrollTop=scroll;
  observeImages(dialog);
}

export function focusSelectedScreening(dialog){
  const selected=dialog.querySelector('.buyrow.is-highlighted');
  (selected||dialog.querySelector('#dialogTitle'))?.focus({preventScroll:true});
  if(selected&&dialog.dataset.view!=='screening'){
    const scroller=getDialogScroller(dialog);
    const bottom=selected.getBoundingClientRect().bottom;
    const context=[selected.closest('.dialog-day'),selected.closest('.dialog-cinema'),selected]
      .find(el=>bottom-el.getBoundingClientRect().top<=scroller.clientHeight-96)||selected;
    scroller.scrollTop+=context.getBoundingClientRect().top-scroller.getBoundingClientRect().top-64;
  }
}
