// Live data (js/live-data.js): server failover, polling with one request in flight, re-render only on change,
// the last good result kept across network drops and restarts, the error states, and the seams with the
// back-end proxy (ph-proxy/) and the config API's published screen config (config-api/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  parseServers, createLiveClient, createMockClient, createScreenData, screenView, fromPublishedConfig,
  classifyCampaign, classifyConfig, STORE_POLL_MS, CONFIG_POLL_MS, CACHE_PREFIX,
} from '../js/live-data.js';
import { storeModel, resolvePromotion, sequence } from '../js/render.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { trimCampaignData } = require('../ph-proxy/src/location-proxy.js');
const { buildScreenConfig } = require('../config-api/src/publish.js');
const CAMPAIGN = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/campaign-data.json'), 'utf8'));
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/config.json'), 'utf8'));

const raw = (device) => CAMPAIGN.devices[device].data;
// What the proxy really returns for a device (its own trimming), and its error shapes.
const proxyOk = (data, meta = {}) => ({ status: 200, body: { ok: true, data: trimCampaignData(data), meta: { server: 'https://ph.example', fetchedAt: '2026-11-20T00:00:00Z', ...meta } } });
const proxyNotFound = { status: 404, body: { ok: false, error: { code: 'DEVICE_NOT_FOUND', message: 'x' } } };

// The published config for a fixture pharmacy, built by the config API's own publish code.
const PROMOS = [
  { id: 'rec-morning', promoId: 'morning', name: 'Morning', templateId: 'builtin-promotion-scenes' },
  { id: 'rec-afternoon', promoId: 'afternoon', name: 'Afternoon', templateId: 'builtin-promotion-scenes' },
  { id: 'rec-closed', promoId: 'closed', name: 'Closed', templateId: 'builtin-opening-hours' },
];
function published(storeCode, { logoUrl = 'https://media.example/logo.png', extraPromos = [], templates = [] } = {}) {
  const ph = CONFIG.pharmacies.find((p) => p.storeCode === storeCode);
  const promos = PROMOS.concat(extraPromos);
  const content = Object.fromEntries(promos.filter((p) => ph.content[p.promoId]).map((p) => [p.id, ph.content[p.promoId]]));
  const rec = { storeCode, name: ph.name, colours: { primary: ph.brand.p, accent: ph.brand.a }, logo: logoUrl ? { url: logoUrl } : null, content };
  return JSON.parse(JSON.stringify(buildScreenConfig(rec, promos, templates, '2026-11-20T00:00:00.000Z')));
}

// A fetch over a table of base URL -> handler(path) returning {status, body} or throwing (network down).
function fakeFetch(servers) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const base = Object.keys(servers).find((b) => url.startsWith(b + '/'));
    const r = await servers[base](url.slice(base.length));
    return { status: r.status, json: async () => { if (r.body === undefined) throw new SyntaxError('not json'); return r.body; } };
  };
  fn.calls = calls;
  return fn;
}
const down = () => { throw new TypeError('Failed to fetch'); };

// Manual timers: run() fires everything due.
function clock() {
  let t = 0, seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (f, ms) => { const id = ++seq; timers.set(id, { f, at: t + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    pending: () => [...timers.values()].map((x) => x.at - t).sort((a, b) => a - b),
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].f();
        await settle();
      }
      t = end;
    },
  };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m }; };

// A screen-data controller over the fake fetch, recording every update.
function rig({ servers, device = 'DEVICE-VIC-MP-001', storage = memStorage(), c = clock() }) {
  const fetchImpl = fakeFetch(servers);
  const client = createLiveClient({ servers: Object.keys(servers), fetchImpl });
  const updates = [];
  const data = createScreenData({ client, device, storage, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, onUpdate: (s, changed) => updates.push({ view: screenView(s).kind, reason: screenView(s).reason, changed, s: JSON.parse(JSON.stringify(s)) }) });
  return { data, updates, fetchImpl, storage, c };
}

test('servers: the meta tag list, deduplicated; nothing means the page origin', () => {
  assert.deepEqual(parseServers(''), ['']);
  assert.deepEqual(parseServers(null), ['']);
  assert.deepEqual(parseServers('https://a.example/, https://b.example  https://a.example'), ['https://a.example', 'https://b.example']);
  assert.deepEqual(parseServers('http://localhost:5001/x, javascript:alert(1), http://evil.example'), ['http://localhost:5001/x']);
});

test('only the proxy\'s and config API\'s own answers are definitive; anything else tries the next server', () => {
  assert.equal(classifyCampaign({ status: 200, json: proxyOk(raw('TEST')).body }).kind, 'ok');
  assert.equal(classifyCampaign({ status: 404, json: proxyNotFound.body }).kind, 'not-found');
  assert.equal(classifyCampaign({ status: 400, json: { ok: false, error: { code: 'INVALID_DEVICE_ID' } } }).kind, 'invalid');
  assert.equal(classifyCampaign({ status: 404, json: null }), null); // a static host without the rewrite
  assert.equal(classifyCampaign({ status: 502, json: { ok: false, error: { code: 'UPSTREAM_UNAVAILABLE' } } }), null);
  assert.equal(classifyCampaign({ status: 503, json: { ok: false, error: { code: 'NOT_CONFIGURED' } } }), null);
  assert.equal(classifyCampaign({ status: 0, error: 'network' }), null);
  assert.equal(classifyConfig({ status: 200, json: published('VIC-MP-001') }).kind, 'ok');
  assert.equal(classifyConfig({ status: 404, json: { error: { code: 'not-found' } } }).kind, 'not-found');
  assert.equal(classifyConfig({ status: 404, json: null }), null);
});

test('failover: the last server that answered is tried first, then the others, one request at a time', async () => {
  let aUp = false;
  const fetchImpl = fakeFetch({
    'https://a.example': (p) => (aUp ? proxyOk(raw('TEST')) : down()),
    'https://b.example': (p) => proxyOk(raw('TEST')),
  });
  const client = createLiveClient({ servers: ['https://a.example', 'https://b.example'], fetchImpl });
  const r1 = await client.getCampaign('TEST');
  assert.equal(r1.kind, 'ok');
  assert.equal(r1.server, 'https://b.example');
  assert.deepEqual(fetchImpl.calls, ['https://a.example/api/device/TEST/campaign_data', 'https://b.example/api/device/TEST/campaign_data']);
  aUp = true;
  fetchImpl.calls.length = 0;
  const r2 = await client.getCampaign('TEST');
  assert.equal(r2.server, 'https://b.example', 'b answered last time, so it goes first');
  assert.deepEqual(fetchImpl.calls, ['https://b.example/api/device/TEST/campaign_data']);
});

test('the device is looked up through the proxy and the config by the store code it returned, never the URL', async () => {
  const { data, fetchImpl, updates } = rig({ servers: { '': (p) => (p.startsWith('/api/device/') ? proxyOk(raw('DEVICE-VIC-MP-003')) : { status: 200, body: published('VIC-MP-003') }) } });
  data.start();
  await settle();
  assert.deepEqual(fetchImpl.calls, ['/api/device/DEVICE-VIC-MP-001/campaign_data', '/api/screens/VIC-MP-003']);
  const last = updates.at(-1);
  assert.equal(last.view, 'ready');
  const store = storeModel(last.s.campaign, last.s.config);
  assert.equal(store.code, 'VIC-MP-003');
  assert.equal(store.suburb, raw('DEVICE-VIC-MP-003').store_info.address_info.suburb);
  assert.equal(store.phone, raw('DEVICE-VIC-MP-003').store_info.address_info.phone_number);
  assert.ok(fetchImpl.calls.every((u) => !/token|x-api-key/i.test(u)));
  data.stop();
});

test('polls store data every 30 s and config every 60 s, re-rendering only when something changed', async () => {
  let hours = raw('DEVICE-VIC-MP-001');
  const { data, updates, fetchImpl, c } = rig({ servers: { '': (p) => (p.startsWith('/api/device/') ? proxyOk(hours) : { status: 200, body: published('VIC-MP-001') }) } });
  data.start();
  await settle();
  assert.deepEqual(c.pending(), [STORE_POLL_MS, CONFIG_POLL_MS]);
  const firstChanged = updates.filter((u) => u.changed).length;
  await c.advance(STORE_POLL_MS);
  assert.equal(fetchImpl.calls.filter((u) => u.includes('/api/device/')).length, 2);
  assert.equal(updates.at(-1).changed, false, 'same data: no re-render');
  // Change the store's hours in PH: the next poll (within 30 s) carries it, and it is a change.
  hours = JSON.parse(JSON.stringify(hours));
  hours.store_info.opening_hours[0].close_time = '20:00:00';
  await c.advance(STORE_POLL_MS);
  assert.equal(updates.at(-1).changed, true);
  assert.equal(updates.at(-1).s.campaign.store_info.opening_hours[0].close_time, '20:00:00');
  assert.equal(fetchImpl.calls.filter((u) => u.includes('/api/screens/')).length, 2, 'config polled at 60 s');
  assert.equal(updates.filter((u) => u.changed).length, firstChanged + 1);
  data.stop();
});

test('one request in flight per endpoint: a poll asked for while one is running waits for it', async () => {
  let release;
  let n = 0;
  const { data, fetchImpl } = rig({ servers: { '': (p) => { if (p.startsWith('/api/screens/')) return { status: 200, body: published('VIC-MP-001') }; n++; return new Promise((r) => { release = () => r(proxyOk(raw('DEVICE-VIC-MP-001'))); }); } } });
  data.start();
  data.refresh();
  data.refresh();
  await settle();
  assert.equal(n, 1, 'still the first request');
  release();
  await settle();
  assert.equal(n, 2, 'then exactly one more');
  release();
  await settle();
  assert.equal(fetchImpl.calls.filter((u) => u.includes('/api/device/')).length, 2);
  data.stop();
});

test('network drop: the screen keeps its last good data, then resumes; a restart shows the cached data at once', async () => {
  let up = true;
  const storage = memStorage();
  const handler = (p) => (!up ? down() : p.startsWith('/api/device/') ? proxyOk(raw('DEVICE-VIC-MP-002')) : { status: 200, body: published('VIC-MP-002') });
  const a = rig({ servers: { '': handler }, device: 'DEVICE-VIC-MP-002', storage });
  a.data.start();
  await settle();
  assert.equal(a.updates.at(-1).view, 'ready');
  up = false;
  await a.c.advance(CONFIG_POLL_MS);
  const dropped = a.updates.at(-1);
  assert.equal(dropped.view, 'ready', 'still showing the store');
  assert.equal(dropped.changed, false, 'nothing re-rendered');
  assert.equal(dropped.s.deviceStatus, 'down');
  assert.equal(dropped.s.lastStore.kind, 'down');
  assert.ok(dropped.s.campaign && dropped.s.config);
  up = true;
  await a.c.advance(STORE_POLL_MS);
  assert.equal(a.updates.at(-1).s.deviceStatus, 'ok');
  a.data.stop();

  // Power cycle with the network still down: the cached result (localStorage) renders straight away.
  assert.ok(storage.map.has(CACHE_PREFIX + 'DEVICE-VIC-MP-002'));
  up = false;
  const b = rig({ servers: { '': handler }, device: 'DEVICE-VIC-MP-002', storage });
  b.data.start();
  assert.equal(b.updates[0].view, 'ready');
  assert.equal(b.updates[0].s.fromCache, true);
  await settle();
  assert.equal(b.updates.at(-1).view, 'ready');
  assert.equal(b.updates.at(-1).changed, false);
  b.data.stop();
});

test('error states: unknown device and store not configured are "Screen not set up"; all servers down with no cache is offline', async () => {
  const unknown = rig({ servers: { '': () => proxyNotFound } });
  unknown.data.start();
  await settle();
  assert.deepEqual([unknown.updates.at(-1).view, unknown.updates.at(-1).reason], ['not-set-up', 'device']);
  unknown.data.stop();

  const unconfigured = rig({ servers: { '': (p) => (p.startsWith('/api/device/') ? proxyOk(raw('DEVICE-VIC-MP-001')) : { status: 404, body: { error: { code: 'not-found', message: 'x' } } }) } });
  unconfigured.data.start();
  await settle();
  const u = unconfigured.updates.at(-1);
  assert.deepEqual([u.view, u.reason, u.s.storeCode], ['not-set-up', 'store', 'VIC-MP-001']);
  unconfigured.data.stop();

  const offline = rig({ servers: { 'https://a.example': down, 'https://b.example': () => ({ status: 502, body: { ok: false, error: { code: 'UPSTREAM_UNAVAILABLE' } } }) } });
  offline.data.start();
  await settle();
  assert.equal(offline.updates.at(-1).view, 'offline');
  assert.deepEqual(offline.updates.at(-1).s.lastStore.tried.map((t) => t.status), ['network', 502]);
  offline.data.stop();
});

test('a device moved to another store drops the old config and fetches the new store\'s at once', async () => {
  let dev = 'DEVICE-VIC-MP-001';
  const { data, updates, fetchImpl, c } = rig({ servers: { '': (p) => (p.startsWith('/api/device/') ? proxyOk(raw(dev)) : { status: 200, body: published(p.split('/').pop()) }) } });
  data.start();
  await settle();
  dev = 'DEVICE-VIC-MP-004';
  await c.advance(STORE_POLL_MS);
  assert.ok(fetchImpl.calls.includes('/api/screens/VIC-MP-004'));
  const last = updates.at(-1);
  assert.equal(last.view, 'ready');
  assert.equal(last.s.config.pharmacies[0].storeCode, 'VIC-MP-004');
  data.stop();
});

test('published config maps onto the render engine exactly as the fixtures do, custom templates included', () => {
  const custom = { id: 'tpl-left', name: 'Left headline', kind: 'promotion-scenes', html: '<div class="s-head">${Headline}</div>${Footer}', css: '.s-head{left:40px}', backgrounds: { portrait: { url: 'https://media.example/p.png' }, landscape: null } };
  const pub = published('VIC-MP-001', { extraPromos: [{ id: 'rec-custom', promoId: 'custom-demo', name: 'Custom', templateId: 'tpl-left' }], templates: [custom] });
  const mapped = fromPublishedConfig(pub);
  const campaign = trimCampaignData(raw('DEVICE-VIC-MP-001'));
  const live = storeModel({ data: campaign }, mapped);
  const fix = storeModel(CAMPAIGN.devices['DEVICE-VIC-MP-001'], CONFIG);
  assert.deepEqual(live.brand, fix.brand);
  assert.equal(live.name, fix.name);
  assert.equal(live.logo, 'https://media.example/logo.png', 'the config logo when the Location API has none');
  for (const promoId of ['morning', 'afternoon', 'closed']) {
    const a = resolvePromotion(mapped, live, promoId), b = resolvePromotion(CONFIG, fix, promoId);
    assert.equal(a.base, b.base, promoId);
    assert.deepEqual(a.content, b.content, promoId);
    assert.deepEqual(sequence(a), sequence(b), promoId);
  }
  const c = resolvePromotion(mapped, live, 'custom-demo');
  assert.equal(c.base, 'scenes');
  assert.equal(c.template.html, custom.html);
  assert.equal(c.template.css, custom.css);
  assert.equal(c.template.bgPortrait, 'https://media.example/p.png');
});

test('the store logo from the proxy (store_info.logo_url, PH-181) wins over the config logo', () => {
  const withLogo = JSON.parse(JSON.stringify(raw('DEVICE-VIC-MP-001')));
  withLogo.store_info.logo_url = 'https://ph.example/logos/vic-mp-001.png';
  const campaign = trimCampaignData(withLogo);
  assert.equal(campaign.store_info.logo_url, 'https://ph.example/logos/vic-mp-001.png', 'the proxy passes it through');
  const mapped = fromPublishedConfig(published('VIC-MP-001'));
  assert.equal(storeModel({ data: campaign }, mapped).logo, 'https://ph.example/logos/vic-mp-001.png');
  // Not a usable URL: the config logo stays.
  campaign.store_info.logo_url = 'javascript:alert(1)';
  assert.equal(storeModel({ data: campaign }, mapped).logo, 'https://media.example/logo.png');
});

test('mockapi=1 reads the seed fixtures the same way, and an unknown device is not found', async () => {
  const files = { 'fixtures/campaign-data.json': CAMPAIGN, 'fixtures/config.json': CONFIG };
  const fetchImpl = async (url) => ({ status: files[url] ? 200 : 404, json: async () => files[url] });
  const client = createMockClient({ fetchImpl });
  const r = await client.getCampaign('TEST');
  assert.equal(r.kind, 'ok');
  const cfg = await client.getConfig(r.data.store_location.store_code);
  assert.equal(cfg.kind, 'ok');
  assert.equal(cfg.config.pharmacies.length, 1);
  assert.equal((await client.getCampaign('NOPE')).kind, 'not-found');
  assert.equal((await client.getConfig('NOPE')).kind, 'not-found');
});

test('published config: an occasion template plays its occasion (t_occ_<occasion>), with that occasion\'s copy', () => {
  const ph = { id: 'rec-ph', storeCode: 'VIC-MP-001', name: 'Beaumaris Pharmacy', colours: { primary: '#0f1050', accent: '#5ee6b0' }, logo: null,
    content: { 'rec-occ': { occasions: { easter: { scenes: [{ title: 'Happy Easter,<br>${Suburb}', sub: '', line1: 'L1', line2: '' }, { title: 'M' }, { title: 'Lest', line1: '' }] } } } } };
  const promos = [{ id: 'rec-occ', promoId: 'occasions', name: 'Occasions', templateId: 'builtin-occasion-easter' }];
  const cfg = fromPublishedConfig(buildScreenConfig(ph, promos, [], '2026-11-20T00:00:00.000Z'));
  assert.deepEqual(cfg.promotions, [{ id: 'occasions', promoId: 'occasions', name: 'Occasions', template: 't_occ_easter' }]);
  const store = storeModel({ data: { store_location: { store_code: 'VIC-MP-001' }, store_info: { address_info: { suburb: 'Beaumaris' } } } }, cfg);
  const play = resolvePromotion(cfg, store, 'occasions');
  assert.equal(play.base, 'occasion');
  assert.equal(play.occasion, 'easter');
  assert.equal(play.content.scenes[0].title, 'Happy Easter,<br>${Suburb}');
  assert.deepEqual(sequence(play).map((x) => x.t), [3, 3, 4]);
  // Christmas, not yet edited: the default copy, signing off with the store name.
  const xmas = resolvePromotion(cfg, store, 'occasions', { occasion: 'christmas' });
  assert.equal(xmas.occasion, 'christmas');
  assert.match(xmas.content.scenes[2].line1, /from the whole \$\{StoreName\} team\.$/);
});
