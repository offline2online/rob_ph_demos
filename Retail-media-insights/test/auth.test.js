'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const { mintToken, verifyToken, createTokenAuthenticator } = require('../src/auth');
const { allowedDisplayTypeIds } = require('../src/scope');
const { optIn } = require('./helpers');
const fs = require('fs');
const path = require('path');

const { raw, ctx } = generateTestRetailer({ days: 10 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const SECRET = 'test-secret-test-secret-test-secret-0123';
const Q = 'dateFrom=2026-10-02&dateTo=2026-10-11';
const authenticate = createTokenAuthenticator({ secret: SECRET });
const tok = (principalType, principalId, extra = {}) => mintToken({ secret: SECRET, principalType, principalId, ...extra });

const routeFiles = fs.readdirSync(path.join(__dirname, '../src/routes')).filter((f) => f.endsWith('.js'));
const ROUTES = routeFiles.map((f) => require(`../src/routes/${f}`)).filter((r) => r.path); // params.js is a helper, not a route
const GUARDED = ROUTES.filter((r) => !r.public);
// The advertiser view endpoints are per advertiser: a retailer user has to name exactly one (400 otherwise).
const PER_ADVERTISER = new Set(['/delivery', '/deals-by-display-type', '/audience', '/my-targeting']);
const RETAILER_ONLY = GUARDED.filter((r) => !r.advertiserAccess);

async function call(p, token, { routes, method = 'GET' } = {}) {
  const server = createServer({ store, today: '2026-10-11', authenticate, routes });
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${BASE}${p}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}

test('createServer refuses to start without authenticate (no open default)', () => {
  assert.throws(() => createServer({ store }), TypeError);
});

test('only /health is public; /health needs no token', async () => {
  assert.deepEqual(ROUTES.filter((r) => r.public).map((r) => r.path), ['/health']);
  assert.equal((await call('/health')).status, 200);
});

test('every guarded route answers 401 without a token, with a tampered, unknown, expired or wrong-scheme token', async () => {
  const good = tok('admin', 'retailer');
  const [body, sig] = good.split('.');
  const tampered = `${Buffer.from(JSON.stringify({ principalType: 'admin', principalId: 'retailer', exp: 9e9 })).toString('base64url')}.${sig}`;
  const wrongKey = mintToken({ secret: 'another-secret-another-secret-123456', principalType: 'admin', principalId: 'retailer' });
  const expired = tok('admin', 'retailer', { ttlSeconds: -10 });
  for (const r of GUARDED) {
    for (const t of [null, 'junk', tampered, wrongKey, expired, `${body}.`, '.', `${good}.x`]) {
      assert.equal((await call(`${r.path}?${Q}`, t)).status, 401, `${r.path} with ${String(t).slice(0, 12)}`);
    }
    const basic = createServer({ store, authenticate });
    await new Promise((res) => basic.listen(0, res));
    try {
      const res = await fetch(`http://127.0.0.1:${basic.address().port}${BASE}${r.path}?${Q}&access_token=${good}`, { headers: { authorization: `Basic ${good}` } });
      assert.equal(res.status, 401, `${r.path} query-string token / Basic scheme`);
    } finally { basic.close(); }
  }
});

test('an authenticate that throws or returns a malformed principal is a 401', async () => {
  for (const bad of [() => { throw new Error('boom'); }, () => ({}), () => ({ principalType: 'advertiser' }), () => ({ principalType: 'root', principalId: 'x' }), () => null]) {
    const server = createServer({ store, authenticate: bad });
    await new Promise((r) => server.listen(0, r));
    try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${BASE}/summary`)).status, 401); } finally { server.close(); }
  }
});

test('a retailer (admin) token reads every route, with or without an advertiserIds filter', async () => {
  const t = tok('admin', 'retailer');
  for (const r of GUARDED) {
    assert.equal((await call(`${r.path}?${Q}`, t)).status, PER_ADVERTISER.has(r.path) ? 400 : 200, r.path);
    assert.equal((await call(`${r.path}?${Q}&advertiserIds=adv-nova`, t)).status, 200, r.path);
  }
  const all = (await call(`/advertisers?${Q}`, t)).body.all;
  assert.ok(all.length > 1);
  assert.deepEqual((await call(`/advertisers?${Q}&advertiserIds=adv-nova`, t)).body.all.map((a) => a.advertiserId), ['adv-nova']);
});

test('advertiser tokens get 403 on every route that is not declared advertiser-callable', async () => {
  const t = tok('advertiser', 'adv-acme');
  assert.deepEqual(RETAILER_ONLY.map((r) => r.path).sort(), ['/advertisers', '/deals', '/maturity', '/missed-revenue', '/revenue', '/slot-allocation', '/slot-value', '/summary', '/yield']);
  for (const r of RETAILER_ONLY) {
    assert.equal((await call(`${r.path}?${Q}`, t)).status, 403, r.path);
    assert.equal((await call(`${r.path}?${Q}&advertiserIds=adv-nova`, t)).status, 403, r.path);
  }
});

test('a route with no declaration is retailer-only', async () => {
  const route = { path: '/new-thing', handler: () => ({ ok: true }) };
  assert.equal((await call('/new-thing', tok('advertiser', 'adv-acme'), { routes: [route] })).status, 403);
  assert.equal((await call('/new-thing', tok('admin', 'retailer'), { routes: [route] })).status, 200);
  assert.equal((await call('/new-thing', null, { routes: [route] })).status, 401);
});

test('POST is 405 for an authenticated caller and 401 without a token', async () => {
  assert.equal((await call('/summary', tok('admin', 'r'), { method: 'POST' })).status, 405);
  assert.equal((await call('/summary', null, { method: 'POST' })).status, 401);
});

test('an advertiser on an opted-in route gets only its own data, whatever advertiserIds says', async () => {
  const t = tok('advertiser', 'adv-nova');
  const routes = optIn('deals', 'advertisers', 'maturity');
  for (const other of ['', '&advertiserIds=adv-acme', '&advertiserIds[]=adv-acme&advertiserIds[]=adv-blackmores', '&advertiserIds=adv-acme,adv-nova']) {
    const adv = (await call(`/advertisers?${Q}${other}`, t, { routes })).body;
    assert.deepEqual(adv.all.map((a) => a.advertiserId), ['adv-nova'], other);
    const deals = (await call(`/deals?${Q}${other}`, t, { routes })).body;
    assert.ok(deals.rows.length > 0 && deals.rows.every((d) => d.advertisers.every((a) => a.advertiserId === 'adv-nova')), other);
    const text = JSON.stringify([adv, deals, (await call(`/maturity?${Q}${other}`, t, { routes })).body]);
    for (const name of ['Acme', 'Blackmores']) assert.ok(!text.includes(name), `${name} leaked with ${other}`);
  }
});

test('display-types and filter-options for an advertiser are limited to its deal slots plus campaign targets', async () => {
  const expected = (id) => allowedDisplayTypeIds(store, id).sort();
  const types = store.catalog.displayTypes;
  for (const id of ['adv-acme', 'adv-nova', 'adv-blackmores']) {
    const t = tok('advertiser', id);
    const opts = (await call('/filter-options', t)).body.displayTypes.map((d) => d.id).sort();
    assert.deepEqual(opts, expected(id));
    assert.ok(opts.length > 0 && opts.length < Object.keys(types).length || id !== 'adv-nova', id);
    for (const forged of ['', `&displayTypeIds=${Object.keys(types).join(',')}`]) {
      const rows = (await call(`/display-types?${Q}${forged}`, t)).body.rows.map((r) => r.id).sort();
      assert.deepEqual(rows, opts.filter((o) => rows.includes(o)), `${id}${forged}`);
      assert.ok(rows.every((r) => opts.includes(r)));
    }
  }
  const retailer = (await call('/filter-options', tok('admin', 'r'))).body.displayTypes.map((d) => d.id).sort();
  assert.deepEqual(retailer, Object.keys(types).sort());
});

test('campaign-targeted display types are added, untargeted campaigns add nothing', () => {
  const fake = {
    catalog: { displayTypes: { a: { name: 'A' }, b: { name: 'B' }, c: { name: 'C' } }, deals: { d1: { buyers: [{ advertiserId: 'x' }], slots: [{ displayTypeId: 'a' }] } } },
    campaigns: [{ advertiserId: 'x', displayTypeIds: ['b'] }, { advertiserId: 'x', displayTypeIds: null }, { advertiserId: 'y', displayTypeIds: ['c'] }],
  };
  assert.deepEqual(allowedDisplayTypeIds(fake, 'x').sort(), ['a', 'b']);
  assert.deepEqual(allowedDisplayTypeIds(fake, 'nobody'), []);
});

test('token helpers: verify round trip, short secret rejected, expiry honoured', () => {
  const p = verifyToken(SECRET, tok('advertiser', 'adv-acme'));
  assert.deepEqual(p, { principalType: 'advertiser', principalId: 'adv-acme', scopes: ['insights:read'] });
  assert.throws(() => createTokenAuthenticator({ secret: 'short' }));
  assert.throws(() => createTokenAuthenticator({}));
  assert.throws(() => mintToken({ secret: SECRET, principalType: 'partner', principalId: 'x' }));
  const t = tok('admin', 'r', { ttlSeconds: 60, now: 1_000_000 });
  assert.ok(verifyToken(SECRET, t, 1_000_000 + 30_000));
  assert.equal(verifyToken(SECRET, t, 1_000_000 + 61_000), null);
});

test('date range cap: over 366 days or a year outside 2000-2100 is 400', async () => {
  const t = tok('admin', 'r');
  for (const route of ['maturity?granularity=week', 'summary', 'revenue']) {
    const sep = route.includes('?') ? '&' : '?';
    assert.equal((await call(`/${route}${sep}dateFrom=1000-01-01&dateTo=9999-12-31`, t)).status, 400, route);
    assert.equal((await call(`/${route}${sep}dateFrom=1999-12-31&dateTo=2000-01-02`, t)).status, 400, route);
    assert.equal((await call(`/${route}${sep}dateFrom=2100-12-30&dateTo=2101-01-02`, t)).status, 400, route);
    assert.equal((await call(`/${route}${sep}dateFrom=2025-01-01&dateTo=2026-01-02`, t)).status, 400, route);
  }
  assert.equal((await call('/summary?dateFrom=2025-10-12&dateTo=2026-10-11', t)).status, 200); // exactly 365 days
  assert.equal((await call('/summary?dateFrom=2025-10-11&dateTo=2026-10-11', t)).status, 200); // 366 days, the limit
  assert.equal((await call('/summary?dateFrom=2025-10-10&dateTo=2026-10-11', t)).status, 400); // 367
});
