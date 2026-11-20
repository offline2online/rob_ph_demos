// The screen kept on the device by its service worker (sw.js), in headless Chromium against a copy staged and
// stamped exactly as the deploy publishes it (scripts/deploy.mjs):
//   - the second start downloads none of the page, scripts or stylesheets;
//   - a deploy that changes nothing downloads nothing; one that changes a shell file is picked up by the player's
//     update check, downloaded once, and the page reloads itself onto it;
//   - with the server gone, the screen still starts and plays the promotion.
// The data is the seed fixtures (mockapi=1); sw=1 turns the worker on for a local server; now= pins the store's
// clock to a weekday noon, so the "Open today" bar reads the same whatever time the suite runs.
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
const SHELL = ['pharmacy-screen.html', 'js/player.js', 'js/render.js', 'css/screen.css', 'css/material-symbols.css', 'css/fonts.css'];

let server, browser, pub, base, hits;
before(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-offline-'));
  stage(undefined, out);
  pub = path.join(out, 'public');
  hits = {};
  server = await serve(0, pub, hits);
  base = `http://127.0.0.1:${server.address().port}/pharmacy-screen.html?mockapi=1&sw=1&device=TEST&promo=morning&orientation=portrait&now=wed-12:00`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser.close(); if (server.listening) { server.closeAllConnections(); server.close(); } });

const reset = () => { for (const k of Object.keys(hits)) delete hits[k]; };
const shellHits = () => SHELL.filter((f) => hits[f]);
async function playing(page) {
  await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.info && window.pharmacyScreen.info.promo === 'morning', null, { timeout: 15000 });
  return page.evaluate(() => ({ logo: [...document.images].map((i) => i.alt), text: document.body.innerText }));
}
const shellCaches = (page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('pharmacy-screen-shell-')));

test('cached start, update only on change, and an offline start', async () => {
  const context = await browser.newContext({ viewport: { width: 540, height: 960 } });
  const page = await context.newPage();
  const build1 = shellBuildId(pub);

  // First start: the worker installs and downloads the shell into its build's cache.
  await page.goto(base);
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
  const first = await playing(page);
  assert.ok(first.logo.includes('Beaumaris Pharmacy'), 'the Beaumaris morning promotion plays');
  assert.deepEqual(await shellCaches(page), [`pharmacy-screen-shell-${build1}`]);

  // Second start: nothing of the shell is downloaded again.
  reset();
  await page.reload();
  await playing(page);
  assert.deepEqual(shellHits(), [], 'page, scripts and stylesheets come from the device');

  // A deploy that changes nothing: the update check finds the same sw.js and nothing is downloaded or reloaded.
  reset();
  const sameReg = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); return !!r.installing || !!r.waiting; });
  assert.equal(sameReg, false, 'no new worker for an unchanged build');
  assert.deepEqual(shellHits(), []);

  // A deploy that changes the stylesheet: the next update check installs the new build and the page reloads onto it.
  fs.appendFileSync(path.join(pub, 'css', 'screen.css'), '\n/* changed */\n');
  fs.copyFileSync(SW_SOURCE, path.join(pub, 'sw.js'));
  const build2 = stampServiceWorker(pub);
  assert.notEqual(build2, build1);
  reset();
  const reloaded = page.waitForEvent('load', { timeout: 15000 });
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await reloaded;
  await playing(page);
  assert.ok(hits['css/screen.css'] >= 1, 'the changed stylesheet was downloaded');
  assert.deepEqual(await shellCaches(page), [`pharmacy-screen-shell-${build2}`], 'the old build is deleted');
  assert.match(await page.evaluate(async () => (await (await fetch('css/screen.css')).text()).slice(-30)), /changed/);

  // The network gone (the server stopped): the screen still starts and plays from the device.
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await page.reload();
  const offline = await playing(page);
  assert.ok(offline.logo.includes('Beaumaris Pharmacy'), 'plays offline');
  // The Open today bar, in whichever state the store's real clock puts it (the test runs at any hour).
  assert.match(offline.text, /Open today|Opens today|Closing soon|Closed now/i);
  await context.close();
});
