const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.VOBARNA_PUBLIC_URL || 'http://127.0.0.1:8831';
const output = 'output/language-transition/after';

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const reports = [];
  try {
    for (const [width, theme, motion] of [[1440, 'light', 'no-preference'], [390, 'dark', 'reduce']]) {
      const context = await browser.newContext({viewport: {width, height: 900}, colorScheme: theme, reducedMotion: motion,
        recordVideo: {dir: output, size: {width, height: 900}}});
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      // Avoid unrelated animation downloads/captures obscuring the measurements.
      await context.addInitScript(() => Object.defineProperty(navigator, 'connection', {
        value: Object.assign(new EventTarget(), {effectiveType: '3g', saveData: true}), configurable: true,
      }));
      const page = await context.newPage(), errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push({url: request.url(), type: request.resourceType()}));
      const press = async locator => {
        // Use the visible sticky control's coordinates: locator.click() calls
        // scrollIntoView and would move the document before the user click.
        const box = await locator.boundingBox();
        assert.ok(box && box.y >= 0 && box.y + box.height <= 900);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      };
      const choose = async language => {
        if (width <= 600) await press(page.locator('.language-toggle'));
        await press(page.locator(`.lang-switch a[hreflang=${language}]`));
        await page.waitForFunction(language => document.documentElement.lang === language && !document.querySelector('.lang-switch').hasAttribute('aria-busy'), language);
      };
      for (const start of ['/es/cines/mooby-arenas-de-barcelona/', '/es/']) {
        await page.goto(base + start, {waitUntil: 'load'});
        await page.waitForSelector('#grid[data-enhanced] .card');
        await page.evaluate(async () => {await document.fonts.ready; await Promise.all([...document.querySelectorAll('#grid img')].slice(0,4).map(image => image.decode().catch(() => {})));});
        await page.waitForTimeout(300);
        await page.evaluate(() => {
          window.original = {document, grid: document.getElementById('grid'), theme: document.querySelector('.theme-toggle'),
            posters: [...document.querySelectorAll('#grid .poster-button')].slice(0,4),
            images: [...document.querySelectorAll('#grid img')].slice(0,4)};
          window.frameSamples = [];
          window.sampleLanguageFrames = true;
          const sample = () => {
            if (!window.sampleLanguageFrames) return;
            const image = original.images[0], rect = image.getBoundingClientRect();
            frameSamples.push({y: rect.y, width: rect.width, height: rect.height, connected: image.isConnected,
              source: image.currentSrc, pickerX: document.querySelector('.lang-switch').getBoundingClientRect().x});
            requestAnimationFrame(sample);
          }; sample();
        });
        const offset = requests.length;
        for (const language of ['ca', 'en', 'es']) {
          await choose(language);
          await page.waitForTimeout(150);
          const state = await page.evaluate(() => ({
            sameDocument: original.document === document,
            sameGrid: original.grid === document.getElementById('grid'),
            sameTheme: original.theme === document.querySelector('.theme-toggle'),
            samePosters: original.posters.every((node, index) => node === document.querySelectorAll('#grid .poster-button')[index]),
            sameImages: original.images.every((node, index) => node === document.querySelectorAll('#grid img')[index]),
            lang: document.documentElement.lang, path: location.pathname,
            canonical: document.querySelector('link[rel=canonical]').href,
            home: document.querySelector('.logo-copy').getAttribute('href'),
            selected: document.querySelector('.lang-switch [aria-current]').hreflang,
            theme: document.documentElement.dataset.theme,
            disclosureOpen: document.querySelector('.language-toggle').getAttribute('aria-expanded'),
          }));
          for (const key of ['sameDocument', 'sameGrid', 'sameTheme', 'samePosters', 'sameImages']) assert.equal(state[key], true, key);
          assert.ok(state.path.startsWith('/' + language + '/'));
          assert.equal(state.canonical, 'https://vobarna.com' + state.path);
          assert.equal(state.home, '/' + language + '/');
          assert.equal(state.selected, language);
          assert.equal(state.theme, theme);
          assert.equal(state.disclosureOpen, 'false');
        }
        const frames = await page.evaluate(() => {window.sampleLanguageFrames = false; return frameSamples;});
        assert.ok(frames.length > 5);
        assert.ok(frames.every(frame => frame.connected && frame.width > 0 && frame.height > 0));
        assert.equal(new Set(frames.map(frame => frame.source)).size, 1, 'Loaded poster never returns to its blurred preview');
        const movement = {};
        for (const metric of ['y', 'width', 'height', 'pickerX']) {
          const values = frames.map(frame => frame[metric]);
          movement[metric] = Math.max(...values) - Math.min(...values);
          assert.ok(movement[metric] < 1, `${metric} moved during translation`);
        }
        assert.equal(requests.slice(offset).filter(request => request.type === 'document').length, 0, 'No document navigation');
        assert.equal(requests.slice(offset).filter(request => /programme\.json|fonts\/|clint|cinema-curtain-toggle/.test(request.url)).length, 0, 'No catalogue/header/font restart');
        reports.push({width, theme, start, frames: frames.length, documentNavigations: 0, movement});
        await page.screenshot({path: `${output}/${width}-${start === '/es/' ? 'home' : 'cinema'}.png`});

        // A language switch must retain search, selected dates and both scroll axes.
        const title = await page.locator('#grid .card h2').first().innerText();
        await page.locator('#search').fill(title);await page.locator('#search').press('Enter');
        await page.waitForFunction(() => document.querySelector('#grid').getAttribute('aria-busy') === 'false' && location.search.includes('q='));
        await page.locator('#dates button[data-date]:not([data-date=all])').first().click();
        await page.evaluate(() => {document.getElementById('dates').scrollLeft = 100; scrollTo({top: 150, behavior: 'instant'});});
        const saved = await page.evaluate(() => ({query: location.search, y: scrollY, dateScroll: document.getElementById('dates').scrollLeft,
          date: document.querySelector('#dates [aria-pressed=true]').dataset.date}));
        await choose('ca');
        assert.equal(new URL(page.url()).search, saved.query);
        assert.equal(await page.locator('#search').inputValue(), title);
        assert.equal(await page.locator('#dates [aria-pressed=true]').getAttribute('data-date'), saved.date);
        assert.equal(await page.evaluate(() => scrollY), saved.y);
        assert.equal(await page.locator('#dates').evaluate(node => node.scrollLeft), saved.dateScroll);
        assert.ok((await page.locator('.lang-switch a[hreflang=en]').getAttribute('href')).endsWith(saved.query));
        await page.goBack();
        await page.waitForFunction(() => document.documentElement.lang === 'es');
        assert.equal(await page.locator('#search').inputValue(), title);
        await page.goForward();
        await page.waitForFunction(() => document.documentElement.lang === 'ca');
        const listingURL = page.url();
        await page.locator('#grid .title-button').first().click();
        await page.waitForSelector('#filmDialog[open]');
        assert.match(new URL(page.url()).pathname, /^\/ca\/pellicules\//);
        await page.keyboard.press('Escape');
        await page.waitForSelector('#filmDialog[open]', {state: 'hidden'});
        await page.waitForURL(listingURL);
        assert.ok(new URL(page.url()).pathname.startsWith('/ca/'));
        assert.equal(new URL(page.url()).search, saved.query);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }

    // A slow translation keeps the current page painted; the latest choice wins.
    const context = await browser.newContext({reducedMotion: 'reduce'});
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(base + '/es/', {waitUntil: 'load'});
    await page.waitForSelector('#grid[data-enhanced]');
    let release;
    const gate = new Promise(resolve => {release = resolve;});
    await page.route('**/ca/', async route => {await gate; await route.continue();});
    await page.locator('.lang-switch a[hreflang=ca]').click();
    assert.equal(await page.locator('html').getAttribute('lang'), 'es');
    assert.ok(await page.locator('#grid .card').first().isVisible());
    await page.locator('.lang-switch a[hreflang=en]').click();
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    release();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    const entries = await page.evaluate(() => history.length);
    await page.locator('.lang-switch a[hreflang=en]').click();
    assert.equal(await page.evaluate(() => history.length), entries, 'Current language is a no-op');
    await page.locator('#complete-programme').evaluate(node => {node.open = true;});
    await page.waitForSelector('#complete-programme [data-programme-entries]');
    await page.locator('.site-information').evaluate(node => {node.open = true;});
    await page.locator('.lang-switch a[hreflang=ca]').click();
    await page.waitForFunction(() => document.documentElement.lang === 'ca');
    assert.equal(await page.locator('#complete-programme').getAttribute('open'), '');
    assert.equal(await page.locator('.site-information').getAttribute('open'), '');
    await page.waitForSelector('#complete-programme [data-programme-entries]');
    assert.ok((await page.locator('#complete-programme [data-programme-page]').first().getAttribute('href')).startsWith('/ca/'));
    await page.setViewportSize({width:390,height:844});
    await page.locator('.language-toggle').focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(await page.locator('.language-toggle').evaluate(node => node === document.activeElement), true);
    await context.close();

    // Network failure uses the normal link, and no-JS venue links stay in this tab.
    const fallback = await browser.newContext({reducedMotion: 'reduce'});
    const fallbackPage = await fallback.newPage();
    await fallbackPage.goto(base + '/es/', {waitUntil: 'load'});
    await fallbackPage.waitForSelector('#grid[data-enhanced]');
    await fallbackPage.route('**/ca/', route => route.request().resourceType() === 'fetch' ? route.abort() : route.continue());
    await fallbackPage.locator('.lang-switch a[hreflang=ca]').click();
    await fallbackPage.waitForURL(base + '/ca/');
    await fallbackPage.waitForSelector('#grid[data-enhanced]');
    assert.equal(await fallbackPage.locator('html').getAttribute('lang'), 'ca');
    await fallback.close();
    const noJS = await browser.newContext({javaScriptEnabled: false});
    const plain = await noJS.newPage();
    await plain.goto(base + '/es/cines/mooby-arenas-de-barcelona/');
    await plain.locator('.lang-switch a[hreflang=ca]').click();
    assert.match(new URL(plain.url()).pathname, /^\/ca\/cinemes\//);
    assert.equal(noJS.pages().length, 1);
    await noJS.close();
    fs.writeFileSync(`${output}/report.json`, JSON.stringify(reports, null, 2));
    console.log('Language navigation passed: stable frames/posters/header, EN/ES/CA, mobile/desktop, dark/reduced motion, filters, history, dialogs, races, fallback and no-JS.');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
