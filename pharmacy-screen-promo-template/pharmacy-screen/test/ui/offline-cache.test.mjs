// The screen kept on the device, in headless Chromium against a copy staged, fingerprinted and stamped exactly as the
// deploy publishes it (scripts/deploy.mjs), served with the deploy's caching (tools/serve.mjs: assets/ immutable):
//   - with the service worker (sw.js): the second start downloads none of the page, scripts, stylesheets or fonts;
//     a deploy that changes nothing downloads nothing; a deploy that changes js/player.js is picked up by the
//     player's update check, which downloads sw.js, the page and that one script only, and the page reloads itself
//     onto it; with the server gone, the screen still starts and plays the promotion, a Seasonal one included;
//   - without it (nosw=1): the second load asks for the page only, never a script, stylesheet or font;
//   - a Morning promotion in landscape never loads the Seasonal stylesheets; the Seasonal promotion does, and shows
//     its fonts and the Christmas photo.
// The data is the seed fixtures (mockapi=1); sw=1 turns the worker on for a local server; now= pins the store's
// clock to a weekday noon and date= the season (Christmas), so the screen reads the same whatever day the suite runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { serve } from '../../tools/serve.mjs';
import { stage, stampServiceWorker, shellBuildId } from '../../../scripts/deploy.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SW_SOURCE = path.resolve(HERE, '../../sw.js');

let server, browser, pub, origin, hits;
before(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-offline-'));
  stage(undefined, out);
  pub = path.join(out, 'public');
  hits = {};
  server = await serve(0, pub, hits);
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser.close(); if (server.listening) { server.closeAllConnections(); server.close(); } });

const url = (q) => `${origin}/pharmacy-screen.html?mockapi=1&device=TEST&now=wed-12:00&date=2026-12-20&${q}`;
const morning = () => url('sw=1&promo=morning&orientation=portrait');
const reset = () => { for (const k of Object.keys(hits)) delete hits[k]; };
// Requests for the screen's own files (not the seed data, which is fetched like live data).
const shellHits = () => Object.keys(hits).filter((f) => !f.startsWith('fixtures/')).sort();
async function playing(page, promo = 'morning') {
  await page.waitForFunction((p) => window.pharmacyScreen && window.pharmacyScreen.info && window.pharmacyScreen.info.promo === p, promo, { timeout: 15000 });
  await page.evaluate(() => window.pharmacyScreen.settled());
  return page.evaluate(() => ({ logo: [...document.images].map((i) => i.alt), text: document.body.innerText }));
}
const shellCaches = (page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('pharmacy-screen-shell-')));
const occasionSheets = (page) => page.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.getAttribute('href')).filter((h) => /occasion-/.test(h)));
// A Seasonal promotion as drawn: its display font in use and the Christmas photo behind it.
const seasonal = (page) => page.evaluate(async () => {
  const occ = document.querySelector('.occ');
  const photo = occ ? getComputedStyle(occ).getPropertyValue('--occ-photo') : '';
  const fonts = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''));
  return { design: occ ? occ.className : '', photo: /\.jpg/.test(photo), fonts };
});

test('a Morning promotion in landscape loads no Seasonal stylesheet; the Seasonal promotion loads them and shows its fonts and photo', async () => {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  reset();
  await page.goto(url('promo=morning&orientation=landscape'));
  await playing(page);
  assert.deepEqual(await occasionSheets(page), []);
  assert.deepEqual(Object.keys(hits).filter((f) => /occasion-|\.jpg$/.test(f)), [], 'no Seasonal stylesheet, font or photo is downloaded');
  assert.ok(!Object.keys(hits).some((f) => /debug/.test(f)), 'nor the debug panel and its Roboto');
  // The page links only the small stylesheets; its fonts are .woff2 files.
  assert.ok(Object.keys(hits).some((f) => /^assets\/fonts\/[0-9a-f]{16}\.woff2$/.test(f)), 'the fonts come as their own files');

  await page.goto(url('promo=occasions&orientation=landscape'));
  await playing(page, 'occasions');
  assert.equal(await occasionSheets(page).then((s) => s.length), 2);
  const s = await seasonal(page);
  assert.match(s.design, /occ-christmas/);
  assert.ok(s.photo, 'the Christmas photo is set');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /\/assets\/media\/[0-9a-f]{16}\.jpg$/.test(e.name) && e.responseEnd > 0), null, { timeout: 10000 });
  assert.ok(Object.keys(hits).some((f) => /^assets\/media\/[0-9a-f]{16}\.jpg$/.test(f)), 'the photo is downloaded as a file');
  assert.ok(s.fonts.includes('Playfair Display'), `the Seasonal fonts are in (${s.fonts.join(', ')})`);
  await context.close();
});

test('without the service worker (nosw=1) a second load asks for the page only', async () => {
  const context = await browser.newContext({ viewport: { width: 540, height: 960 } });
  const page = await context.newPage();
  const u = url('nosw=1&promo=morning&orientation=portrait');
  await page.goto(u);
  await playing(page);
  reset();
  await page.goto(u);
  await playing(page);
  assert.deepEqual(shellHits(), ['pharmacy-screen.html'], 'scripts, stylesheets and fonts come from the browser cache without a request');
  await context.close();
});

test('cached start, only changed files downloaded after a deploy, and an offline start', async () => {
  const context = await browser.newContext({ viewport: { width: 540, height: 960 } });
  const page = await context.newPage();
  const build1 = shellBuildId(pub);

  // First start: the worker installs and downloads the shell into its build's cache.
  await page.goto(morning());
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
  const first = await playing(page);
  assert.ok(first.logo.includes('Beaumaris Pharmacy'), 'the Beaumaris morning promotion plays');
  assert.deepEqual(await shellCaches(page), [`pharmacy-screen-shell-${build1}`]);

  // Second start: nothing of the shell is downloaded again (sw.js may be checked).
  reset();
  await page.reload();
  await playing(page);
  assert.deepEqual(shellHits().filter((f) => f !== 'sw.js'), [], 'page, scripts, stylesheets and fonts come from the device');

  // A deploy that changes nothing: the update check finds the same sw.js and nothing is downloaded or reloaded.
  reset();
  const sameReg = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); return !!r.installing || !!r.waiting; });
  assert.equal(sameReg, false, 'no new worker for an unchanged build');
  assert.deepEqual(shellHits(), ['sw.js']);

  // A deploy with a one-line change to js/player.js: the next update check installs the new build, which downloads
  // sw.js, the page and the new player only, and the page reloads onto it.
  fs.appendFileSync(path.join(pub, 'js', 'player.js'), '\n// changed\n');
  fs.copyFileSync(SW_SOURCE, path.join(pub, 'sw.js'));
  const build2 = stampServiceWorker(pub);
  assert.notEqual(build2, build1);
  const player2 = fs.readdirSync(path.join(pub, 'assets', 'js')).filter((f) => f.startsWith('player.')).find((f) => fs.readFileSync(path.join(pub, 'assets', 'js', f), 'utf8').endsWith('// changed\n'));
  reset();
  const reloaded = page.waitForEvent('load', { timeout: 15000 });
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await reloaded;
  await playing(page);
  assert.deepEqual(shellHits(), ['assets/js/' + player2, 'pharmacy-screen.html', 'sw.js'].sort(), 'only sw.js, the page and the changed script are downloaded');
  assert.deepEqual(await shellCaches(page), [`pharmacy-screen-shell-${build2}`], 'the old build is deleted');
  assert.ok(await page.evaluate((p) => [...document.scripts].some((s) => s.src.endsWith(p)), player2), 'the page runs the new player');

  // The network gone (the server stopped): the screen still starts and plays from the device, a Seasonal
  // promotion with its fonts and photo too.
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await page.reload();
  const offline = await playing(page);
  assert.ok(offline.logo.includes('Beaumaris Pharmacy'), 'plays offline');
  assert.match(offline.text, /Open today|Opens today|Closing soon|Closed now/i);
  await page.goto(url('sw=1&promo=occasions&orientation=portrait'));
  await playing(page, 'occasions');
  const s = await seasonal(page);
  assert.match(s.design, /occ-christmas/);
  assert.ok(s.photo, 'the Christmas photo, offline');
  assert.ok(s.fonts.includes('Playfair Display'), `the Seasonal fonts, offline (${s.fonts.join(', ')})`);
  await context.close();
});
