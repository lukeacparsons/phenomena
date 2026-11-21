const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.VOBARNA_PUBLIC_URL || 'http://127.0.0.1:8815';
const output = process.env.SEO_CONTEXT_OUTPUT || 'output/seo-content-2026-11-21/browser';
const slug = 'the-hunger-games-sunrise-on-the-reaping-2026';

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const results = [];
  try {
    for (const javaScriptEnabled of [false, true]) {
      const context = await browser.newContext({javaScriptEnabled, userAgent: 'VO-Barna/check SEO-footer-browser'});
      await context.addInitScript(() => { try { localStorage.setItem('vobarna-internal', '1'); } catch {} });
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = await context.newPage();
      for (const width of [390, 1280]) {
        await page.setViewportSize({width, height: 900});
        for (const [lang, filmSection, venueSection] of [['en', 'films', 'cinemas'], ['es', 'peliculas', 'cines'], ['ca', 'pellicules', 'cinemes']]) {
          for (const path of [`/${lang}/${filmSection}/${slug}/`, `/${lang}/${venueSection}/mooby-aribau/`]) {
            const response = await page.goto(base + path, {waitUntil: 'load'});
            assert.equal(response.status(), 200);
            const copy = page.locator('.screening-context');
            const disclosure = page.locator('.site-footer > details.site-information');
            assert.equal(await page.locator('main .screening-context').count(), 0);
            assert.equal(await copy.count(), 1);
            assert.equal(await copy.isVisible(), false);
            assert.equal(await disclosure.getAttribute('open'), null);
            assert.equal(await page.locator('h1').count(), 1);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            const originalMainHeight = await page.locator('main').evaluate(el => el.getBoundingClientRect().height);
            if (lang === 'en' && javaScriptEnabled) {
              await page.screenshot({path: `${output}/${path.includes('/films/') ? 'film' : 'cinema'}-${width}-closed.png`});
            }
            await disclosure.locator('summary').focus();
            await page.keyboard.press('Enter');
            assert.equal(await copy.isVisible(), true);
            assert.equal(await page.locator('main').evaluate(el => el.getBoundingClientRect().height), originalMainHeight);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            assert.ok(await copy.locator('a.screening-action').count() > 0);
            assert.ok(await copy.locator('a[href*="/gui"]').count() > 0);
            if (lang === 'en' && javaScriptEnabled && path.includes('/films/')) {
              await copy.scrollIntoViewIfNeeded();
              await page.screenshot({path: `${output}/film-${width}-expanded.png`});
              const action = copy.locator('a.screening-action').first();
              const hash = new URL(await action.getAttribute('href'), base).hash;
              await action.click();
              await page.waitForSelector('#filmDialog[open]');
              assert.equal(new URL(page.url()).hash, hash);
              assert.equal(await page.locator('#filmDialog .buyrow.is-highlighted').count(), 1);
              await page.keyboard.press('Escape');
            }
            results.push({path, width, javaScriptEnabled, collapsed: true, overflow: false});
          }
        }
        await page.goto(base + '/en/', {waitUntil: 'load'});
        assert.equal(await page.locator('.screening-context').count(), 0);
        assert.equal(await page.locator('.site-nav').isVisible(), false);
      }
      await context.close();
    }
    fs.writeFileSync(`${output}/report.json`, JSON.stringify(results, null, 2));
    console.log(`Passed ${results.length} film/cinema checks across three languages, mobile/desktop and JavaScript on/off; screening actions and homepage verified.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
