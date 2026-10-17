'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const { build, OUT } = require('../scripts/build-local-api');
const LocalApi = require('../frontend/local-api');

const ADMIN = { principalType: 'admin', principalId: 'hq', scopes: ['insights:read'] };
const ADVERTISER = { principalType: 'advertiser', principalId: 'adv-blackmores', scopes: ['insights:read'] };

test('the committed browser bundle is what scripts/build-local-api.js builds from src/', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), build(), 'run `npm run build:local-api` and commit frontend/local-api.js');
});

test('the bundle needs no http, fs, crypto or token code', () => {
  const src = fs.readFileSync(OUT, 'utf8');
  for (const bad of ["require('http')", "require('fs')", "require('crypto')", 'createTokenAuthenticator', 'mintToken']) assert.ok(!src.includes(bad), bad);
});

const SAMPLE = [
  '/filter-options', '/display-types', '/summary', '/revenue?granularity=week', '/revenue?dsps[]=DV360&dsps[]=Amazon%20DSP&dealTypes[]=Preferred%20deal',
  '/deals', '/deals?dealType=Programmatic%20guaranteed&storeIds[]=store-2', '/slot-value', '/slot-allocation', '/missed-revenue', '/yield?dealType=Private%20auction',
  '/advertisers', '/maturity', '/maturity?level=Personalised&scheduling=uses', '/delivery', '/deals-by-display-type', '/audience', '/my-targeting',
  '/summary?displayTypeIds[]=queue&storeIds[]=store-1&dateFrom=2026-10-01&dateTo=2026-10-07', '/health', '/summary?dateFrom=nope', '/missed-revenue?displayTypeIds=queue',
].map((p) => (p.includes('dateFrom') || p === '/health' ? p : p + (p.includes('?') ? '&' : '?') + 'dateFrom=2026-09-12&dateTo=2026-10-11'));

test('LocalApi answers exactly what the HTTP server answers, as admin and as advertiser, on every route', async () => {
  const { raw, ctx } = generateTestRetailer();
  const store = new AggregateStore(buildAggregates(raw, ctx));
  for (const principal of [ADMIN, ADVERTISER]) {
    const server = createServer({ store, today: '2026-10-11', authenticate: () => principal });
    await new Promise((r) => server.listen(0, r));
    try {
      const base = `http://127.0.0.1:${server.address().port}${BASE}`;
      for (const p of SAMPLE) {
        const res = await fetch(base + p);
        const body = await res.json();
        const u = new URL(p, 'http://x');
        const params = {};
        for (const [k, v] of u.searchParams) { const key = k.replace(/\[\]$/, ''); params[key] = k.endsWith('[]') ? [...(params[key] || []), v] : v; }
        const got = await LocalApi.get(u.pathname, params, principal).then((b) => ({ status: 200, body: b }), (e) => ({ status: e.status, body: { error: e.error } }));
        assert.equal(got.status, res.status, `${principal.principalType} ${p}: status`);
        assert.deepEqual(got.body, body, `${principal.principalType} ${p}: body`);
      }
    } finally { server.close(); }
  }
});

test('LocalApi rejects a missing principal with 401 and an advertiser on a retailer route with 403', async () => {
  await assert.rejects(LocalApi.get('/summary', {}, null), { status: 401 });
  await assert.rejects(LocalApi.get('/summary', {}, ADVERTISER), { status: 403 });
  await assert.rejects(LocalApi.get('/summary', {}, { ...ADMIN, scopes: [] }), { status: 403 });
  await assert.rejects(LocalApi.get('/summary', { dateFrom: 'x' }, ADMIN), { status: 400 });
});

test('an advertiser principal is pinned to itself even when the page asks for another advertiser', async () => {
  const plain = await LocalApi.get('/deals-by-display-type', {}, ADVERTISER);
  const pushed = await LocalApi.get('/deals-by-display-type', { advertiserIds: ['adv-acme'] }, ADVERTISER);
  assert.ok(plain.groups.length > 0);
  assert.deepEqual(pushed, plain);
});

test('filter-options lists the 5 test stores and advertisers for a retailer, and only own display types for an advertiser', async () => {
  const r = await LocalApi.get('/filter-options', {}, ADMIN);
  assert.equal(r.stores.length, 5);
  assert.deepEqual(r.advertisers.map((a) => a.name), ['Acme', 'Blackmores', 'Nova']);
  assert.equal(r.lastDataDay, '2026-10-11');
  const a = await LocalApi.get('/filter-options', {}, ADVERTISER);
  assert.equal(a.stores.length, 5);
  assert.equal(a.advertisers, undefined);
  assert.equal(a.advertiser.id, 'adv-blackmores');
  assert.ok(a.displayTypes.length > 0 && a.displayTypes.length < r.displayTypes.length);
});
