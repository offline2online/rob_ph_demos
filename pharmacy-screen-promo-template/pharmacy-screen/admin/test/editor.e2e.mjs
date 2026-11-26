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
import { startDevServer, DEV_DEVICES } from '../tools/dev-server.mjs';
import * as M from '../js/model.js';
import fs from 'node:fs';
const CAMPAIGN_DEVICES = JSON.parse(fs.readFileSync(new URL('../../fixtures/campaign-data.json', import.meta.url), 'utf8')).devices;

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
// Download MP4's file-name rule, the one the server uses.
const { slug: videoSlug } = require('../../config-api/src/video/format.js');

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

// date: pin the browser's date (the Currently active promotion drop-down opens on what plays today).
// The editor opens on its first tab, Sales Promos; most tests here work on Morning, so open() selects it unless told
// to stay (stay: true), and says which tab was selected when the editor opened (firstTab).
async function open(token = 'dev-admin', { viewport = { width: 1400, height: 1000 }, path = '/admin/', date, stay = false } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  if (date) await page.clock.setFixedTime(new Date(date));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(dev.base + path);
  await page.fill('#gateTokenIn', token);
  await page.click('#gateToken button[type=submit]');
  let firstTab = null;
  if (token === 'dev-admin') {
    await page.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.ready, null, { timeout: 20000 });
    firstTab = await page.$eval('#dpTabs [aria-selected="true"]', (b) => b.dataset.dp).catch(() => null);
    if (!stay && firstTab === 'seed-promotion-sale') await page.click('#dpTabs button:has-text("Morning")');
  }
  return { ctx, page, errors, firstTab };
}
const settle = (page) => page.evaluate(async () => { await window.pharmacyAdmin.flush(); for (let i = 0; i < 100 && window.pharmacyAdmin.pending(); i++) await new Promise((r) => setTimeout(r, 50)); });
const api = async (method, path, { token = 'dev-admin', body } = {}) => {
  const r = await fetch(dev.base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null), text: '' };
};
// Seasonal content is always a pharmacy's own (config-api/src/seasonal.js), so its section is always detached:
// what a test means by "inherits everything" is every other section.
const detachedOf = (rec) => { const d = Object.fromEntries(Object.entries(rec.detached || {}).filter(([id]) => id !== 'seed-promotion-occasions')); return Object.keys(d).length ? d : undefined; };
const headline = (page) => page.$eval('#screen .s-head h2', (e) => e.textContent);
// The seeded promotions have a master template (Beaumaris's content), so a pharmacy inherits every section.
// Tests that edit a pharmacy's own copy first set the selected promotion's sections to be managed separately.
const own = async (page) => {
  for (let i = 0; i < 8; i++) {
    const b = await page.$('#dpBody .inh-act[data-own="0"]:not([disabled])');
    if (!b) return;
    await b.click();
    await settle(page);
  }
};

test('loads the pharmacies, promotions and a live preview from the server', async () => {
  const { ctx, page, errors, firstTab } = await open();
  // Sales Promos is the first tab, and the one selected when the editor opens.
  assert.equal(firstTab, 'seed-promotion-sale');
  const opts = await page.$$eval('#storeSel option', (o) => o.map((x) => x.textContent));
  assert.equal(opts.length, 5);
  assert.match(opts[0], /Beaumaris Pharmacy · VIC-MP-001/);
  // Promo preview offers the master template first, then the same pharmacies.
  assert.deepEqual(await page.$$eval('#pvSel option', (o) => o.map((x) => x.textContent)), ['Master template', ...opts]);
  assert.deepEqual(await page.$$eval('#dpTabs button', (b) => b.map((x) => x.textContent.replace(/^(sell|campaign|schedule|celebration)/, ''))), ['Sales Promos', 'Morning', 'Afternoon', 'Closed', 'Seasonal']);
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
  await own(a.page);
  await a.page.click('#setBtn'); // pharmacy details are in Settings
  await a.page.fill('#sName', 'Beaumaris Pharmacy Plus');
  await a.page.click('#setBtn');
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
  assert.ok(keys.every((k) => /^ps-admin-(orient|pharmacy)/.test(k)), keys.join(','));
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
  assert.equal(await page.isHidden('#pvSel'), true); // only "Back to promotions" in the toolbar
  assert.match(await page.textContent('#setBtn'), /Back to promotions/);
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
  // the screens' Location API calls go through the proxy, which adds the saved token
  assert.equal((await api('GET', '/api/device/DEVICE-VIC-MP-001/campaign_data', { token: '' })).status, 200);
  assert.ok(dev.upstreamCalls.length && dev.upstreamCalls.every((c) => c.key === TOKEN), 'the proxy adds the saved token');
  await ctx.close();
});

test('Settings holds the pharmacies, their details and branding, and the API; promotions has only a Promo preview drop-down', async () => {
  const { ctx, page, errors } = await open();
  // promotions page: no pharmacy details, branding or pharmacy management, just the Promo preview drop-down
  for (const id of ['#detailsCard', '#brandingCard', '#pharmaciesCard', '#addBtn', '#delBtn', '#sName', '#cP', '#logoBtn']) assert.equal(await page.isHidden(id), true, id);
  assert.equal(await page.isVisible('#pvSel'), true);
  assert.match(await page.textContent('#toolbar'), /Promo preview/);
  const pv = await page.$$eval('#pvSel option', (o) => o.map((x) => x.value));
  assert.deepEqual(pv, ['__master', ...(await page.$$eval('#storeSel option', (o) => o.map((x) => x.value)))]);
  assert.equal(pv.length, 6);
  // picking a pharmacy in Promo preview switches the content and the preview
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-003');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-003');
  assert.equal(await page.inputValue('#storeSel'), 'seed-pharmacy-vic-mp-003');
  // The pill says whose opening hours the preview uses. It sits under the preview, directly to the right of Pause on the
  // controls row (nothing about it above the preview any more), and always shows in full; the scene time is on its
  // own line under the scene bar. Its info tooltip says each screen uses its store's actual hours for the day and
  // time the promotion plays, opens above the row on hover and keyboard focus, and is not clipped.
  // VIC-MP-003 has a Screen device ID and the PH API token is saved (an earlier test), so the preview has its live
  // store data and the pill says so (Settings → Screen device ID).
  await page.waitForFunction(() => document.getElementById('pvData').textContent === 'Live opening hours');
  const pvRow = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const p = document.getElementById('pvData'), row = p.parentElement, b = p.getBoundingClientRect(), play = r('#playBtn');
    return { cls: row.className, kids: [...row.children].map((e) => e.id || e.className), parent: row.parentElement.className,
      afterPlay: row.previousElementSibling && row.previousElementSibling.id, cut: p.scrollWidth > p.clientWidth, h: b.height, top: b.top,
      left: b.left, playRight: play.right, centre: (b.top + b.bottom) / 2, playCentre: (play.top + play.bottom) / 2,
      stageBottom: r('#stage').bottom, tlBottom: r('#tl').bottom, timeTop: r('#tlTime').top, timeBottom: r('#tlTime').bottom, controlsTop: r('.controls').top,
      tabsNext: document.getElementById('orTabs').nextElementSibling.id, timeInControls: !!document.querySelector('.controls #tlTime') };
  });
  assert.equal(pvRow.cls, 'pvnote', JSON.stringify(pvRow));
  assert.deepEqual(pvRow.kids, ['pvData', 'infowrap'], 'the label holds only the pill and its info icon');
  assert.equal(pvRow.parent, 'controls', 'on the controls row under the preview');
  assert.equal(pvRow.afterPlay, 'playBtn', 'directly to the right of Pause');
  assert.equal(pvRow.tabsNext, 'stage', 'nothing between the Portrait/Landscape tabs and the preview');
  assert.ok(pvRow.top >= pvRow.stageBottom && pvRow.left > pvRow.playRight && Math.abs(pvRow.centre - pvRow.playCentre) <= 1, `below the screen, right of Pause, same row: ${JSON.stringify(pvRow)}`);
  assert.equal(pvRow.cut, false, 'the label is not cut off');
  assert.equal(pvRow.timeInControls, false, 'the scene time is not on the controls row');
  assert.ok(pvRow.timeTop >= pvRow.tlBottom - 0.5 && pvRow.timeBottom <= pvRow.controlsTop, `scene time under the scene bar: ${JSON.stringify(pvRow)}`);
  // In the narrowest preview column (240px, a tablet-sized frame), Pause shows as its icon alone and the label still
  // shares its line and shows in full.
  const pvNarrow = await page.evaluate(async () => {
    const pv = document.querySelector('.pv'), row = document.querySelector('.controls'), p = document.getElementById('pvData'), play = document.getElementById('playBtn');
    pv.style.width = '240px';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = p.getBoundingClientRect(), pb = play.getBoundingClientRect(), i = document.getElementById('pvInfo').getBoundingClientRect();
    const d = document.getElementById('dlBtn').getBoundingClientRect();
    const out = { h: b.height, cut: p.scrollWidth > p.clientWidth, inside: i.right <= d.left + 0.5 && d.right <= row.getBoundingClientRect().right + 0.5, dlSameLine: Math.abs((d.top + d.bottom) / 2 - (pb.top + pb.bottom) / 2) <= 1, sameLine: Math.abs((b.top + b.bottom) / 2 - (pb.top + pb.bottom) / 2) <= 1, overlap: b.left < pb.right, text: p.innerText.replace(/\s+/g, ' '), playName: play.textContent.replace('pause', '').trim(), playW: pb.width };
    pv.style.width = '';
    return out;
  });
  assert.ok(Math.abs(pvNarrow.h - pvRow.h) < 1, `one line when narrow: ${JSON.stringify(pvNarrow)} vs ${pvRow.h}`);
  assert.equal(pvNarrow.cut, false);
  assert.equal(pvNarrow.inside, true, `Download MP4 fits after the label, inside the row: ${JSON.stringify(pvNarrow)}`);
  assert.equal(pvNarrow.dlSameLine, true, JSON.stringify(pvNarrow));
  assert.equal(pvNarrow.sameLine, true, JSON.stringify(pvNarrow));
  assert.equal(pvNarrow.overlap, false, JSON.stringify(pvNarrow));
  assert.equal(pvNarrow.text, 'Live opening hours');
  assert.ok(['Pause', 'Play'].includes(pvNarrow.playName) && pvNarrow.playW < 60, `Pause as its icon, named for screen readers: ${JSON.stringify(pvNarrow)}`);
  assert.match(await page.textContent('#pvTip'), /^Read from Personalisation Hub for Ocean Grove Terrace Pharmacy at \d{1,2}:\d{2} [ap]m\. The preview shows its own opening hours, suburb, store name and logo, as its screens do\.$/);
  await page.hover('#pvInfo');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('pvTip')).opacity === '1');
  const pvTip = await page.$eval('#pvTip', (e) => { const r = e.getBoundingClientRect(), c = e.closest('.controls').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cl: c.left, cr: c.right, ct: c.top, h: r.height }; });
  assert.ok(pvTip.l >= pvTip.cl - 0.5 && pvTip.r <= pvTip.cr + 0.5 && pvTip.b <= pvTip.ct && pvTip.t >= 0 && pvTip.h > 40, JSON.stringify(pvTip));
  await page.mouse.move(0, 0);
  await page.focus('#playBtn');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pvInfo');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('pvTip')).opacity === '1');
  await page.evaluate(() => document.activeElement.blur());
  // Settings: pharmacies, details, branding and the PH API; the store record section is gone
  await page.click('#setBtn');
  for (const id of ['#pharmaciesCard', '#addBtn', '#detailsCard', '#sName', '#sCode', '#brandingCard', '#cP', '#cA', '#logoBtn', '#apiBase']) assert.equal(await page.isVisible(id), true, id);
  assert.equal(await page.inputValue('#sCode'), 'VIC-MP-003');
  assert.equal((await page.$$('#devId, #devGo, #recBody')).length, 0);
  assert.doesNotMatch(await page.textContent('#settingsView'), /Store record/);
  // picking a pharmacy in Settings moves Promo preview with it
  await page.selectOption('#storeSel', 'seed-pharmacy-vic-mp-001');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-001');
  assert.equal(await page.inputValue('#pvSel'), 'seed-pharmacy-vic-mp-001');
  await page.click('#setBtn');
  assert.equal(await page.isVisible('#dpTabs'), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Settings → Tokens: lists the tokens the pharmacy uses (master included); a value set by hand shows and is published', async () => {
  const { ctx, page, errors } = await open();
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-001');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-001');
  await page.click('#setBtn');
  assert.equal(await page.isVisible('#tokensCard'), true);
  const names = await page.$$eval('#tokList input[data-token]', (l) => l.map((e) => e.dataset.token));
  assert.ok(names.includes('Suburb'), `Suburb in ${names}`);
  // ${StoreName} is the Pharmacy name field (its token shown beside the label); today's hours are filled live.
  for (const n of ['StoreName', 'CloseTime', 'OpenTime']) assert.ok(!names.includes(n), `${n} not in ${names}`);
  assert.equal((await page.textContent('#detailsCard label:has(#sName) > span')).trim(), 'Pharmacy name * ${StoreName}');
  assert.equal(await page.textContent('#sNameTok'), '${StoreName}');
  assert.ok(!names.some((n) => ['Headline', 'Logo', 'Content', 'Footer'].includes(n)), 'layout slots are not listed');
  // A pharmacy with live store data shows its Personalisation Hub suburb as the placeholder; else where it comes from.
  assert.equal(await page.getAttribute('#tokList input[data-token="Suburb"]', 'placeholder'), (await page.textContent('#pvData')) === 'Live opening hours' ? 'Beaumaris (from Personalisation Hub)' : 'Suburb from store details');
  assert.match(await page.textContent('#tokList'), /Used in Morning/);
  // A value set by hand wins over the store's suburb, in the preview as on the screens.
  assert.doesNotMatch(await headline(page), /Testville/);
  await page.fill('#tokList input[data-token="Suburb"]', 'Testville');
  await page.waitForFunction(() => /Testville/.test(document.querySelector('#screen .s-head h2').textContent));
  await settle(page);
  assert.deepEqual((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-001')).body.tokens, { Suburb: 'Testville' });
  assert.deepEqual((await api('GET', '/api/screens/VIC-MP-001', { token: null })).body.tokens, { Suburb: 'Testville' });
  // Kept after a reload; clearing it shows the store's data again and removes it from the record.
  await page.reload();
  await page.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.ready, null, { timeout: 20000 });
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-001');
  await page.click('#setBtn');
  assert.equal(await page.inputValue('#tokList input[data-token="Suburb"]'), 'Testville');
  await page.fill('#tokList input[data-token="Suburb"]', '');
  await settle(page);
  assert.equal((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-001')).body.tokens, undefined);
  // A token used only in a custom template renders from the value set by hand; ${StoreName} in copy is always the
  // pharmacy name, even with a value stored for it before it stopped being settable.
  const html = await page.evaluate(async () => {
    const R = await import('/js/render.js');
    const el = document.createElement('div'); el.id = 'tokTest'; el.className = 'screen'; document.body.append(el);
    const cfg = { promotions: [{ id: 'x', promoId: 'x', template: 'c1' }], templates: [{ id: 'c1', base: 'scenes', html: '<div class="s-head">${Headline}</div><p class="w">${Website}</p><div class="s-body">${Content}</div>' }],
      pharmacies: [{ storeCode: 'T1', name: 'Own Name', brand: { p: '#0f1050', a: '#5ee6b0' }, tokens: { Website: 'mi.example', StoreName: 'Set Name' },
        content: { x: { greeting: 'Hi', introTitle: 'From ${StoreName}', introSub: 'Visit ${Website}', slots: [], close: { title: 'Bye' } } } }] };
    const store = R.storeModel({ data: { store_location: { store_code: 'T1' } } }, cfg);
    R.renderScene(el, { store, play: R.resolvePromotion(cfg, store, 'x'), orientation: 'portrait', scene: 0 });
    const out = el.innerHTML; el.remove(); return out;
  });
  assert.match(html, /<p class="w">mi\.example<\/p>/);
  assert.match(html, /From Own Name/);
  assert.doesNotMatch(html, /Set Name/);
  assert.match(html, /Visit mi\.example/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('promotions: create, unique promo ID, rename, delete with confirm', async () => {
  const { ctx, page } = await open();
  await page.click('#newPromoBtn');
  await page.fill('#npName', 'Weekend');
  assert.equal(await page.inputValue('#npToken'), 'weekend');
  // Schedule: No schedule by default, no dates; Annual shows a start and an end date.
  assert.equal(await page.inputValue('#npSch'), 'none');
  assert.equal(await page.$('#npFromd'), null);
  await page.selectOption('#npSch', 'annual');
  await page.waitForSelector('#npFromd');
  await page.selectOption('#npFromd', '1'); await page.selectOption('#npFromm', '11');
  await page.selectOption('#npTod', '15'); await page.selectOption('#npTom', '1');
  await page.fill('#npToken', 'morning');
  await page.click('#npCreate');
  assert.match(await page.textContent('#npErr'), /already used/);
  await page.fill('#npToken', 'weekend');
  await page.click('#npCreate');
  await page.waitForSelector('#dpTabs button:has-text("Weekend")[aria-selected=true]');
  assert.match(await page.textContent('#pmUrl'), /promo=weekend/);
  assert.deepEqual((await api('GET', '/api/admin/promotions')).body.find((x) => x.promoId === 'weekend').schedule, { type: 'annual', from: '11-01', to: '01-15' });
  assert.equal(await page.inputValue('#pmSch'), 'annual');
  assert.equal(await page.inputValue('#pmFromm'), '11');
  // Back to No schedule: the dates go, on the page and on the server.
  await page.selectOption('#pmSch', 'none');
  assert.equal(await page.$('#pmFromd'), null);
  await settle(page);
  assert.equal((await api('GET', '/api/admin/promotions')).body.find((x) => x.promoId === 'weekend').schedule, undefined);
  // An existing promotion can be given one too.
  await page.selectOption('#pmSch', 'annual');
  await page.selectOption('#pmTod', '30'); await page.selectOption('#pmTom', '12');
  await settle(page);
  assert.equal((await api('GET', '/api/admin/promotions')).body.find((x) => x.promoId === 'weekend').schedule.to, '12-30');
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

test('seasonal: Currently active promotion opens on what plays (the Fallback outside every season), previews any one, and Activate on display puts it on the screens to its end date', async () => {
  // 1 July 2026: outside every season's dates.
  const { ctx, page, errors } = await open('dev-admin', { date: '2026-07-01T12:00:00' });
  await page.click('#dpTabs button:has-text("Seasonal")');
  await own(page);
  await page.click('#playBtn'); // pause
  // The Template drop-down is Currently active promotion here; seasonal templates have no Edit HTML.
  assert.equal(await page.$eval('#pmTpl', (e) => e.closest('label').querySelector('span').textContent), 'Currently active promotion');
  // The Fallback first, then each season with its start and end dates after its name (Easter's are this year's); the
  // one the screens play now ends in "· on display".
  const seasonOpts = () => page.$$eval('#pmTpl option', (o) => o.map((x) => x.textContent));
  const easterOpt = (await seasonOpts())[5];
  assert.match(easterOpt, /^Easter \(\d{1,2} (Mar|Apr) – \d{1,2} (Mar|Apr)\)$/);
  assert.deepEqual(await seasonOpts(), ['Fallback · on display', 'Christmas (15 Dec – 27 Dec)', "New Year's (28 Dec – 5 Jan)", 'Australia Day (26 Jan)', "Valentine's Day (14 Feb)", easterOpt, 'Anzac Day (25 Apr)']);
  assert.equal(await page.inputValue('#pmTpl'), 'builtin-occasion-fallback');
  assert.equal(await page.isHidden('#pmHtml'), true);
  assert.equal(await page.textContent('#pmActivate'), 'check_circleOn display');
  assert.equal(await page.isDisabled('#pmActivate'), true);
  // The Fallback: the pharmacy's branding, three beats, exactly 7 s (no seconds to set), no dates.
  await page.waitForFunction(() => document.querySelector('#screen .occ.occ-thankyou'));
  assert.deepEqual(await page.$$eval('#tl button .lb', (b) => b.map((x) => x.textContent)), ['1Beat 1', '2Beat 2', '3Beat 3']);
  assert.equal(await page.textContent('#loopLen'), 'Loop 7s');
  assert.equal(await page.textContent('#pbSecs'), '8s');
  assert.equal(await page.$$eval('#occList input[type=number], #occDates select', (e) => e.length), 0);
  assert.match(await page.textContent('#occDates'), /When it plays.*Whenever no season is on/);
  assert.match(await page.$eval('#screen .occ', (e) => e.style.getPropertyValue('--b-p')), /^#[0-9a-f]{6}$/i);
  // Picking Christmas previews it only: the screens are unchanged until Activate on display.
  await page.selectOption('#pmTpl', 'builtin-occasion-christmas');
  await page.waitForFunction(() => document.querySelector('#screen .occ.occ-christmas'));
  await settle(page);
  assert.equal((await api('GET', '/api/screens/VIC-MP-001', { token: null })).body.promotions.occasions.content.activation, undefined);
  assert.equal(await page.textContent('#pmActivate'), 'castActivate on display');
  assert.equal(await page.isDisabled('#pmActivate'), false);
  assert.match(await page.getAttribute('#pmActivate', 'title'), /until its end date, 27 Dec 2026, then the screens go back to the Fallback/);
  // Christmas: two beats, each a card of its lines; the preview draws the standalone design (no brand panel).
  assert.deepEqual(await page.$$eval('#tl button .lb', (b) => b.map((x) => x.textContent)), ['1Beat 1', '2Beat 2']);
  // The seeded seconds (3 s + 4 s): every season's loop is 7 s, so the playback duration is 8 s.
  assert.equal(await page.textContent('#loopLen'), 'Loop 7s');
  assert.equal(await page.textContent('#pbSecs'), '8s');
  // Each Main line and each Small line has its "+ Add token" menu (aria-label "Add token") on its label row, and
  // its "Tokens used" row under it.
  assert.deepEqual(await page.$$eval('#occList .slot [aria-label], #occList .slot input', (e) => e.map((x) => x.getAttribute('aria-label') || (x.labels && x.labels[0] ? x.labels[0].textContent : x.closest('label').querySelector('span').textContent))), ['Starts: day', 'Starts: month', 'Ends: day', 'Ends: month', 'Seconds on screen', 'Add token', 'Main line', 'Tokens used', 'Seconds on screen', 'Add token', 'Small line above', 'Tokens used', 'Add token', 'Main line', 'Tokens used']);
  // Christmas's dates: 15 to 27 December by default; changing them is saved with the copy and reaches the screen.
  assert.equal(await page.textContent('#occWhen'), '15 Dec to 27 Dec');
  // The dates read as a yearly schedule: start and end, every year.
  assert.equal(await page.textContent('#occYearly'), 'event_repeatEvery year:15 Dec to 27 Dec');
  assert.equal(await page.isVisible('#occYearly'), true);
  assert.deepEqual([await page.inputValue('#occFromd'), await page.inputValue('#occFromm'), await page.inputValue('#occTod'), await page.inputValue('#occTom')], ['15', '12', '27', '12']);
  await page.selectOption('#occTod', '24');
  assert.equal(await page.textContent('#occWhen'), '15 Dec to 24 Dec');
  // The drop-down follows the change straight away, and keeps Christmas selected.
  assert.equal((await seasonOpts())[1], 'Christmas (15 Dec – 24 Dec)');
  assert.equal(await page.inputValue('#pmTpl'), 'builtin-occasion-christmas');
  await settle(page);
  const xmasDates = (await api('GET', '/api/screens/VIC-MP-001', { token: null })).body.promotions.occasions.content.occasions.christmas;
  assert.deepEqual([xmasDates.from, xmasDates.to], ['12-15', '12-24']);
  await page.selectOption('#occTod', '27');
  assert.equal(await page.textContent('#occWhen'), '15 Dec to 27 Dec');
  assert.equal((await seasonOpts())[1], 'Christmas (15 Dec – 27 Dec)');
  // Each beat has its own seconds on screen: the loop, the timeline and the playback duration follow, and the playing
  // preview runs the beats on keyframes of that length.
  assert.deepEqual(await page.$$eval('#occList input[type=number]', (e) => e.map((x) => x.value)), ['3', '4']);
  await page.fill('#o0dur', '8');
  assert.equal(await page.textContent('#loopLen'), 'Loop 12s');
  await page.waitForFunction(() => document.getElementById('pbSecs').textContent === '13s');
  assert.match(await page.getAttribute('#tl button[data-i="0"]', 'title'), /· 8s$/);
  await page.click('#playBtn'); // play
  await page.waitForFunction(() => { const b = document.querySelector('#screen .occ-christmas:not(.hold) .b1'); return b && getComputedStyle(b).animationDuration === '12s' && /^occT8_4B1$/.test(getComputedStyle(b).animationName); });
  await page.click('#playBtn'); // pause
  await settle(page);
  assert.equal((await api('GET', '/api/screens/VIC-MP-001', { token: null })).body.promotions.occasions.content.occasions.christmas.beats[0].dur, 8);
  await page.fill('#o0dur', '3');
  assert.equal(await page.textContent('#loopLen'), 'Loop 7s');
  await page.click('#tl button[data-i="1"]');
  await page.waitForFunction(() => document.querySelector('#screen .occ.occ-christmas.hold .b2.on'));
  assert.equal(await page.$$eval('#screen .s-top, #screen .s-logo, #screen .s-foot', (e) => e.length), 0);
  // ${StoreName} is the store name Personalisation Hub returns for the pharmacy's screen device, as on its screens
  // (the preview reads it live); the pharmacy's name as saved only without live store data.
  const name = await page.evaluate(() => { const ph = window.pharmacyAdmin.state.cur; return document.getElementById('pvData').textContent === 'Live opening hours' ? 'Beaumaris Pharmacy' : ph.name; });
  assert.equal(await page.$eval('#screen .b2 .sub', (e) => e.textContent), `from the whole ${name} team`);
  assert.equal(await page.$eval('#screen .b2 .kicker', (e) => e.textContent), 'With warm wishes');
  // Edit Christmas's second beat, then switch to Easter and edit a line there.
  await page.fill('#o1text', 'from all of us at ${StoreName}');
  await page.waitForFunction(() => /from all of us at/.test(document.querySelector('#screen .b2 .sub').textContent));
  await page.selectOption('#pmTpl', 'builtin-occasion-easter');
  await page.click('#tl button[data-i="0"]');
  await page.waitForFunction(() => document.querySelector('#screen .occ.occ-easter .b1.on') && /Happy Easter/.test(document.querySelector('#screen .b1.on').textContent));
  assert.deepEqual(await page.$$eval('#tl button .lb', (b) => b.map((x) => x.textContent)), ['1Beat 1', '2Beat 2', '3Beat 3']);
  // Easter moves each year: its dates are worked out (Good Friday to Easter Monday), not picked.
  assert.equal(await page.isVisible('#occEaster'), true);
  assert.equal(await page.$$eval('#occDates select', (e) => e.length), 0);
  assert.match(await page.textContent('#occWhen'), / this year$/);
  await page.fill('#o1text', 'Have a safe long weekend, everyone');
  await settle(page);
  // Previewing changed nothing on the screens: still published as the Fallback, nothing activated.
  let screen = (await api('GET', '/api/screens/VIC-MP-001', { token: null })).body.promotions.occasions;
  assert.deepEqual([screen.template.kind, screen.template.occasion, screen.content.activation], ['occasion', 'fallback', undefined]);
  // Activate on display: Easter goes on this pharmacy's screens now, until Easter Monday 2027 (the next Easter);
  // the button then reads On display and Easter's line "· on display". Other stores are not touched.
  await page.click('#pmActivate');
  await settle(page);
  screen = (await api('GET', '/api/screens/VIC-MP-001', { token: null })).body.promotions.occasions;
  assert.deepEqual(screen.content.activation, { occasion: 'easter', until: '2027-03-29' });
  // Published as Easter's template while it runs, so a screen still on an older player plays Easter too.
  assert.deepEqual([screen.template.kind, screen.template.occasion], ['occasion', 'easter']);
  assert.equal(await page.textContent('#pmActivate'), 'check_circleOn display');
  assert.match((await seasonOpts())[5], /· on display$/);
  assert.doesNotMatch((await seasonOpts())[0], /on display/);
  assert.equal((await api('GET', '/api/screens/VIC-MP-002', { token: null })).body.promotions.occasions.content.activation, undefined);
  assert.equal(screen.content.occasions.easter.beats[1].text, 'Have a safe long weekend, everyone');
  assert.equal(screen.content.occasions.christmas.beats[1].text, 'from all of us at ${StoreName}', 'Christmas copy kept');
  assert.ok(!/StoreName/.test(JSON.stringify(screen.content.occasions.easter)), 'Easter: suburb only, no store-name sign-off');
  // Every occasion previews its own design, in both orientations, and shows its seeded seconds: a 7 s loop.
  for (const o of ['christmas', 'new-year', 'australia-day', 'valentines-day', 'easter', 'anzac-day']) {
    await page.selectOption('#pmTpl', 'builtin-occasion-' + o);
    await page.waitForFunction((d) => document.querySelector('#screen .occ.occ-' + d), { christmas: 'christmas', 'new-year': 'newyear', 'australia-day': 'ausday', 'valentines-day': 'valentine', easter: 'easter', 'anzac-day': 'anzac' }[o]);
    const secs = { christmas: ['3', '4'], 'new-year': ['2', '2', '3'], 'australia-day': ['2', '2', '3'], 'valentines-day': ['3', '2', '2'], easter: ['2', '3', '2'], 'anzac-day': ['3', '2', '2'] }[o];
    await page.waitForFunction((n) => document.querySelectorAll('#occList input[type=number]').length === n, secs.length);
    assert.deepEqual(await page.$$eval('#occList input[type=number]', (e) => e.map((x) => x.value)), secs, `${o}: seconds per beat`);
    assert.equal(await page.textContent('#loopLen'), 'Loop 7s', `${o}: loop`);
  }
  await page.selectOption('#pmTpl', 'builtin-occasion-easter');
  await page.waitForFunction(() => { const b = document.querySelector('#screen .occ-easter .b2'); return b && /Have a safe long weekend, everyone/.test(b.textContent); }, null, { timeout: 5000 });
  // Activating the Fallback outside every season is what the schedule plays anyway: the activation is cleared.
  await page.selectOption('#pmTpl', 'builtin-occasion-fallback');
  await page.click('#pmActivate');
  await settle(page);
  assert.equal((await api('GET', '/api/screens/VIC-MP-001', { token: null })).body.promotions.occasions.content.activation, undefined);
  assert.equal(await page.textContent('#pmActivate'), 'check_circleOn display');
  assert.equal((await api('GET', '/api/admin/promotions/seed-promotion-occasions')).body.templateId, 'builtin-occasion-christmas', 'the promotion itself is untouched');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('scenes: add from the whole service library, reorder, durations, delete', async () => {
  const { ctx, page } = await open();
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-004');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-004');
  await page.click('#dpTabs button:has-text("Morning")');
  await own(page);
  const before = await page.$$eval('#slotList .slot', (s) => s.length);
  await page.click('#addSlot');
  // every service in the library, for every pharmacy: no "offered by" filter or labels
  const services = (await api('GET', '/api/admin/services')).body;
  assert.ok(services.some((s) => !s.offeredBy.includes('VIC-MP-004')));
  assert.equal(await page.$$eval('#svcList .svc', (b) => b.length), services.length);
  assert.equal(await page.$('#svcMine'), null);
  assert.doesNotMatch(await page.textContent('#svcPick'), /offered by/i);
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
  // a just-added promotion is deleted with one click
  await page.click(`#slotList .slot[data-i="${last - 1}"] .del`);
  assert.equal(await page.$$eval('#slotList .slot', (s) => s.length), before);
  await settle(page);
  c = (await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-004')).body.content['seed-promotion-morning'];
  assert.ok(!c.slots.some((s) => s.label === 'First aid'));
  // an existing promotion still asks to confirm
  await page.click('#slotList .slot[data-i="0"] .del');
  assert.equal(await page.$$eval('#slotList .slot', (s) => s.length), before);
  assert.match(await page.textContent('#slotList .slot[data-i="0"] .del'), /Confirm/);
  await ctx.close();
});

test('scenes: Add promotion picker closes without adding; a new promotion can be removed at once', async () => {
  const { ctx, page, errors } = await open();
  await page.click('#playBtn'); // pause
  await page.click('#dpTabs button:has-text("Afternoon")');
  await own(page);
  const heads = await page.$$eval('#dpBody .slot-h', (h) => h.map((x) => x.textContent.trim()));
  assert.ok(heads.some((t) => t.startsWith('Top: Greeting')), heads.join('|'));
  assert.ok(heads.some((t) => t.startsWith('Tail: Walk-in close')), heads.join('|'));
  assert.ok(heads.some((t) => t.startsWith('Footer: Open today bar')), heads.join('|'));
  assert.equal(await page.isChecked('#ftShow'), true);
  const before = await page.$$eval('#slotList .slot', (s) => s.length);
  const scenes = await page.$$eval('#tl button', (b) => b.length);
  // Close button: nothing added
  await page.click('#addSlot');
  assert.equal(await page.isVisible('#svcPick'), true);
  await page.click('#svcClose');
  assert.equal(await page.isHidden('#svcPick'), true);
  assert.equal(await page.getAttribute('#addSlot', 'aria-expanded'), 'false');
  // Escape: nothing added
  await page.click('#addSlot');
  await page.press('#svcQ', 'Escape');
  assert.equal(await page.isHidden('#svcPick'), true);
  assert.equal(await page.$$eval('#slotList .slot', (s) => s.length), before);
  assert.equal(await page.$$eval('#tl button', (b) => b.length), scenes);
  // add a blank promotion, then delete it straight away: preview timeline follows
  await page.click('#addSlot');
  await page.click('#svcBlank');
  assert.equal(await page.$$eval('#slotList .slot', (s) => s.length), before + 1);
  await page.waitForFunction((n) => document.querySelectorAll('#tl button').length === n, scenes + 1);
  await page.click(`#slotList .slot[data-i="${before}"] .del`);
  assert.equal(await page.$$eval('#slotList .slot', (s) => s.length), before);
  await page.waitForFunction((n) => document.querySelectorAll('#tl button').length === n, scenes);
  await settle(page);
  const c = (await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-001')).body.content['seed-promotion-afternoon'];
  assert.equal(c.slots.length, before);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('preview: Copy experience URL with a live playback duration and its setup tooltip', async () => {
  const { ctx, page } = await open();
  await own(page);
  // The admin view keeps the ${Suburb} hint, the remote config and this row (the pharmacy view hides them).
  for (const id of ['#dpHint', '#cfgBox', '#cpRow', '#pbInfo']) assert.equal(await page.isVisible(id), true, id);
  assert.match(await page.textContent('#cpTx'), /^Copy experience URL$/);
  const total = async () => +(await page.textContent('#tlTime')).match(/ ([\d.]+)s/)[1];
  const shown = async () => +(await page.textContent('#pbSecs')).replace('s', '');
  const t0 = await total();
  assert.equal(await shown(), Math.ceil(t0 + 1));
  assert.match(await page.textContent('#pbDur'), /^Playback duration: \d+s/);
  // retime the first scene by +3s: the number follows at once
  const d0 = +(await page.inputValue('#s0dur'));
  await page.fill('#s0dur', String(d0 + 3));
  await page.waitForFunction((n) => document.getElementById('pbSecs').textContent === `${n}s`, Math.ceil(t0 + 3 + 1));
  await page.fill('#s0dur', String(d0 + 2.5));
  await page.waitForFunction((n) => document.getElementById('pbSecs').textContent === `${n}s`, Math.ceil(t0 + 2.5 + 1));
  await page.fill('#s0dur', String(d0));
  await page.waitForFunction((n) => document.getElementById('pbSecs').textContent === `${n}s`, Math.ceil(t0 + 1));
  // the info tooltip names the same N and wraps
  const n = await shown();
  assert.equal(await page.textContent('#pbTip'), `To run this promotion, open the campaign's Creative tab, turn on Experience URL and paste this URL in. Set the playback duration to ${n} seconds, which is one second longer than the promotion so the last scene finishes. Then save and activate the campaign to put it live.`);
  await page.hover('#pbInfo');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('pbTip')).opacity === '1');
  const box = await page.$eval('#pbTip', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, vw: innerWidth }; });
  assert.ok(box.h > 40 && box.w <= 281 && box.l >= 0, JSON.stringify(box));
  // another promotion carries its own length
  await page.click('#dpTabs button:has-text("Closed")');
  await page.waitForFunction(() => document.querySelectorAll('#tl button').length === 3);
  await page.waitForFunction(() => { const m = document.getElementById('tlTime').textContent.match(/ ([\d.]+)s/); return m && document.getElementById('pbSecs').textContent === `${Math.ceil(+m[1] + 1)}s`; });
  await ctx.close();
});

test('preview: timeline and editor highlight each other; orientation and experience URL follow', async () => {
  const { ctx, page } = await open();
  await own(page);
  await page.click('#playBtn');
  await page.click('#tl button[data-i="2"]');
  assert.ok(await page.$eval('#slotList .slot[data-i="1"]', (e) => e.classList.contains('focus')));
  await page.focus('#cl3');
  await page.waitForSelector('#tl button[data-i="4"][aria-current="true"]');
  assert.match(await headline(page), /Walk in today/);
  await page.click('#dpTabs button:has-text("Closed")');
  await page.waitForFunction(() => document.querySelectorAll('#tl button').length === 3);
  await own(page);
  await page.click('#orTabs button[data-or="landscape"]');
  await page.waitForFunction(() => document.getElementById('screen').classList.contains('land'));
  assert.match(await page.textContent('#cpTip'), /pharmacy-screen\.html\?device=\$\{UniqueDeviceID\}&promo=closed&orientation=landscape$/);
  await page.hover('#cpUrl');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cpTip')).opacity === '1');
  // opening hours editor: three rich-text headlines, each with its own seconds on screen, and the address toggle
  assert.equal(await page.$$eval('#dpBody .rt', (r) => r.length), 3);
  assert.deepEqual(await page.$$eval('#hlSec input[type=number]', (e) => e.map((x) => x.value)), ['2.7', '2.7', '2.6']);
  assert.equal(await page.textContent('#loopLen'), 'Loop 8s');
  await page.fill('#h1dur', '4');
  assert.equal(await page.textContent('#loopLen'), 'Loop 9.3s');
  await page.waitForSelector('#tl button[data-i="1"][aria-current="true"]');
  // The timeline re-renders after the edit: wait for it rather than reading the title straight away.
  await page.waitForFunction(() => /· 4s$/.test(document.querySelector('#tl button[data-i="1"]').title), null, { timeout: 5000 });
  assert.ok(await page.$eval('#hlSec .slot[data-h="1"]', (e) => e.classList.contains('focus')));
  await settle(page);
  assert.equal((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-001')).body.content['seed-promotion-closed'].headlineDurs[1], 4);
  await page.check('#cAddr');
  await settle(page);
  assert.equal((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-001')).body.content['seed-promotion-closed'].showAddress, true);
  await page.click('#orTabs button[data-or="portrait"]');
  await ctx.close();
});

test('pharmacies: add (unique store code), logo upload and remove, delete', async () => {
  const { ctx, page } = await open();
  await page.click('#setBtn'); // adding a pharmacy, its details and branding are in Settings
  await page.click('#addBtn');
  assert.equal(await page.isVisible('#settingsView'), true);
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
  assert.deepEqual(created.promotionsWithContent.sort(), ['seed-promotion-afternoon', 'seed-promotion-closed', 'seed-promotion-morning', 'seed-promotion-occasions', 'seed-promotion-sale']);
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

test('edits made while a new pharmacy is being created are saved too, and the pill waits for them', async () => {
  const { ctx, page, errors } = await open();
  // a slow create (a Cloud Function cold start)
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/api/admin/pharmacies', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await held;
    return route.continue();
  });
  await page.click('#setBtn');
  await page.click('#addBtn');
  await page.fill('#sName', 'Hampton Pharmacy');
  const posted = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/admin\/pharmacies$/.test(r.url()));
  await page.fill('#sCode', 'VIC-MP-007');
  const req = await posted;
  assert.equal(JSON.parse(req.postData()).name, 'Hampton Pharmacy');
  // while the create is in flight: rename it and change its accent colour (its content is the master template's,
  // inherited, so there is no content of its own to edit yet)
  assert.equal(await page.$eval('#dit', (e) => e.closest('[inert]') !== null), true);
  await page.fill('#sName', 'Hampton Street Pharmacy');
  await page.fill('#cA', '#123456');
  await page.waitForTimeout(800); // longer than the edit debounce
  assert.match(await page.textContent('#saveState'), /Saving/);
  release();
  // no flush from the test: the pill alone must not say saved before the edits land
  await page.waitForFunction(() => /All changes saved/.test(document.getElementById('saveState').textContent), null, { timeout: 15000 });
  const created = (await api('GET', '/api/admin/pharmacies')).body.find((p) => p.storeCode === 'VIC-MP-007');
  assert.ok(created);
  const rec = (await api('GET', `/api/admin/pharmacies/${created.id}`)).body;
  assert.equal(rec.name, 'Hampton Street Pharmacy');
  assert.equal(rec.colours.accent, '#123456');
  assert.equal(detachedOf(rec), undefined, 'a new pharmacy inherits every section');
  // another admin sees both after a reload
  const b = await open();
  await b.page.selectOption('#pvSel', created.id);
  await b.page.waitForFunction((id) => window.pharmacyAdmin.state.cur.id === id, created.id);
  assert.equal(await b.page.inputValue('#sName'), 'Hampton Street Pharmacy');
  assert.equal(await b.page.inputValue('#cA'), '#123456');
  await b.ctx.close();
  // switching pharmacy while a create is in flight waits for it, so the new one is kept and listed
  await page.unroute('**/api/admin/pharmacies');
  let release2;
  const held2 = new Promise((r) => { release2 = r; });
  await page.route('**/api/admin/pharmacies', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await held2;
    return route.continue();
  });
  await page.click('#addBtn'); // still in Settings
  await page.fill('#sName', 'Sandringham Pharmacy');
  const posted2 = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/admin\/pharmacies$/.test(r.url()));
  await page.fill('#sCode', 'VIC-MP-008');
  await posted2;
  await page.fill('#sName', 'Sandringham Village Pharmacy');
  const switched = page.evaluate((id) => { const sel = document.getElementById('storeSel'); sel.value = id; sel.dispatchEvent(new Event('change')); }, created.id);
  await page.waitForTimeout(300);
  release2();
  await switched;
  await page.waitForFunction((id) => window.pharmacyAdmin.state.cur.id === id, created.id);
  await settle(page);
  const second = (await api('GET', '/api/admin/pharmacies')).body.find((p) => p.storeCode === 'VIC-MP-008');
  assert.ok(second);
  assert.equal(second.name, 'Sandringham Village Pharmacy');
  assert.ok(await page.$eval('#storeSel', (s, id) => [...s.options].some((o) => o.value === id), second.id));
  // tidy up
  for (const id of [created.id, second.id]) {
    const r = (await api('GET', `/api/admin/pharmacies/${id}`)).body;
    await fetch(dev.base + `/api/admin/pharmacies/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer dev-admin', 'If-Match': `"${r.version}"` } });
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('master template: every pharmacy inherits it section by section; a section can be managed separately and reverted', async () => {
  const { ctx, page, errors } = await open();
  await page.click('#playBtn'); // pause
  // Promo preview → Master template: the masters of the shared promotions, nothing inherited in the master itself.
  await page.selectOption('#pvSel', '__master');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.isMaster);
  assert.equal(await page.isVisible('#masterCard'), true);
  assert.equal(await page.$('#dpBody .inh-bar'), null);
  // The master's preview shows its tokens as written: the greeting carries ${Suburb}.
  await page.click('#dpTabs button:has-text("Morning")');
  await page.click('#tl button[data-i="0"]');
  await page.waitForFunction(() => /Good morning,\s*\$\{Suburb\}/.test(document.querySelector('#screen .s-head h2').textContent));
  // Seeded from Beaumaris: the master's Morning greeting is Beaumaris's fixture copy.
  const master = (await api('GET', '/api/admin/promotions/seed-promotion-morning')).body.master;
  assert.equal(master.introSub, 'No fuss. Just ask in store.');
  await page.fill('#dis', 'Walk in, no appointment');
  await settle(page);
  assert.equal((await api('GET', '/api/admin/promotions/seed-promotion-morning')).body.master.introSub, 'Walk in, no appointment');
  // A pharmacy that inherits everything plays the master's copy at once, with its own branding.
  let scr = (await api('GET', '/api/screens/VIC-MP-002?promo=morning', { token: null })).body;
  assert.equal(scr.promotions.morning.content.introSub, 'Walk in, no appointment');
  assert.equal(scr.name, 'North Ringwood Family Pharmacy');
  // On that pharmacy every section says it is inherited and is read-only.
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-002');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-002');
  assert.equal(await page.isHidden('#masterCard'), true);
  // A pharmacy's preview fills its tokens in: no token shows as written.
  await page.click('#tl button[data-i="0"]');
  await page.waitForFunction(() => !/\$\{/.test(document.querySelector('#screen').textContent));
  assert.deepEqual(await page.$$eval('#dpBody .inh', (s) => s.map((x) => x.dataset.sec)), ['greeting', 'slots', 'close', 'footer']);
  assert.ok((await page.$$eval('#dpBody .inh-pill', (p) => p.map((x) => x.textContent))).every((t) => /Inherited from master/.test(t)));
  assert.equal(await page.inputValue('#dis'), 'Walk in, no appointment');
  assert.equal(await page.$eval('#dis', (e) => e.closest('[inert]') !== null), true);
  // Edit for this pharmacy: the message says the section is now managed separately; the copy is its own.
  await page.click('.inh[data-sec="greeting"] .inh-act');
  await settle(page);
  assert.match(await page.textContent('.inh[data-sec="greeting"] .inh-alert'), /Greeting is now managed separately for North Ringwood Family Pharmacy\. Changes to the master template no longer reach it/);
  assert.match(await page.textContent('.inh[data-sec="greeting"] .inh-pill'), /Managed separately/);
  await page.fill('#dis', 'Ringwood only');
  await settle(page);
  assert.deepEqual(detachedOf((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002')).body), { 'seed-promotion-morning': ['greeting'] });
  scr = (await api('GET', '/api/screens/VIC-MP-002?promo=morning', { token: null })).body;
  assert.equal(scr.promotions.morning.content.introSub, 'Ringwood only');
  // A later master change no longer reaches it, but still reaches the sections it inherits.
  await page.selectOption('#pvSel', '__master');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.isMaster);
  await page.fill('#dis', 'Master again');
  await page.fill('#cl3', 'From the master');
  await settle(page);
  scr = (await api('GET', '/api/screens/VIC-MP-002?promo=morning', { token: null })).body;
  assert.equal(scr.promotions.morning.content.introSub, 'Ringwood only');
  assert.equal(scr.promotions.morning.content.close.line1, 'From the master');
  // Revert to master: it inherits again.
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-002');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-002');
  await page.click('.inh[data-sec="greeting"] .inh-act');
  await settle(page);
  assert.equal(await page.inputValue('#dis'), 'Master again');
  assert.equal(detachedOf((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002')).body), undefined);
  scr = (await api('GET', '/api/screens/VIC-MP-002?promo=morning', { token: null })).body;
  assert.equal(scr.promotions.morning.content.introSub, 'Master again');
  // Settings works on pharmacies: opened from the master template it shows the first pharmacy.
  await page.selectOption('#pvSel', '__master');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.isMaster);
  await page.click('#setBtn');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-001');
  assert.equal(await page.inputValue('#sCode'), 'VIC-MP-001');
  // A new pharmacy starts as the master.
  await page.click('#addBtn');
  assert.equal(await page.inputValue('#dis'), 'Master again');
  assert.equal(await page.isDisabled('.inh[data-sec="greeting"] .inh-act'), true);
  // put the master back for the other tests
  await page.click('#setBtn');
  await page.selectOption('#pvSel', '__master');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.isMaster);
  await page.fill('#dis', master.introSub);
  await page.fill('#cl3', master.close.line1);
  await settle(page);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('every save is audit-logged with the admin who made it', async () => {
  const audit = (await api('GET', '/api/admin/audit?limit=500')).body;
  const byEditor = audit.filter((e) => e.actorUid === 'dev-admin');
  for (const entity of ['pharmacy', 'promotion', 'template']) assert.ok(byEditor.some((e) => e.entity === entity), entity);
  assert.ok(dev.phAudit.entries.some((e) => e.action === 'ph-api.token.set' && e.actorUid === 'dev-admin'));
});

test('layout follows the frame inside the PH shell: menu expanded or collapsed, nothing wraps, tabs scroll', async () => {
  // Personalisation Hub shows the editor in an iframe beside its left menu (256px expanded, 70px collapsed).
  // Extra promotions so the tabs cannot fit on one line at the narrow width.
  const promos = (await api('GET', '/api/admin/promotions')).body;
  const templateId = promos[0].templateId;
  const made = [];
  for (let i = 1; i <= 6; i++) {
    const r = await api('POST', '/api/admin/promotions', { body: { name: `Layout check promotion ${i}`, promoId: `layout-${i}`, templateId } });
    assert.equal(r.status < 300, true, JSON.stringify(r.body));
    made.push(r.body);
  }
  const shell = `<!doctype html><html><head><style>html,body{margin:0;height:100%}body{display:flex}
    aside{width:256px;flex:none;background:#333}body.collapsed aside{width:70px}
    main{flex:1;min-width:0;display:flex}iframe{border:0;flex:1;min-width:0;height:100%}</style></head>
    <body><aside></aside><main><iframe src="/admin/"></iframe></main></body></html>`;
  const lines = (sel) => { // how many lines the visible children of `sel` sit on
    const el = document.querySelector(sel);
    let n = 0, bottom = -1e9;
    for (const c of el.children) {
      if (!c.offsetParent || getComputedStyle(c).position === 'absolute') continue;
      const b = c.getBoundingClientRect();
      if (b.top >= bottom - 1) n++;
      bottom = Math.max(bottom, b.bottom);
    }
    return n;
  };
  for (const width of [1280, 1440, 1920]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/ph-shell.html', (r) => r.fulfill({ contentType: 'text/html', body: shell }));
    await page.goto(dev.base + '/ph-shell.html');
    const fr = page.frame({ url: /\/admin\/$/ });
    await fr.fill('#gateTokenIn', 'dev-admin');
    await fr.click('#gateToken button[type=submit]');
    await fr.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.ready, null, { timeout: 20000 });
    await fr.click(`#dpTabs button[data-dp="${made[5].id}"]`); // the last tab, selected
    const seen = {};
    for (const state of ['expanded', 'collapsed', 'expanded', 'collapsed']) {
      await page.evaluate((s) => document.body.classList.toggle('collapsed', s === 'collapsed'), state);
      await fr.waitForFunction((w) => innerWidth === w, width - (state === 'collapsed' ? 70 : 256));
      await fr.waitForTimeout(400); // the tab strip's smooth scroll
      const m = await fr.evaluate((linesSrc) => {
        const lines = eval(linesSrc);
        const t = document.getElementById('dpTabs'), a = t.querySelector('[aria-selected="true"]').getBoundingClientRect(), c = t.getBoundingClientRect();
        return {
          editor: Math.round(document.querySelector('.edcol').getBoundingClientRect().width),
          preview: Math.round(document.querySelector('.pv').getBoundingClientRect().width),
          tabLines: lines('#dpTabs'), barLines: lines('.promo-bar'), toolbarLines: lines('#toolbar'), controlsLines: lines('.controls'),
          pmLines: lines('.pm-row'), metaLines: lines('.meta-row'), copyRowLines: lines('.cprow'),
          activeInView: a.left >= c.left - 1 && a.right <= c.right + 1,
          scrolls: t.scrollWidth > t.clientWidth, arrows: !document.getElementById('dpPrev').hidden && !document.getElementById('dpNext').hidden,
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          fixed: [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).position === 'fixed').length,
        };
      }, lines.toString());
      const where = `${width}px, menu ${state}: ${JSON.stringify(m)}`;
      for (const k of ['tabLines', 'barLines', 'toolbarLines', 'controlsLines', 'pmLines', 'metaLines', 'copyRowLines']) assert.equal(m[k], 1, `${k} at ${where}`);
      assert.equal(m.activeInView, true, where);
      assert.equal(m.pageOverflow, 0, where);
      assert.equal(m.fixed, 0, where);
      if (m.scrolls) assert.equal(m.arrows, true, where);
      if (seen[state]) assert.deepEqual([m.editor, m.preview], seen[state], `same layout after toggling back, ${where}`);
      seen[state] = [m.editor, m.preview];
    }
    assert.ok(seen.collapsed[0] > seen.expanded[0], 'the editor widens when the menu collapses, without a reload');
    if (width === 1280) {
      // the narrowest frame: the tabs scroll, and the arrows move them
      await page.evaluate(() => document.body.classList.remove('collapsed'));
      await fr.waitForFunction((w) => innerWidth === w, width - 256);
      await fr.waitForFunction(() => document.getElementById('dpTabs').scrollLeft > 0);
      const before = await fr.$eval('#dpTabs', (t) => t.scrollLeft);
      assert.equal(await fr.isDisabled('#dpPrev'), false);
      await fr.click('#dpPrev');
      await fr.waitForFunction((x) => document.getElementById('dpTabs').scrollLeft < x - 50, before);
      await fr.waitForFunction(() => !document.getElementById('dpNext').disabled);
      // picking a tab that is scrolled out of view brings it back
      await fr.click('#dpTabs button[data-dp="seed-promotion-morning"]');
      await fr.click(`#dpTabs button[data-dp="${made[5].id}"]`);
      await fr.waitForFunction(() => { const t = document.getElementById('dpTabs'), a = t.querySelector('[aria-selected="true"]').getBoundingClientRect(), c = t.getBoundingClientRect(); return a.right <= c.right + 1 && a.left >= c.left - 1; });
    }
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  for (const p of made) {
    const r = (await api('GET', '/api/admin/promotions')).body.find((x) => x.id === p.id);
    await fetch(dev.base + `/api/admin/promotions/${p.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer dev-admin', 'If-Match': `"${r.version}"` } });
  }
});

test('on a tablet the preview scrolls up until the orientation tabs lock to the top, and nothing below is cut off', async () => {
  // iPad landscape sizes, the shorter ones being the visible height with Safari's bars showing
  for (const viewport of [{ width: 1024, height: 768 }, { width: 1024, height: 620 }, { width: 1180, height: 740 }, { width: 1366, height: 940 }]) {
    for (const or of ['portrait', 'landscape']) {
      const { ctx, page, errors } = await open('dev-admin', { viewport });
      if (or === 'landscape') await page.click('#orTabs [data-or="landscape"]');
      await page.evaluate(() => scrollTo(0, 600));
      await page.waitForFunction(() => scrollY >= 600);
      const m = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        return { tabsTop: Math.round(r('#orTabs').top), pvBottom: Math.round(r('.pv').bottom), copyBottom: Math.round(r('#cpUrl').bottom), vh: innerHeight };
      });
      const where = `${viewport.width}x${viewport.height} ${or}: ${JSON.stringify(m)}`;
      assert.equal(m.tabsTop, 0, `the Portrait/Landscape tabs lock to the very top, ${where}`);
      assert.ok(m.pvBottom <= m.vh && m.copyBottom <= m.vh, `the whole preview is in view, ${where}`);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  }
});

test('with the PH left menu expanded on a tablet or small laptop, the preview stays beside the editor and in view', async () => {
  // Ticket IrKm7Pajph6dMIRvULez: below a 920px frame the preview used to drop under the whole editor and seemed to
  // disappear. 1024 - 256 = 768px and 1180 - 256 = 924px frames; the collapsed menu (70px) is checked too.
  const shell = `<!doctype html><html><head><style>html,body{margin:0;height:100%}body{display:flex}
    aside{width:256px;flex:none;background:#333}body.collapsed aside{width:70px}
    main{flex:1;min-width:0;display:flex}iframe{border:0;flex:1;min-width:0;height:100%}</style></head>
    <body><aside></aside><main><iframe src="/admin/"></iframe></main></body></html>`;
  for (const viewport of [{ width: 1024, height: 768 }, { width: 1180, height: 820 }]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/ph-shell.html', (r) => r.fulfill({ contentType: 'text/html', body: shell }));
    await page.goto(dev.base + '/ph-shell.html');
    const fr = page.frame({ url: /\/admin\/$/ });
    await fr.fill('#gateTokenIn', 'dev-admin');
    await fr.click('#gateToken button[type=submit]');
    await fr.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.ready, null, { timeout: 20000 });
    for (const or of ['portrait', 'landscape']) {
      await fr.click(`#orTabs [data-or="${or}"]`);
      for (const state of ['expanded', 'collapsed', 'expanded']) {
        await page.evaluate((s) => document.body.classList.toggle('collapsed', s === 'collapsed'), state);
        await fr.waitForFunction((w) => innerWidth === w, viewport.width - (state === 'collapsed' ? 70 : 256));
        const m = await fr.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const ed = r('.edcol'), pv = r('.pv'), st = r('.stage');
          return { frame: innerWidth, edRight: Math.round(ed.right), edTop: Math.round(ed.top), pvLeft: Math.round(pv.left), pvTop: Math.round(pv.top),
            stageW: Math.round(st.width), stageBottom: Math.round(st.bottom), vh: innerHeight, pageOverflow: document.documentElement.scrollWidth - innerWidth };
        });
        const where = `${viewport.width}px ${or}, menu ${state}: ${JSON.stringify(m)}`;
        assert.ok(m.pvLeft >= m.edRight, `the preview is to the right of the editor, ${where}`);
        assert.ok(Math.abs(m.pvTop - m.edTop) <= 2, `the preview starts level with the editor, not below it, ${where}`);
        assert.ok(m.stageW >= 200 && m.stageBottom <= m.vh, `the preview screen is visible without scrolling, ${where}`);
        assert.equal(m.pageOverflow, 0, where);
      }
    }
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('pharmacy view: admin/?store=<code> shows only that pharmacy\'s promotions, titled Display Promotions; its own content is editable, shared things and timings are not', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const signInAt = async (path) => {
    await page.goto(dev.base + path);
    if (await page.isVisible('#gateTokenIn')) { await page.fill('#gateTokenIn', 'dev-admin'); await page.click('#gateToken button[type=submit]'); }
  };
  await page.clock.setFixedTime(new Date('2026-07-01T12:00:00')); // outside every season's dates
  await signInAt('/admin/?store=vic-mp-005');
  await page.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.ready, null, { timeout: 20000 });
  await page.click('#playBtn'); // pause
  // Locked to that pharmacy and titled Display Promotions; only the promotions show: no Promo preview drop-down,
  // no pharmacy-view pill, no Settings.
  assert.equal(await page.textContent('#pageTitle'), 'Display Promotions');
  assert.equal(await page.title(), 'Display Promotions');
  assert.equal(await page.isHidden('#toolbar'), true);
  for (const id of ['#pvSel', '#setBtn', '#settingsView']) assert.equal(await page.isHidden(id), true, id);
  // No ${Suburb} hint, no remote config, and no Copy experience URL or playback duration (with its tooltip) under
  // the preview: an administrator sets up the campaign in the full editor.
  for (const id of ['#dpHint', '#cfgBox', '#cfgJson', '#cpRow', '#cpUrl', '#cpField', '#pbDur', '#pbInfo']) assert.equal(await page.isHidden(id), true, id);
  assert.equal(await page.isVisible('#stage'), true);
  assert.equal(await page.isVisible('#playBtn'), true);
  assert.equal(await page.evaluate(() => window.pharmacyAdmin.state.cur.id), 'seed-pharmacy-vic-mp-005');
  // The grey promotion section (name, promo ID, template, promo= line) is not shown on Morning, Afternoon or Closed;
  // the fields stay read-only underneath. Creating or deleting a promotion is not offered.
  for (const tab of ['Morning', 'Afternoon', 'Closed']) {
    await page.click(`#dpTabs button:has-text("${tab}")`);
    for (const id of ['#promoMeta', '#pmName', '#pmToken', '#pmTpl', '#pmUrl', '#pmHtml']) assert.equal(await page.isHidden(id), true, `${tab} ${id}`);
  }
  await page.click('#dpTabs button:has-text("Morning")');
  assert.equal(await page.$eval('#pmName', (e) => e.readOnly), true);
  assert.equal(await page.$eval('#pmToken', (e) => e.readOnly), true);
  assert.equal(await page.isDisabled('#pmTpl'), true);
  assert.equal(await page.isHidden('#newPromoBtn'), true);
  assert.equal(await page.isHidden('#pmDel'), true);
  // The top of the page offers Restore to default instead of "shared by all pharmacies"; nothing to restore yet.
  assert.equal(await page.isHidden('#promoShared'), true);
  assert.equal(await page.isVisible('#restoreBtn'), true);
  assert.equal(await page.textContent('#restoreTx'), 'Restore to default');
  assert.equal(await page.isDisabled('#restoreBtn'), true);
  // Each inherited section's action is simply "Edit".
  assert.deepEqual(await page.$$eval('#dpBody .inh-act', (b) => b.map((x) => x.textContent.replace('edit', '').trim())), ['Edit', 'Edit', 'Edit', 'Edit']);
  // Timings are set by an administrator only: no scene shows its seconds on screen.
  assert.equal(await page.$$eval('#dpBody .dur', (d) => d.length) > 0, true);
  assert.equal(await page.$$eval('#dpBody .dur', (d) => d.every((x) => x.hidden && x.offsetParent === null)), true);
  // Its own content: make the greeting its own and edit it; it saves and reaches its screen.
  await page.click('.inh[data-sec="greeting"] .inh-act');
  await settle(page);
  await page.fill('#dit', 'This pharmacy only');
  await settle(page);
  let scr = (await api('GET', '/api/screens/VIC-MP-005?promo=morning', { token: null })).body;
  assert.equal(scr.promotions.morning.content.introTitle, 'This pharmacy only');
  assert.equal(await page.isDisabled('#restoreBtn'), false);
  // Its own slots: at most 3, so Add promotion is hidden at 3 and back after a delete. Slots can still be
  // reordered and deleted, but their timings stay hidden.
  await page.click('.inh[data-sec="slots"] .inh-act');
  await settle(page);
  assert.equal(await page.$$eval('#slotList .slot', (x) => x.length), 3);
  assert.equal(await page.isHidden('#addSlot'), true);
  assert.equal(await page.isHidden('#s0dur'), true);
  assert.equal(await page.isVisible('#slotList .slot[data-i="0"] .mv[data-mv="1"]'), true);
  await page.click('#slotList .slot[data-i="2"] .del');
  await page.click('#slotList .slot[data-i="2"] .del'); // confirm
  await settle(page);
  assert.equal((await api('GET', '/api/screens/VIC-MP-005?promo=morning', { token: null })).body.promotions.morning.content.slots.length, 2);
  assert.equal(await page.isVisible('#addSlot'), true);
  await page.click('#addSlot');
  await page.click('#svcBlank');
  await settle(page);
  scr = (await api('GET', '/api/screens/VIC-MP-005?promo=morning', { token: null })).body;
  assert.equal(scr.promotions.morning.content.slots.length, 3);
  assert.equal(await page.isHidden('#addSlot'), true);
  // Opening hours and Seasonal hide their timings too (and Seasonal its dates).
  await page.click('#dpTabs button:has-text("Closed")');
  assert.equal(await page.isHidden('#h0dur'), true);
  await page.click('#dpTabs button:has-text("Morning")');
  // Seasonal: only Currently active promotion and Activate on display (no promotion name, promo ID or promo= pill);
  // activating here is what this pharmacy's screens play.
  await page.click('#dpTabs button:has-text("Seasonal")');
  assert.equal(await page.isVisible('#promoMeta'), true);
  for (const id of ['#pmName', '#pmToken', '#pmUrl', '#pmHtml', '#pmDel']) assert.equal(await page.isHidden(id), true, id);
  assert.equal(await page.isVisible('#pmTpl'), true);
  assert.equal(await page.$eval('#pmTpl', (e) => e.closest('label').querySelector('span').textContent), 'Currently active promotion');
  assert.equal(await page.isDisabled('#pmTpl'), false);
  assert.equal(await page.inputValue('#pmTpl'), 'builtin-occasion-fallback');
  assert.equal(await page.isVisible('#pmActivate'), true);
  // The drop-down is not squashed by the button beside it: its label takes the whole row in the pharmacy view and
  // the drop-down keeps its width, so the selected line (with its dates and "· on display") can be read.
  const pick = await page.evaluate(() => { const s = document.getElementById('pmTpl'), row = s.closest('.meta-row').getBoundingClientRect(), lab = s.closest('label').getBoundingClientRect(); return { sel: s.getBoundingClientRect().width, lab: lab.width, row: row.width }; });
  assert.ok(pick.sel >= 300, `drop-down ${pick.sel}px wide`);
  assert.ok(pick.lab >= pick.row - 1, 'the field spans the row');
  await page.selectOption('#pmTpl', 'builtin-occasion-christmas');
  assert.equal(await page.isHidden('#o0dur'), true);
  assert.equal(await page.isVisible('#occDates'), true, 'the pharmacy view shows the season dates');
  // Activated here, Christmas goes on this pharmacy's screens (to 27 Dec); the promotion and other stores do not move.
  await page.click('#pmActivate');
  await settle(page);
  assert.equal((await api('GET', '/api/admin/promotions/seed-promotion-occasions')).body.templateId, 'builtin-occasion-christmas');
  assert.deepEqual((await api('GET', '/api/screens/VIC-MP-005', { token: null })).body.promotions.occasions.content.activation, { occasion: 'christmas', until: '2026-12-27' });
  assert.equal((await api('GET', '/api/screens/VIC-MP-001', { token: null })).body.promotions.occasions.content.activation, undefined);
  // The season's start and end dates are the pharmacy's own too: changed here, only its screen follows them.
  assert.equal(await page.isVisible('#occDates'), true, 'the pharmacy view shows the season dates');
  assert.match(await page.textContent('#occYearly'), /Every year:\d{1,2} [A-Z][a-z]{2}( to \d{1,2} [A-Z][a-z]{2})?$/);
  assert.equal(await page.$$eval('#occDates select', (e) => e.length), 4, 'date pickers in the pharmacy view');
  await page.selectOption('#occTod', '24');
  assert.equal(await page.textContent('#occWhen'), '15 Dec to 24 Dec');
  await settle(page);
  assert.equal((await api('GET', '/api/screens/VIC-MP-005', { token: null })).body.promotions.occasions.content.occasions.christmas.to, '12-24');
  // The activation still ends on Christmas's (new) end date.
  assert.equal((await api('GET', '/api/screens/VIC-MP-005', { token: null })).body.promotions.occasions.content.activation.until, '2026-12-24');
  assert.notEqual((await api('GET', '/api/screens/VIC-MP-001', { token: null })).body.promotions.occasions.content.occasions.christmas.to, '12-24');
  // The drop-down shows each season's dates after its name here too; the selected season's match its Dates card.
  const lockOpts = await page.$$eval('#pmTpl option', (o) => o.map((x) => x.textContent));
  assert.equal(lockOpts.length, 7);
  assert.equal(lockOpts[0], 'Fallback');
  for (const t of lockOpts.slice(1)) assert.match(t, /^.+ \(\d{1,2} [A-Z][a-z]{2}( – \d{1,2} [A-Z][a-z]{2})?\)( · on display)?$/, t);
  assert.equal(lockOpts[1], 'Christmas (15 Dec – 24 Dec) · on display');
  // Seasonal content is the pharmacy's own: no "Inherited from master", and Copy from master (asked twice) takes the
  // master's dates and copy for this season as they are now.
  assert.match(await page.textContent('.inh[data-sec="occasions"] .inh-pill'), /This pharmacy's own/);
  await page.click('#occCopyMaster');
  assert.match(await page.textContent('#occCopyMaster'), /Click again to copy/);
  await page.click('#occCopyMaster');
  await settle(page);
  assert.equal(await page.textContent('#occWhen'), '15 Dec to 27 Dec');
  assert.equal((await api('GET', '/api/screens/VIC-MP-005', { token: null })).body.promotions.occasions.content.occasions.christmas.to, undefined);
  await page.click('#dpTabs button:has-text("Morning")');
  assert.equal(await page.isHidden('#promoMeta'), true);
  // Reload: the same pharmacy, still locked. The admin view's remembered pharmacy is untouched.
  await page.reload();
  await page.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.ready, null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => window.pharmacyAdmin.state.lock), 'VIC-MP-005');
  assert.equal(await page.evaluate(() => localStorage.getItem('ps-admin-pharmacy')), null);
  // It opens on the first tab, Sales Promos (no promotion settings there either); back to Morning.
  assert.equal(await page.getAttribute('#dpTabs button[data-dp="seed-promotion-sale"]', 'aria-selected'), 'true');
  assert.equal(await page.isHidden('#promoMeta'), true);
  await page.click('#dpTabs button:has-text("Morning")');
  // Restore to default (second click confirms): every section inherits the master template again, on the screen too.
  await page.click('#playBtn');
  const master = (await api('GET', '/api/admin/promotions/seed-promotion-morning')).body.master;
  await page.click('#restoreBtn');
  assert.equal(await page.textContent('#restoreTx'), 'Click again to restore');
  assert.equal((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-005')).body.detached['seed-promotion-morning'].length, 2);
  await page.click('#restoreBtn');
  await settle(page);
  assert.equal(detachedOf((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-005')).body), undefined);
  scr = (await api('GET', '/api/screens/VIC-MP-005?promo=morning', { token: null })).body;
  assert.equal(scr.promotions.morning.content.introTitle, master.introTitle);
  assert.equal(scr.promotions.morning.content.slots.length, master.slots.length);
  assert.equal(await page.inputValue('#dit'), master.introTitle);
  assert.ok((await page.$$eval('#dpBody .inh-pill', (p) => p.map((x) => x.textContent))).every((t) => /Inherited from master/.test(t)));
  assert.equal(await page.isDisabled('#restoreBtn'), true);
  assert.equal(await page.textContent('#restoreTx'), 'Restore to default');
  // ?storeCode= works too.
  await signInAt('/admin/?storeCode=VIC-MP-005');
  await page.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.state.lock === 'VIC-MP-005', null, { timeout: 20000 });
  // An unknown store code is refused.
  await signInAt('/admin/?store=NOPE-1');
  await page.waitForSelector('#gateBlocked:not([hidden])');
  assert.match(await page.textContent('#gateBlocked'), /No pharmacy has the store code NOPE-1/);
  assert.match(await page.textContent('#gateTitle'), /Pharmacy not found/);
  assert.equal(await page.isHidden('#app'), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Edit for this pharmacy / Edit / Revert to master keep the page where it was', async () => {
  // The panel is redrawn when a section switches; the button clicked stays at the same place on screen (it used
  // to move, or jump the page), in the admin view and in the pharmacy view, at desktop and phone widths.
  for (const viewport of [{ width: 1400, height: 700 }, { width: 390, height: 800 }]) {
    for (const path of ['/admin/', '/admin/?store=VIC-MP-002']) {
      const { ctx, page, errors } = await open('dev-admin', { viewport, path });
      await page.click('#playBtn'); // pause, so nothing else redraws the panel
      if (path === '/admin/') {
        await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-002');
        await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-002');
      }
      const where = (sec) => page.$eval(`.inh[data-sec="${sec}"] .inh-act`, (b) => Math.round(b.getBoundingClientRect().top));
      const toMiddle = (sec) => page.$eval(`.inh[data-sec="${sec}"] .inh-act`, (b) => b.scrollIntoView({ block: 'center' }));
      // greeting, then footer: the greeting's "managed separately" message goes when the footer's is shown, above it
      for (const sec of ['greeting', 'footer', 'footer', 'greeting']) {
        await toMiddle(sec);
        const before = await where(sec), scrolled = await page.evaluate(() => document.scrollingElement.scrollTop);
        assert.ok(scrolled > 0 || sec === 'greeting', `${path} ${viewport.width} ${sec}: the page is scrolled`);
        await page.click(`.inh[data-sec="${sec}"] .inh-act`);
        await settle(page);
        assert.ok(Math.abs((await where(sec)) - before) <= 1, `${path} ${viewport.width} ${sec}: the button stayed put`);
        assert.equal(await page.evaluate((s) => document.activeElement === document.querySelector(`.inh[data-sec="${s}"] .inh-act`), sec), true);
      }
      // back to inheriting everything, for the other tests
      assert.equal(detachedOf((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002')).body), undefined);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  }
});

test('Open today bar: each message can be shown in the preview, by tab or by clicking into it', async () => {
  const { ctx, page, errors } = await open();
  await page.click('#playBtn'); // pause
  // A pharmacy the other tests leave inheriting every section.
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-002');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-002');
  const bar = () => page.$eval('#screen .s-foot .f1', (e) => e.textContent.trim());
  const tab = () => page.$eval('#barTabs button[aria-selected="true"]', (b) => b.textContent);
  const marked = () => page.$$eval('#footSlot .rtf.focus .rt', (e) => e.map((x) => x.id));
  // The tabs, with the store's time selected; the section is inherited from the master and they still work.
  assert.deepEqual(await page.$$eval('#barTabs button', (b) => b.map((x) => x.textContent)), ["Store's time", 'While open', 'Last 30 minutes', 'Before opening', 'After closing']);
  assert.equal(await tab(), "Store's time");
  assert.equal(await page.$eval('.inh[data-sec="footer"] #footSlot', (e) => e.inert), true);
  assert.deepEqual(await marked(), []);
  const want = { 'While open': [/^Open today until \d/, 'ftOpen'], 'Last 30 minutes': [/^Closing soon · \d/, 'ftClosing'], 'Before opening': [/^Opens today at 9AM$/, 'ftBefore'], 'After closing': [/^Closed now$/, 'ftClosed'] };
  for (const [label, [re, box]] of Object.entries(want)) {
    await page.click(`#barTabs button:text-is("${label}")`);
    assert.equal(await tab(), label);
    assert.match(await bar(), re, label);
    assert.deepEqual(await marked(), [box], label);
  }
  // The same close time in "While open" and "Last 30 minutes".
  await page.click('#barTabs button:text-is("While open")');
  const close = (await bar()).match(/\d[\d.]*[AP]M/)[0];
  await page.click('#barTabs button:text-is("Last 30 minutes")');
  assert.equal((await bar()).match(/\d[\d.]*[AP]M/)[0], close);
  // Managed separately: clicking into a message shows it, and typing updates the bar as you type.
  await own(page);
  await page.click('#barTabs button:text-is("After closing")');
  await page.click('#ftBefore');
  assert.equal(await tab(), 'Before opening');
  assert.deepEqual(await marked(), ['ftBefore']);
  assert.match(await bar(), /^Opens today at 9AM$/);
  await page.keyboard.press('End');
  await page.keyboard.type(' sharp');
  await page.waitForFunction(() => /sharp$/.test(document.querySelector('#screen .s-foot .f1').textContent.trim()));
  // Anywhere else in the promotion: back to the store's clock.
  await page.click('#dit');
  assert.equal(await tab(), "Store's time");
  assert.deepEqual(await marked(), []);
  await page.click('#barTabs button:text-is("While open")');
  await page.click('#barTabs button:text-is("Store\'s time")');
  assert.equal(await tab(), "Store's time");
  assert.deepEqual(await marked(), []);
  // A new pharmacy or promotion starts on the store's time again.
  await page.click('#barTabs button:text-is("After closing")');
  await page.click('#dpTabs button:nth-child(3)');
  await page.click('#dpTabs button:nth-child(2)');
  assert.equal(await tab(), "Store's time");
  await settle(page);
  // Put the pharmacy back to inheriting, for the other tests.
  for (let i = 0; i < 8; i++) {
    const b = await page.$('#dpBody .inh-act[data-own="1"]');
    if (!b) break;
    await b.click();
    await settle(page);
  }
  assert.equal(detachedOf((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002')).body), undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Remote config for this pharmacy opens inside the editor column, never over the preview', async () => {
  // Ticket Jh9lIUcSFVZq0lZ7eTrx: opened on a narrow frame (a 1024px iPad), the JSON's longest line widened the box
  // past the editor column and over the preview. Its lines now wrap inside the column.
  for (const viewport of [{ width: 768, height: 900 }, { width: 1024, height: 768 }, { width: 1400, height: 1000 }]) {
    const { ctx, page, errors } = await open('dev-admin', { viewport });
    const box = () => page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const ed = r('.edcol'), cfg = r('#cfgBox'), pre = r('#cfgJson'), pv = r('.pv'), el = document.querySelector('#cfgJson');
      return { edLeft: Math.round(ed.left), edRight: Math.round(ed.right), cfgLeft: Math.round(cfg.left), cfgRight: Math.round(cfg.right),
        preRight: Math.round(pre.right), pvLeft: Math.round(pv.left), sideScroll: el.scrollWidth - el.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - innerWidth };
    });
    const shut = await box();
    await page.click('#cfgBox summary');
    assert.equal(await page.$eval('#cfgBox', (d) => d.open), true);
    assert.ok((await page.textContent('#cfgJson')).includes('"storeCode"'));
    const m = await box();
    const where = `${viewport.width}px: ${JSON.stringify(m)}`;
    assert.equal(m.cfgRight, shut.cfgRight, `opening it does not widen the box, ${where}`);
    assert.ok(m.cfgLeft >= m.edLeft && m.cfgRight <= m.edRight && m.preRight <= m.edRight, `the box stays in the editor column, ${where}`);
    assert.ok(m.pvLeft >= m.edRight || m.pvLeft === m.edLeft, `the preview keeps its place, ${where}`);
    assert.equal(m.sideScroll, 0, `long lines wrap, ${where}`);
    assert.equal(m.pageOverflow, 0, where);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('+ Add token above every headline field lists the available tokens and inserts one at the caret', async () => {
  const { ctx, page, errors } = await open();
  await page.click('#playBtn'); // pause
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-004');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-004');
  // Every rich-text field (each headline, the Open today bar messages) has its own "+ Add token" on its label row.
  const fields = await page.$$eval('#dpBody .rtf', (l) => l.map((f) => !!f.querySelector('.rt-lab .tok-add')));
  assert.ok(fields.length >= 3 && fields.every(Boolean), `${fields.length} headline fields, each with Add token`);
  await own(page);
  const add = '.tok-add[data-tok-for="dg"]', menu = '[data-tok-menu="dg"]';
  assert.equal((await page.textContent(add)).replace('add', '').trim(), 'Add token');
  assert.equal(await page.isVisible(menu), false);
  await page.click(add);
  assert.equal(await page.getAttribute(add, 'aria-expanded'), 'true');
  assert.deepEqual(await page.$$eval(`${menu} button .tok-l`, (l) => l.map((e) => e.textContent)),
    ['Store name', 'Suburb', 'Store code', 'State', 'Phone number']);
  assert.deepEqual(await page.$$eval(`${menu} button code`, (l) => l.map((e) => e.textContent)),
    ['${StoreName}', '${Suburb}', '${StoreCode}', '${State}', '${Phone}']);
  // Brand name, Website, Languages spoken and Localised copy are gone, and nothing says "From Personalisation Hub".
  assert.doesNotMatch(await page.textContent(menu), /Brand name|Website|Languages spoken|Localised copy|Personalisation Hub/);
  assert.deepEqual(await page.$$eval(`${menu} button .tok-s`, (l) => l.map((e) => e.textContent)), ['Pharmacy name']);
  // Escape and a click elsewhere close it without inserting anything.
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible(menu), false);
  await page.click(add);
  await page.click('#dpBody .sect', { position: { x: 2, y: 2 } }).catch(() => page.mouse.click(5, 5));
  assert.equal(await page.isVisible(menu), false);
  // A pick goes in where the caret was, and the preview fills it from the store's data.
  await page.click('#dg');
  await page.keyboard.press('End');
  await page.keyboard.type(' at ');
  await page.click(add);
  await page.click(`${menu} button[data-t="StoreCode"]`);
  assert.equal(await page.isVisible(menu), false);
  assert.match(await page.textContent('#dg'), / at \$\{StoreCode\}$/);
  await page.waitForFunction(() => /at VIC-MP-004/.test(document.querySelector('#screen').textContent));
  await settle(page);
  const rec = await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-004');
  assert.match(rec.body.content['seed-promotion-morning'].greeting, / at \$\{StoreCode\}$/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('+ Add token on every copy field, plain lines too, with the tokens each field uses, in the admin and pharmacy views', async () => {
  for (const path of ['/admin/', '/admin/?store=VIC-MP-003']) {
    const { ctx, page, errors } = await open('dev-admin', { path });
    await page.click('#playBtn'); // pause
    if (path === '/admin/') {
      await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-003');
      await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-003');
    }
    await own(page);
    // Every copy field, headlines and plain lines alike (accent lines, Line 1 / Line 2, service chip labels), has
    // its own "+ Add token" with the same menu.
    const plain = await page.$$eval('#dpBody .ptf', (l) => l.map((f) => [f.querySelector('input').id, !!f.querySelector('.rt-lab .tok-add')]));
    for (const id of ['dit', 'dis', 's0sub', 's0label', 's0line1', 's0line2', 'cl2', 'cl3', 'cl4']) assert.ok(plain.some(([x, has]) => x === id && has), `${path}: ${id} has Add token`);
    assert.ok(await page.$$eval('#dpBody .rtf', (l) => l.every((f) => !!f.querySelector('.rt-lab .tok-add'))));
    assert.deepEqual(await page.$$eval('[data-tok-menu="cl3"] button code', (l) => l.map((e) => e.textContent)),
      ['${StoreName}', '${Suburb}', '${StoreCode}', '${State}', '${Phone}']);
    // The tokens a field uses are shown under it, and follow the copy as it changes.
    assert.deepEqual(await page.$$eval('[data-tok-used="ftOpen"] .tok', (l) => l.map((e) => e.textContent)), ['${CloseTime}']);
    await page.fill('#cl3', 'Ask for ');
    assert.equal(await page.isHidden('[data-tok-used="cl3"]'), true);
    // A pick goes in at the caret of a plain line, saves it, and the preview fills it from the store's data.
    await page.click('#cl3');
    await page.keyboard.press('End');
    await page.click('.tok-add[data-tok-for="cl3"]');
    await page.click('[data-tok-menu="cl3"] button[data-t="StoreCode"]');
    assert.equal(await page.isVisible('[data-tok-menu="cl3"]'), false);
    assert.equal(await page.inputValue('#cl3'), 'Ask for ${StoreCode}');
    assert.deepEqual(await page.$$eval('[data-tok-used="cl3"] .tok', (l) => l.map((e) => e.textContent)), ['${StoreCode}']);
    await page.click('.tok-add[data-tok-for="cl3"]');
    await page.click('[data-tok-menu="cl3"] button[data-t="Phone"]');
    assert.deepEqual(await page.$$eval('[data-tok-used="cl3"] .tok', (l) => l.map((e) => e.textContent)), ['${StoreCode}', '${Phone}']);
    // A token the menu does not offer (one set by hand in Settings → Tokens) is shown too.
    await page.fill('#cl4', 'Visit ${Website}');
    assert.deepEqual(await page.$$eval('[data-tok-used="cl4"] .tok', (l) => l.map((e) => e.textContent)), ['${Website}']);
    await settle(page);
    const close = (await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-003')).body.content['seed-promotion-morning'].close;
    assert.equal(close.line1, 'Ask for ${StoreCode}${Phone}');
    assert.equal(close.line2, 'Visit ${Website}');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('seasonal master: editing its copy, dates or timings changes no store\'s screen; a store takes it only by Copy from master', async () => {
  const { ctx, page, errors } = await open('dev-admin', { date: '2026-07-01T12:00:00' });
  const CODES = ['VIC-MP-001', 'VIC-MP-002', 'VIC-MP-003', 'VIC-MP-004', 'VIC-MP-005'];
  const seasonal = async (code) => { const p = (await api('GET', `/api/screens/${code}`, { token: null })).body.promotions.occasions; return { template: p.template, content: p.content }; };
  const before = {};
  for (const c of CODES) before[c] = await seasonal(c);

  await page.selectOption('#pvSel', '__master');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur && window.pharmacyAdmin.state.cur.isMaster);
  await page.click('#dpTabs button:has-text("Seasonal")');
  await page.click('#playBtn'); // pause
  const master = async () => (await api('GET', '/api/admin/promotions/seed-promotion-occasions')).body;
  const templateId = (await master()).templateId, season = 'christmas';
  // The master has no screens: no Activate on display; picking a season previews it.
  assert.equal(await page.isHidden('#pmActivate'), true);
  await page.selectOption('#pmTpl', `builtin-occasion-${season}`);
  // Copy, a beat's seconds, the dates, then previewing another season.
  await page.fill('#o0text', 'Master edit that no store asked for');
  await page.fill('#o0dur', '9');
  if (await page.$('#occTod')) await page.selectOption('#occTod', '20');
  await settle(page);
  const other = season === 'easter' ? 'builtin-occasion-anzac-day' : 'builtin-occasion-easter';
  await page.selectOption('#pmTpl', other);
  await settle(page);
  const m = await master();
  assert.equal(m.templateId, templateId, 'picking in the drop-down saves nothing');
  assert.equal(m.master.occasions[season].beats[0].text, 'Master edit that no store asked for');
  assert.equal(m.master.occasions[season].beats[0].dur, 9);
  for (const c of CODES) assert.deepEqual(await seasonal(c), before[c], `${c}: its screen plays exactly what it played`);

  // One store copies that season from the master: it, and only it, now plays the master's copy.
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-003');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur && window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-003');
  await page.click('#dpTabs button:has-text("Seasonal")');
  assert.equal(await page.inputValue('#pmTpl'), 'builtin-occasion-fallback', 'the store shows what it plays');
  await page.selectOption('#pmTpl', `builtin-occasion-${season}`);
  await page.click('#occCopyMaster');
  await page.click('#occCopyMaster');
  await settle(page);
  const copied = await seasonal('VIC-MP-003');
  assert.equal(copied.content.occasions[season].beats[0].text, 'Master edit that no store asked for');
  assert.equal(copied.template.occasion, 'fallback', 'copying a season does not change what the store plays');
  assert.equal(copied.content.activation, before['VIC-MP-003'].content.activation, 'nor activates it');
  for (const c of CODES.filter((x) => x !== 'VIC-MP-003')) assert.deepEqual(await seasonal(c), before[c], c);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Sales Promos: the first tab, no promotion settings; a pharmacy\'s own copy (offer, brands, end date by date picker) drives the preview and its screens; others keep the defaults in their own colours; a past date is only a hint (Personalisation Hub schedules it)', async () => {
  const { ctx, page, errors, firstTab } = await open(undefined, { stay: true, date: '2026-11-26T10:00:00' });
  assert.equal(firstTab, 'seed-promotion-sale');
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-001');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-001');
  await page.click('#dpTabs button:has-text("Sales Promos")');
  // A built-in like Morning, Afternoon and Closed: no promotion settings section (so no Delete either).
  assert.equal(await page.isHidden('#promoMeta'), true);
  assert.equal(await page.isHidden('#pmDel'), true);
  assert.deepEqual(await page.$$eval('#tl button', (b) => b.map((x) => x.textContent)), ['1The brands', '2The offer']);
  assert.match(await page.textContent('#tlTime'), / 10\.0s · 2 scenes/);
  assert.equal(await page.textContent('#pbSecs'), '11s');
  // The defaults (the Big Brand Sale), drawn by the screen's own template.
  await page.click('#playBtn'); // pause
  await page.click('#tl button[data-i="0"]');
  assert.deepEqual(await page.$$eval('#screen .sl-nm', (n) => n.map((x) => x.textContent)), ['TOSHI', 'CETAPHIL', 'NATIO', 'BLACKMORES']);
  assert.equal(await page.textContent('#screen .sl-l2'), 'SALE');
  assert.equal(await page.textContent('#screen .sl-c2'), 'Finishes Wednesday 2nd December');
  await page.click('#tl button[data-i="1"]');
  assert.equal(await page.textContent('#screen .sl-pd'), 'Wednesday 2nd December');
  assert.equal(await page.textContent('#slEndTx'), 'eventWednesday 2nd December');
  // Offer 25, one brand removed and another added, a new end date from the date picker: preview, caption, panel and
  // footer follow, with the right weekday.
  await page.fill('#slVal', '25');
  await page.waitForFunction(() => document.querySelector('#screen .sl-val').textContent === '25');
  await page.click('#slBrands .slbrand[data-b="1"] .del');
  await page.click('#slAdd');
  await page.fill('#slB3', 'SWISSE');
  await page.fill('#slEnd', '2026-12-09');
  await page.waitForFunction(() => document.querySelector('#screen .sl-pd').textContent === 'Wednesday 9th December');
  assert.equal(await page.textContent('#slEndTx'), 'eventWednesday 9th December');
  assert.equal(await page.inputValue('#slCap2'), 'Finishes Wednesday 9th December');
  assert.equal(await page.inputValue('#slF1'), 'BIG BRAND SALE · UP TO 25% OFF');
  assert.equal(await page.textContent('#screen .sl-foot .f2'), 'Finishes Wednesday 9th December');
  assert.equal(await page.textContent('#screen .sl-brands'), 'TOSHI · NATIO · BLACKMORES · SWISSE');
  await settle(page);
  const rec = (await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-001')).body.content['seed-promotion-sale'].sale;
  assert.deepEqual([rec.value, rec.brands, rec.endDate], [25, ['TOSHI', 'NATIO', 'BLACKMORES', 'SWISSE'], '2026-12-09']);
  const pub = (await api('GET', '/api/screens/VIC-MP-001?promo=sale', { token: '' })).body.promotions.sale;
  assert.deepEqual([pub.template.kind, pub.content.sale.value], ['sale', 25]);
  // Footer written by hand.
  await page.check('#slFtOwn');
  await page.fill('#slF1', 'Our biggest sale');
  await page.waitForFunction(() => document.querySelector('#screen .sl-foot .f1').textContent === 'Our biggest sale');
  await page.uncheck('#slFtOwn');
  await page.waitForFunction(() => document.querySelector('#screen .sl-foot .f1').textContent === 'BIG BRAND SALE · UP TO 25% OFF');
  // Another pharmacy keeps the defaults, in its own colours; Beaumaris's edits are not there.
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-004');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-004');
  await page.click('#dpTabs button:has-text("Sales Promos")');
  assert.equal(await page.inputValue('#slVal'), '30');
  assert.equal(await page.inputValue('#slEnd'), '2026-12-02');
  assert.equal(await page.$$eval('#slBrands .slbrand', (r) => r.length), 4);
  const primary = await page.evaluate(() => window.pharmacyAdmin.state.cur.colours.primary);
  assert.equal(await page.$eval('#screen', (e) => e.style.getPropertyValue('--s-p')), primary);
  assert.equal((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-004')).body.content['seed-promotion-sale'], undefined, 'nothing saved for it');
  // Back on Beaumaris: an end date before today ("yesterday"). Personalisation Hub schedules the sale, so nothing reads
  // as a schedule: no "Sale has ended" on the tab or at the top, just one small hint under the date field, and the
  // preview still plays the sale with that date's own weekday.
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-001');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-001');
  await page.click('#dpTabs button:has-text("Sales Promos")');
  assert.equal(await page.isVisible('#slEndPast'), false);
  await page.fill('#slEnd', '2026-11-25');
  await page.waitForSelector('#slEndPast');
  assert.equal(await page.textContent('#slEndPast'), 'This date has passed. The screen still plays whenever Personalisation Hub schedules it.');
  assert.equal(await page.getAttribute('#slEnd', 'aria-describedby'), 'slEndPast');
  assert.equal(await page.textContent('#dpTabs button[data-dp="seed-promotion-sale"]'), 'sellSales Promos');
  assert.equal(await page.$('#saleEnded'), null);
  assert.doesNotMatch(await page.textContent('#dpBody'), /Sale has ended|Morning or Afternoon/);
  await page.waitForFunction(() => document.querySelector('#screen .sl-pd') && document.querySelector('#screen .sl-pd').textContent === 'Wednesday 25th November');
  assert.equal(await page.textContent('#screen .sl-foot .f2'), 'Finishes Wednesday 25th November');
  // A future date: the hint goes. (And puts the copy back for the other tests.)
  await page.fill('#slEnd', '2026-12-02');
  await page.waitForSelector('#slEndPast', { state: 'detached' });
  await page.fill('#slVal', '30');
  await settle(page);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Download MP4: on the Pause row at 1024, 1180 and 390px; disabled with a tooltip until a pharmacy with a screen device ID is picked; downloads that pharmacy\'s MP4', async () => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 1180, height: 820 }, { width: 390, height: 800 }]) {
    const { ctx, page, errors } = await open('dev-admin', { viewport, stay: true });
    for (const or of ['portrait', 'landscape']) {
      await page.click(`#orTabs [data-or="${or}"]`);
      await page.waitForTimeout(100);
      const m = await page.evaluate(() => {
        const row = document.querySelector('.controls').getBoundingClientRect();
        const rs = ['playBtn', 'pvData', 'pvInfo', 'dlBtn'].map((id) => document.getElementById(id).getBoundingClientRect());
        const c = rs.map((r) => (r.top + r.bottom) / 2);
        return { sameLine: c.every((x) => Math.abs(x - c[0]) <= 1), inside: rs.every((r) => r.left >= row.left - 0.5 && r.right <= row.right + 0.5), afterLabel: rs[3].left >= rs[2].right, icon: document.getElementById('dlIc').textContent, name: document.getElementById('dlTx').textContent, overflow: document.documentElement.scrollWidth - innerWidth };
      });
      const where = `${viewport.width}px ${or}: ${JSON.stringify(m)}`;
      assert.ok(m.sameLine && m.inside && m.afterLabel, `Pause, the label and Download MP4 on one line, inside the row: ${where}`);
      assert.equal(m.icon, 'download', where);
      assert.equal(m.name, 'Download MP4', `named for screen readers even as an icon: ${where}`);
      assert.equal(m.overflow, 0, where);
    }
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // The video reads the store's data through the PH API proxy, as a screen does: it needs a token saved.
  assert.equal((await api('PUT', '/api/settings/ph-api', { body: { token: 'dl-test-token-1234' } })).status, 200);
  const { ctx, page, errors } = await open('dev-admin', { stay: true });
  // The master template is not a pharmacy: disabled, and the tooltip says what to do.
  await page.selectOption('#pvSel', '__master');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.isMaster);
  await page.waitForFunction(() => document.getElementById('dlBtn').getAttribute('aria-disabled') === 'true');
  assert.match(await page.getAttribute('#dlBtn', 'title'), /Pick a pharmacy/);
  assert.equal(await page.isEnabled('#dlBtn'), false, 'disabled for assistive technology too');
  await page.click('#dlBtn', { force: true });
  assert.equal(await page.isVisible('#dlMsg'), false, 'a disabled click does nothing');
  // A pharmacy with no screen device ID: disabled, the tooltip says to add it in Settings. Settings → Screen device ID.
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-002');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-002');
  await page.click('#setBtn');
  assert.equal(await page.inputValue('#sDev'), 'DEVICE-VIC-MP-002');
  // The ID is taken on Enter, paste or leaving the field (Settings → Screen device ID); clearing it saves at once.
  await page.fill('#sDev', '');
  await page.press('#sDev', 'Enter');
  await page.waitForFunction(() => /screen device ID in Settings/.test(document.getElementById('dlBtn').title));
  assert.equal(await page.getAttribute('#dlBtn', 'aria-disabled'), 'true');
  await settle(page);
  assert.equal((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002')).body.device, undefined, 'cleared on the server');
  await page.fill('#sDev', 'DEVICE-VIC-MP-002');
  await page.press('#sDev', 'Enter'); // checked with Personalisation Hub (its store is VIC-MP-002), then saved
  await page.waitForSelector('#sDevInfo [data-dev="live"]');
  await settle(page);
  assert.equal((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002')).body.device, 'DEVICE-VIC-MP-002', 'saved on the server');
  await page.click('#setBtn');
  // Beaumaris, Sales Promos, portrait: progress while it is made, then the file, named as the ticket says.
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-001');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-001');
  await page.click('#dpTabs button[data-dp="seed-promotion-sale"]');
  await page.click('#orTabs [data-or="portrait"]');
  await page.waitForFunction(() => document.getElementById('dlBtn').getAttribute('aria-disabled') === 'false');
  assert.match(await page.getAttribute('#dlBtn', 'title'), /uses the saved version/);
  const download = page.waitForEvent('download', { timeout: 180000 });
  await page.click('#dlBtn');
  await page.waitForFunction(() => document.getElementById('dlBtn').getAttribute('aria-busy') === 'true');
  assert.equal(await page.getAttribute('#dlBtn', 'aria-disabled'), 'true', 'cannot be clicked twice');
  assert.equal(await page.textContent('#dlTx'), 'Preparing video…');
  assert.match(await page.textContent('#dlMsg'), /Preparing video…/);
  const d = await download;
  // The name follows the pharmacy's saved name, which an earlier test in this file changes ("Beaumaris Pharmacy
  // Plus"), so the expected name is built from the name it has now, by the same rule (src/video/format.js slug).
  const phName = (await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-001')).body.name;
  const want = new RegExp(`^${videoSlug(phName)}-sales-promos-portrait-\\d+s_android\\.mp4$`);
  assert.match(d.suggestedFilename(), want);
  assert.match(d.suggestedFilename(), /^beaumaris-pharmacy(-[a-z0-9]+)*-sales-promos-portrait-\d+s_android\.mp4$/);
  await page.waitForFunction(() => document.getElementById('dlBtn').getAttribute('aria-busy') === 'false');
  assert.equal(await page.textContent('#dlTx'), 'Download MP4');
  assert.equal(await page.textContent('#dlMsg'), `Downloaded: ${d.suggestedFilename()}`);
  // A failure is a plain message and the button is usable again.
  await page.route('**/api/admin/videos', (r) => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'video-busy', message: 'A video is already being made. Try again in a minute.' } }) }));
  await page.click('#dlBtn');
  await page.waitForFunction(() => document.getElementById('dlMsg').classList.contains('err'));
  assert.equal(await page.textContent('#dlMsg'), 'A video is already being made. Try again in a minute.');
  assert.equal(await page.getAttribute('#dlBtn', 'aria-disabled'), 'false');
  // A job the server stops answering for (a 401 once the sign-in has ended) stops waiting at once, with a plain
  // message, and the button is usable again: it never stays on "Preparing video…".
  await page.unroute('**/api/admin/videos');
  await page.route('**/api/admin/videos', (r) => r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: 'job-x', status: 'queued', progress: 0, orientation: 'portrait' }) }));
  let polls = 0;
  await page.route('**/api/admin/videos/job-x', (r) => { polls++; return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unauthenticated', message: 'Sign in first' } }) }); });
  await page.click('#dlBtn');
  await page.waitForFunction(() => document.getElementById('dlMsg').classList.contains('err'), null, { timeout: 15000 });
  assert.match(await page.textContent('#dlMsg'), /sign-in has ended/);
  assert.equal(polls, 1, 'a 401 is not polled again');
  assert.equal(await page.getAttribute('#dlBtn', 'aria-busy'), 'false');
  assert.equal(await page.getAttribute('#dlBtn', 'aria-disabled'), 'false');
  await page.unroute('**/api/admin/videos');
  await page.unroute('**/api/admin/videos/job-x');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ── Settings → Screen device ID (ticket LCmvnIfZA6ZoVjLr7p8P): the store's details read live from Personalisation Hub
// (the dev server's mock Location API, through the real proxy), the pharmacy filled in from them, and every preview
// drawn with them. ──
const EXAMPLE_DEVICE = DEV_DEVICES.beaumaris; // the test site's Beaumaris screen
const paste = (page, sel, text) => page.evaluate(([s, t]) => {
  const e = document.querySelector(s); e.focus(); e.value = t;
  e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: t }));
}, [sel, text]);
const enter = async (page, sel, text) => { await page.fill(sel, text); await page.press(sel, 'Enter'); };
const devInfo = (page) => page.textContent('#sDevInfo');
const deviceOf = async (id) => (await api('GET', `/api/admin/pharmacies/${id}`)).body.device;

test('Screen device ID: the first field of Settings; fits at 1024, 1180 and 390px with the live pill on the Pause row', async () => {
  assert.equal((await api('PUT', '/api/settings/ph-api', { body: { token: 'device-id-token-1234' } })).status, 200);
  for (const viewport of [{ width: 1024, height: 768 }, { width: 1180, height: 820 }, { width: 390, height: 800 }]) {
    const { ctx, page, errors } = await open('dev-admin', { viewport });
    await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-001');
    await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-001');
    await page.waitForFunction(() => document.getElementById('pvData').textContent === 'Live opening hours');
    const row = await page.evaluate(() => {
      const r = document.querySelector('.controls').getBoundingClientRect();
      const rs = ['playBtn', 'pvData', 'pvInfo', 'dlBtn'].map((id) => document.getElementById(id).getBoundingClientRect());
      const c = rs.map((x) => (x.top + x.bottom) / 2);
      return { sameLine: c.every((x) => Math.abs(x - c[0]) <= 1), inside: rs.every((x) => x.left >= r.left - 0.5 && x.right <= r.right + 0.5), cut: document.getElementById('pvData').scrollWidth > document.getElementById('pvData').clientWidth };
    });
    assert.ok(row.sameLine && row.inside && !row.cut, `${viewport.width}px: ${JSON.stringify(row)}`);
    await page.click('#setBtn');
    await page.waitForSelector('#sDevInfo [data-dev="live"]');
    const m = await page.evaluate(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      const card = box('detailsCard'), dev = box('sDev'), name = box('sName'), info = box('sDevInfo'), check = box('sDevCheck');
      const first = document.querySelector('#detailsCard .sect').nextElementSibling;
      return { first: first && first.id, above: dev.bottom <= name.top, wide: dev.right - card.left > (card.right - card.left) * 0.75 && name.right - name.left < (card.right - card.left) * 0.75 + 1,
        inside: [dev, info, check, box('delBtn'), box('addBtn')].every((x) => x.left >= card.left - 0.5 && x.right <= card.right + 0.5),
        overflow: document.documentElement.scrollWidth - innerWidth, help: document.getElementById('sDevHelp').textContent };
    });
    const where = `${viewport.width}px: ${JSON.stringify(m)}`;
    assert.equal(m.first, 'sDevRow', `the first field of the pharmacy's details: ${where}`);
    assert.ok(m.above, where);
    assert.equal(m.inside, true, where);
    assert.equal(m.overflow, 0, where);
    if (viewport.width > 600) assert.ok(m.wide, `full width: ${where}`);
    assert.equal(m.help, "Paste the Personalisation Hub device ID of one of this pharmacy's screens. Its store details are then read live from Personalisation Hub.");
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('Screen device ID: a pasted ID is read from Personalisation Hub, shown under the field and fills in; a different name or suburb is offered, not overwritten; every preview uses the live data', async () => {
  const { ctx, page, errors } = await open();
  await page.selectOption('#pvSel', 'seed-pharmacy-vic-mp-001');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-001');
  await page.click('#setBtn');
  // No device ID: a prompt in Settings, a marker in the pharmacy list, sample data in the preview.
  await enter(page, '#sDev', '');
  await settle(page);
  assert.equal(await deviceOf('seed-pharmacy-vic-mp-001'), undefined);
  assert.match(await page.textContent('#sDevInfo [data-dev="warn"]'), /No screen device ID yet\. Until one is added, the preview shows sample data and Download MP4 is off\./);
  assert.match(await page.$eval('#storeSel option:checked', (o) => o.textContent), /Beaumaris Pharmacy.* · VIC-MP-001 · no screen device ID$/);
  assert.equal(await page.textContent('#pvData'), 'Sample opening hours');
  assert.match(await page.textContent('#pvTip'), /add its Screen device ID in Settings\./);
  // A name typed by hand and a suburb set by hand, both different from Personalisation Hub's.
  await page.fill('#sName', 'Beaumaris Pharmacy Plus');
  await page.fill('#tokList input[data-token="Suburb"]', 'Sandringham');
  await settle(page);
  // Paste the test site's example ID: the store's details appear under the field, marked live.
  await paste(page, '#sDev', EXAMPLE_DEVICE);
  await page.waitForFunction((d) => window.pharmacyAdmin.state.cur.device === d, EXAMPLE_DEVICE);
  const info = await devInfo(page);
  for (const want of ['Live from Personalisation Hub', 'Beaumaris Pharmacy', 'VIC-MP-001', '1A East Concourse, Beaumaris, Victoria', '03 9589 2676', 'Australia/Melbourne', M.storeSummary(CAMPAIGN_DEVICES['DEVICE-VIC-MP-001']).today, 'None in Personalisation Hub']) assert.ok(info.includes(want), `${want} in ${info}`);
  assert.match(info, /· read \d{1,2}:\d{2} [ap]m/);
  await settle(page);
  assert.equal(await deviceOf('seed-pharmacy-vic-mp-001'), EXAMPLE_DEVICE, 'saved: the store is this pharmacy\'s');
  assert.doesNotMatch(await page.$eval('#storeSel option:checked', (o) => o.textContent), /no screen device ID/);
  // Not overwritten: PH's value is offered beside each.
  assert.equal(await page.inputValue('#sName'), 'Beaumaris Pharmacy Plus');
  assert.match(await page.textContent('#sDevInfo dd[data-f="Store name"]'), /This pharmacy: Beaumaris Pharmacy Plus\s*Use Personalisation Hub's/);
  assert.match(await page.textContent('#sDevInfo dd[data-f="Suburb"]'), /This pharmacy: Sandringham\s*Use Personalisation Hub's/);
  await page.click('#sDevInfo [data-use="name"]');
  assert.equal(await page.inputValue('#sName'), 'Beaumaris Pharmacy');
  await page.click('#sDevInfo [data-use="suburb"]');
  await settle(page);
  const rec = (await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-001')).body;
  assert.equal(rec.name, 'Beaumaris Pharmacy');
  assert.equal((rec.tokens || {}).Suburb, undefined, 'the hand-set suburb is cleared, so screens show PH\'s');
  assert.match(await page.textContent('#sDevInfo dd[data-f="Suburb"]'), /Beaumaris\s*used for \$\{Suburb\}/);
  assert.equal(await page.getAttribute('#tokList input[data-token="Suburb"]', 'placeholder'), 'Beaumaris (from Personalisation Hub)');
  // Every promotion, both orientations: the live store data, and the pill says so.
  await page.click('#setBtn');
  await page.click('#playBtn'); // pause
  for (const tab of ['Sales Promos', 'Morning', 'Afternoon', 'Closed', 'Seasonal']) {
    await page.click(`#dpTabs button:has-text("${tab}")`);
    for (const or of ['portrait', 'landscape']) {
      await page.click(`#orTabs [data-or="${or}"]`);
      await page.waitForTimeout(80);
      const where = `${tab} ${or}`;
      assert.equal(await page.textContent('#pvData'), 'Live opening hours', where);
      const screen = await page.textContent('#screen');
      assert.doesNotMatch(screen, /Preview unavailable/, where);
      if (tab === 'Closed') {
        assert.match(screen, /8\.30am – 7\.00pm/, `Beaumaris's own weekday hours: ${where}`);
        assert.doesNotMatch(screen, /9\.00am – 5\.30pm/, `not the sample hours: ${where}`);
      }
    }
  }
  assert.match(await page.textContent('#pvTip'), /^Read from Personalisation Hub for Beaumaris Pharmacy at \d{1,2}:\d{2} [ap]m\./);
  // Personalisation Hub cannot be reached: the last read is kept, and says when it was read. The preview keeps it.
  const host = new URL((await api('GET', '/api/settings/ph-api')).body.settings.baseUrls[0]).host;
  dev.downHosts.add(host);
  try {
    await page.click('#setBtn');
    await page.click('#sDevCheck');
    await page.waitForSelector('#sDevInfo [data-dev="warn"]');
    assert.match(await devInfo(page), /Personalisation Hub could not be reached\. Showing the details read at \d{1,2}:\d{2} [ap]m\./);
    assert.match(await devInfo(page), /Last read from Personalisation Hub/);
    assert.equal(await page.textContent('#pvData'), 'Live opening hours');
  } finally { dev.downHosts.delete(host); }
  await page.click('#sDevCheck');
  await page.waitForFunction(() => /Live from Personalisation Hub/.test(document.getElementById('sDevInfo').textContent));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Screen device ID: another store\'s device, a malformed ID, an unknown ID and an unset API each say so and are not saved; a new pharmacy starts from a device ID alone', async () => {
  const { ctx, page, errors } = await open();
  await page.click('#setBtn');
  await page.selectOption('#storeSel', 'seed-pharmacy-vic-mp-004');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.storeCode === 'VIC-MP-004');
  const saved = await deviceOf('seed-pharmacy-vic-mp-004');
  // Beaumaris's device on Vermont South: refused in plain words.
  await paste(page, '#sDev', EXAMPLE_DEVICE);
  await page.waitForSelector('#sDevInfo [data-dev="err"]');
  assert.equal((await devInfo(page)).replace(/^error/, ''), 'This device belongs to Beaumaris Pharmacy (VIC-MP-001), not this pharmacy. The device ID was not saved.');
  assert.equal(await page.getAttribute('#sDev', 'aria-invalid'), 'true');
  // Malformed, and well-formed but unknown: each its own message.
  await enter(page, '#sDev', 'not a device!');
  await page.waitForFunction(() => /not a valid screen device ID/.test(document.getElementById('sDevInfo').textContent));
  await enter(page, '#sDev', 'NO-SUCH-DEVICE-123');
  await page.waitForFunction(() => /Personalisation Hub does not know this device/.test(document.getElementById('sDevInfo').textContent));
  await settle(page);
  assert.equal(await deviceOf('seed-pharmacy-vic-mp-004'), saved, 'none of them saved');
  // The PH API not set up: held, not saved, until it can be checked; Check again then saves it.
  assert.equal((await api('DELETE', '/api/settings/ph-api/token')).status, 200);
  await enter(page, '#sDev', 'TEST-LATE-NIGHT');
  await page.waitForSelector('#sDevInfo [data-dev="warn"]');
  assert.match(await devInfo(page), /The Personalisation Hub API is not set up\..*Not saved yet/);
  await settle(page);
  assert.equal(await deviceOf('seed-pharmacy-vic-mp-004'), saved);
  assert.equal((await api('PUT', '/api/settings/ph-api', { body: { token: 'device-id-token-1234' } })).status, 200);
  await page.click('#sDevInfo [data-dev-retry]');
  await page.waitForFunction(() => window.pharmacyAdmin.state.cur.device === 'TEST-LATE-NIGHT');
  await settle(page);
  assert.equal(await deviceOf('seed-pharmacy-vic-mp-004'), 'TEST-LATE-NIGHT');
  await enter(page, '#sDev', saved || '');
  await page.waitForFunction((d) => (window.pharmacyAdmin.state.cur.device || '') === d, saved || ''); // checked, then saved
  await settle(page);
  assert.equal(await deviceOf('seed-pharmacy-vic-mp-004'), saved);
  // Add pharmacy: the device ID field takes the focus; pasting one fills in the rest and creates the pharmacy.
  await page.click('#addBtn');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sDev');
  await paste(page, '#sDev', DEV_DEVICES.newStore);
  await page.waitForSelector('#sDevInfo [data-dev="filled"]');
  assert.equal(await page.inputValue('#sName'), 'Brighton Pharmacy');
  assert.equal(await page.inputValue('#sCode'), 'VIC-MP-006');
  assert.equal(await page.textContent('#sDevInfo [data-dev="filled"]'), 'Filled in from Personalisation Hub: Pharmacy name, Store code.');
  await page.waitForFunction(() => !!window.pharmacyAdmin.state.cur.id);
  await settle(page);
  const made = (await api('GET', '/api/admin/pharmacies')).body.find((p) => p.storeCode === 'VIC-MP-006');
  assert.ok(made, 'created');
  assert.equal(made.name, 'Brighton Pharmacy');
  assert.equal(made.device, DEV_DEVICES.newStore);
  // A new pharmacy from a device whose store is already set up is refused, naming it.
  await page.click('#addBtn');
  await paste(page, '#sDev', 'DEVICE-VIC-MP-002');
  await page.waitForFunction(() => /already set up here as North Ringwood Family Pharmacy/.test(document.getElementById('sDevInfo').textContent));
  assert.equal(await page.inputValue('#sCode'), '');
  assert.equal((await api('DELETE', `/api/admin/pharmacies/${made.id}`)).status < 300, true);
  assert.deepEqual(errors, []);
  await ctx.close();
});
