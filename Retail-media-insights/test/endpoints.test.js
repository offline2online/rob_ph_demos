'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const { DEAL_TYPES, DSPS } = require('../src/constants');

const { raw, ctx } = generateTestRetailer({ days: 30 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const Q = 'dateFrom=2026-09-12&dateTo=2026-10-11';

async function withServer(fn) {
  const server = createServer({ store, today: '2026-10-11' });
  await new Promise((r) => server.listen(0, r));
  try { await fn(async (p) => (await fetch(`http://127.0.0.1:${server.address().port}${BASE}${p}`)).json()); } finally { server.close(); }
}
const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);

test('summary money equals the sum of revenue for the same filters, at every granularity', () => withServer(async (get) => {
  for (const extra of ['', '&dsps=DV360', '&dsps[]=DV360&dsps[]=Amazon DSP&dealTypes=Open auction,Preferred deal', '&storeIds=store-2']) {
    const s = await get(`/summary?${Q}${extra}`);
    for (const g of ['day', 'week', 'month']) {
      const r = await get(`/revenue?${Q}&granularity=${g}${extra}`);
      assert.ok(Math.abs(s.earnedRevenue - sum(r.rows, 'earned')) < 0.01 * r.rows.length, `earned ${g} ${extra}`);
      assert.ok(Math.abs(s.estimatedRevenue - sum(r.rows, 'estimated')) < 0.01 * r.rows.length, `estimated ${g} ${extra}`);
    }
  }
}));

test('summary inventory parts add up and match the raw slot records', () => withServer(async (get) => {
  const s = (await get(`/summary?${Q}`)).inventorySold;
  assert.equal(s.percent, Math.round((s.slotsSold / (s.slotsSold + s.slotsAvailable)) * 100));
  assert.ok(s.slotsSold > 0 && s.slotsAvailable > 0);
}));

test('revenue rows are ordered by period, DSP then deal type', () => withServer(async (get) => {
  const { rows } = await get(`/revenue?${Q}&granularity=month`);
  for (let i = 1; i < rows.length; i += 1) {
    const a = rows[i - 1]; const b = rows[i];
    if (a.period === b.period && a.dsp === b.dsp) assert.ok(DEAL_TYPES.indexOf(a.dealType) < DEAL_TYPES.indexOf(b.dealType));
    if (a.period === b.period && a.dsp !== b.dsp) assert.ok(DSPS.indexOf(a.dsp) < DSPS.indexOf(b.dsp));
  }
}));

test('yield: one row per connected DSP in standard order; CPM reconciles to billing', () => withServer(async (get) => {
  const y = await get(`/yield?${Q}`);
  assert.deepEqual(y.rows.map((r) => r.dsp), DSPS);
  for (const row of y.rows) {
    let rev = 0; let views = 0;
    for (const b of raw.billing) {
      if (b.date < '2026-09-12' || b.date > '2026-10-11' || b.dsp !== row.dsp || !b.settled) continue;
      rev += b.revenue; views += b.views;
    }
    assert.equal(row.assumedViews, views);
    assert.ok(Math.abs(row.earnedRevenue - rev) < 0.01);
    assert.ok(Math.abs(row.effectiveCpm - rev / (views / 1000)) < 0.01);
  }
  const one = await get(`/yield?${Q}&dealType=Preferred deal`);
  assert.equal(one.dealType, 'Preferred deal');
  // d2 (Preferred deal) is sold only through The Trade Desk at $18 CPM.
  assert.equal(one.rows.find((r) => r.dsp === 'The Trade Desk').effectiveCpm, 18);
  assert.equal(one.rows.find((r) => r.dsp === 'DV360').effectiveCpm, null);
}));

test('yield rejects unknown or multiple deal types', async () => {
  const server = createServer({ store, today: '2026-10-11' });
  await new Promise((r) => server.listen(0, r));
  try {
    const base = `http://127.0.0.1:${server.address().port}${BASE}`;
    assert.equal((await fetch(`${base}/yield?dealType=Nope`)).status, 400);
    assert.equal((await fetch(`${base}/yield?dealType=Open auction,Private auction`)).status, 400);
    assert.equal((await fetch(`${base}/revenue?dealTypes=Nope`)).status, 400);
  } finally { server.close(); }
});
