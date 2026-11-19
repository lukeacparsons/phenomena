// Apply a saved preference before styles paint; otherwise CSS follows the device.
(() => {
  const key = 'vobarna-theme';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let preference;
  try { preference = localStorage.getItem(key); } catch {}
  const valid = value => value === 'light' || value === 'dark';
  if (!valid(preference)) preference = null;
  const selectedTheme = () => preference || (system.matches ? 'dark' : 'light');
  root.dataset.theme = selectedTheme();

  let toggle;
  let syncing = false;
  let reveal;
  // The supplied curtain drawing has 15 steps, each held for 50 ms.
  const curtainDuration = 750;
  const artwork = '/cinema-curtain-toggle/';
  const colour = document.createElement('meta');
  colour.name = 'theme-color';
  document.head.append(colour);
  const labels = {
    en: ['Light mode', 'Close curtains for dark mode', 'Open curtains for light mode'],
    es: ['Modo claro', 'Cerrar el telón para el modo oscuro', 'Abrir el telón para el modo claro'],
    ca: ['Mode clar', 'Tanca el teló per al mode fosc', 'Obre el teló per al mode clar'],
  };

  function sync() {
    const dark = preference ? preference === 'dark' : system.matches;
    colour.content = dark ? '#181818' : '#f7f2e8';
    if (!toggle) return;
    const copy = labels[root.lang] || labels.en;
    if (toggle.localName === 'cinema-theme-toggle') {
      toggle.setAttribute('label', copy[0]);
      // The component emits changes for programmatic updates too. Following
      // the device or another tab must not create a new saved preference.
      syncing = true;
      toggle.checked = !dark;
      syncing = false;
    } else {
      toggle.setAttribute('aria-label', copy[0]);
      toggle.setAttribute('aria-checked', String(!dark));
      const image = toggle.querySelector('img');
      const frame = dark ? '01' : '16';
      if (image.dataset.frame !== frame) {
        image.dataset.frame = frame;
        image.src = `${artwork}frames/frame-${frame}.png`;
      }
    }
    toggle.title = copy[dark ? 2 : 1];
  }

  function selectTheme(theme) {
    preference = theme;
    try { localStorage.setItem(key, preference); } catch {}
    transitionTo(theme);
  }

  function playReveal(state, align = false) {
    const animation = state.animation;
    if (!animation) return;
    // Align once after snapshot capture. Reversals keep the current position;
    // snapping back to a discrete drawing would make the page visibly jump.
    if (align && toggle?.localName === 'cinema-theme-toggle') {
      const open = toggle.progress;
      animation.currentTime = (state.to === 'light' ? open : 1 - open) * curtainDuration;
    }
    animation.playbackRate = selectedTheme() === state.to ? 1 : -1;
    animation.play();
  }

  function transitionTo(theme) {
    sync();
    if (reveal) {
      playReveal(reveal);
      return;
    }
    if (root.dataset.theme === theme) return;
    if (!toggle || reducedMotion.matches || document.hidden || !document.startViewTransition) {
      root.dataset.theme = theme;
      return;
    }

    const state = { to: theme, animation: null, transition: null };
    reveal = state;
    root.dataset.themeReveal = theme;
    state.transition = document.startViewTransition(() => {
      root.dataset.theme = state.to;
    });
    state.transition.ready.then(() => {
      // Light is always the upper layer: opening reveals it from the centre;
      // closing draws its curved edges back together over the dark page.
      const aperture = ['ellipse(0% 62% at 50% 50%)', 'ellipse(58% 100% at 50% 50%)'];
      state.animation = root.animate(
        { clipPath: theme === 'light' ? aperture : [...aperture].reverse() },
        {
          duration: curtainDuration, easing: 'linear', fill: 'both',
          pseudoElement: `::view-transition-${theme === 'light' ? 'new' : 'old'}(root)`,
        },
      );
      playReveal(state, true);
    }).catch(() => {
      // A hidden tab or an interrupted capture may skip the visual transition.
      state.transition.skipTransition();
    });
    const finish = () => {
      if (reveal !== state) return;
      root.dataset.theme = selectedTheme();
      delete root.dataset.themeReveal;
      reveal = null;
    };
    state.transition.finished.then(finish, finish);
  }

  async function mount() {
    const header = document.querySelector('.header-wrap header');
    if (!header) return;
    let actions = header.querySelector('.header-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'header-actions';
      const navigation = header.querySelector('nav');
      if (navigation) actions.append(navigation);
      header.append(actions);
    }
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'theme-toggle';
    toggle.setAttribute('role', 'switch');
    // The resting image stays usable while the animation loads, and remains
    // the fallback if its module or any of its frames cannot be fetched.
    toggle.innerHTML = '<img width="44" height="44" alt="" aria-hidden="true">';
    toggle.addEventListener('click', () => {
      const dark = preference ? preference === 'dark' : system.matches;
      selectTheme(dark ? 'light' : 'dark');
    });
    actions.append(toggle);
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['lang'] });
    sync();

    function isTogglePress(event) {
      if (event.composedPath().includes(toggle)) return true;
      // During a View Transition, hit testing can target its root snapshot.
      // Route presses on the visible curtain back to the live control.
      if (!reveal || document.querySelector('dialog[open]')) return false;
      const rect = toggle.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
    }
    function press() {
      toggle.focus({ preventScroll: true });
      if (toggle.localName === 'cinema-theme-toggle') toggle.checked = !toggle.checked;
      else selectTheme(selectedTheme() === 'dark' ? 'light' : 'dark');
    }
    document.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || !isTogglePress(event)) return;
      event.preventDefault();
      event.stopPropagation();
      press();
    }, true);
    document.addEventListener('click', event => {
      // Pointer activation already happened on press. Keep virtual clicks for
      // assistive technology, without toggling again on pointer release.
      if (event.detail > 0 && isTogglePress(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
    document.addEventListener('keydown', event => {
      if (!event.composedPath().includes(toggle) || ![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) press();
    }, true);
    document.addEventListener('keyup', event => {
      if (event.composedPath().includes(toggle) && [' ', 'Enter'].includes(event.key)) event.preventDefault();
    }, true);

    try {
      await import(`${artwork}cinema-theme-toggle.js`);
      const curtains = document.createElement('cinema-theme-toggle');
      curtains.className = 'theme-toggle';
      curtains.setAttribute('size', '44');
      await curtains.ready;
      const fallback = toggle;
      const focused = document.activeElement === fallback;
      toggle = curtains;
      sync();
      curtains.addEventListener('theme-change', ({ detail }) => {
        if (!syncing) selectTheme(detail.theme);
      });
      fallback.replaceWith(curtains);
      if (focused) curtains.focus();
    } catch {
      // Keep the native switch functional even when the animation is offline.
    }
  }

  system.addEventListener('change', () => transitionTo(selectedTheme()));
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && reveal) {
      reveal.transition.skipTransition();
      root.dataset.theme = selectedTheme();
    }
  });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : null;
    transitionTo(selectedTheme());
  });
  sync();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
