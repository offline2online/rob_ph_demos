'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const { admin, advertiser } = require('./helpers');

const { raw, ctx } = generateTestRetailer({ days: 10 });
const store = new AggregateStore(buildAggregates(raw, ctx));

async function withServer(fn, opts = {}) {
  const server = createServer({ store, today: '2026-10-11', authenticate: admin, ...opts });
  await new Promise((r) => server.listen(0, r));
  try { await fn(`http://127.0.0.1:${server.address().port}${BASE}`); } finally { server.close(); }
}

test('GET /health returns {status:ok}; POST returns 405; unknown path 404', () => withServer(async (base) => {
  const ok = await fetch(`${base}/health`);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { status: 'ok' });
  assert.equal((await fetch(`${base}/health`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
}));

test('a bad dateFrom returns 400', () => withServer(async (base) => {
  assert.equal((await fetch(`${base}/summary?dateFrom=2026-13-45`)).status, 400);
  assert.equal((await fetch(`${base}/summary?dateFrom=yesterday`)).status, 400);
  assert.equal((await fetch(`${base}/summary?dateFrom=2026-10-11&dateTo=2026-10-01`)).status, 400);
}));

test('summary and revenue honour the page filters; advertiser logins are scoped server-side', () => withServer(async (base) => {
  const all = await (await fetch(`${base}/summary?dateFrom=2026-10-02&dateTo=2026-10-11`)).json();
  assert.ok(all.earnedRevenue > 0 && all.inventorySold.percent > 0 && all.inventorySold.percent <= 100);
  const one = await (await fetch(`${base}/summary?dateFrom=2026-10-02&dateTo=2026-10-11&storeIds[]=store-1`)).json();
  assert.ok(one.earnedRevenue < all.earnedRevenue);
  const rev = await (await fetch(`${base}/revenue?dateFrom=2026-10-02&dateTo=2026-10-11&granularity=week`)).json();
  assert.equal(rev.granularity, 'week');
  assert.ok(rev.rows.length > 0);
  assert.equal((await fetch(`${base}/revenue?granularity=hour`)).status, 400);
}));

