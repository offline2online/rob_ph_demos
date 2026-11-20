// End to end on the whole local stack, no cloud: the screen page, the admin editor, the config API and the PH API
// proxy (admin/tools/dev-server.mjs: one origin, in memory, loaded with the seed, a mock Location API answering
// from fixtures/campaign-data.json behind two PH base URLs). Headless Chromium through Playwright.
//
//   npm run test:e2e     (uses the sandbox's preinstalled Playwright/Chromium)
//
// Covers: the screen on a mock device for every promotion and orientation (copy-fit audited per scene); an admin
// edit reaching a running screen; proxy failover to a second base URL; an offline screen keeping its last good
// data; and the security checks across the HTTP surface (token write-only and encrypted, never in a response, log
// line or audit entry; non-admin and anonymous writes refused; screen reads carry no secrets).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startDevServer } from '../../admin/tools/dev-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PRIMARY = 'https://ph-primary.example';
const SECONDARY = 'https://ph-secondary.example';
const TOKEN = 'ph-e2e-' + Math.random().toString(36).slice(2) + 'Zq7W';
const DEVICE = 'DEVICE-VIC-MP-002';
const bodies = []; // every response body this file reads, checked for the token at the end

let dev, browser;
before(async () => {
  dev = await startDevServer({ quiet: true });
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const r = await api('PUT', '/api/settings/ph-api', { body: { baseUrls: [PRIMARY, SECONDARY], token: TOKEN } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
after(async () => {
  if (browser) await browser.close();
  if (dev) await dev.close();
});

async function api(method, path, { token = 'dev-admin', body } = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const r = await fetch(dev.base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  bodies.push(`${method} ${path} ${r.status} ${text}`);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, body: json, text };
}

/** A screen page on the dev server; responses it receives are kept for the token check. */
async function screen(query, { landscape = false, clock = false, ctx = null } = {}) {
  ctx = ctx || await browser.newContext({ viewport: landscape ? { width: 960, height: 540 } : { width: 540, height: 960 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', async (res) => { if (res.url().includes('/api/')) { try { bodies.push(`screen ${res.url()} ${await res.text()}`); } catch {} } });
  if (clock) await page.clock.install();
  await page.goto(`${dev.base}/pharmacy-screen.html?${query}`);
  await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.ready, null, { timeout: 20000 });
  return { ctx, page, errors };
}
// page.clock fakes the page's timers, so poll from here with real time passing for the requests.
async function until(page, fn, arg) {
  for (let i = 0; i < 150; i++) {
    if (await page.evaluate(fn, arg)) return;
    try { await page.clock.runFor(100); } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met: ' + fn + '\n' + JSON.stringify(await page.evaluate(() => window.pharmacyScreen && window.pharmacyScreen.data)));
}
const screenText = (page) => page.evaluate(() => document.getElementById('screen').innerText.replace(/\s+/g, ' '));

test('the screen on a mock device plays every promotion in both orientations, each scene fitting', async () => {
  let scenes = 0;
  for (const landscape of [false, true]) {
    const { ctx, page, errors } = await screen(`device=${DEVICE}&orientation=${landscape ? 'landscape' : 'portrait'}&scene=0&now=wed-12:00`, { landscape });
    await page.evaluate(() => document.fonts.ready);
    const d = await page.evaluate(() => window.pharmacyScreen.data);
    assert.equal(d.storeCode, 'VIC-MP-002');
    assert.equal(d.view, 'ready');
    const promos = await page.evaluate(() => window.pharmacyScreen.promotions());
    assert.deepEqual([...promos].sort(), ['afternoon', 'closed', 'morning', 'occasions']);
    for (const promo of promos) {
      const info = await page.evaluate((p) => window.pharmacyScreen.show(p, 0), promo);
      assert.equal(info.store, 'VIC-MP-002');
      assert.ok(info.scenes.length >= 1, `${promo} has scenes`);
      for (let i = 0; i < info.scenes.length; i++) {
        const problems = await page.evaluate(([p, n]) => { window.pharmacyScreen.show(p, n); return window.pharmacyScreen.audit(); }, [promo, i]);
        assert.deepEqual(problems, [], `${promo} ${landscape ? 'landscape' : 'portrait'} scene ${i + 1} (${info.scenes[i]})`);
        scenes++;
      }
    }
    // the store data really came through the proxy, with the saved token
    assert.match(await page.evaluate(() => { window.pharmacyScreen.show('closed', 0); return document.getElementById('screen').innerText; }), /Monday/);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  assert.ok(scenes >= 6);
  assert.ok(dev.upstreamCalls.length > 0 && dev.upstreamCalls.every((c) => c.key === TOKEN), 'the proxy adds the saved token upstream');
});

test('Occasions: promo=occasions plays Christmas, signing off with the store name; the admin picks Easter and the same URL plays Easter', async () => {
  const url = 'device=DEVICE-VIC-MP-001&promo=occasions&orientation=portrait&scene=2&now=wed-12:00';
  let s = await screen(url);
  let info = await s.page.evaluate(() => window.pharmacyScreen.info);
  assert.deepEqual([info.promo, info.occasion, info.scenes], ['occasions', 'christmas', ['Greeting', 'Message', 'Sign-off']]);
  const name = (await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-001')).body.name;
  assert.match(await screenText(s.page), new RegExp(`from the whole ${name} team\\.`));
  assert.deepEqual(await s.page.evaluate(() => window.pharmacyScreen.audit()), []);
  await s.ctx.close();

  const promo = (await api('GET', '/api/admin/promotions/seed-promotion-occasions')).body;
  assert.equal((await api('PATCH', '/api/admin/promotions/seed-promotion-occasions', { body: { templateId: 'builtin-occasion-easter', expectedVersion: promo.version } })).status, 200);
  try {
    for (const orientation of ['portrait', 'landscape']) {
      s = await screen(url.replace('portrait', orientation).replace('scene=2', 'scene=0'), { landscape: orientation === 'landscape' });
      info = await s.page.evaluate(() => window.pharmacyScreen.info);
      assert.equal(info.occasion, 'easter');
      assert.match(await screenText(s.page), /Happy Easter/);
      for (let i = 0; i < 3; i++) {
        const t = await s.page.evaluate((n) => { window.pharmacyScreen.show('occasions', n); return document.getElementById('screen').innerText; }, i);
        assert.ok(!t.includes(name), `Easter scene ${i + 1} has no store-name sign-off`);
        assert.deepEqual(await s.page.evaluate(() => window.pharmacyScreen.audit()), [], `Easter ${orientation} scene ${i + 1}`);
      }
      await s.ctx.close();
    }
  } finally {
    const now = (await api('GET', '/api/admin/promotions/seed-promotion-occasions')).body;
    await api('PATCH', '/api/admin/promotions/seed-promotion-occasions', { body: { templateId: 'builtin-occasion-christmas', expectedVersion: now.version } });
  }
});

test('an admin edit in the editor reaches a running screen at its next config poll, without a reload', async () => {
  const s = await screen('device=DEVICE-VIC-MP-001&promo=morning&scene=0&now=wed-12:00', { clock: true });
  assert.equal(await s.page.evaluate(() => window.pharmacyScreen.info.scenes.length > 1), true);
  assert.match(await screenText(s.page), /Three reasons to walk in/);
  await s.page.evaluate(() => { window.__marker = 1; });

  const actx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const admin = await actx.newPage();
  await admin.goto(dev.base + '/admin/');
  await admin.fill('#gateTokenIn', 'dev-admin');
  await admin.click('#gateToken button[type=submit]');
  await admin.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.ready, null, { timeout: 20000 });
  assert.match(await admin.$eval('#storeSel', (e) => e.selectedOptions[0].textContent), /VIC-MP-001/);
  await admin.fill('#dit', 'Four reasons to walk in');
  await admin.evaluate(async () => { await window.pharmacyAdmin.flush(); for (let i = 0; i < 100 && window.pharmacyAdmin.pending(); i++) await new Promise((r) => setTimeout(r, 50)); });
  assert.match(await admin.textContent('#saveState'), /All changes saved/);
  await actx.close();

  await s.page.clock.runFor(60000);
  await until(s.page, () => /Four reasons to walk in/.test(document.getElementById('screen').innerText));
  assert.equal(await s.page.evaluate(() => window.__marker), 1, 'same page, no reload');
  assert.deepEqual(s.errors, []);
  await s.ctx.close();
});

test('proxy failover: with the first PH base URL down the proxy uses the second; both down, a fresh screen shows the error', async () => {
  const host1 = new URL(PRIMARY).host, host2 = new URL(SECONDARY).host;
  dev.downHosts.add(host1);
  try {
    const before = dev.upstreamCalls.length;
    const r = await api('GET', `/api/device/${DEVICE}/campaign_data`, { token: '' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.store_location.store_code, 'VIC-MP-002');
    assert.equal(r.body.meta.server, SECONDARY);
    const calls = dev.upstreamCalls.slice(before).map((c) => new URL(c.url).host);
    assert.ok(calls.includes(host2), calls.join(','));
    // a screen on the same proxy plays from the second server
    const s = await screen(`device=${DEVICE}&promo=morning&scene=0`);
    assert.equal(await s.page.evaluate(() => window.pharmacyScreen.data.view), 'ready');
    assert.equal(await s.page.evaluate(() => window.pharmacyScreen.info.store), 'VIC-MP-002');
    await s.ctx.close();

    dev.downHosts.add(host2);
    const down = await api('GET', `/api/device/${DEVICE}/campaign_data`, { token: '' });
    assert.equal(down.body.ok, false);
    assert.equal(down.body.error.code, 'UPSTREAM_UNAVAILABLE');
    const f = await screen(`device=${DEVICE}&promo=morning`);
    await f.page.waitForSelector('.s-errbadge');
    assert.match(await screenText(f.page), /Screen data could not load/);
    await f.ctx.close();
  } finally {
    dev.downHosts.clear();
  }
  const back = await api('GET', `/api/device/${DEVICE}/campaign_data`, { token: '' });
  assert.equal(back.status, 200);
});

test('offline: the screen keeps its last good data, restarts from the cache, and goes live again', async () => {
  const ctx = await browser.newContext({ viewport: { width: 540, height: 960 } });
  let offline = false;
  await ctx.route('**/api/**', (route) => (offline ? route.abort('internetdisconnected') : route.continue()));
  const s = await screen(`device=${DEVICE}&promo=afternoon&scene=0&now=wed-15:00`, { ctx, clock: true });
  const shown = await screenText(s.page);
  offline = true;
  await s.page.clock.runFor(60000);
  await until(s.page, () => window.pharmacyScreen.data.lastStore && window.pharmacyScreen.data.lastStore.kind === 'down');
  assert.equal(await s.page.evaluate(() => window.pharmacyScreen.data.view), 'ready');
  assert.equal(await screenText(s.page), shown, 'same scene, unchanged');
  assert.equal(await s.page.locator('.s-errbadge').count(), 0);
  // a restart while still offline (new page, same device storage) comes back from the cache
  await s.page.close();
  const r = await screen(`device=${DEVICE}&promo=afternoon&scene=0&now=wed-15:00`, { ctx, clock: true });
  assert.equal(await r.page.evaluate(() => window.pharmacyScreen.info.store), 'VIC-MP-002');
  assert.equal(await r.page.evaluate(() => window.pharmacyScreen.data.fromCache), true);
  assert.equal(await screenText(r.page), shown);
  offline = false;
  await r.page.clock.runFor(30000);
  await until(r.page, () => window.pharmacyScreen.data.lastStore && window.pharmacyScreen.data.lastStore.kind === 'ok');
  assert.equal(await r.page.evaluate(() => window.pharmacyScreen.data.fromCache), false);
  await ctx.close();
});

test('security: the token is write-only and stored as ciphertext; screen reads carry no secrets', async () => {
  const got = await api('GET', '/api/settings/ph-api');
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.settings.baseUrls, [PRIMARY, SECONDARY]);
  assert.equal(got.body.settings.token.set, true);
  assert.equal(got.body.settings.token.last4, TOKEN.slice(-4));
  assert.ok(!got.text.includes(TOKEN.slice(0, -4)), 'settings GET shows set + last 4 only');
  assert.ok(!/envelope|ciphertext|wrappedKey/.test(got.text), 'no envelope in the settings GET');
  // what is physically stored: an envelope, no plaintext
  const raw = JSON.stringify(dev.phSettings.raw());
  assert.ok(!raw.includes(TOKEN), 'token not stored in plain text');
  assert.ok(dev.phSettings.raw().token.envelope.ciphertext, 'stored as ciphertext');
  // screen reads: device data and published config hold no token, envelope, base URLs or admin/audit fields
  const SECRET = /x-api-key|token|envelope|ciphertext|wrappedKey|baseUrls|ph-primary|ph-secondary|setBy|updatedBy|createdBy|audit/i;
  const device = await api('GET', `/api/device/${DEVICE}/campaign_data`, { token: '' });
  assert.equal(device.status, 200);
  const deviceData = JSON.stringify(device.body.data);
  assert.ok(!SECRET.test(deviceData), deviceData.slice(0, 300));
  for (const path of ['/api/screens/VIC-MP-002', '/api/screens/VIC-MP-001?promo=morning']) {
    const r = await api('GET', path, { token: '' });
    assert.equal(r.status, 200);
    assert.ok(!SECRET.test(r.text), `${path}: ${r.text.match(SECRET)}`);
  }
});

test('security: non-admin and anonymous write calls are refused on every write endpoint', async () => {
  const writes = [
    ['PUT', '/api/settings/ph-api', { token: 'abcdefgh1234' }],
    ['DELETE', '/api/settings/ph-api/token'],
    ['POST', '/api/admin/pharmacies', { storeCode: 'X-1', name: 'x', colours: { primary: '#000000', accent: '#ffffff' } }],
    ['PATCH', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002', { name: 'x' }],
    ['PUT', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002/content/seed-promotion-morning', { introTitle: 'x' }],
    ['DELETE', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002'],
    ['POST', '/api/admin/promotions', { promoId: 'x-1', name: 'x', templateId: 'builtin-promotion-scenes' }],
    ['PATCH', '/api/admin/promotions/seed-promotion-morning', { name: 'x' }],
    ['DELETE', '/api/admin/promotions/seed-promotion-morning'],
    ['POST', '/api/admin/templates/builtin-promotion-scenes/clone', {}],
    ['POST', '/api/admin/services', { name: 'x', category: 'x', icon: 'pill' }],
  ];
  for (const [m, p, body] of writes) {
    const viewer = await api(m, p, { token: 'dev-viewer', body });
    assert.equal(viewer.status, 403, `viewer ${m} ${p}: ${viewer.text}`);
    const anon = await api(m, p, { token: '', body });
    assert.ok([401, 403].includes(anon.status), `anonymous ${m} ${p}: ${anon.status}`);
    const bad = await api(m, p, { token: 'not-a-user', body });
    assert.ok([401, 403].includes(bad.status), `bad token ${m} ${p}: ${bad.status}`);
  }
  // nothing changed
  assert.equal((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002')).body.name !== 'x', true);
  assert.equal((await api('GET', '/api/settings/ph-api')).body.settings.token.last4, TOKEN.slice(-4));
});

test('security: the token never appears in any response, log line or audit entry from this whole run', async () => {
  // force the paths that log: a rejected token upstream, an unknown device and a settings save
  await api('GET', '/api/device/NO-SUCH-DEVICE/campaign_data', { token: '' });
  await api('PUT', '/api/settings/ph-api', { body: { baseUrls: [PRIMARY, SECONDARY] } });
  assert.ok(dev.logLines.length > 0, 'the stack logged something');
  const secret = TOKEN.slice(0, -4); // the last 4 are shown on purpose
  for (const b of bodies) assert.ok(!b.includes(secret), 'response: ' + b.slice(0, 200));
  for (const l of dev.logLines) assert.ok(!l.includes(secret), 'log: ' + l.slice(0, 200));
  const audit = JSON.stringify(dev.phAudit.entries) + JSON.stringify((await api('GET', '/api/admin/audit?limit=500')).body);
  assert.ok(dev.phAudit.entries.length > 0);
  assert.ok(!audit.includes(secret), 'audit entry');
  assert.ok(bodies.length > 20);
});
