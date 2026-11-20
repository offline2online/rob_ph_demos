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
  const { ctx, page, errors } = await open();
  const opts = await page.$$eval('#storeSel option', (o) => o.map((x) => x.textContent));
  assert.equal(opts.length, 5);
  assert.match(opts[0], /Beaumaris Pharmacy · VIC-MP-001/);
  // Promo preview offers the master template first, then the same pharmacies.
  assert.deepEqual(await page.$$eval('#pvSel option', (o) => o.map((x) => x.textContent)), ['Master template', ...opts]);
  assert.deepEqual(await page.$$eval('#dpTabs button', (b) => b.map((x) => x.textContent.replace(/^(campaign|schedule|celebration)/, ''))), ['Morning', 'Afternoon', 'Closed', 'Occasions']);
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
  assert.match(await page.textContent('#pvData'), /Sample store data/);
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
  for (const n of ['Suburb', 'StoreName', 'CloseTime', 'OpenTime']) assert.ok(names.includes(n), `${n} in ${names}`);
  assert.ok(!names.some((n) => ['Headline', 'Logo', 'Content', 'Footer'].includes(n)), 'layout slots are not listed');
  assert.equal(await page.getAttribute('#tokList input[data-token="Suburb"]', 'placeholder'), 'Suburb from Personalisation Hub');
  assert.match(await page.textContent('#tokList'), /Used in Morning/);
  // The preview has no store data, so ${Suburb} is blank until a value is set by hand.
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
  // A token used only in a custom template, and ${StoreName} in copy, render from the values set by hand.
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
  assert.match(html, /From Set Name/);
  assert.match(html, /Visit mi\.example/);
  assert.deepEqual(errors, []);
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

test('occasions: the Occasion drop-down picks what promo=occasions plays; each occasion keeps its own copy', async () => {
  const { ctx, page, errors } = await open();
  await page.click('#dpTabs button:has-text("Occasions")');
  await own(page);
  await page.click('#playBtn'); // pause
  // The Template drop-down is the Occasion drop-down here, Christmas by default; occasion templates have no Edit HTML.
  assert.equal(await page.$eval('#pmTpl', (e) => e.closest('label').querySelector('span').textContent), 'Occasion');
  assert.deepEqual(await page.$$eval('#pmTpl option', (o) => o.map((x) => x.textContent)), ['Christmas', "New Year's", 'Australia Day', "Valentine's Day", 'Easter', 'Anzac Day']);
  assert.equal(await page.inputValue('#pmTpl'), 'builtin-occasion-christmas');
  assert.equal(await page.isHidden('#pmHtml'), true);
  // Christmas: two beats, each a card of its lines; the preview draws the standalone design (no brand panel).
  assert.deepEqual(await page.$$eval('#tl button .lb', (b) => b.map((x) => x.textContent)), ['1Beat 1', '2Beat 2']);
  assert.equal(await page.textContent('#loopLen'), 'Loop 12s');
  assert.equal(await page.textContent('#pbSecs'), '13s');
  assert.deepEqual(await page.$$eval('#occList .slot [aria-label], #occList .slot input', (e) => e.map((x) => x.getAttribute('aria-label') || x.closest('label').querySelector('span').textContent)), ['Seconds on screen', 'Main line', 'Seconds on screen', 'Small line above', 'Main line']);
  // Each beat has its own seconds on screen: the loop, the timeline and the playback duration follow, and the playing
  // preview runs the beats on keyframes of that length.
  assert.deepEqual(await page.$$eval('#occList input[type=number]', (e) => e.map((x) => x.value)), ['6', '6']);
  await page.fill('#o0dur', '8');
  assert.equal(await page.textContent('#loopLen'), 'Loop 14s');
  await page.waitForFunction(() => document.getElementById('pbSecs').textContent === '15s');
  assert.match(await page.getAttribute('#tl button[data-i="0"]', 'title'), /· 8s$/);
  await page.click('#playBtn'); // play
  await page.waitForFunction(() => { const b = document.querySelector('#screen .occ-christmas:not(.hold) .b1'); return b && getComputedStyle(b).animationDuration === '14s'; });
  await page.click('#playBtn'); // pause
  await settle(page);
  assert.equal((await api('GET', '/api/screens/VIC-MP-001', { token: null })).body.promotions.occasions.content.occasions.christmas.beats[0].dur, 8);
  await page.fill('#o0dur', '6');
  assert.equal(await page.textContent('#loopLen'), 'Loop 12s');
  await page.click('#tl button[data-i="1"]');
  await page.waitForFunction(() => document.querySelector('#screen .occ.occ-christmas.hold .b2.on'));
  assert.equal(await page.$$eval('#screen .s-top, #screen .s-logo, #screen .s-foot', (e) => e.length), 0);
  // ${StoreName} is the pharmacy's name as saved (an earlier test may have renamed it).
  const name = await page.evaluate(() => window.pharmacyAdmin.state.cur.name);
  assert.equal(await page.$eval('#screen .b2 .sub', (e) => e.textContent), `from the whole ${name} team`);
  assert.equal(await page.$eval('#screen .b2 .kicker', (e) => e.textContent), 'With warm wishes');
  // Edit Christmas's second beat, then switch to Easter and edit a line there.
  await page.fill('#o1text', 'from all of us at ${StoreName}');
  await page.waitForFunction(() => /from all of us at/.test(document.querySelector('#screen .b2 .sub').textContent));
  await page.selectOption('#pmTpl', 'builtin-occasion-easter');
  await page.click('#tl button[data-i="0"]');
  await page.waitForFunction(() => document.querySelector('#screen .occ.occ-easter .b1.on') && /Happy Easter/.test(document.querySelector('#screen .b1.on').textContent));
  assert.deepEqual(await page.$$eval('#tl button .lb', (b) => b.map((x) => x.textContent)), ['1Beat 1', '2Beat 2', '3Beat 3']);
  await page.fill('#o1text', 'Have a safe long weekend, everyone');
  await settle(page);
  assert.equal((await api('GET', '/api/admin/promotions/seed-promotion-occasions')).body.templateId, 'builtin-occasion-easter');
  const screen = (await api('GET', '/api/screens/VIC-MP-001', { token: null })).body.promotions.occasions;
  assert.deepEqual([screen.template.kind, screen.template.occasion], ['occasion', 'easter']);
  assert.equal(screen.content.occasions.easter.beats[1].text, 'Have a safe long weekend, everyone');
  assert.equal(screen.content.occasions.christmas.beats[1].text, 'from all of us at ${StoreName}', 'Christmas copy kept');
  assert.ok(!/StoreName/.test(JSON.stringify(screen.content.occasions.easter)), 'Easter: suburb only, no store-name sign-off');
  // Every occasion previews its own design, in both orientations.
  for (const o of ['christmas', 'new-year', 'australia-day', 'valentines-day', 'easter', 'anzac-day']) {
    await page.selectOption('#pmTpl', 'builtin-occasion-' + o);
    await page.waitForFunction((d) => document.querySelector('#screen .occ.occ-' + d), { christmas: 'christmas', 'new-year': 'newyear', 'australia-day': 'ausday', 'valentines-day': 'valentine', easter: 'easter', 'anzac-day': 'anzac' }[o]);
  }
  await page.selectOption('#pmTpl', 'builtin-occasion-easter');
  await page.waitForFunction(() => { const b = document.querySelector('#screen .occ-easter .b2'); return b && /Have a safe long weekend, everyone/.test(b.textContent); }, null, { timeout: 5000 });
  // Back to Christmas for the other tests.
  await page.selectOption('#pmTpl', 'builtin-occasion-christmas');
  await settle(page);
  assert.equal((await api('GET', '/api/admin/promotions/seed-promotion-occasions')).body.templateId, 'builtin-occasion-christmas');
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
  assert.match(await page.getAttribute('#tl button[data-i="1"]', 'title'), /· 4s$/);
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
  assert.deepEqual(created.promotionsWithContent.sort(), ['seed-promotion-afternoon', 'seed-promotion-closed', 'seed-promotion-morning', 'seed-promotion-occasions']);
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
  assert.equal(rec.detached, undefined, 'a new pharmacy inherits every section');
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
  assert.deepEqual((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002')).body.detached, { 'seed-promotion-morning': ['greeting'] });
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
  assert.equal((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-002')).body.detached, undefined);
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

test('pharmacy view: admin/?store=<code> locks the editor to that pharmacy; its own content is editable, shared things are not', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const signInAt = async (path) => {
    await page.goto(dev.base + path);
    if (await page.isVisible('#gateTokenIn')) { await page.fill('#gateTokenIn', 'dev-admin'); await page.click('#gateToken button[type=submit]'); }
  };
  await signInAt('/admin/?store=vic-mp-005');
  await page.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.ready, null, { timeout: 20000 });
  await page.click('#playBtn'); // pause
  // Locked to that pharmacy: the label, one entry in Promo preview (no master template), and it cannot be changed.
  assert.equal(await page.textContent('#lockTx'), 'Pharmacy view · VIC-MP-005');
  assert.equal(await page.isVisible('#lockPill'), true);
  assert.deepEqual(await page.$$eval('#pvSel option', (o) => o.map((x) => x.value)), ['seed-pharmacy-vic-mp-005']);
  assert.equal(await page.isDisabled('#pvSel'), true);
  // Shared promotion settings are read-only; creating or deleting a promotion is not offered.
  assert.equal(await page.$eval('#pmName', (e) => e.readOnly), true);
  assert.equal(await page.$eval('#pmToken', (e) => e.readOnly), true);
  assert.equal(await page.isDisabled('#pmTpl'), true);
  assert.equal(await page.isHidden('#newPromoBtn'), true);
  assert.equal(await page.isHidden('#pmDel'), true);
  // Its own content: make the greeting its own and edit it; it saves and reaches its screen.
  await page.click('.inh[data-sec="greeting"] .inh-act');
  await settle(page);
  await page.fill('#dit', 'This pharmacy only');
  await settle(page);
  let scr = (await api('GET', '/api/screens/VIC-MP-005?promo=morning', { token: null })).body;
  assert.equal(scr.promotions.morning.content.introTitle, 'This pharmacy only');
  // Add a promotion slot (blank) to its own slots.
  await page.click('.inh[data-sec="slots"] .inh-act');
  await settle(page);
  const before = (await api('GET', '/api/screens/VIC-MP-005?promo=morning', { token: null })).body.promotions.morning.content.slots.length;
  await page.click('#addSlot');
  await page.click('#svcBlank');
  await settle(page);
  scr = (await api('GET', '/api/screens/VIC-MP-005?promo=morning', { token: null })).body;
  assert.equal(scr.promotions.morning.content.slots.length, before + 1);
  // Templates are shared: Edit HTML opens read-only, with no Clone.
  await page.click('#pmHtml');
  assert.equal(await page.isHidden('#tmClone'), true);
  assert.equal(await page.isHidden('#tmDel'), true);
  assert.equal(await page.textContent('#tmLockTx'), 'Shared by every pharmacy. Only an administrator can change it.');
  await page.click('#hdTabs [data-t="html"]');
  assert.equal(await page.$eval('#hdHtml', (e) => e.readOnly), true);
  await page.click('#hdDone');
  // Settings: its details (store code read-only), tokens and branding; no Pharmacies card, no PH API card.
  await page.click('#setBtn');
  assert.equal(await page.isVisible('#detailsCard'), true);
  assert.equal(await page.$eval('#sCode', (e) => e.readOnly), true);
  assert.equal(await page.inputValue('#sCode'), 'VIC-MP-005');
  assert.equal(await page.isVisible('#tokensCard'), true);
  assert.equal(await page.isVisible('#brandingCard'), true);
  assert.equal(await page.isHidden('#pharmaciesCard'), true);
  assert.equal(await page.isHidden('#phApiCard'), true);
  await page.click('#setBtn');
  // Reload: the same pharmacy, still locked. The admin view's remembered pharmacy is untouched.
  await page.reload();
  await page.waitForFunction(() => window.pharmacyAdmin && window.pharmacyAdmin.ready, null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => window.pharmacyAdmin.state.lock), 'VIC-MP-005');
  assert.equal(await page.evaluate(() => localStorage.getItem('ps-admin-pharmacy')), null);
  // Put it back: inherit the master again.
  await page.click('#playBtn');
  await page.click('.inh[data-sec="greeting"] .inh-act');
  await settle(page);
  await page.click('.inh[data-sec="slots"] .inh-act');
  await settle(page);
  assert.equal((await api('GET', '/api/admin/pharmacies/seed-pharmacy-vic-mp-005')).body.detached, undefined);
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
