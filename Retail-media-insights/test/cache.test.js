'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer, ADVERTISERS } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, loadRoutes, BASE } = require('../src/server');
const { optIn } = require('./helpers');
const { ResponseCache } = require('../src/cache');

const TODAY = '2026-10-11';
const { raw, ctx } = generateTestRetailer({ days: 30 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const Q = 'dateFrom=2026-09-12&dateTo=2026-10-11';

// Tokens stand in for logins: "admin", "admin2" (a second retailer user) or an advertiser id.
const authenticate = (req) => {
  const t = String(req.headers.authorization || '').replace('Bearer ', '');
  if (t.startsWith('admin')) return { principalType: 'admin', principalId: t, scopes: ['insights:read'] };
  if (t) return { principalType: 'advertiser', principalId: t, scopes: ['insights:read'] };
  return null;
};
async function withServer(fn, opts = {}) {
  const server = createServer({ store, today: TODAY, authenticate, ...opts });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}${BASE}`;
  const get = async (path, token) => { const res = await fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }); return { status: res.status, text: await res.text() }; };
  try { await fn(get, server); } finally { server.close(); }
}

test('the cache holds at most maxEntries entries and drops the least recently used first', () => {
  const c = new ResponseCache({ maxEntries: 3 });
  for (const k of ['a', 'b', 'c']) c.set(k, `"${k}"`);
  assert.equal(c.get('a'), '"a"'); // a is now the most recent; b is the oldest
  c.set('d', '"d"');
  assert.deepEqual([...c.entries.keys()], ['c', 'a', 'd']);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.size, 3);
});

test('the cache holds at most maxBytes of serialised responses, and never one bigger than that', () => {
  const c = new ResponseCache({ maxBytes: 100, maxEntries: 500 });
  c.set('a', 'x'.repeat(40)); c.set('b', 'y'.repeat(40));
  c.set('c', 'z'.repeat(40)); // 120 bytes: a goes
  assert.equal(c.get('a'), undefined);
  assert.equal(c.bytes, 80);
  assert.equal(c.set('big', 'q'.repeat(101)), false);
  assert.equal(c.get('big'), undefined);
  assert.equal(c.bytes, 80);
  c.set('b', 'y'.repeat(10)); // replacing an entry re-counts it
  assert.equal(c.bytes, 50);
  c.clear();
  assert.deepEqual([c.size, c.bytes], [0, 0]);
  assert.equal(new ResponseCache().maxEntries, 500);
  assert.equal(new ResponseCache().maxBytes, 64 * 1024 * 1024);
});

test('bytes are counted as UTF-8, not characters', () => {
  const c = new ResponseCache();
  c.set('k', '"é€"');
  assert.equal(c.bytes, Buffer.byteLength('"é€"'));
});

test('keyFor: admins share one key space, advertisers each have their own, and the key is canonical', () => {
  const c = new ResponseCache();
  const route = { path: '/deals' };
  const f = { dateFrom: '2026-09-12', dateTo: TODAY, storeIds: ['s2', 's1'], displayTypeIds: null, advertiserIds: null };
  const k = (principal, filters = f, q = Q) => c.keyFor({ route, principal, filters, params: new URLSearchParams(q) });
  const admin = { principalType: 'admin', principalId: 'a' }; const admin2 = { principalType: 'admin', principalId: 'b' };
  const advA = { principalType: 'advertiser', principalId: 'adv-a' }; const advB = { principalType: 'advertiser', principalId: 'adv-b' };
  assert.equal(k(admin), k(admin2));
  assert.notEqual(k(admin), k(advA));
  assert.notEqual(k(advA), k(advB));
  // An advertiser named "admin" is not an admin.
  assert.notEqual(k({ principalType: 'advertiser', principalId: 'admin' }), k(admin));
  // Lists are read as sets, so order does not matter; other query parameters are part of the key, in any order.
  assert.equal(k(admin, f), k(admin, { ...f, storeIds: ['s1', 's2'] }));
  assert.notEqual(k(admin, f), k(admin, { ...f, storeIds: ['s1'] }));
  assert.equal(k(admin, f, 'dealType=Preferred+deal&granularity=week'), k(admin, f, 'granularity=week&dealType=Preferred+deal'));
  assert.notEqual(k(admin, f, 'granularity=week'), k(admin, f, 'granularity=day'));
  // The raw filter parameters are represented by the filters (after scoping), not by the query text.
  assert.equal(k(admin, f, 'storeIds=s1,s2&dateFrom=2026-09-12'), k(admin, f, 'storeIds[]=s1&advertiserIds=anything'));
  assert.notEqual(c.keyFor({ route: { path: '/summary' }, principal: admin, filters: f, params: new URLSearchParams() }), k(admin));
});

test('a cached response is byte for byte the response the handler gives, for every route', () => withServer(async (get, server) => {
  const urls = ['/summary', '/revenue?granularity=week', '/deals', '/advertisers', '/display-types', '/slot-value', '/slot-allocation', '/missed-revenue', '/maturity', '/filter-options', '/datasets']
    .map((p) => `${p}${p.includes('?') ? '&' : '?'}${Q}`);
  await withServer(async (plain) => {
    for (const url of urls) {
      const cold = await get(url, 'admin'); const warm = await get(url, 'admin');
      assert.deepEqual(cold, await plain(url, 'admin'), url);
      assert.deepEqual(warm, cold, url);
    }
  }, { cache: false });
  assert.equal(server.cache.hits, urls.length);
  assert.equal(server.cache.size, urls.length);
}));

test('advertiser A never receives B\'s cached response, nor an admin\'s, and nobody gets the advertiser\'s', () => withServer(async (get, server) => {
  const [A, B] = ADVERTISERS;
  const path = `/deals-by-display-type?${Q}`;
  const a1 = await get(path, A); // A's response is cached first ...
  assert.equal(a1.status, 200);
  const b1 = await get(path, B); // ... then B asks for the same URL
  assert.equal(b1.status, 200);
  assert.notEqual(b1.text, a1.text);
  const adminAsA = await get(`${path}&advertiserIds=${A}`, 'admin'); // an admin looking at A is not A's cache entry either
  const adminAsB = await get(`${path}&advertiserIds=${B}`, 'admin');
  assert.equal(adminAsA.status, 200);
  assert.deepEqual(JSON.parse(adminAsA.text), JSON.parse(a1.text));
  assert.deepEqual(JSON.parse(adminAsB.text), JSON.parse(b1.text));
  // A client-supplied advertiserIds never changes whose data an advertiser sees (nor which entry it reads)
  const spoof = await get(`${path}&advertiserIds=${B}`, A);
  assert.equal(spoof.text, a1.text);
  // Same URL, cached for A, B and an admin: each now hits only its own entry
  const before = server.cache.size;
  assert.equal((await get(path, A)).text, a1.text);
  assert.equal((await get(path, B)).text, b1.text);
  assert.equal(server.cache.size, before);

  // The retailer's /deals is cached for the admin; an advertiser asking for the same URL gets its own scoped answer
  const dealsAdmin = await get(`/deals?${Q}`, 'admin');
  const dealsA = await get(`/deals?${Q}`, A);
  const dealsB = await get(`/deals?${Q}`, B);
  assert.notEqual(dealsA.text, dealsAdmin.text);
  assert.notEqual(dealsA.text, dealsB.text);
  assert.ok(JSON.parse(dealsA.text).rows.every((r) => r.advertisers.every((x) => x.advertiserId === A)));
  assert.ok(JSON.parse(dealsAdmin.text).rows.some((r) => r.advertisers.some((x) => x.advertiserId !== A)));
  assert.equal((await get(`/deals?${Q}`, 'admin2')).text, dealsAdmin.text); // a second admin shares the admin entry

  // An advertiser is refused a retailer-only route even while the admin's answer to it is cached; no token is a 401
  assert.equal((await get(`/missed-revenue?${Q}`, 'admin')).status, 200);
  assert.equal((await get(`/missed-revenue?${Q}`, 'admin')).status, 200);
  assert.equal((await get(`/missed-revenue?${Q}`, A)).status, 403);
  assert.equal((await get(`/missed-revenue?${Q}`)).status, 401);
  assert.equal((await get(`/deals?${Q}`)).status, 401);
}, { routes: [...loadRoutes().filter((r) => r.path !== '/deals'), ...optIn('deals')] })); // /deals opened to advertisers, as a later ticket might

test('errors are not cached, and replaceStore clears the cache', () => withServer(async (get, server) => {
  assert.equal((await get(`/summary?dateFrom=nope`, 'admin')).status, 400);
  assert.equal(server.cache.size, 0);
  const first = await get(`/summary?${Q}`, 'admin');
  assert.equal(server.cache.size, 1);
  const empty = new AggregateStore({ delivery: [], inventory: [], catalog: { displayTypes: {}, displays: [] } });
  server.replaceStore(empty);
  assert.equal(server.cache.size, 0);
  const after = await get(`/summary?${Q}`, 'admin');
  assert.notEqual(after.text, first.text);
  assert.equal(JSON.parse(after.text).earnedRevenue, 0);
}));

test('health is never cached and the CSV datasets are served as before', () => withServer(async (get, server) => {
  await get('/health'); await get('/health');
  assert.equal(server.cache.size, 0);
  const csv = await get(`/dataset?name=revenue&format=csv&${Q}`, 'admin');
  assert.equal(csv.status, 200);
  assert.ok(csv.text.startsWith('period,') || csv.text.includes(','), csv.text.slice(0, 80));
}));

test('the key sorts filter lists because every route answers the same for any order of them', () => withServer(async (get) => {
  const routes = ['summary', 'revenue', 'deals', 'advertisers', 'display-types', 'slot-value', 'slot-allocation', 'missed-revenue', 'maturity'];
  await withServer(async (plain) => {
    for (const r of routes) {
      const a = await plain(`/${r}?${Q}&storeIds=store-1,store-3,store-2&displayTypeIds=queue,window,endcap&advertiserIds=${ADVERTISERS.join(',')}`, 'admin');
      const b = await plain(`/${r}?${Q}&storeIds=store-2,store-1,store-3&displayTypeIds=endcap,queue,window&advertiserIds=${[...ADVERTISERS].reverse().join(',')}`, 'admin');
      assert.deepEqual(a, b, r);
    }
  }, { cache: false });
  const a = await get(`/summary?${Q}&storeIds=store-3,store-1`, 'admin');
  const b = await get(`/summary?${Q}&storeIds[]=store-1&storeIds[]=store-3`, 'admin');
  assert.deepEqual(a, b);
}));
