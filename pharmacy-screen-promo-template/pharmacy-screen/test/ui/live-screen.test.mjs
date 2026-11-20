// The screen on live data, in headless Chromium: the ticket's test steps with the back-end proxy and the config
// read answered by Playwright routes (the real proxy's response shape, the config API's own published shape).
//   npm run test:ui     (uses the sandbox's preinstalled Playwright/Chromium; CHROMIUM_PATH for another binary)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { serve } from '../../tools/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { trimCampaignData } = require('../../ph-proxy/src/location-proxy.js');
const { buildScreenConfig } = require('../../config-api/src/publish.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CAMPAIGN = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/campaign-data.json'), 'utf8'));
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/config.json'), 'utf8'));

const PROMOS = [
  { id: 'rec-morning', promoId: 'morning', name: 'Morning', templateId: 'builtin-promotion-scenes' },
  { id: 'rec-afternoon', promoId: 'afternoon', name: 'Afternoon', templateId: 'builtin-promotion-scenes' },
  { id: 'rec-closed', promoId: 'closed', name: 'Closed', templateId: 'builtin-opening-hours' },
];
function published(storeCode) {
  const ph = CONFIG.pharmacies.find((p) => p.storeCode === storeCode);
  const content = Object.fromEntries(PROMOS.map((p) => [p.id, ph.content[p.promoId]]));
  return buildScreenConfig({ storeCode, name: ph.name, colours: { primary: ph.brand.p, accent: ph.brand.a }, logo: null, content }, PROMOS, [], '2026-11-20T00:00:00.000Z');
}

let server, browser, base;
before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}/pharmacy-screen.html`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser.close(); server.close(); });

/**
 * A page whose /api/device/** and /api/screens/** are answered by `api` (mutable: change it mid-test).
 * api.devices[device] = raw campaign_data (or absent: DEVICE_NOT_FOUND); api.down = true aborts every call.
 */
async function open(query, api, { viewport = { width: 540, height: 960 }, clock = false } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const external = [];
  const errors = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1')) external.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    api.calls = (api.calls || 0) + 1;
    if (api.down) return route.abort('internetdisconnected');
    let m = /^\/api\/device\/([^/]+)\/campaign_data$/.exec(url.pathname);
    if (m) {
      const d = api.devices[decodeURIComponent(m[1])];
      return d
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: trimCampaignData(d), meta: { server: 'https://ph.example', fetchedAt: new Date().toISOString() } }) })
        : route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'DEVICE_NOT_FOUND', message: 'not registered' } }) });
    }
    m = /^\/api\/screens\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const code = decodeURIComponent(m[1]);
      return api.configured.includes(code)
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(published(code)) })
        : route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not-found', message: 'no config' } }) });
    }
    return route.fulfill({ status: 404, body: 'no route' });
  });
  if (clock) await page.clock.install();
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.ready);
  return { page, ctx, external, errors };
}

const copy = (d) => JSON.parse(JSON.stringify(d));
// waitForFunction polls on the page's own timers, which page.clock fakes: poll from here instead, with real
// time passing for the routed fetches and a little fake time for the page's own timers.
async function until(page, fn, arg) {
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(fn, arg)) return;
    await page.clock.runFor(100);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met: ' + fn + '\n' + JSON.stringify(await page.evaluate(() => [window.pharmacyScreen.data, document.getElementById('screen').innerText.slice(0, 200)])));
}
const screenText = (page) => page.evaluate(() => document.getElementById('screen').innerText.replace(/\s+/g, ' '));

test('1. a device on the proxy shows its own store: suburb, hours and phone', async () => {
  const dev = copy(CAMPAIGN.devices['DEVICE-VIC-MP-002'].data);
  const api = { devices: { 'SCREEN-42': dev }, configured: ['VIC-MP-002'] };
  const { page, ctx, external, errors } = await open('device=SCREEN-42&promo=closed&scene=1', api);
  const info = await page.evaluate(() => window.pharmacyScreen.info);
  assert.equal(info.store, 'VIC-MP-002');
  const text = await screenText(page);
  assert.ok(text.includes(dev.store_info.address_info.suburb), 'suburb in "Serving ${Suburb}"');
  assert.ok(text.includes(dev.store_info.address_info.phone_number), 'phone line');
  assert.match(text, /Monday/);
  // Self-hosted fonts and icons: nothing reaches Google (or anywhere else) at runtime.
  assert.deepEqual(external, []);
  const loaded = await page.evaluate(async () => {
    const icons = await document.fonts.load('120px "Material Symbols Outlined"', 'pill');
    const text = await document.fonts.load('800 40px Figtree', 'Serving');
    return [icons.length, text.length];
  });
  assert.deepEqual(loaded, [1, 1], 'icon font and Figtree load from the page itself');
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('2. hours changed in PH reach the screen within 30 s, without a reload', async () => {
  const dev = copy(CAMPAIGN.devices['DEVICE-VIC-MP-001'].data);
  const api = { devices: { D1: dev }, configured: ['VIC-MP-001'] };
  const { page, ctx } = await open('device=D1&promo=closed&scene=0', api, { clock: true });
  assert.match(await screenText(page), /Monday 8\.30am – 7\.00pm/);
  const next = copy(dev);
  next.store_info.opening_hours[0].close_time = '21:00:00';
  api.devices.D1 = next;
  await page.evaluate(() => { window.__marker = 1; });
  await page.clock.runFor(30000);
  await until(page, () => /Monday\s+8\.30am – 9\.00pm/.test(document.getElementById('screen').innerText));
  assert.equal(await page.evaluate(() => window.__marker), 1, 'same page, no reload');
  await ctx.close();
});

test('3. network killed: the screen keeps the last good data; restored, it resumes', async () => {
  const dev = copy(CAMPAIGN.devices['DEVICE-VIC-MP-003'].data);
  const api = { devices: { D3: dev }, configured: ['VIC-MP-003'] };
  const { page, ctx } = await open('device=D3&promo=morning&scene=0&now=wed-12:00', api, { clock: true });
  const before = await screenText(page);
  api.down = true;
  await page.clock.runFor(60000);
  await until(page, () => window.pharmacyScreen.data.lastStore && window.pharmacyScreen.data.lastStore.kind === 'down');
  assert.equal(await page.evaluate(() => window.pharmacyScreen.data.view), 'ready');
  assert.equal(await screenText(page), before, 'still the same scene');
  assert.equal(await page.locator('.s-errbadge').count(), 0);
  // A restart while still offline: the cached result (localStorage) comes straight back.
  await page.reload();
  await until(page, () => window.pharmacyScreen && window.pharmacyScreen.info);
  assert.equal(await page.evaluate(() => window.pharmacyScreen.info.store), 'VIC-MP-003');
  assert.equal(await page.evaluate(() => window.pharmacyScreen.data.fromCache), true);
  api.down = false;
  await page.clock.runFor(30000);
  await until(page, () => window.pharmacyScreen.data.lastStore && window.pharmacyScreen.data.lastStore.kind === 'ok');
  assert.equal(await page.evaluate(() => window.pharmacyScreen.data.fromCache), false);
  await ctx.close();
});

test('4. unknown device, store not configured and missing device show the right states', async () => {
  const api = { devices: { KNOWN: CAMPAIGN.devices['DEVICE-VIC-MP-004'].data }, configured: [] };
  let { page, ctx } = await open('device=NOT-REGISTERED-7&orientation=landscape', api, { viewport: { width: 960, height: 540 } });
  assert.match(await screenText(page), /Screen not set up/);
  assert.match(await page.locator('.s-devid').innerText(), /NOT-REGISTERED-7/);
  assert.equal(await page.locator('.screen.setup .s-top').count(), 1, 'drawn in the brand panel');
  await ctx.close();

  ({ page, ctx } = await open('device=KNOWN', api));
  assert.match(await screenText(page), /Screen not set up/);
  assert.match(await screenText(page), /Store VIC-MP-004 has no screen content yet/);
  await ctx.close();

  const none = { devices: {}, configured: [] };
  ({ page, ctx } = await open('promo=morning', none));
  assert.match(await screenText(page), /Invalid screen URL/);
  assert.equal(none.calls || 0, 0, 'no device: nothing is called');
  await ctx.close();

  ({ page, ctx } = await open('device=%24%7BUniqueDeviceID%7D', api));
  assert.match(await screenText(page), /Invalid screen URL/, 'an unswapped ${UniqueDeviceID}');
  await ctx.close();

  ({ page, ctx } = await open('device=FRESH-SCREEN', { devices: {}, configured: [], down: true }));
  await page.waitForSelector('.s-errbadge');
  assert.match(await screenText(page), /Screen data could not load/);
  await ctx.close();
});

test('5. debug=1: device, store code, last fetch, server, and a test time for every bar state', async () => {
  const api = { devices: { DBG: CAMPAIGN.devices['DEVICE-VIC-MP-001'].data }, configured: ['VIC-MP-001'] };
  const { page, ctx, errors } = await open('device=DBG&promo=morning&scene=0&debug=1', api);
  await page.waitForSelector('.dbg dt');
  const panel = await page.locator('.dbg').innerText();
  for (const s of ['DBG', 'VIC-MP-001', 'Store data', 'Config', 'Server', 'Live']) assert.ok(panel.includes(s), s);
  const bar = async (day, time) => {
    await page.selectOption('.dbg-tt select', day);
    await page.fill('.dbg-tt input', time);
    await page.click('.dbg-tt button[type=submit]');
    return (await page.locator('.s-foot').innerText()).replace(/\s+/g, ' ');
  };
  assert.match(await bar('wed', '07:00'), /OPENS TODAY AT 8\.30AM/i);
  assert.match(await bar('wed', '12:00'), /OPEN TODAY UNTIL 7PM/i);
  assert.match(await bar('wed', '18:45'), /CLOSING SOON · 7PM/i);
  assert.match(await bar('wed', '19:30'), /CLOSED NOW/i);
  assert.match(await page.locator('.dbg').innerText(), /After closing/);
  await page.click('.dbg-tt [data-act=clear]');
  await page.waitForFunction(() => !document.querySelector('.dbg-tag'));
  assert.match((await page.locator('.s-foot').innerText()).replace(/\s+/g, ' '), /OPEN|CLOSED|CLOSING/i);
  assert.deepEqual(errors, []);
  await ctx.close();
});
