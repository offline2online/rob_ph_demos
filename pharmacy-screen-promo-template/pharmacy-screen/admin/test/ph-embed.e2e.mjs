// End-to-end tests for signing in from Personalisation Hub (auth.mode 'ph', docs/PH-EMBED.md): the real editor
// in Chromium, framed by a stand-in PH page on another origin, against the real config API and proxy with a mock
// PH auth API (admin/tools/dev-server.mjs, phEmbed). No network, no cloud.
//
//   cd pharmacy-screen-promo-template/pharmacy-screen/admin && npm run test:ph

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startDevServer, PH_TOKENS } from '../tools/dev-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let dev, browser;
before(async () => { dev = await startDevServer({ quiet: true, phEmbed: true }); browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); if (dev) await dev.close(); });

async function host(query, { ready = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push({ url: r.url(), auth: r.headers().authorization || '', body: r.postData() || '' }));
  await page.goto(`${dev.hostBase}/__ph-host.html?${query}`);
  const frame = page.frames().find((f) => f !== page.mainFrame()) || (await page.waitForEvent('frameattached'));
  if (ready) await frame.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.ready, null, { timeout: 20000 });
  return { ctx, page, frame, requests };
}
const blocked = async (frame) => {
  await frame.waitForSelector('#gateBlocked:not([hidden])', { timeout: 15000 });
  return { title: await frame.$eval('#gateTitle', (e) => e.textContent), text: await frame.$eval('#gateBlockedTx', (e) => e.textContent), signIn: await frame.$eval('#gateFirebase', (e) => !e.hidden) };
};

test('HQ Admin: the editor opens with no sign-in prompt and every pharmacy', async () => {
  const { ctx, frame, requests } = await host('as=hq');
  assert.equal(await frame.$eval('#gate', (e) => e.hidden), true);
  assert.equal((await frame.$$eval('#storeSel option', (o) => o.length)), 5);
  assert.equal(await frame.$eval('#toolbar', (e) => e.hidden), false);
  // The PH token went to the exchange endpoint in a request body only: never in a URL, a header or storage.
  const withToken = requests.filter((r) => r.url.includes(PH_TOKENS.hq) || r.auth.includes(PH_TOKENS.hq));
  assert.deepEqual(withToken, []);
  assert.ok(requests.some((r) => r.url.endsWith('/api/auth/ph-session') && r.body.includes(PH_TOKENS.hq)));
  const stored = await frame.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie + location.href);
  assert.ok(!stored.includes(PH_TOKENS.hq) && !/session-|id-[0-9a-f]{24}/.test(stored), 'a token was stored');
  await ctx.close();
});

test('Retail Admin: locked to the user\'s own store; another store code is refused in the page and by the server', async () => {
  const { ctx, frame } = await host('as=store&store=VIC-MP-003');
  assert.equal(await frame.$eval('#pageTitle', (e) => e.textContent), 'Display Promotions');
  assert.equal(await frame.$eval('#toolbar', (e) => e.hidden), true);
  assert.deepEqual(await frame.evaluate(() => window.pharmacyAdmin.state.pharmacies.map((p) => p.storeCode)), ['VIC-MP-003']);
  // The session the page holds cannot reach another store or the master, whatever it sends.
  const [idToken] = [...dev.sessions.entries()].find(([, a]) => a.stores.includes('VIC-MP-003'));
  const call = (method, path, body) => fetch(dev.base + path, { method, headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await call('GET', '/api/admin/audit')).status, 403);
  assert.equal((await call('POST', '/api/admin/promotions', { name: 'x', promoId: 'x', templateId: 'builtin-promotion-scenes' })).status, 403);
  assert.equal((await call('GET', '/api/settings/ph-api')).status, 403);
  assert.equal((await call('PUT', '/api/settings/ph-api', { baseUrls: ['https://evil.example'] })).status, 403);
  await ctx.close();

  const no = await host('as=store&store=VIC-MP-001', { ready: false });
  const b = await blocked(no.frame);
  assert.equal(b.title, 'Access denied');
  assert.match(b.text, /VIC-MP-001/);
  assert.equal(await no.frame.evaluate(() => window.pharmacyAdmin && window.pharmacyAdmin.state.cur), null);
  await no.ctx.close();

  // No ?store= at all: their own store opens.
  const own = await host('as=store');
  assert.equal(await own.frame.evaluate(() => window.pharmacyAdmin.state.lock), 'VIC-MP-003');
  await own.ctx.close();
});

test('opened directly, or with a session PH does not accept: Access denied and no sign-in offered', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${dev.base}/admin/`);
  const direct = await blocked(page);
  assert.deepEqual([direct.title, direct.signIn], ['Access denied', false]);
  assert.equal(await page.$eval('#gateSignOut', (e) => e.hidden), true);
  await ctx.close();

  const stranger = await host('as=stranger', { ready: false });
  assert.equal((await blocked(stranger.frame)).title, 'Access denied');
  await stranger.ctx.close();

  // The parent never answers (not signed in to PH): denied after the wait, nothing loaded.
  const silent = await host('as=silent', { ready: false });
  assert.equal((await blocked(silent.frame)).title, 'Access denied');
  await silent.ctx.close();
});

test('a session posted from any origin but Personalisation Hub is ignored', async () => {
  // The same host page served from the editor's own origin stands in for "some other site" framing the editor.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${dev.base}/__ph-host.html?as=hq`);
  const frame = page.frames().find((f) => f !== page.mainFrame()) || (await page.waitForEvent('frameattached'));
  // It posts the (valid) token without being asked: the editor must not take it from this origin.
  await page.waitForTimeout(500);
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.phHost.post(); });
  assert.equal((await blocked(frame)).title, 'Access denied');
  await ctx.close();
});

test('the session renews from the parent before it runs out, and ends when PH signs out', async () => {
  dev.idTtlSeconds.value = 2; // each ID token is already inside the renewal margin
  try {
    const { ctx, page, frame } = await host('as=hq');
    const before = await page.evaluate(() => window.phHost.posts);
    const n = dev.sessions.size;
    await frame.evaluate(() => window.pharmacyAdmin.flush());
    // Any API call asks for a token; with a short-lived one that means asking the parent again.
    await frame.evaluate(() => document.querySelector('#storeSel').dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForFunction((b) => window.phHost.posts > b, before, { timeout: 10000 });
    assert.ok(dev.sessions.size > n, 'no new session was exchanged');
    assert.equal(await frame.$eval('#gate', (e) => e.hidden), true);

    await page.evaluate(() => window.phHost.signOut());
    const b = await blocked(frame);
    assert.equal(b.title, 'Signed out');
    await ctx.close();
  } finally { dev.idTtlSeconds.value = 3600; }
});

// The PH content frame is not given clipboard access, so the Clipboard API rejects every write in it: Copy experience
// URL falls back to the copy command. Every promotion (Sales Promos, Morning, Afternoon, Closed and Seasonal in each season) and
// both orientations copy the URL of what is on the preview.
test('Copy experience URL copies the right URL in the PH frame: every promotion, season and orientation', async () => {
  const { ctx, frame } = await host('as=hq');
  const page = new URL('../pharmacy-screen.html', frame.url()).href;
  await frame.evaluate(() => { document.addEventListener('copy', () => { window.__copied = String(getSelection()); }); });
  // The Clipboard API is refused here, as it is in PH.
  assert.equal(await frame.evaluate(() => navigator.clipboard.writeText('x').then(() => 'ok', () => 'refused')), 'refused');
  const copy = async () => {
    await frame.evaluate(() => { window.__copied = null; });
    await frame.click('#cpUrl');
    await frame.waitForFunction(() => document.getElementById('cpTx').textContent !== 'Copy experience URL');
    return { label: await frame.textContent('#cpTx'), copied: await frame.evaluate(() => window.__copied), field: await frame.isVisible('#cpField') };
  };
  const check = async (promo, o, what) => {
    await frame.click(`#orTabs button[data-or="${o}"]`);
    const r = await copy();
    const want = `${page}?device=\${UniqueDeviceID}&promo=${promo}&orientation=${o}`;
    assert.deepEqual(r, { label: 'Copied', copied: want, field: false }, `${what} ${o}`);
    assert.equal(await frame.textContent('#cpTip'), want, `${what} ${o} tooltip`);
  };
  // The tabs, in order: Sales Promos first (selected when the editor opens), then the other four defaults.
  assert.deepEqual(await frame.$$eval('#dpTabs button', (b) => b.map((x) => x.textContent.replace(/^(sell|campaign|schedule|celebration)/, '').replace(/Sale has ended$/, ''))), ['Sales Promos', 'Morning', 'Afternoon', 'Closed', 'Seasonal']);
  assert.equal(await frame.getAttribute('#dpTabs button:nth-child(1)', 'aria-selected'), 'true');
  for (const [tab, promo] of [['Sales Promos', 'sale'], ['Morning', 'morning'], ['Afternoon', 'afternoon'], ['Closed', 'closed']]) {
    await frame.click(`#dpTabs button:has-text("${tab}")`);
    for (const o of ['portrait', 'landscape']) await check(promo, o, tab);
  }
  // Seasonal: one URL for the Fallback and every season (the screen plays the season whose dates hold the store's
  // date, else the Fallback).
  await frame.click('#dpTabs button:has-text("Seasonal")');
  const seasons = await frame.$$eval('#pmTpl option', (o) => o.map((x) => x.value));
  assert.equal(seasons.length, 7, 'the Fallback and the six seasons');
  const was = await frame.inputValue('#pmTpl');
  for (const s of seasons) {
    await frame.selectOption('#pmTpl', s);
    for (const o of ['landscape', 'portrait']) await check('occasions', o, s);
  }
  await frame.selectOption('#pmTpl', was);
  await frame.evaluate(() => window.pharmacyAdmin.flush());
  await ctx.close();
});

test('Copy experience URL: when the browser refuses to copy at all, the URL is shown selected for the keyboard', async () => {
  const { ctx, frame } = await host('as=hq');
  await frame.evaluate(() => { document.execCommand = () => false; });
  await frame.click('#dpTabs button:has-text("Afternoon")');
  await frame.click('#orTabs button[data-or="landscape"]');
  await frame.click('#cpUrl');
  await frame.waitForSelector('#cpField:not([hidden])');
  const want = `${new URL('../pharmacy-screen.html', frame.url()).href}?device=\${UniqueDeviceID}&promo=afternoon&orientation=landscape`;
  assert.equal(await frame.inputValue('#cpField'), want);
  assert.match(await frame.textContent('#cpTx'), /^Press (Ctrl\+C|⌘C) to copy the URL below$/);
  assert.doesNotMatch(await frame.textContent('#cpTx'), /tooltip/);
  // Selected and focused, read-only.
  assert.deepEqual(await frame.$eval('#cpField', (e) => ({ focused: document.activeElement === e, sel: e.value.slice(e.selectionStart, e.selectionEnd), ro: e.readOnly })), { focused: true, sel: want, ro: true });
  // The field follows the preview: switch orientation and it holds the portrait URL.
  await frame.click('#orTabs button[data-or="portrait"]');
  assert.equal(await frame.inputValue('#cpField'), want.replace('orientation=landscape', 'orientation=portrait'));
  // The label goes back to "Copy experience URL".
  await frame.waitForFunction(() => document.getElementById('cpTx').textContent === 'Copy experience URL', null, { timeout: 6000 });
  await ctx.close();
});

test('Retail Admin: a store user edits its own pharmacy\'s Sales Promos copy, and only its own', async () => {
  const { ctx, frame } = await host('as=store&store=VIC-MP-003');
  // Sales Promos is the first tab and opens selected; no promotion settings and no scene timings for a store user.
  assert.equal(await frame.getAttribute('#dpTabs button[data-dp="seed-promotion-sale"]', 'aria-selected'), 'true');
  assert.equal(await frame.isHidden('#promoMeta'), true);
  assert.equal(await frame.isHidden('#sl1dur'), true);
  await frame.fill('#slVal', '20');
  await frame.fill('#slB0', 'SWISSE');
  await frame.evaluate(() => window.pharmacyAdmin.flush());
  await frame.waitForFunction(() => !window.pharmacyAdmin.pending());
  const [idToken] = [...dev.sessions.entries()].find(([, a]) => a.stores.includes('VIC-MP-003'));
  const call = (method, path, body) => fetch(dev.base + path, { method, headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const mine = await (await call('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-003')).json();
  assert.deepEqual([mine.content['seed-promotion-sale'].sale.value, mine.content['seed-promotion-sale'].sale.brands[0]], [20, 'SWISSE']);
  // Another pharmacy's copy, and the promotion itself, stay out of reach.
  assert.equal((await call('PUT', '/api/admin/pharmacies/seed-pharmacy-vic-mp-001/content/seed-promotion-sale', { sale: { value: 5 } })).status, 403);
  assert.equal((await call('DELETE', '/api/admin/promotions/seed-promotion-sale')).status, 403);
  await ctx.close();
});
