import {observeImages,posterMarkup} from './progressive-images.js';
import {filmMarkup} from './film-view.js';
const swipeDialogs = new WeakSet();
function enableSheetDismiss(dialog){
  if(dialog.tagName!=='DIALOG'||swipeDialogs.has(dialog))return;
  swipeDialogs.add(dialog);
  const mobile=matchMedia('(max-width:460px)');
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
    if(!handle&&(!target.closest('.dialog-head')||dialog.scrollTop>1))return;
    const touch=event.touches[0];
    gesture={id:touch.identifier,x:touch.clientX,y:touch.clientY,started:event.timeStamp,distance:0,handle};
  },{passive:true});
  dialog.addEventListener('touchmove',event=>{
    if(!gesture)return;
    if(event.touches.length!==1||(!gesture.handle&&dialog.scrollTop>1)){reset();return;}
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
  enableSheetDismiss(dialog);
  const scroll=dialog.scrollTop;
  dialog.dataset.film=film.id;
  dialog.innerHTML=filmMarkup(film,{...options,poster:posterMarkup(film,{className:'dialog-poster'})});
  dialog.scrollTop=scroll;
  observeImages(dialog);
}

export function focusSelectedScreening(dialog){
  const selected=dialog.querySelector('.buyrow.is-highlighted');
  (selected||dialog.querySelector('#dialogTitle'))?.focus({preventScroll:true});
  if(selected){
    const bottom=selected.getBoundingClientRect().bottom;
    const context=[selected.closest('.dialog-day'),selected.closest('.dialog-cinema'),selected]
      .find(el=>bottom-el.getBoundingClientRect().top<=dialog.clientHeight-96)||selected;
    dialog.scrollTop=context.getBoundingClientRect().top-dialog.getBoundingClientRect().top-64;
  }
}
