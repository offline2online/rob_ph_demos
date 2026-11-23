// A lighter screen, in headless Chromium on the repo's own files:
//   - a scene's fitted copy is kept per content signature, so showing it again (the loop's next pass) sets the same
//     sizes without running the fit loop, and changed content is fitted afresh;
//   - the icon font, cut down to the editor's icons (tools/subset-icons.py), still draws them as icons;
//   - the page asks for no Seasonal stylesheet and no debug stylesheet while a Morning promotion plays.
//   npm run test:ui     (uses the sandbox's preinstalled Playwright/Chromium; CHROMIUM_PATH for another binary)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { serve } from '../../tools/serve.mjs';
import { ICONS } from '../../admin/js/icons.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let server, browser, base, hits;
before(async () => {
  hits = {};
  server = await serve(0, undefined, hits);
  base = `http://127.0.0.1:${server.address().port}/pharmacy-screen.html?mockapi=1&device=DEVICE-VIC-MP-001&now=wed-12:00`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser.close(); server.close(); });

async function open(q) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
  const page = await ctx.newPage();
  await page.goto(`${base}&${q}`);
  await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.info);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

test('a scene shown again reuses its fitted sizes; changed content is fitted again', async () => {
  const { ctx, page } = await open('promo=morning&orientation=portrait&scene=0');
  try {
    const r = await page.evaluate(async () => {
      const { fitMemoStats } = await import('./js/render.js');
      const run = () => {
        const out = [];
        const n = window.pharmacyScreen.show('morning', 0).scenes.length;
        for (let i = 0; i < n; i++) {
          const info = window.pharmacyScreen.show('morning', i);
          const head = document.querySelector('.s-head'), body = document.querySelector('.s-body');
          out.push({ fit: info.fit, k: head && head.style.getPropertyValue('--k'), kb: body && body.style.getPropertyValue('--kb'), problems: window.pharmacyScreen.audit() });
        }
        return out;
      };
      const first = run();
      const before = { ...fitMemoStats };
      const second = run();
      const after = { ...fitMemoStats };
      return { first, second, before, after };
    });
    assert.ok(r.first.length >= 3);
    assert.deepEqual(r.second, r.first, 'the same sizes, the same fit result, the same audit');
    assert.equal(r.after.misses, r.before.misses, 'no scene ran the fit loop on the second pass');
    assert.equal(r.after.hits - r.before.hits, r.first.length + 1, 'every scene, and the first again for the scene count');
    for (const s of r.first) assert.deepEqual(s.problems, []);

    // Different copy is a different signature: fitted afresh.
    const fresh = await page.evaluate(async () => {
      const { fitMemoStats } = await import('./js/render.js');
      const m = fitMemoStats.misses;
      window.pharmacyScreen.show('afternoon', 0);
      return fitMemoStats.misses - m;
    });
    assert.equal(fresh, 1);
  } finally { await ctx.close(); }
});

test('the cut-down icon font draws the editor\'s icons and the screen\'s own as icons', async () => {
  const { ctx, page } = await open('promo=morning&orientation=portrait&scene=0');
  try {
    const sample = ['tv_off', 'local_pharmacy', 'vaccines', 'medication', 'pill', 'favorite', ICONS[0], ICONS[ICONS.length - 1]];
    const widths = await page.evaluate(async (names) => {
      await document.fonts.load('100px "Material Symbols Outlined"', names.join(''));
      const box = document.createElement('div');
      box.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden';
      document.body.appendChild(box);
      return names.map((n) => {
        const s = document.createElement('span');
        s.className = 'ms';
        s.style.fontSize = '100px';
        s.textContent = n;
        box.appendChild(s);
        return [n, s.getBoundingClientRect().width];
      });
    }, sample);
    // A ligature is one glyph, 1em wide; an icon the font lacks would be its name spelled out.
    for (const [n, w] of widths) assert.ok(w > 80 && w < 130, `${n} draws ${w}px wide`);
  } finally { await ctx.close(); }
});

test('a Morning promotion loads neither the Seasonal stylesheets nor the debug panel\'s', async () => {
  for (const k of Object.keys(hits)) delete hits[k];
  const { ctx, page } = await open('promo=morning&orientation=landscape');
  try {
    await page.evaluate(() => window.pharmacyScreen.settled());
    const asked = Object.keys(hits);
    assert.ok(asked.includes('css/screen.css') && asked.includes('js/player.js'));
    assert.deepEqual(asked.filter((f) => /occasion-|debug/.test(f)), []);
  } finally { await ctx.close(); }
  for (const k of Object.keys(hits)) delete hits[k];
  const dbg = await open('promo=morning&orientation=landscape&debug=1');
  try {
    await dbg.page.waitForSelector('.dbg');
    assert.ok(Object.keys(hits).includes('css/debug.css'), 'debug=1 loads the panel\'s stylesheet, with Roboto');
    assert.equal(await dbg.page.evaluate(async () => { await document.fonts.load('14px Roboto'); return document.fonts.check('14px Roboto'); }), true);
  } finally { await dbg.ctx.close(); }
});
