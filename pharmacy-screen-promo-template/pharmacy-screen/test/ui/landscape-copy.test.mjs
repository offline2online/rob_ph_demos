// Landscape (in-store) wording on the screen page (28 Nov 2026), in headless Chromium on mock data: Morning and
// Afternoon in landscape play the in-store wording ("Our services", "Speak to your pharmacist", "Ask us this
// morning", …) and never ask the viewer to walk in; portrait plays today's wording exactly; Sales Promos, Seasonal
// and Closed read the same in both orientations.
//   npm run test:ui     (uses the sandbox's preinstalled Playwright/Chromium; CHROMIUM_PATH for another binary)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { serve } from '../../tools/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let server, browser, base;
before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}/pharmacy-screen.html`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser.close(); server.close(); });

const COME_IN = /\b(walk in|pop in|drop in|come in|visit us|on your way|ask in store)\b/i;

// Every scene's text of one promotion for Beaumaris (DEVICE-VIC-MP-001), and the copy-fit audit's problems.
async function scenes(promo, orientation) {
  const land = orientation === 'landscape';
  const ctx = await browser.newContext({ viewport: land ? { width: 960, height: 540 } : { width: 540, height: 960 } });
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}?mockapi=1&device=DEVICE-VIC-MP-001&orientation=${orientation}&promo=${promo}&scene=0&now=wed-10:00&date=2027-06-02`);
    await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.ready);
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(async (promo) => {
      const out = [];
      const n = window.pharmacyScreen.info.scenes.length;
      for (let i = 0; i < n; i++) {
        window.pharmacyScreen.show(promo, i);
        await window.pharmacyScreen.settled();
        const t = (sel) => [...document.querySelectorAll(`#screen ${sel}`)].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | ');
        out.push({ h2: t('h2'), acc: t('.s-head p'), title: t('.s-title'), sub: t('.s-sub'), all: document.getElementById('screen').textContent.replace(/\s+/g, ' '), problems: window.pharmacyScreen.audit() });
      }
      return out;
    }, promo);
  } finally { await ctx.close(); }
}

test('landscape Morning and Afternoon play the in-store wording, and nothing asks the viewer to walk in', async () => {
  const m = await scenes('morning', 'landscape');
  const intro = m[0], close = m[m.length - 1];
  assert.equal(intro.title, 'Our services');
  assert.equal(intro.sub, 'Speak to your pharmacist');
  assert.match(close.h2, /Speak to your pharmacist/);
  assert.match(close.acc, /We're here to help/);
  assert.equal(close.title, 'Ask us about any of these services');
  assert.equal(close.sub, 'Trusted local care since 1952');
  assert.ok(m.some((s) => s.sub === 'Ask us this morning'), JSON.stringify(m.map((s) => s.sub)));
  const a = await scenes('afternoon', 'landscape');
  assert.ok(a.some((s) => s.sub === 'Talk to us today'), JSON.stringify(a.map((s) => s.sub)));
  assert.ok(a.some((s) => /Ask us to book/.test(s.acc)), JSON.stringify(a.map((s) => s.acc)));
  for (const s of [...m, ...a]) {
    assert.doesNotMatch(s.all, COME_IN);
    assert.deepEqual(s.problems, [], `${s.h2}: ${s.problems.join('; ')}`);
  }
  // the greeting is unchanged
  assert.match(intro.h2, /Good morning/);
});

test('portrait Morning and Afternoon play exactly the wording they did before', async () => {
  const m = await scenes('morning', 'portrait');
  assert.equal(m[0].title, 'Three reasons to walk in');
  assert.equal(m[0].sub, 'No fuss. Just ask in store.');
  const close = m[m.length - 1];
  assert.match(close.h2, /Walk in today/);
  assert.match(close.acc, /Speak directly with a pharmacist/);
  assert.equal(close.title, 'We look forward to seeing you');
  assert.ok(m.some((s) => s.sub === 'Pop in this morning'));
  const a = await scenes('afternoon', 'portrait');
  assert.ok(a.some((s) => s.sub === 'Talk to us on your way home'));
  assert.ok(a.some((s) => /Ask in store to book/.test(s.acc)));
});

test('Sales Promos, Seasonal and Closed read the same in both orientations', async () => {
  for (const promo of ['sale', 'occasions', 'closed']) {
    const p = await scenes(promo, 'portrait'), l = await scenes(promo, 'landscape');
    assert.deepEqual(l.map((s) => [s.h2, s.title, s.sub]), p.map((s) => [s.h2, s.title, s.sub]), promo);
  }
});
