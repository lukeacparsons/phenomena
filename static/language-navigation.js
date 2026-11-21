// Translate an enhanced listing without restarting its catalogue, images or
// header. The published alternate page remains the source of editorial copy.
const fragments = ['.skip', '.logo-copy', 'main > h1', '.breadcrumbs', '.venue-heading',
  '.venue-programme-link', '.venue-information', '#complete-programme', '.site-footer'];
const metadata = 'link[rel="canonical"],link[rel="alternate"][hreflang],meta[name="description"],meta[name="robots"],meta[property^="og:"],meta[name^="twitter:"],script[type="application/ld+json"]';

export function installLanguageNavigation({ready, getLanguage, commit}) {
  const navigation = document.querySelector('.lang-switch');
  const choices = [...navigation.querySelectorAll('a[hreflang]')];
  const paths = new Map(choices.map(link => [new URL(link.href).pathname, link.hreflang]));
  const pages = new Map(), requests = new Map();
  let revision = 0;

  function snapshot(source, path) {
    return {path, language: source.documentElement.lang, title: source.title,
      fragments: fragments.map(selector => [selector, source.querySelector(selector)?.cloneNode(true)]),
      metadata: [...source.head.querySelectorAll(metadata)].map(node => node.cloneNode(true)),
      labels: ['.lang-switch', '.filters', '.logo-mark'].map(selector => {
        const node = source.querySelector(selector);
        return [selector, node?.getAttribute('aria-label'), node?.getAttribute('alt')];
      }),
    };
  }
  // Cache only the three translations of this listing, never other pages.
  pages.set(location.pathname, snapshot(document, location.pathname));

  async function prepare(path) {
    if (pages.has(path)) return pages.get(path);
    if (!requests.has(path)) {
      const request = (async () => {
        const response = await fetch(path, {signal: AbortSignal.timeout(10000)});
        if (!response.ok || new URL(response.url).pathname !== path) throw new Error('Language page unavailable');
        const source = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (!source.querySelector('#grid') || source.documentElement.lang !== paths.get(path) ||
            (source.body.dataset.cinemaId || '') !== (document.body.dataset.cinemaId || ''))
          throw new Error('Language page does not match this listing');
        const page = snapshot(source, path);
        pages.set(path, page);
        return page;
      })();
      requests.set(path, request);
      void request.finally(() => requests.delete(path)).catch(() => {});
    }
    return requests.get(path);
  }

  function update(page) {
    for (const [selector, source] of page.fragments) {
      const target = document.querySelector(selector);
      if (!target || !source) continue;
      const replacement = source.cloneNode(true);
      // Keep the user's research disclosures open in the translated version.
      const open = [target, ...target.querySelectorAll('details')].filter(node => node.tagName === 'DETAILS').map(node => node.open);
      [replacement, ...replacement.querySelectorAll('details')].filter(node => node.tagName === 'DETAILS')
        .forEach((node, index) => {node.open = open[index] || false;});
      target.replaceWith(replacement);
    }
    document.head.querySelectorAll(metadata).forEach(node => node.remove());
    document.head.append(...page.metadata.map(node => node.cloneNode(true)));
    document.title = page.title;
    document.body.dataset.siteLang = page.language;
    for (const [selector, label, alt] of page.labels) {
      const node = document.querySelector(selector);
      if (label !== null && label !== undefined) node?.setAttribute('aria-label', label);
      if (alt !== null && alt !== undefined) node?.setAttribute('alt', alt);
    }
    for (const choice of choices) {
      if (choice.hreflang === page.language) choice.setAttribute('aria-current', 'page');
      else choice.removeAttribute('aria-current');
    }
  }

  function pending(language) {
    if (language) navigation.setAttribute('aria-busy', 'true');
    else navigation.removeAttribute('aria-busy');
    choices.forEach(choice => choice.toggleAttribute('data-language-pending', choice.hreflang === language));
  }

  async function navigate(path, {historyView, fromHistory = false, fallback} = {}) {
    const version = ++revision;
    if (!fromHistory && paths.get(path) === getLanguage()) {pending(null); return;}
    pending(paths.get(path));
    try {
      // Keep the old view completely visible and usable while copy is fetched.
      const page = await prepare(path);
      if (version !== revision) return;
      const x = scrollX, y = scrollY;
      if (!fromHistory) history.pushState(null, '', path + location.search + location.hash);
      update(page);
      commit(page, historyView);
      scrollTo({left: x, top: y, behavior: 'instant'});
      window.dispatchEvent(new Event('vobarna:languagechange'));
    } catch {
      // A failed enhancement still follows the ordinary translated HTML link.
      if (version === revision) location.assign(fallback || location.href);
    } finally {
      if (version === revision) pending(null);
    }
  }

  navigation.addEventListener('click', event => {
    const choice = event.target.closest('a[hreflang]');
    if (!choice || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !ready()) return;
    const url = new URL(choice.href);
    if (url.origin !== location.origin || !paths.has(url.pathname)) return;
    event.preventDefault();
    void navigate(url.pathname, {fallback: url.href});
  });
  // Prepare just the intended translation on hover/focus. No language
  // downloads compete with the first view.
  const warm = event => {
    if (!ready() || navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || '')) return;
    const choice = event.target.closest('a[hreflang]');
    if (!choice) return;
    const url = new URL(choice.href);
    if (url.origin === location.origin && paths.has(url.pathname)) void prepare(url.pathname).catch(() => {});
  };
  navigation.addEventListener('pointerover', warm, {passive: true});
  navigation.addEventListener('focusin', warm);
  // Run before the listing's ordinary film/filter history restoration.
  window.addEventListener('popstate', event => {
    const path = event.state?.vobarna?.listingPath || location.pathname;
    if (!paths.has(path)) return;
    revision++;
    pending(null);
    if (paths.get(path) === getLanguage()) return;
    event.stopImmediatePropagation();
    void navigate(path, {fromHistory: true, historyView: event.state?.vobarna});
  }, true);
}
