// End-to-end tests for the admin editor: the real page in Chromium against the real config API and PH API
// proxy (in memory, admin/tools/dev-server.mjs, loaded with the seed). No network, no cloud.
//
//   cd pharmacy-screen-promo-template/pharmacy-screen/admin && npm test
//
// Covers the ticket's test steps: the prototype's interactions, server persistence (another admin sees an
// edit after a reload), non-admins refused, and the PH API token never shown back.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startDevServer } from '../tools/dev-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let dev, browser;
const TOKEN = 'e2e-' + Math.random().toString(36).slice(2) + 'ABCDEFGH' + 'QRST';

before(async () => {
  dev = await startDevServer({ quiet: true });
  browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  if (dev) await dev.close();
});

async function open(token = 'dev-admin', { viewport = { width: 1400, height: 1000 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(dev.base + '/admin/');
  await page.fill('#gateTokenIn', token);
  await page.click('#gateToken button[type=submit]');
  if (token === 'dev-admin') await page.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.ready, null, { timeout: 20000 });
  return { ctx, page, errors };
}
const settle = (page) => page.evaluate(async () => { await window.pharmacyAdmin.flush(); for (let i = 0; i < 100 && window.pharmacyAdmin.pending(); i++) await new Promise((r) => setTimeout(r, 50)); });
const api = async (method, path, { token = 'dev-admin', body } = {}) => {
  const r = await fetch(dev.base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null), text: '' };
};
const headline = (page) => page.$eval('#screen .s-head h2', (e) => e.textContent);

test('loads the pharmacies, promotions and a live preview from the server', async () => {
  const { ctx, page, errors } = await open();
  const opts = await page.$$eval('#storeSel option', (o) => o.map((x) => x.textContent));
  assert.equal(opts.length, 5);
  assert.match(opts[0], /Beaumaris Pharmacy · VIC-MP-001/);
  assert.deepEqual(await page.$$eval('#dpTabs button', (b) => b.map((x) => x.textContent.replace(/^(campaign|schedule)/, ''))), ['Morning', 'Afternoon', 'Closed']);
  assert.equal(await page.$$eval('#tl button', (b) => b.length), 5);
  await page.click('#playBtn'); // pause
  await page.click('#tl button[data-i="0"]');
  assert.match(await headline(page), /^Good morning/);
  assert.equal(await page.isHidden('#newPromo'), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('edits are saved to the server and another admin sees them after a reload', async () => {
  const a = await open();
  await a.page.fill('#sName', 'Beaumaris Pharmacy Plus');
  await a.page.fill('#dit', 'Four reasons to walk in');
  await settle(a.page);
  assert.match(await a.page.textContent('#saveState'), /All changes saved/);
  const rec = await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-001');
  assert.equal(rec.body.name, 'Beaumaris Pharmacy Plus');
  assert.equal(rec.body.content['seed-promotion-morning'].introTitle, 'Four reasons to walk in');
  // published config for the screens follows
  const pub = await api('GET', '/api/screens/VIC-MP-001?promo=morning', { token: '' });
  assert.equal(pub.body.promotions.morning.content.introTitle, 'Four reasons to walk in');
  // a different admin, fresh browser context (no shared storage)
  const b = await open();
  assert.equal(await b.page.inputValue('#sName'), 'Beaumaris Pharmacy Plus');
  assert.equal(await b.page.inputValue('#dit'), 'Four reasons to walk in');
  // nothing kept in browser storage but view preferences
  const keys = await b.page.evaluate(() => Object.keys(localStorage));
  assert.ok(keys.every((k) => /^ps-admin-(orient|pharmacy|device-)/.test(k)), keys.join(','));
  await a.ctx.close(); await b.ctx.close();
});

test('a non-admin cannot open the editor or call write endpoints', async () => {
  const { ctx, page } = await open('dev-viewer');
  await page.waitForSelector('#gateBlocked:not([hidden])');
  assert.match(await page.textContent('#gateTitle'), /Admin role required/);
  assert.equal(await page.isHidden('#app'), true);
  await ctx.close();
  for (const [m, p, body] of [['POST', '/api/admin/pharmacies', { storeCode: 'X-1', name: 'x', colours: { primary: '#000000', accent: '#ffffff' } }], ['PATCH', '/api/admin/promotions/seed-promotion-morning', { name: 'x' }], ['PUT', '/api/settings/ph-api', { token: 'abcdefgh1234' }], ['DELETE', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002']]) {
    assert.equal((await api(m, p, { token: 'dev-viewer', body })).status, 403, `${m} ${p}`);
    assert.equal((await api(m, p, { token: 'nobody', body })).status, 401, `${m} ${p}`);
  }
});

test('the PH API token is write-only: saved encrypted, shown only as its last 4', async () => {
  const { ctx, page } = await open();
  await page.click('#setBtn');
  assert.equal(await page.isHidden('#addBtn'), true); // only "Back to pharmacy content" in the toolbar
  assert.match(await page.textContent('#setBtn'), /Back to pharmacy content/);
  await page.waitForSelector('#apiState:has-text("No token saved")');
  await page.fill('#apiBase', 'https://ph.example.com');
  await page.fill('#apiTok', TOKEN);
  await page.click('#apiSave');
  await page.waitForSelector('#apiState:has-text("••••QRST")');
  assert.equal(await page.inputValue('#apiTok'), '');
  assert.equal(await page.isVisible('#apiRm'), true);
  await page.reload();
  await page.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.ready);
  await page.click('#setBtn');
  await page.waitForSelector('#apiState:has-text("••••QRST")');
  assert.equal(await page.inputValue('#apiTok'), '');
  assert.ok(!(await page.content()).includes(TOKEN.slice(0, -4)), 'token not in the page');
  const got = await api('GET', '/api/settings/ph-api');
  assert.ok(!JSON.stringify(got.body).includes(TOKEN.slice(0, -4)), 'token not returned by the API');
  assert.ok(!JSON.stringify(dev.phSettings.raw()).includes(TOKEN), 'token not stored in plain text');
  assert.deepEqual(got.body.settings.baseUrls, ['https://ph.example.com']);
  await ctx.close();
});

test('Settings reads the store record from the Location API through the proxy; the preview uses it', async () => {
  const { ctx, page } = await open();
  await page.click('#setBtn');
  await page.fill('#devId', 'DEVICE-VIC-MP-001');
  await page.click('#devGo');
  await page.waitForSelector('#recBody:not([hidden])');
  const fields = await page.$$eval('#recFields .f', (f) => f.map((x) => x.textContent));
  assert.ok(fields.some((t) => /Suburb store_info\.address_info\.suburbBeaumaris/.test(t)), fields.join('|'));
  assert.equal(await page.$$eval('#recFields input', (i) => i.length), 0); // read-only
  assert.equal(await page.$$eval('#hours .d', (d) => d.length), 7);
  assert.match(await page.textContent('#pvData'), /DEVICE-VIC-MP-001/);
  assert.ok(dev.upstreamCalls.every((c) => c.key === TOKEN), 'the proxy adds the saved token');
  await page.click('#setBtn');
  await page.click('#playBtn');
  await page.click('#tl button[data-i="0"]');
  assert.match(await headline(page), /Good morning,\s*Beaumaris/);
  await page.click('#setBtn');
  await page.fill('#devId', 'NO-SUCH-DEVICE');
  await page.click('#devGo');
  await page.waitForSelector('#devErr:not([hidden])');
  await ctx.close();
});

test('promotions: create, unique promo ID, rename, delete with confirm', async () => {
  const { ctx, page } = await open();
  await page.click('#newPromoBtn');
  await page.fill('#npName', 'Weekend');
  assert.equal(await page.inputValue('#npToken'), 'weekend');
  await page.fill('#npToken', 'morning');
  await page.click('#npCreate');
  assert.match(await page.textContent('#npErr'), /already used/);
  await page.fill('#npToken', 'weekend');
  await page.click('#npCreate');
  await page.waitForSelector('#dpTabs button:has-text("Weekend")[aria-selected=true]');
  assert.match(await page.textContent('#pmUrl'), /promo=weekend/);
  await page.fill('#pmToken', 'closed');
  assert.match(await page.textContent('#pmErr'), /already used/);
  await page.fill('#pmToken', 'sat-sun');
  await page.fill('#pmName', 'Saturday and Sunday');
  await settle(page);
  const list = (await api('GET', '/api/admin/promotions')).body;
  const p = list.find((x) => x.promoId === 'sat-sun');
  assert.equal(p && p.name, 'Saturday and Sunday');
  assert.match(await page.textContent('#cpTip'), /promo=sat-sun&orientation=portrait$/);
  await page.click('#pmDel');
  assert.match(await page.textContent('#pmDelTx'), /Click again/);
  await page.click('#pmDel');
  await page.waitForSelector('#dpTabs button:has-text("Saturday")', { state: 'detached' });
  assert.ok(!(await api('GET', '/api/admin/promotions')).body.some((x) => x.promoId === 'sat-sun'));
  await ctx.close();
});

test('templates: built-ins read-only, clone, edit HTML with token chips, unsafe HTML refused, delete falls back', async () => {
  const { ctx, page } = await open();
  await page.click('#dpTabs button:has-text("Afternoon")');
  await page.click('#pmHtml');
  assert.equal(await page.isVisible('#tmLock'), true);
  assert.equal(await page.isDisabled('#tmName'), true);
  await page.click('#tmClone');
  await page.waitForFunction(() => !document.getElementById('tmName').disabled);
  assert.equal(await page.inputValue('#tmName'), 'Promotion scenes copy');
  await page.fill('#tmName', 'Afternoon layout');
  await page.click('#hdTabs button[data-t="html"]');
  assert.ok(await page.$$eval('#hdTokens button', (b) => b.some((x) => x.textContent === '${Headline}')));
  await page.click('#hdTabs button[data-t="css"]');
  await page.fill('#hdCss', '.s-head h2{letter-spacing:.02em}');
  await settle(page);
  let t = (await api('GET', '/api/admin/templates')).body.find((x) => x.name === 'Afternoon layout');
  assert.ok(t, 'custom template saved');
  assert.equal(t.css, '.s-head h2{letter-spacing:.02em}');
  const promo = (await api('GET', '/api/admin/promotions/seed-promotion-afternoon')).body;
  assert.equal(promo.templateId, t.id);
  await page.click('#hdTabs button[data-t="html"]');
  await page.click('#hdTokens button[data-t="Footer"]');
  assert.match(await page.inputValue('#hdHtml'), /\$\{Footer\}/);
  await page.fill('#hdHtml', '<div class="s-head">${Headline}</div><script>alert(1)</script>');
  await settle(page);
  await page.waitForSelector('#hdErr:not([hidden])');
  assert.match(await page.textContent('#hdErr'), /script/);
  await page.click('#hdReset');
  assert.match(await page.inputValue('#hdHtml'), /class="s-top"/);
  await settle(page);
  await page.click('#tmDel');
  await page.click('#tmDel');
  await page.waitForFunction(() => document.getElementById('tmName').disabled);
  assert.equal(await page.inputValue('#tmName'), 'Promotion scenes');
  assert.equal((await api('GET', '/api/admin/promotions/seed-promotion-afternoon')).body.templateId, 'builtin-promotion-scenes');
  await page.click('#hdDone');
  await ctx.close();
});

test('scenes: add from the service library (this pharmacy\'s services), reorder, durations, delete', async () => {
  const { ctx, page } = await open();
  await page.selectOption('#storeSel', 'seed-pharmacy-vic-mp-004');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-004');
  await page.click('#dpTabs button:has-text("Morning")');
  const before = await page.$$eval('#slotList .slot', (s) => s.length);
  await page.click('#addSlot');
  const shown = await page.$$eval('#svcList .svc', (b) => b.map((x) => x.dataset.id));
  const services = (await api('GET', '/api/admin/services')).body;
  assert.ok(shown.length > 0 && shown.every((id) => services.find((s) => s.id === id).offeredBy.includes('VIC-MP-004')));
  await page.uncheck('#svcMine');
  assert.equal(await page.$$eval('#svcList .svc', (b) => b.length), services.length);
  await page.fill('#svcQ', 'first aid');
  await page.click('#svcList .svc');
  assert.equal(await page.$$eval('#slotList .slot', (s) => s.length), before + 1);
  const last = before; // index of the added slot
  assert.equal(await page.inputValue(`#s${last}label`), 'First aid');
  await page.click(`#slotList .slot[data-i="${last}"] .mv[data-mv="-1"]`);
  assert.equal(await page.inputValue(`#s${last - 1}label`), 'First aid');
  await page.fill(`#s${last - 1}dur`, '4');
  assert.match(await page.textContent('#loopLen'), /Loop 1[0-9]s/);
  await settle(page);
  let c = (await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-004')).body.content['seed-promotion-morning'];
  assert.equal(c.slots[last - 1].label, 'First aid');
  assert.equal(c.slots[last - 1].dur, 4);
  await page.click(`#slotList .slot[data-i="${last - 1}"] .del`);
  await page.click(`#slotList .slot[data-i="${last - 1}"] .del`);
  assert.equal(await page.$$eval('#slotList .slot', (s) => s.length), before);
  await settle(page);
  c = (await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-004')).body.content['seed-promotion-morning'];
  assert.ok(!c.slots.some((s) => s.label === 'First aid'));
  await ctx.close();
});

test('preview: timeline and editor highlight each other; orientation and template URL follow', async () => {
  const { ctx, page } = await open();
  await page.click('#playBtn');
  await page.click('#tl button[data-i="2"]');
  assert.ok(await page.$eval('#slotList .slot[data-i="1"]', (e) => e.classList.contains('focus')));
  await page.focus('#cl3');
  await page.waitForSelector('#tl button[data-i="4"][aria-current="true"]');
  assert.match(await headline(page), /Walk in today/);
  await page.click('#dpTabs button:has-text("Closed")');
  await page.waitForFunction(() => document.querySelectorAll('#tl button').length === 3);
  await page.click('#orTabs button[data-or="landscape"]');
  await page.waitForFunction(() => document.getElementById('screen').classList.contains('land'));
  assert.match(await page.textContent('#cpTip'), /pharmacy-screen\.html\?device=\$\{UniqueDeviceID\}&promo=closed&orientation=landscape$/);
  await page.hover('#cpUrl');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cpTip')).opacity === '1');
  // opening hours editor: three rich-text headlines and the address toggle
  assert.equal(await page.$$eval('#dpBody .rt', (r) => r.length), 3);
  await page.check('#cAddr');
  await settle(page);
  assert.equal((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-001')).body.content['seed-promotion-closed'].showAddress, true);
  await page.click('#orTabs button[data-or="portrait"]');
  await ctx.close();
});

test('pharmacies: add (unique store code), logo upload and remove, delete', async () => {
  const { ctx, page } = await open();
  await page.click('#addBtn');
  await page.fill('#sName', 'Brighton Pharmacy');
  await page.fill('#sCode', 'vic-mp-001');
  assert.match(await page.textContent('#codeErr'), /already used/);
  await page.fill('#sCode', 'vic mp 006');
  assert.equal(await page.inputValue('#sCode'), 'VICMP006');
  await page.fill('#sCode', 'VIC-MP-006');
  await settle(page);
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.id);
  const list = (await api('GET', '/api/admin/pharmacies')).body;
  const created = list.find((p) => p.storeCode === 'VIC-MP-006');
  assert.ok(created);
  assert.deepEqual(created.promotionsWithContent.sort(), ['seed-promotion-afternoon', 'seed-promotion-closed', 'seed-promotion-morning']);
  // a 1x1 transparent PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#logoIn', { name: 'logo.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('#logoRm:not([hidden])');
  assert.ok((await api('GET', `/api/admin/pharmacies/${created.id}`)).body.logo);
  await page.click('#logoRm');
  await page.waitForSelector('#logoRm[hidden]', { state: 'attached' });
  await page.click('#delBtn');
  await page.click('#delBtn');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode !== 'VIC-MP-006');
  assert.ok(!(await api('GET', '/api/admin/pharmacies')).body.some((p) => p.storeCode === 'VIC-MP-006'));
  await ctx.close();
});

test('every save is audit-logged with the admin who made it', async () => {
  const audit = (await api('GET', '/api/admin/audit?limit=500')).body;
  const byEditor = audit.filter((e) => e.actorUid === 'dev-admin');
  for (const entity of ['pharmacy', 'promotion', 'template']) assert.ok(byEditor.some((e) => e.entity === entity), entity);
  assert.ok(dev.phAudit.entries.some((e) => e.action === 'ph-api.token.set' && e.actorUid === 'dev-admin'));
});
