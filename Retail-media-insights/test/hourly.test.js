'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const calc = require('../src/calc');
const { admin, advertiser } = require('./helpers');

const { raw, ctx } = generateTestRetailer({ days: 10 });
const aggregates = buildAggregates(raw, ctx);
const store = new AggregateStore(aggregates);
const scan = new AggregateStore(aggregates, { indexed: false });
const Q = 'dateFrom=2026-10-02&dateTo=2026-10-11';

async function get(path, { st = store, ...opts } = {}) {
  const server = createServer({ store: st, today: '2026-10-11', authenticate: admin, ...opts });
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${BASE}${path}`);
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}

test('roundToTotal: rounded parts add to the rounded sum', () => {
  const parts = calc.roundToTotal([1.004, 1.004, 1.004], 2);
  assert.equal(Math.round(parts.reduce((a, b) => a + b, 0) * 100), 301);
  assert.deepEqual(calc.roundToTotal([0.4, 0.4, 0.4], 0), [1, 0, 0]);
});

test('hourly: only hours inside operating hours have a cell; outside screens run 24 hours', async () => {
  const { body } = await get(`/hourly?${Q}`);
  assert.equal(body.viewsBasis, 'share-of-slots-sold');
  const w = body.rows.find((r) => r.name === 'Window Portrait');
  assert.equal(w.hours.length, 24);
  const q = body.rows.find((r) => r.name === 'Queue Screen');
  assert.ok(q.hours.length > 0 && q.hours.length < 24);
  assert.ok(!JSON.stringify(body).includes('open'));
});

test('hourly: slots reconcile to Missed revenue & fill and revenue to the Revenue chart', async () => {
  for (const extra of ['', '&storeIds[]=store-1', '&advertiserIds[]=adv-unilever']) {
    const hourly = (await get(`/hourly?${Q}${extra}`)).body;
    const missed = (await get(`/missed-revenue?${Q}${extra}`)).body;
    for (const row of hourly.rows) {
      const m = missed.rows.find((r) => r.id === row.id);
      const sum = (k) => row.hours.reduce((n, h) => n + h[k], 0);
      assert.equal(sum('slotsSold'), m.slotsSold, row.name);
      assert.equal(sum('slotsUnsold'), m.slotsUnsold, row.name);
      assert.equal(sum('slotsOffline'), m.slotsOffline, row.name);
      for (const h of row.hours) assert.equal(h.slotsSold + h.slotsUnsold + h.slotsOffline, h.slotsTotal);
    }
    const revenue = (await get(`/revenue?${Q}${extra}`)).body.rows.reduce((n, r) => n + r.earned, 0);
    const hourlyRevenue = hourly.rows.reduce((n, r) => n + r.hours.reduce((m, h) => m + h.revenue, 0), 0);
    assert.ok(Math.abs(hourlyRevenue - revenue) <= 0.5, `${extra}: ${hourlyRevenue} vs ${revenue}`);
  }
});

test('hourly: the indexed store and the straight scan agree', async () => {
  for (const extra of ['', '&storeIds[]=store-1&storeIds[]=store-3', '&displayTypeIds[]=window&advertiserIds[]=adv-unilever']) {
    const a = (await get(`/hourly?${Q}${extra}`)).body;
    const b = (await get(`/hourly?${Q}${extra}`, { st: scan })).body;
    assert.deepEqual(a, b, extra);
  }
});

test('hourly is refused for advertiser logins', async () => {
  assert.equal((await get(`/hourly?${Q}`, { authenticate: advertiser('adv-haleon') })).status, 403);
});
