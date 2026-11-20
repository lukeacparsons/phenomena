const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.VOBARNA_PUBLIC_URL || 'http://127.0.0.1:8789';
const film = '/en/films/the-hunger-games-sunrise-on-the-reaping-2026/';

(async () => {
  const browser = await chromium.launch({headless: !process.env.HEADED, channel: 'chrome'});
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({
        viewport: mobile ? {width: 415, height: 683} : {width: 1920, height: 1000},
        deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: 'dark',
      });
      // Keep the check independent of external font/analytics availability.
      await context.route('https://fonts.googleapis.com/**', route => route.fulfill({body: '', contentType: 'text/css'}));
      for (const file of ['theme.js', 'theme.css', 'cinema-curtain-toggle/cinema-theme-toggle.js',
        'cinema-curtain-toggle/cloth.js', 'cinema-curtain-toggle/capture.js']) {
        await context.route(`**/${file}`, route => {
          let source = fs.readFileSync(`static/${file}`, 'utf8');
          if (file.endsWith('/cloth.js')) source = source.replace('constructor() {', 'constructor() { window.__themeCloth = this;');
          if (file.endsWith('/capture.js')) {
            source = source.replace('copy.dataset.theme =', "copy.querySelectorAll('table tr').forEach((row, i) => row.dataset.themeTestRow = i); copy.dataset.theme =");
            source = source.replace('return canvas;', `
              window.__themeCapture = {nodes: doc.querySelectorAll('*').length, differences: []};
              document.querySelectorAll('table tr').forEach((row, i) => {
                [...row.cells].forEach((cell, j) => {
                  const live = cell.getBoundingClientRect();
                  if (live.bottom < 0 || live.top > innerHeight || !live.height) return;
                  const captured = doc.querySelector('tr[data-theme-test-row="' + i + '"]')?.cells[j]?.getBoundingClientRect();
                  if (!captured) { window.__themeCapture.differences.push({i, j, missing: true}); return; }
                  for (const key of ['x', 'y', 'width', 'height']) {
                    if (Math.abs(live[key] - captured[key]) > .1) window.__themeCapture.differences.push({i, j, key, live: live[key], captured: captured[key]});
                  }
                });
              });
              return canvas;
            `);
          }
          return route.fulfill({body: source, contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript'});
        });
      }
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const ready = () => page.waitForFunction(() => window.__themeCloth?.has(), {}, {timeout: 30000});
      const press = async () => {
        const box = await page.locator('cinema-theme-toggle').boundingBox();
        if (mobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      };
      const stableTransition = async (activate = press) => {
        await ready();
        const before = await page.evaluate(() => {
          window.__scrollSamples = [];
          window.__sampleScroll = true;
          const tick = () => { if (window.__sampleScroll) { window.__scrollSamples.push(scrollY); requestAnimationFrame(tick); } };
          tick();
          return {y: scrollY, checked: document.querySelector('cinema-theme-toggle').checked,
            header: document.querySelector('.logo').getBoundingClientRect().toJSON()};
        });
        await activate();
        assert.equal(await page.locator('.theme-reveal-stage').count(), 1, 'The prepared page must animate');
        await page.waitForFunction(() => !document.querySelector('.theme-reveal-stage'));
        // Chromium used to schedule a smooth focus scroll AFTER the handoff.
        await page.waitForTimeout(700);
        const after = await page.evaluate(() => {
          window.__sampleScroll = false;
          const toggle = document.querySelector('cinema-theme-toggle');
          return {samples: window.__scrollSamples, checked: toggle.checked, focused: document.activeElement === toggle,
            header: document.querySelector('.logo').getBoundingClientRect().toJSON()};
        });
        assert.ok(after.samples.every(y => Math.abs(y - before.y) < .1), `Scroll changed from ${before.y} to ${after.samples.at(-1)}`);
        assert.notEqual(after.checked, before.checked);
        assert.ok(after.focused, 'The switch must retain keyboard focus');
        assert.deepEqual(after.header, before.header, 'The header must stay in place');
      };
      for (const route of ['/en/', film, '/en/cinemas/phenomena-experience/', '/en/about/']) {
        await page.goto(base + route, {waitUntil: 'networkidle'});
        await page.evaluate(() => scrollTo({top: 2294, behavior: 'instant'}));
        await stableTransition();
        await stableTransition();
        if (route === film) {
          const capture = await page.evaluate(() => window.__themeCapture);
          assert.ok(capture.nodes < 1000, `Offscreen screening rows leaked into the snapshot: ${capture.nodes} nodes`);
          assert.deepEqual(capture.differences, [], 'Snapshot table cells must align with the live page');
        }
        if (route === '/en/') {
          await stableTransition(async () => {
            for (let i = 0; i < 5; i++) { await press(); await page.waitForTimeout(65); }
          });
          await stableTransition(() => page.keyboard.press('Space'));
          await stableTransition(() => page.keyboard.press('Enter'));
          // Explicit user scrolling must still work while the curtain is open.
          await ready();
          await press();
          await page.evaluate(() => scrollTo({top: 1800, behavior: 'instant'}));
          await page.waitForTimeout(900);
          assert.equal(await page.evaluate(() => scrollY), 1800);
          assert.equal(await page.locator('.theme-reveal-stage').count(), 0);
          await page.evaluate(() => { Element.prototype.moveBefore = undefined; });
          await stableTransition();
        }
        console.log(`Theme transitions, focus and scroll verified: ${mobile ? 'mobile' : 'desktop'} ${route}`);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
