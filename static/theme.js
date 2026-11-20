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
  let cloth;
  let preparation;
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
    cloth?.cancelPreparation();
    clearTimeout(preparation);
    preference = theme;
    try { localStorage.setItem(key, preference); } catch {}
    transitionTo(theme);
  }

  function renderReveal(state) {
    if (reveal !== state) return;
    state.frame = 0;
    const target = selectedTheme() === 'light' ? 1 : 0;
    if (toggle.localName === 'cinema-theme-toggle') {
      // The icon and page use one reversible clock, not two queued animations.
      state.progress = toggle.progress;
    } else {
      const now = performance.now();
      const distance = Math.min((now - state.lastTime) / curtainDuration, Math.abs(state.target - state.progress));
      state.progress += Math.sign(state.target - state.progress) * distance;
      state.lastTime = now;
    }
    state.target = target;
    cloth.draw(state.progress);
    if (state.progress === target) finishReveal(state);
    else state.frame = requestAnimationFrame(() => renderReveal(state));
  }

  function finishReveal(state) {
    if (reveal !== state) return;
    cancelAnimationFrame(state.frame);
    const theme = selectedTheme();
    if (root.dataset.theme !== theme) root.dataset.theme = theme;
    const focused = document.activeElement === toggle;
    // Chrome can scroll a focused shadow button into view after moveBefore(),
    // even when its sticky-header position is unchanged. Restore focus only
    // after returning to normal layout, explicitly without scrolling.
    if (focused) (toggle.shadowRoot?.activeElement || toggle).blur();
    moveToggle(state.placeholder.parentElement, state.placeholder);
    state.placeholder.remove();
    if (state.originalStyle === null) toggle.removeAttribute('style');
    else toggle.setAttribute('style', state.originalStyle);
    state.stage.remove();
    cloth.end();
    delete root.dataset.themeReveal;
    reveal = null;
    if (focused && document.activeElement !== toggle) toggle.focus({ preventScroll: true });
    state.resolve();
    prepareCloth();
  }

  function moveToggle(parent, before = null) {
    // Preserve focus and the icon's running clock when the browser supports
    // moving connected elements without disconnecting/reinitializing them.
    if (parent.moveBefore) parent.moveBefore(toggle, before);
    else parent.insertBefore(toggle, before);
  }

  function makeReveal(theme) {
    // The same dark cloth opens and returns along one reversible path. The
    // light site is always the flat, live DOM underneath, in either direction.
    const canvas = cloth.begin();
    if (!canvas) return null;
    // Read the existing button's position before moving it, so starting the
    // effect does not force a second layout for the newly inserted placeholder.
    const rect = toggle.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = 'theme-reveal-layer';
    const stage = document.createElement('div');
    stage.className = 'theme-reveal-stage';
    stage.setAttribute('aria-hidden', 'true');
    stage.inert = true;
    stage.append(layer);
    layer.append(canvas);
    const width = root.clientWidth, height = innerHeight;
    const progress = root.dataset.theme === 'light' ? 1 : 0;
    const placeholder = document.createElement('span');
    placeholder.className = 'theme-toggle-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    const originalStyle = toggle.getAttribute('style');
    const focused = document.activeElement === toggle;
    toggle.before(placeholder);
    document.body.append(stage);
    moveToggle(document.body);
    Object.assign(toggle.style, { position: 'fixed', zIndex: '10001', margin: '0', left: `${rect.left}px`, top: `${rect.top}px` });
    const state = { to: theme, layer, stage, placeholder, originalStyle, progress, width, height, target: theme === 'light' ? 1 : 0, lastTime: performance.now(), frame: 0 };
    state.finished = new Promise(resolve => { state.resolve = resolve; });
    if (focused && document.activeElement !== toggle) toggle.focus({ preventScroll: true });
    return state;
  }

  function transitionTo(theme) {
    sync();
    if (reveal) {
      // The target changed synchronously; the pending display frame reads it.
      // Drawing here would add a second GPU submission inside the input event.
      return;
    }
    if (root.dataset.theme === theme) return;
    if (!toggle || !cloth || reducedMotion.matches || document.hidden || document.querySelector('dialog[open]')) {
      root.dataset.theme = theme;
      return;
    }

    reveal = makeReveal(theme);
    if (reveal) {
      root.dataset.theme = 'light';
      root.dataset.themeReveal = theme;
      const state = reveal;
      state.frame = requestAnimationFrame(() => renderReveal(state));
    } else {
      root.dataset.theme = theme;
      prepareCloth();
    }
  }

  function prepareCloth(invalidate = false) {
    if (!cloth) return;
    if (invalidate) cloth.invalidate();
    clearTimeout(preparation);
    preparation = setTimeout(async () => {
      if (reveal || reducedMotion.matches || document.hidden) return;
      try {
        await cloth.prepare();
        // Content can change during capture; retry the latest viewport once
        // the previous capture releases its resources.
        if (!cloth.has()) prepareCloth();
      } catch (error) {
        // A scroll or content change cancels the capture in progress, and the
        // request it made may have joined that cancelled run. Start again;
        // after any other failure the native theme remains usable.
        if (error?.name === 'AbortError') prepareCloth();
      }
    }, 250);
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
      return event.composedPath().includes(toggle);
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

    const changed = () => prepareCloth(true);
    const content = new MutationObserver(changed);
    document.querySelectorAll('main').forEach(main => content.observe(main, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['src', 'srcset', 'hidden', 'open', 'aria-pressed'],
    }));
    document.addEventListener('load', event => {
      if (event.target.localName === 'img' && !event.target.closest('.theme-toggle')) changed();
    }, true);
    document.addEventListener('input', changed);
    document.fonts.addEventListener('loadingdone', changed);

    const idle = () => new Promise(resolve => {
      if (window.requestIdleCallback) requestIdleCallback(() => resolve(), { timeout: 4000 });
      else setTimeout(resolve, 200);
    });
    let enhancing;
    // The resting switch above already works. Its fifteen other frames, Three.js
    // and the page capture are megabytes of download and seconds of scripting
    // that no first view needs, so they never compete with it.
    const enhance = () => enhancing ||= (async () => {
      try {
        await import(`${artwork}cinema-theme-toggle.js`);
        const curtains = document.createElement('cinema-theme-toggle');
        curtains.className = 'theme-toggle';
        curtains.setAttribute('size', '44');
        await curtains.ready;
        if (reveal) await reveal.finished;
        const fallback = toggle;
        const focused = document.activeElement === fallback;
        toggle = curtains;
        sync();
        curtains.addEventListener('theme-change', ({ detail }) => {
          if (!syncing) selectTheme(detail.theme);
        });
        fallback.replaceWith(curtains);
        if (focused) curtains.focus({ preventScroll: true });
        // Install the working control before loading or preparing the 3D effect.
        // Neither fonts nor a fresh texture may hold up a user's theme change.
        if (!reducedMotion.matches) {
          try {
            await idle();
            const { ScreenCurtains } = await import(`${artwork}cloth.js`);
            cloth = new ScreenCurtains();
            prepareCloth();
          } catch { cloth = null; }
        }
      } catch {
        // Keep the native switch functional even when the animation is offline.
      }
    })();
    // Reaching for the switch cannot wait for an idle period.
    for (const type of ['pointerenter', 'focus', 'click']) toggle.addEventListener(type, enhance, { once: true });
    const connection = navigator.connection;
    // As with artwork, a constrained connection fetches the animation on demand.
    if (connection?.saveData || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType)) return;
    if (document.readyState !== 'complete') await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
    // An interactive listing publishes its first catalogue attempt here.
    try { await window.vobarnaProgramme; } catch {}
    await idle();
    enhance();
  }

  system.addEventListener('change', () => transitionTo(selectedTheme()));
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && reveal) finishReveal(reveal);
  });
  window.addEventListener('scroll', () => {
    if (reveal) finishReveal(reveal);
    prepareCloth(true);
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (reveal) finishReveal(reveal);
    prepareCloth(true);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && reveal) finishReveal(reveal); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : null;
    transitionTo(selectedTheme());
  });
  sync();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
