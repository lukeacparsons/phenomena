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
      image.alt = '';
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
