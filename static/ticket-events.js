// A ticket click is a handoff to the operator, never a completed purchase.
// Both listing dialogs and information pages import this module once.
import './analytics.js';
document.addEventListener('click',event=>{
  const anchor=event.target.closest?.('a.ticket-link,a.buyrow-ticket');
  if(!anchor)return;
  window.dispatchEvent(new CustomEvent('vobarna:ticket-click',{detail:{
    page:location.pathname,destination:new URL(anchor.href).hostname,
    film_id:anchor.dataset.ticketFilm||null,
    screening_id:anchor.dataset.ticketScreening||null,
    cinema_id:anchor.dataset.ticketCinema||null,
    placement:anchor.closest('dialog')?'dialog':'information'
  }}));
});
