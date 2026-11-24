// Every campaign holds its last frame, in portrait and in landscape: each promotion on the mock data (Morning,
// Afternoon, Closed, the custom-template demo) and the Seasonal promotion in the Fallback and in each of its six
// seasons, plus the Seasonal promotion on the config API's published shape (what a live screen reads). Each one is
// played through on real time, then checked twice, 3 s apart: held on its last scene (Seasonal: its last beat),
// fully drawn, and the frame is not a black screen.
//   npm run test:ui     (uses the sandbox's preinstalled Playwright/Chromium; CHROMIUM_PATH for another binary)
//
// Real time, not page.clock: the Seasonal beats are CSS animations, so this is what a player shows. The cases of one
// orientation play side by side, so the whole file takes about 40 s.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { serve } from '../../tools/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { buildScreenConfig } = require('../../config-api/src/publish.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/config.json'), 'utf8'));

// The Seasonal promotion by date: the Fallback outside every season, then a day inside each season's default dates.
const SEASONS = [
  ['fallback', '2026-07-01'], ['christmas', '2026-12-20'], ['new-year', '2026-12-30'], ['australia-day', '2027-01-26'],
  ['valentines-day', '2027-02-14'], ['easter', '2027-03-28'], ['anzac-day', '2027-04-25'],
];
const CASES = [
  ...['morning', 'afternoon', 'closed', 'custom-demo'].map((p) => ({ name: p, query: `promo=${p}&now=wed-12:00` })),
  ...SEASONS.map(([occasion, date]) => ({ name: occasion, occasion, query: `promo=occasions&date=${date}` })),
];

let server, browser, base;
before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}/pharmacy-screen.html`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser.close(); server.close(); });

/** The share of a PNG's pixels that are near black (r + g + b < 30). Decodes 8-bit RGB/RGBA, the screenshot format. */
function darkShare(png) {
  let p = 8, w = 0, h = 0, ch = 4;
  const idat = [];
  while (p < png.length) {
    const len = png.readUInt32BE(p), type = png.toString('ascii', p + 4, p + 8), d = png.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ch = d[9] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch;
  let prev = Buffer.alloc(stride), dark = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      line[x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    for (let x = 0; x < stride; x += ch) if (line[x] + line[x + 1] + line[x + 2] < 30) dark++;
    prev = line;
  }
  return dark / (w * h);
}

/** What the screen shows: playback state, the copy on screen with its effective opacity, and how dark the frame is. */
async function frame(page) {
  const i = await page.evaluate(() => window.pharmacyScreen.info);
  const drawn = await page.evaluate(() => {
    const el = document.getElementById('screen');
    const opacity = (n) => { let o = 1; for (let x = n; x && x !== el.parentElement; x = x.parentElement) o *= +getComputedStyle(x).opacity; return o; };
    const beats = [...el.querySelectorAll('.occ .txt .b')].map(opacity);
    const copy = [...el.querySelectorAll('*')].filter((n) => !n.childElementCount && n.closest('style') === null && n.tagName !== 'STYLE' && n.textContent.trim() && opacity(n) > 0.9).length;
    return { leaving: el.classList.contains('leaving'), beats, copy };
  });
  return { scene: i.scene, held: i.held, occasion: i.occasion, scenes: i.scenes.length, ...drawn, dark: darkShare(await page.screenshot()) };
}

/** Open one campaign, play it through on real time, and read its frame as it holds, then again 3 s later. */
async function playAndHold(query, orientation, route) {
  const viewport = orientation === 'landscape' ? { width: 960, height: 540 } : { width: 540, height: 960 };
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (route) await route(page);
  await page.goto(`${base}?device=TEST&orientation=${orientation}&${query}`);
  await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.ready && window.pharmacyScreen.info, null, { timeout: 20000 });
  const first = await page.evaluate(() => window.pharmacyScreen.info);
  await page.waitForFunction(() => window.pharmacyScreen.info.held, null, { timeout: 60000, polling: 200 });
  await page.waitForTimeout(1200); // the last scene's entrance (under 1 s) has finished
  const atHold = await frame(page);
  await page.waitForTimeout(3000);
  const later = await frame(page);
  await ctx.close();
  return { first, atHold, later, errors };
}

/** The checks every campaign must pass: held on its last scene or beat, fully drawn, not black, and still so 3 s on. */
function assertHeld(label, r, occasion) {
  assert.deepEqual(r.errors, [], `${label}: no page errors`);
  assert.equal(r.first.held, false, `${label}: not held before it has played`);
  for (const [when, f] of [['when held', r.atHold], ['3 s later', r.later]]) {
    const at = `${label} ${when}`;
    assert.equal(f.held, true, `${at}: held`);
    if (occasion) {
      assert.equal(f.occasion, occasion, `${at}: plays ${occasion}`);
      assert.ok(f.beats.length >= 2, `${at}: beats drawn`);
      assert.ok(f.beats[f.beats.length - 1] > 0.9, `${at}: the last beat is on screen (${f.beats})`);
      // The Fallback builds up (all three stay); a season shows its last beat alone.
      if (occasion === 'fallback') assert.ok(f.beats.every((o) => o > 0.9), `${at}: every Fallback beat on screen (${f.beats})`);
      else assert.ok(f.beats.slice(0, -1).every((o) => o < 0.1), `${at}: only the last beat (${f.beats})`);
    } else {
      assert.equal(f.scene, f.scenes - 1, `${at}: on the last scene`);
      assert.equal(f.leaving, false, `${at}: no leaving fade`);
    }
    assert.ok(f.copy > 0, `${at}: copy on screen`);
    assert.ok(f.dark < 0.5, `${at}: not a black screen (${Math.round(f.dark * 100)}% black)`);
  }
}

for (const orientation of ['portrait', 'landscape']) {
  test(`every campaign holds its last frame, drawn and not black (${orientation}, mock data)`, async () => {
    const results = await Promise.all(CASES.map((c) => playAndHold(`mockapi=1&${c.query}`, orientation)));
    CASES.forEach((c, k) => assertHeld(`${orientation} ${c.name}`, results[k], c.occasion));
  });
}

// The Seasonal promotion as a live screen reads it: the store's data and the config API's published config (its
// publishedSeason template: the Fallback) answered by routes, no mockapi.
test('the Seasonal promotion on the published config holds the Fallback and a season, portrait and landscape', async () => {
  const campaign = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/campaign-data.json'), 'utf8'));
  const { trimCampaignData } = require('../../ph-proxy/src/location-proxy.js');
  const ph = CONFIG.pharmacies.find((p) => p.storeCode === 'VIC-MP-001');
  const promos = [{ id: 'rec-occasions', promoId: 'occasions', name: 'Seasonal', templateId: 'builtin-occasion-fallback' }];
  const published = buildScreenConfig({ storeCode: ph.storeCode, name: ph.name, colours: { primary: ph.brand.p, accent: ph.brand.a }, logo: null, content: { 'rec-occasions': ph.content.occasions } }, promos, [], '2026-11-20T00:00:00.000Z');
  const route = (page) => page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()).pathname;
    if (/^\/api\/device\/TEST\/campaign_data$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: trimCampaignData(campaign.devices.TEST.data), meta: { server: 'https://ph.example', fetchedAt: new Date().toISOString() } }) });
    if (u.startsWith('/api/screens/')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(published) });
    return r.fulfill({ status: 404, body: 'no route' });
  });
  const runs = [];
  for (const orientation of ['portrait', 'landscape']) for (const [occasion, date] of [SEASONS[0], SEASONS[1]]) runs.push({ orientation, occasion, date });
  const results = await Promise.all(runs.map((x) => playAndHold(`promo=occasions&date=${x.date}`, x.orientation, route)));
  runs.forEach((x, k) => assertHeld(`published ${x.orientation} ${x.occasion}`, results[k], x.occasion));
});
