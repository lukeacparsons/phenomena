// Keep the original language links and buttons inside the mobile disclosure.
for (const [index, navigation] of [...document.querySelectorAll('.lang-switch')].entries()) {
  const choices = [...navigation.querySelectorAll('a[hreflang], button[data-lang]')];
  if (!choices.length) continue;
  const names = {en: 'English', es: 'Español', ca: 'Català'};
  const mobile = matchMedia('(max-width: 600px)');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'language-toggle';
  toggle.innerHTML = '<span class="language-current"></span><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg>';
  const options = document.createElement('div');
  options.className = 'language-options';
  options.id = `language-options-${index}`;
  toggle.setAttribute('aria-controls', options.id);
  for (const choice of choices) {
    // Venue pages use a new-tab base for operator links. Language changes stay here.
    if (choice.hasAttribute('href')) choice.target = '_self';
    const code = choice.getAttribute('hreflang') || choice.dataset.lang;
    const abbreviation = document.createElement('span');
    abbreviation.className = 'language-code';
    abbreviation.textContent = choice.textContent.trim();
    const name = document.createElement('span');
    name.className = 'language-name';
    name.lang = code;
    name.textContent = names[code] || code;
    choice.replaceChildren(abbreviation, name);
    options.append(choice);
  }
  const setOpen = (open, restoreFocus = false) => {
    navigation.classList.toggle('is-language-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (restoreFocus) toggle.focus({preventScroll: true});
  };
  const sync = () => {
    const language = document.documentElement.lang;
    toggle.querySelector('.language-current').textContent = language.toUpperCase();
    toggle.setAttribute('aria-label', `${language === 'en' ? 'Language' : 'Idioma'}: ${names[language] || language}`);
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  navigation.addEventListener('click', event => {
    const choice = event.target.closest('a[hreflang], button[data-lang]');
    if (!choice || !mobile.matches) return;
    setOpen(false, true);
  });
  navigation.addEventListener('keydown', event => {
    if (!mobile.matches) return;
    if (event.key === 'Escape') {
      if (toggle.getAttribute('aria-expanded') === 'true') {
        event.preventDefault();
        setOpen(false, true);
      }
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      const current = choices.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 :
        current < 0 ? (event.key === 'ArrowUp' ? choices.length - 1 : 0) :
        (current + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
      choices[next].focus();
    }
  });
  navigation.addEventListener('focusout', event => {
    if (!navigation.contains(event.relatedTarget)) setOpen(false);
  });
  document.addEventListener('click', event => {
    if (!navigation.contains(event.target)) setOpen(false);
  });
  mobile.addEventListener('change', () => {
    if (navigation.contains(document.activeElement)) {
      if (mobile.matches) toggle.focus();
      else choices.find(choice => choice.hasAttribute('aria-current') || choice.getAttribute('aria-pressed') === 'true')?.focus();
    }
    setOpen(false);
  });
  sync();
  setOpen(false);
  navigation.append(toggle, options);
  navigation.classList.add('has-language-menu');
  new MutationObserver(sync).observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
  window.addEventListener('pageshow', () => {sync(); setOpen(false);});
}

// Clint is a separate button; the adjacent title remains the home link.
const logo = document.querySelector('.logo-mark');
const button = document.querySelector('.clint-button');
if (logo && button) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const gestures = {
    scroll: { url: '/barcelona-mascot-point-right-brow-refined.webp', duration: 4700 },
    poke: { url: '/barcelona-mascot-poke.webp', duration: 760 },
  };
  const assets = new Map();
  let displayed;
  let active;
  let pending;
  let playback = 0;
  let timer;
  let frame;
  let previousY = Math.max(0, scrollY);
  let downwardDistance = 0;
  let nextScroll = 0;

  function getAsset(kind) {
    if (!assets.has(kind)) {
      assets.set(kind, fetch(gestures[kind].url).then(response => {
        if (!response.ok) throw new Error('Clint animation unavailable');
        return response.blob();
      }).catch(error => {
        assets.delete(kind);
        throw error;
      }));
    }
    return assets.get(kind);
  }

  function rest() {
    playback++;
    pending = null;
    clearTimeout(timer);
    button.classList.remove('is-animating');
    delete button.dataset.gesture;
    active = null;
    downwardDistance = 0;
    nextScroll = performance.now() + 1200;
  }

  async function play(kind) {
    if (reducedMotion.matches || document.hidden) return;
    if (kind === 'scroll' && (active || pending)) return;
    // Every poke starts a fresh playback, including during another poke.
    // The request counter discards any older image still being decoded.
    pending = kind;
    const request = ++playback;
    clearTimeout(timer);
    let readyURL;
    try {
      const blob = await getAsset(kind);
      if (request !== playback) return;
      readyURL = URL.createObjectURL(blob);
      const image = new Image();
      image.className = 'clint-animation';
      image.alt = logo.alt;
      image.setAttribute('aria-hidden', 'true');
      image.src = readyURL;
      await image.decode();
      if (request !== playback || reducedMotion.matches || document.hidden) return;
      if (displayed) {
        // Restart the decoded WebP in the existing layer. Repeated clicks
        // must not restart its opacity transition or add translucent layers.
        const previousURL = displayed.url;
        displayed.image.src = readyURL;
        displayed.url = readyURL;
        URL.revokeObjectURL(previousURL);
      } else {
        button.append(image);
        getComputedStyle(image).opacity;
        displayed = { image, url: readyURL };
      }
      active = kind;
      readyURL = null;
      pending = null;
      button.classList.add('is-animating');
      button.dataset.gesture = kind;
      timer = setTimeout(rest, gestures[kind].duration);
    } catch {
      if (request === playback) rest();
    } finally {
      if (readyURL) URL.revokeObjectURL(readyURL);
    }
  }

  button.addEventListener('click', () => void play('poke'));
  // Warm the small reaction asset on hover/focus so a click responds promptly.
  const preparePoke = () => {
    if (!reducedMotion.matches) void getAsset('poke').catch(() => {});
  };
  button.addEventListener('pointerenter', preparePoke);
  button.addEventListener('focus', preparePoke);

  addEventListener('scroll', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const y = Math.max(0, scrollY);
      const delta = y - previousY;
      previousY = y;
      if (y <= 24) {
        downwardDistance = 0;
        return;
      }
      downwardDistance = delta > 0 ? downwardDistance + delta : 0;
      if (!active && !pending && downwardDistance >= 24 && performance.now() >= nextScroll) {
        downwardDistance = 0;
        void play('scroll');
      }
    });
  }, { passive: true });
  reducedMotion.addEventListener('change', rest);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) rest();
  });
  // The legacy listing changes language without navigating.
  const label = () => button.setAttribute('aria-label', {
    en: 'Poke Clint', es: 'Toca a Clint', ca: 'Toca el Clint',
  }[document.documentElement.lang] || 'Poke Clint');
  new MutationObserver(label).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  label();
}
