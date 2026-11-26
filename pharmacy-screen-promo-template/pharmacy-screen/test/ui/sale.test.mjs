// The Sales Promos screen (promo=sale) in headless Chromium, on mock data: both scenes in portrait and landscape with
// nothing leaving its box (the default four brands, six long brand names, one brand), the loop playing scene 1, the
// offer and back, the value counting up from 0, reduced motion, and Morning / Afternoon after the end date.
//   npm run test:ui     (uses the sandbox's preinstalled Playwright/Chromium; CHROMIUM_PATH for another binary)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { serve } from '../../tools/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'config.json'), 'utf8'));

let server, browser, base;
before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}/pharmacy-screen.html`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser.close(); server.close(); });

// The mock config with Beaumaris's sale copy changed by `sale`.
function configWith(sale) {
  const c = JSON.parse(JSON.stringify(FIXTURE));
  const ph = c.pharmacies.find((p) => p.storeCode === 'VIC-MP-001');
  ph.content.sale = { sale: { ...ph.content.sale.sale, ...sale } };
  return c;
}

async function screen(query, { orientation = 'portrait', sale, reducedMotion } = {}) {
  const land = orientation === 'landscape';
  const ctx = await browser.newContext({ viewport: land ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 }, reducedMotion });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (sale) await page.route('**/fixtures/config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(configWith(sale)) }));
  await page.goto(`${base}?mockapi=1&device=TEST&promo=sale&orientation=${orientation}&${query}`);
  await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.ready);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page, errors };
}

// Both scenes held, as drawn after their entrance: what leaves its box, and the sizes the fit settled on.
async function scenes(page) {
  return page.evaluate(async () => {
    const out = [];
    for (const i of [0, 1]) {
      const info = window.pharmacyScreen.show('sale', i);
      await window.pharmacyScreen.settled();
      const el = document.getElementById('screen');
      const cards = [...el.querySelectorAll('.sl-card')].map((c) => { const n = c.querySelector('.sl-nm'); return { name: n.textContent, fits: n.offsetWidth <= c.clientWidth - 47 }; });
      const valw = el.querySelector('.sl-valw');
      out.push({ base: info.base, scene: info.scene, problems: window.pharmacyScreen.audit(), fit: info.fit, cards, val: valw ? valw.offsetWidth : 0,
        offerFits: (() => { const o = el.querySelector('.sl-offer'); if (!o) return true; const r = o.getBoundingClientRect(), s = el.getBoundingClientRect(); return [...o.querySelectorAll('.sl-lead,.sl-valw,.sl-suf,.sl-panel,.sl-brands')].every((x) => { const b = x.getBoundingClientRect(); return b.left >= s.left - 1 && b.right <= s.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1; }); })() });
    }
    return out;
  });
}

const LONG = ['ELIZABETH ARDEN SKINCARE', 'LA ROCHE-POSAY DERMATOLOGY', 'NATURE\'S WAY KIDS SMART', 'BLACKMORES SUPERIOR', 'SWISSE ULTIVITE DAILY', 'NEUTROGENA HYDRO BOOST'];

for (const orientation of ['portrait', 'landscape']) {
  for (const [what, sale] of [['four brands', null], ['six long brand names', { brands: LONG, value: 99, caption: 'Six big brands, every one of them on sale this week only' }], ['one brand', { brands: ['TOSHI'], value: 5 }]]) {
    test(`${orientation}, ${what}: both scenes fit (headline in the wedge, cards and names, the offer, the footer)`, async () => {
      const { ctx, page, errors } = await screen('date=2026-11-30&scene=0', { orientation, sale: sale || undefined });
      const [s1, s2] = await scenes(page);
      assert.deepEqual([s1.base, s1.scene, s2.scene], ['sale', 0, 1]);
      assert.deepEqual(s1.problems, [], 'scene 1');
      assert.deepEqual(s2.problems, [], 'scene 2');
      assert.ok(s1.fit.ok && s1.fit.okb, JSON.stringify(s1.fit));
      assert.equal(s1.cards.length, sale ? sale.brands.length : 4);
      for (const c of s1.cards) assert.ok(c.fits, `${c.name} fits its card`);
      assert.ok(s2.offerFits && s2.fit.ok2, JSON.stringify(s2.fit));
      if (orientation === 'portrait') assert.ok(s2.val <= 1080 * 0.8 + 1 && s2.val >= 1080 * (sale && sale.value === 5 ? 0.3 : 0.5), `the value is ${s2.val}px wide`);
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  }
}

test('playback: scene 1, the transition into the offer, the value counting up from 0, and (loop=1) back to scene 1', async () => {
  const { ctx, page, errors } = await screen('date=2026-11-30&loop=1');
  assert.equal(await page.evaluate(() => window.pharmacyScreen.info.scene), 0);
  assert.deepEqual(await page.evaluate(() => window.pharmacyScreen.info.scenes), ['The brands', 'The offer']);
  await page.waitForFunction(() => window.pharmacyScreen.info.scene === 1, null, { timeout: 6000 });
  // The wedge slides over the screen (transform only) and the value starts from 0.
  assert.equal(await page.$eval('#screen .sl-wedge', (e) => getComputedStyle(e).animationName), 'slGrow');
  assert.equal(await page.$eval('#screen .sl-val', (e) => e.textContent), '0');
  await page.waitForFunction(() => document.querySelector('#screen .sl-val').textContent === '30', null, { timeout: 4000 });
  await page.waitForFunction(() => window.pharmacyScreen.info.scene === 0, null, { timeout: 9000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('played once (the player\'s default) it holds the offer at the end', async () => {
  const { ctx, page } = await screen('date=2026-11-30');
  await page.waitForFunction(() => window.pharmacyScreen.info.held, null, { timeout: 14000 });
  assert.equal(await page.evaluate(() => window.pharmacyScreen.info.scene), 1);
  assert.equal(await page.$eval('#screen .sl-val', (e) => e.textContent), '30');
  await ctx.close();
});

test('reduced motion: no animation, everything drawn at once, the value at its number', async () => {
  const { ctx, page } = await screen('date=2026-11-30&scene=1', { reducedMotion: 'reduce' });
  assert.equal(await page.$eval('#screen .sl-val', (e) => e.textContent), '30');
  assert.deepEqual(await page.$$eval('#screen .sl *', (els) => [...new Set(els.map((e) => getComputedStyle(e).animationName).filter((n) => n !== 'none'))]), []);
  assert.equal(await page.$eval('#screen .sl-wedge', (e) => getComputedStyle(e).transform), 'none', 'the brand colour fills the screen');
  await ctx.close();
});

test('after the end date the screen shows Morning before 12:00 and Afternoon after, and the sale again with a later date', async () => {
  for (const [q, want] of [['date=2026-12-02&now=wed-23:00', 'sale'], ['date=2026-12-03&now=thu-09:30', 'morning'], ['date=2026-12-03&now=thu-13:00', 'afternoon']]) {
    const { ctx, page } = await screen(q);
    const info = await page.evaluate(() => window.pharmacyScreen.info);
    assert.equal(info.promo, want, q);
    assert.equal(info.endedSale, want === 'sale' ? null : 'sale', q);
    await ctx.close();
  }
  const { ctx, page } = await screen('date=2026-12-03&now=thu-09:30', { sale: { endDate: '2026-12-10' } });
  assert.equal(await page.evaluate(() => window.pharmacyScreen.info.promo), 'sale');
  await ctx.close();
});
