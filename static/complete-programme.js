// Every page is linked in the original HTML. Opening the disclosure is only a
// reading convenience; neither crawling nor the fallback requires JavaScript.
const disclosure = document.querySelector('details#complete-programme');
const labels = {
  en: ['Loading the programme…', 'Read the programme using the page links above.'],
  es: ['Cargando la cartelera…', 'Consulta la cartelera con los enlaces de arriba.'],
  ca: ['Carregant la cartellera…', 'Consulta la cartellera amb els enllaços de dalt.'],
};
let loading = false, loaded = false;
disclosure?.addEventListener('toggle', async () => {
  if (!disclosure.open || loading || loaded) return;
  loading = true;
  const status = disclosure.querySelector('[data-programme-status]');
  const target = disclosure.querySelector('[data-programme-loaded]');
  const text = labels[document.documentElement.lang] || labels.en;
  status.textContent = text[0];
  target.setAttribute('aria-busy', 'true');
  try {
    const links = [...disclosure.querySelectorAll('a[data-programme-page]')];
    const fragments = [];
    // Limit simultaneous requests; retain the published page order.
    for (let start = 0; start < links.length; start += 3) {
      fragments.push(...await Promise.all(links.slice(start, start + 3).map(async link => {
        const response = await fetch(link.href, {signal: AbortSignal.timeout(20000)});
        if (!response.ok) throw new Error('Programme page unavailable');
        const page = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (page.querySelector('#complete-programme')?.dataset.programmeVersion !== disclosure.dataset.programmeVersion)
          throw new Error('Programme changed; use the current linked pages');
        const entries = page.querySelector('[data-programme-entries]');
        if (!entries) throw new Error('Invalid programme page');
        return entries;
      })));
    }
    target.replaceChildren(...fragments);
    loaded = true;
    status.textContent = '';
  } catch {
    status.textContent = text[1];
  } finally {
    target.removeAttribute('aria-busy');
    loading = false;
  }
});
