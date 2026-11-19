// Today uses the ordinary programme's date filter, including after midnight.
function updateTodayLinks() {
  const date = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Madrid', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
  for (const link of document.querySelectorAll('[data-today-link]')) {
    const url = new URL(link.href);
    url.searchParams.set('date', date);
    link.href = url.pathname + url.search;
  }
}
updateTodayLinks();
document.addEventListener('click', event => { if (event.target.closest?.('[data-today-link]')) updateTodayLinks(); }, true);
window.addEventListener('pageshow', updateTodayLinks);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateTodayLinks(); });
