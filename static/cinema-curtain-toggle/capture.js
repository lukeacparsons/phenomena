import './vendor/html-to-image.js';

const { toCanvas, getFontEmbedCSS } = globalThis.htmlToImage;
delete globalThis.htmlToImage;
let background;
let fonts;
const stylesheets = new Map();
const yieldTask = () => globalThis.scheduler?.yield?.() || new Promise(resolve => setTimeout(resolve, 0));

const dataURL = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

// Film pages can contain hundreds of screenings. Keep the browser's measured
// column widths and replace consecutive offscreen rows with one empty spacer.
// This affects only the snapshot; the live, accessible table stays complete.
function pruneTable(copy, original, viewportHeight) {
  const rows = [...original.rows];
  if (!rows.length || rows.some(row => [...row.cells].some(cell => cell.rowSpan !== 1))) return;
  const columns = rows.find(row => [...row.cells].every(cell => cell.colSpan === 1));
  if (!columns) return;
  const pairs = [...copy.rows].map((row, i) => ({ row, original: rows[i], box: rows[i].getBoundingClientRect() }));
  const offscreen = box => box.bottom < -1 || box.top > viewportHeight + 1;
  if (!pairs.some(({ box }) => offscreen(box))) return;
  copy.querySelectorAll(':scope > colgroup').forEach(group => group.remove());
  const group = document.createElement('colgroup');
  for (const cell of columns.cells) {
    const col = document.createElement('col');
    col.style.width = `${cell.getBoundingClientRect().width}px`;
    group.append(col);
  }
  copy.prepend(group);
  Object.assign(copy.style, { tableLayout: 'fixed', width: `${original.getBoundingClientRect().width}px` });
  for (let i = 0; i < pairs.length; i++) {
    const first = pairs[i];
    if (!offscreen(first.box)) continue;
    let end = i;
    while (end + 1 < pairs.length && offscreen(pairs[end + 1].box)
      && pairs[end + 1].row.parentElement === first.row.parentElement) end++;
    const spacer = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columns.cells.length;
    cell.style.cssText = `height:${pairs[end].box.bottom - first.box.top}px;padding:0;border:0`;
    // Collapsed borders contribute half their width to neighbouring rows.
    // Keep the run's outer borders so visible text cannot shift at its edges.
    cell.style.borderTop = getComputedStyle(first.original.cells[0]).borderTop;
    cell.style.borderBottom = getComputedStyle(pairs[end].original.cells[0]).borderBottom;
    spacer.style.visibility = 'hidden';
    spacer.append(cell);
    first.row.before(spacer);
    for (; i <= end; i++) pairs[i].row.remove();
    i--;
  }
}

// Render the browser's own text layout, masks and backgrounds into the cloth
// texture. Reconstructing text with canvas measurements moves font baselines.
export async function captureDarkPage(signal) {
  signal?.throwIfAborted();
  const width = document.documentElement.clientWidth, height = innerHeight;
  const offsetX = scrollX, offsetY = scrollY;
  const headerBounds = document.querySelector('.header-wrap')?.getBoundingClientRect();
  // Embed the compact source artwork in the one-off snapshot. The live page
  // uses its pre-rendered WebP, avoiding SVG work on each theme transition.
  background ||= fetch('/barcelona-cinema-background.svg').then(r => {
    if (!r.ok) throw new Error('Curtain background unavailable');
    return r.blob();
  }).then(dataURL);
  const tile = await background;
  signal?.throwIfAborted();
  const copy = document.documentElement.cloneNode(true);
  copy.dataset.theme = 'dark';
  copy.style.setProperty('--header-height', getComputedStyle(document.documentElement).getPropertyValue('--header-height'));
  delete copy.dataset.themeReveal;
  copy.querySelectorAll('script,iframe,.theme-reveal-stage,.curtain-mesh').forEach(el => el.remove());
  copy.querySelectorAll('*').forEach(el => {
    for (const name of el.getAttributeNames()) if (name.startsWith('on')) el.removeAttribute(name);
  });
  // Make the webfont rules readable in the isolated clone without changing
  // the live page's stylesheets or relying on cross-origin CSSOM access.
  await Promise.all([...copy.querySelectorAll('link[rel=stylesheet]')].map(async link => {
    const url = new URL(link.getAttribute('href'), document.baseURI);
    if (url.origin === location.origin) return;
    if (!stylesheets.has(url.href)) stylesheets.set(url.href, fetch(url).then(response => {
      if (!response.ok) throw new Error('Curtain font stylesheet unavailable');
      return response.text();
    }));
    const sheet = document.createElement('style');
    sheet.textContent = (await stylesheets.get(url.href)).replace(/url\((['"]?)([^)'"\s]+)\1\)/g,
      (_, quote, src) => `url("${new URL(src, url).href}")`);
    link.replaceWith(sheet);
  }));
  // Keep the header's layout space, but omit the separately animated control.
  copy.querySelectorAll('.theme-toggle').forEach(el => { el.style.visibility = 'hidden'; });
  const images = document.querySelectorAll('img');
  copy.querySelectorAll('img').forEach((el, i) => {
    if (images[i]?.currentSrc) {
      el.src = images[i].currentSrc;
      el.removeAttribute('srcset');
    }
    el.loading = 'eager';
  });
  const inputs = document.querySelectorAll('input');
  copy.querySelectorAll('input').forEach((el, i) => { el.setAttribute('value', inputs[i]?.value || ''); });
  const blocks = '.card,.dates > :is(button,a),main > .filters,.site-footer,.complete-programme,.complete-programme-content article,.table-scroll';
  const originals = [...document.querySelectorAll(blocks)];
  // Pair while both trees still have the same disclosure contents.
  const blockPairs = [...copy.querySelectorAll(blocks)].map((card, i) => [card, originals[i]]);
  const tables = [...document.querySelectorAll('table')];
  const tablePairs = [...copy.querySelectorAll('table')].map((table, i) => [table, tables[i]]);
  // A closed disclosure paints only its first summary. In particular, the
  // complete programme contains thousands of hidden screenings: styling and
  // embedding those nodes can turn a viewport snapshot into a 100+ MB SVG.
  copy.querySelectorAll('details:not([open])').forEach(details => {
    const summary = [...details.children].find(child => child.localName === 'summary');
    [...details.childNodes].forEach(child => { if (child !== summary) child.remove(); });
  });
  // Offscreen cards keep their exact layout boxes, but none of their text,
  // images or controls need styling, embedding or rasterizing for this view.
  blockPairs.forEach(([card, original]) => {
    if (!copy.contains(card)) return;
    const box = original?.getBoundingClientRect();
    if (box && (!box.width || !box.height || box.bottom < -1 || box.top > height + 1 || box.right < -1 || box.left > width + 1)) {
      // This marker controls the mobile header via :has(), even when its
      // subtitle is far offscreen. Keep it so pruning cannot change layout.
      const markers = [...card.querySelectorAll('.programme-subtitle')].map(node => {
        const marker = node.cloneNode(false);
        marker.style.setProperty('display', 'none', 'important');
        return marker;
      });
      card.replaceChildren(...markers);
      Object.assign(card.style, { height: `${box.height}px`, minHeight: `${box.height}px`, visibility: 'hidden' });
    }
  });
  tablePairs.forEach(([table, original]) => {
    if (copy.contains(table)) pruneTable(table, original, height);
  });
  signal?.throwIfAborted();
  await yieldTask();
  const style = document.createElement('style');
  // Data URLs let the SVG renderer paint the exact decorative background;
  // external image references inside a foreignObject cannot be loaded.
  style.textContent = `html{scroll-behavior:auto!important;overflow:hidden!important;--site-background:url("${tile}")!important}body{position:relative!important;top:${-offsetY}px!important;left:${-offsetX}px!important}*,*::before,*::after{animation:none!important;transition:none!important}`;
  copy.querySelector('head').append(style);

  const frame = document.createElement('iframe');
  frame.className = 'curtain-capture';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.inert = true;
  Object.assign(frame.style, { position: 'fixed', left: '-100000px', top: '0', width: `${width}px`, height: `${height}px`, border: '0', pointerEvents: 'none' });
  const loaded = new Promise((resolve, reject) => {
    frame.onload = resolve;
    frame.onerror = reject;
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  frame.srcdoc = '<!doctype html>' + copy.outerHTML;
  document.body.append(frame);
  try {
    await loaded;
    signal?.throwIfAborted();
    const doc = frame.contentDocument;
    await doc.fonts.ready;
    const header = doc.querySelector('.header-wrap');
    if (header && headerBounds) {
      const space = doc.createElement('div');
      space.style.height = `${headerBounds.height}px`;
      header.before(space);
      Object.assign(header.style, {
        position: 'fixed', top: `${headerBounds.top}px`,
        left: `${headerBounds.left}px`, width: `${headerBounds.width}px`,
      });
    }
    // Preserve the visible part of the horizontally scrolled date reel.
    const reel = document.querySelector('.dates');
    if (reel?.scrollLeft) doc.querySelectorAll('.dates > *').forEach(el => {
      el.style.transform = `translateX(${-reel.scrollLeft}px)`;
    });
    fonts ||= getFontEmbedCSS(doc.documentElement);
    const fontEmbedCSS = await fonts;
    // Computed visual properties already resolve var(). Copying inherited
    // custom properties would duplicate the embedded background on every node.
    const includeStyleProperties = [...doc.defaultView.getComputedStyle(doc.documentElement)]
      .filter(name => !name.startsWith('--')
        && (!name.startsWith('-webkit-') || name === '-webkit-font-smoothing')
        && !/^(animation|transition|scroll-|overscroll|view-transition|timeline|anchor|pointer-events|touch-action|cursor|caret|user-select|resize|will-change)/.test(name));
    let sliceStart = performance.now();
    const canvas = await toCanvas(doc.documentElement, {
      width, height, pixelRatio: Math.min(devicePixelRatio, 2),
      fontEmbedCSS, includeStyleProperties, backgroundColor: '#181818',
      filter: el => !el.matches?.('script,iframe'),
      yieldControl: async () => {
        signal?.throwIfAborted();
        if (performance.now() - sliceStart > 6) {
          await yieldTask();
          signal?.throwIfAborted();
          sliceStart = performance.now();
        }
      },
    });
    signal?.throwIfAborted();
    return canvas;
  } finally {
    frame.remove();
  }
}
