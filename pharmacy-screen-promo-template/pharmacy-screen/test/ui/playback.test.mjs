// Playback on the player, in headless Chromium on the mock data (mockapi=1): a promotion plays once through and then
// stays on its last scene (a Seasonal promotion: its last beat) until the next campaign loads; it plays from the
// start again when the page is loaded or shown again, or a season changes at midnight; loop=1 loops as before.
//   npm run test:ui     (uses the sandbox's preinstalled Playwright/Chromium; CHROMIUM_PATH for another binary)
//
// The page's timers run on Playwright's fake clock (page.clock), so a 30 s hold takes no real time. The Seasonal
// beats are CSS animations, which run on real time: their timing is read from the Web Animations API, and finish()
// jumps a beat to its end. config.json is answered from a copy here, so each test sets the copy it plays.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { serve } from '../../tools/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/config.json'), 'utf8'));
const copy = (d) => JSON.parse(JSON.stringify(d));

let server, browser, base;
before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}/pharmacy-screen.html`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser.close(); server.close(); });

/** The mock config with the TEST store's (VIC-MP-001) Seasonal beats set: beats[season] = [{text?, label?, dur?}]. */
function withBeats(beats) {
  const cfg = copy(CONFIG);
  const occ = cfg.pharmacies.find((p) => p.storeCode === 'VIC-MP-001').content.occasions.occasions;
  for (const [season, list] of Object.entries(beats)) {
    const saved = occ[season] || { beats: [] };
    occ[season] = { beats: list.map((b, i) => { const x = { ...(saved.beats[i] || {}), ...b }; if (!('dur' in b)) delete x.dur; return x; }) };
  }
  return cfg;
}
/** Every season at its default timings (no beat seconds set), with no dates of its own. */
function defaults() {
  const cfg = copy(CONFIG);
  const occ = cfg.pharmacies.find((p) => p.storeCode === 'VIC-MP-001').content.occasions.occasions;
  for (const s of Object.values(occ)) { delete s.from; delete s.to; for (const b of s.beats || []) delete b.dur; }
  return cfg;
}

/** The screen on mock data, its clock faked from `time`; `api.config` (changeable mid-test) answers config.json. */
async function open(query, api, { time, viewport = { width: 540, height: 960 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/fixtures/config.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(api.config) }));
  await page.clock.install(time ? { time: new Date(time) } : {});
  await page.goto(`${base}?mockapi=1&device=TEST&${query}`);
  await until(page, () => window.pharmacyScreen && window.pharmacyScreen.info);
  return { page, ctx, errors };
}
// Fake time in small steps with real time between them, so a poll's (real) fixture answer arrives in between.
async function pass(page, ms, step = 2000) {
  for (let t = 0; t < ms; t += step) {
    await page.clock.runFor(Math.min(step, ms - t));
    await new Promise((r) => setTimeout(r, 30));
  }
}
async function until(page, fn, arg) {
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(fn, arg)) return;
    await page.clock.runFor(100);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met: ' + fn);
}
const info = (page) => page.evaluate(() => window.pharmacyScreen.info);
/** Step the clock until the promotion holds (max 120 s), returning every scene it showed, in order. */
async function playThrough(page) {
  const seen = [];
  for (let t = 0; t < 120000; t += 250) {
    const i = await info(page);
    if (seen[seen.length - 1] !== i.scene) seen.push(i.scene);
    if (i.held) return seen;
    await page.clock.runFor(250);
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never held: ' + JSON.stringify(seen));
}
/** The scene as drawn: the screen's classes, the headline and content opacity once the entrance has finished. */
async function drawn(page) {
  await new Promise((r) => setTimeout(r, 1200)); // the entrance animations run on real time (under 1 s)
  return page.evaluate(() => {
    const el = document.getElementById('screen');
    const op = (q) => { const n = el.querySelector(q); return n ? getComputedStyle(n).opacity : null; };
    return { leaving: el.classList.contains('leaving'), head: op('.s-head'), h2: op('.s-head h2'), body: op('.s-body'), foot: (el.querySelector('.s-foot') || {}).innerText };
  });
}
/** The Seasonal beats' animations: name, iterations, and each beat's opacity once every beat has finished. */
function beatsAtEnd(page) {
  return page.evaluate(() => {
    const occ = document.querySelector('#screen .occ');
    const beats = [...occ.querySelectorAll('.txt .b')];
    const anims = beats.map((b) => b.getAnimations()[0]);
    const timing = anims.map((a) => a && { name: a.animationName, iterations: a.effect.getComputedTiming().iterations });
    for (const a of anims) if (a && Number.isFinite(a.effect.getComputedTiming().iterations)) a.finish();
    const decorations = document.getAnimations().filter((a) => a.effect && a.effect.target && !a.effect.target.closest('.txt'));
    return {
      root: occ.className,
      timing,
      end: beats.map((b) => +getComputedStyle(b).opacity),
      decorationsMoving: decorations.length > 0 && decorations.every((a) => a.playState === 'running' && a.effect.getComputedTiming().iterations === Infinity),
    };
  });
}

test('1. promo=morning plays each scene once, then stays on the last scene, fully drawn, 30 s later still', async () => {
  const api = { config: copy(CONFIG) };
  const { page, ctx, errors } = await open('promo=morning&now=wed-12:00', api);
  const first = await info(page);
  assert.equal(first.playback, 'once');
  assert.equal(first.scene, 0);
  const n = first.scenes.length;
  assert.deepEqual(await playThrough(page), Array.from({ length: n }, (_, i) => i), 'every scene once, in order');
  await pass(page, 30000);
  const i = await info(page);
  assert.deepEqual([i.scene, i.held], [n - 1, true], 'still on the last scene');
  const d = await drawn(page);
  assert.deepEqual([d.leaving, d.head, d.h2, d.body], [false, '1', '1', '1'], 'no leaving fade: fully drawn');
  assert.match(await page.evaluate(() => document.getElementById('screen').innerText), /Walk in today/i);
  // The Opening hours promotion (Closed) holds its last headline the same way.
  await page.goto(`${base}?mockapi=1&device=TEST&promo=closed&now=wed-20:00`);
  await until(page, () => window.pharmacyScreen && window.pharmacyScreen.info);
  const m = (await info(page)).scenes.length;
  assert.deepEqual(await playThrough(page), Array.from({ length: m }, (_, k) => k));
  await pass(page, 30000);
  assert.deepEqual([(await info(page)).scene, (await drawn(page)).leaving], [m - 1, false]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('2. promo=occasions: the beats play once, the last beat stays visible (default and custom timings), decorations keep moving', async () => {
  // Christmas (two beats, the design's own keyframes), default timings.
  let api = { config: defaults() };
  let { page, ctx, errors } = await open('promo=occasions&date=2026-07-01', api);
  let s = await beatsAtEnd(page);
  assert.equal(s.root, 'occ occ-christmas once');
  assert.deepEqual(s.timing, [{ name: 'xmasB1', iterations: 1 }, { name: 'xmasB2Once', iterations: 1 }]);
  assert.deepEqual(s.end, [0, 1], 'the first beat has gone, the last stays');
  assert.equal(s.decorationsMoving, true);
  assert.equal((await info(page)).held, false);
  await pass(page, 12000);
  assert.equal((await info(page)).held, true, 'held once 12 s have played');
  await pass(page, 30000);
  assert.equal((await info(page)).held, true);
  await ctx.close();

  // A three-beat design (Valentine's Day, in its dates), default timings.
  ({ page, ctx } = await open('promo=occasions&date=2027-02-14', api));
  s = await beatsAtEnd(page);
  assert.equal(s.root, 'occ occ-valentine once');
  assert.deepEqual(s.timing.map((t) => [t.name, t.iterations]), [['occB1', 1], ['occB2', 1], ['occB3Once', 1]]);
  assert.deepEqual(s.end, [0, 0, 1]);
  assert.equal(s.decorationsMoving, true);
  await ctx.close();

  // Custom beat seconds (3 s + 4 s): the generated keyframes end with the last beat visible.
  api = { config: withBeats({ christmas: [{ dur: 3 }, { dur: 4 }] }) };
  ({ page, ctx, errors } = await open('promo=occasions&date=2026-07-01', api));
  s = await beatsAtEnd(page);
  assert.equal(s.root, 'occ occ-christmas once');
  assert.deepEqual(s.timing, [{ name: 'occTo3_4B1', iterations: 1 }, { name: 'occTo3_4B2', iterations: 1 }]);
  assert.deepEqual(s.end, [0, 1]);
  assert.equal(s.decorationsMoving, true);
  await pass(page, 7000);
  assert.equal((await info(page)).held, true, 'held once its 7 s have played');
  // New data while held: redrawn in place, still on the last beat (the beats don't start again).
  api.config = withBeats({ christmas: [{ dur: 3 }, { dur: 4, text: 'from all of us at ${StoreName}' }] });
  await pass(page, 20000);
  await until(page, () => /from all of us at/.test(document.querySelector('#screen .b2').textContent));
  const redrawn = await page.evaluate(() => [...document.querySelectorAll('#screen .txt .b')].map((b) => +getComputedStyle(b).opacity));
  assert.deepEqual(redrawn, [0, 1], 'the redrawn last beat is on screen at once');
  assert.equal((await info(page)).held, true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('3. shown again after being hidden, restored from the back-forward cache, or reloaded: playback starts from the first scene', async () => {
  const api = { config: defaults() };
  const { page, ctx, errors } = await open('promo=morning&now=wed-12:00', api);
  await playThrough(page);
  assert.equal((await info(page)).held, true);
  await page.evaluate(() => {
    let state = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
    window.__setVisibility = (v) => { state = v; document.dispatchEvent(new Event('visibilitychange')); };
  });
  await page.evaluate(() => window.__setVisibility('hidden'));
  assert.equal((await info(page)).held, true, 'hiding the page changes nothing on screen');
  await page.evaluate(() => window.__setVisibility('visible'));
  let i = await info(page);
  assert.deepEqual([i.scene, i.held], [0, false], 'shown again: from the first scene');
  assert.equal(await page.evaluate(() => document.getElementById('screen').classList.contains('enter')), true);
  await playThrough(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  i = await info(page);
  assert.deepEqual([i.scene, i.held], [0, false], 'restored from the back-forward cache: from the first scene');
  await playThrough(page);
  await page.reload();
  await until(page, () => window.pharmacyScreen && window.pharmacyScreen.info);
  i = await info(page);
  assert.deepEqual([i.scene, i.held], [0, false], 'reloaded: from the first scene');

  // A Seasonal promotion: its beats start again from the first.
  await page.goto(`${base}?mockapi=1&device=TEST&promo=occasions&date=2026-07-01`);
  await until(page, () => window.pharmacyScreen && window.pharmacyScreen.info);
  await pass(page, 13000);
  assert.equal((await info(page)).held, true);
  await page.evaluate(() => {
    let state = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    window.__setVisibility = (v) => { state = v; document.dispatchEvent(new Event('visibilitychange')); };
    window.__occ = document.querySelector('#screen .occ');
    window.__setVisibility('hidden');
    window.__setVisibility('visible');
  });
  const again = await page.evaluate(() => ({ fresh: document.querySelector('#screen .occ') !== window.__occ, t: document.querySelector('#screen .b1').getAnimations()[0].currentTime, held: window.pharmacyScreen.info.held }));
  assert.equal(again.fresh, true);
  assert.ok(again.t < 1000, 'beat 1 from its start');
  assert.equal(again.held, false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('3b. a season that changes at midnight plays from its first beat', async () => {
  // 23:59:30 on 27 December in Melbourne (UTC+11): Christmas, then New Year's from midnight.
  const api = { config: defaults() };
  const { page, ctx, errors } = await open('promo=occasions', api, { time: '2026-12-27T12:59:30Z' });
  assert.equal((await info(page)).occasion, 'christmas');
  await pass(page, 14000);
  assert.equal((await info(page)).held, true);
  await pass(page, 20000);
  await until(page, () => window.pharmacyScreen.info.occasion === 'new-year');
  const i = await info(page);
  assert.equal(i.held, false);
  const s = await page.evaluate(() => ({ root: document.querySelector('#screen .occ').className, t: document.querySelector('#screen .b1').getAnimations()[0].currentTime }));
  assert.equal(s.root, 'occ occ-newyear once');
  assert.ok(s.t < 1000, 'from its first beat');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('4. held on the last scene, the Open today bar follows the store\'s clock without restarting the scene', async () => {
  // Wednesday 18:29:05 in Melbourne (UTC+10): open until 7pm; at 18:30 the bar turns to "Closing soon".
  const api = { config: copy(CONFIG) };
  const { page, ctx, errors } = await open('promo=morning&debug=1', api, { time: '2026-07-01T08:29:05Z' });
  const n = (await info(page)).scenes.length;
  await playThrough(page);
  assert.match((await drawn(page)).foot, /OPEN TODAY UNTIL 7PM/i);
  await page.evaluate(() => { window.__shows = 0; new MutationObserver(() => { window.__shows++; }).observe(document.getElementById('screen'), { childList: true }); });
  await pass(page, 60000, 1000);
  const i = await info(page);
  assert.deepEqual([i.scene, i.held, i.state], [n - 1, true, 'closing'], 'still the last scene, now in the last 30 minutes');
  const d = await drawn(page);
  assert.match(d.foot, /CLOSING SOON · 7PM/i);
  assert.deepEqual([d.leaving, d.head, d.body], [false, '1', '1']);
  assert.equal(await page.evaluate(() => document.getElementById('screen').classList.contains('enter')), false, 'redrawn in place, no entrance');
  assert.equal(await page.evaluate(() => window.__shows), 1, 'redrawn once, at the minute the message changed');
  assert.match(await page.locator('.dbg').innerText(), /Last 30 minutes/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('5. loop=1 loops as before', async () => {
  const api = { config: defaults() };
  let { page, ctx, errors } = await open('promo=morning&now=wed-12:00&loop=1', api);
  const first = await info(page);
  assert.equal(first.playback, 'loop');
  const n = first.scenes.length;
  const seen = [];
  let leaving = false;
  for (let t = 0; t < 40000 && seen.length < n + 2; t += 125) {
    const s = (await info(page)).scene;
    if (seen[seen.length - 1] !== s) seen.push(s);
    leaving = leaving || (await page.evaluate(() => document.getElementById('screen').classList.contains('leaving')));
    await page.clock.runFor(125);
  }
  assert.deepEqual(seen.slice(0, n + 1), [...Array.from({ length: n }, (_, i) => i), 0], 'back to the first scene after the last');
  assert.equal(leaving, true, 'each scene fades out as before');
  assert.equal((await info(page)).held, false);
  await ctx.close();

  ({ page, ctx, errors } = await open('promo=occasions&date=2026-07-01&loop=1', api));
  const s = await page.evaluate(() => ({ root: document.querySelector('#screen .occ').className, it: [...document.querySelectorAll('#screen .txt .b')].map((b) => b.getAnimations()[0].effect.getComputedTiming().iterations) }));
  assert.deepEqual(s, { root: 'occ occ-christmas', it: [Infinity, Infinity] });
  await pass(page, 40000);
  assert.equal((await info(page)).held, false);
  assert.deepEqual(errors, []);
  await ctx.close();
});
