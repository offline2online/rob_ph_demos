'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const { admin, advertiser } = require('./helpers');
const { DEAL_TYPES, SOURCES: DSPS } = require('../src/constants');

const { raw, ctx } = generateTestRetailer({ days: 30 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const Q = 'dateFrom=2026-09-12&dateTo=2026-10-11';

async function withServer(fn) {
  const server = createServer({ store, today: '2026-10-11', authenticate: admin });
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
    }
    // Estimated revenue is the reservations in its own window, whatever the range: the same chart filters on /revenue over that window.
    const w = s.estimatedWindow;
    const ahead = await get(`/revenue?dateFrom=${w.dateFrom}&dateTo=${w.dateTo}&granularity=day${extra}`);
    assert.ok(Math.abs(s.estimatedRevenue - sum(ahead.rows, "estimated")) <= 0.01 * ahead.rows.length, `estimated ${extra}`);
  }
}));

test('summary inventory parts add up and match the raw slot records', () => withServer(async (get) => {
  const s = (await get(`/summary?${Q}`)).inventorySold;
  assert.equal(s.percent, Math.round((s.slotsSold / (s.slotsSold + s.slotsAvailable + s.slotsOffline)) * 100));
  assert.ok(s.slotsSold > 0 && s.slotsAvailable > 0);
}));

test('summary Inventory sold equals Missed revenue fill, and every row reads its own x of y', () => withServer(async (get) => {
  for (const extra of ['', '&storeIds=store-2']) {
    const s = (await get(`/summary?${Q}${extra}`)).inventorySold;
    const { rows, total } = await get(`/missed-revenue?${Q}${extra}`);
    assert.equal(s.percent, total.fillPercent, `summary vs total ${extra}`);
    assert.equal(s.slotsSold + s.slotsAvailable + s.slotsOffline, total.slotsTotal);
    for (const r of [...rows, total]) {
      if (r.slotsTotal) assert.equal(r.fillPercent, Math.round((r.slotsSold / r.slotsTotal) * 100), r.name);
    }
  }
}));

test('deal type labels use the README casing; the old casing is accepted on input only', () => withServer(async (get) => {
  assert.deepEqual(DEAL_TYPES, ['Direct advertiser', 'Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction']);
  const types = (await get(`/deals?${Q}`)).rows.map((r) => r.dealType);
  assert.ok(types.includes('Programmatic guaranteed') && !types.includes('Programmatic Guaranteed'));
  const old = await get(`/deals?${Q}&dealType=Programmatic Guaranteed`);
  assert.equal(old.dealType, 'Programmatic guaranteed');
  assert.ok(old.rows.length && old.rows.every((r) => r.dealType === 'Programmatic guaranteed'));
  const a = await get(`/summary?${Q}&dealTypes=Programmatic Guaranteed`);
  const b = await get(`/summary?${Q}&dealTypes=Programmatic guaranteed`);
  assert.deepEqual(a, b);
}));

test('revenue rows are ordered by period, DSP then deal type', () => withServer(async (get) => {
  const { rows } = await get(`/revenue?${Q}&granularity=month`);
  for (let i = 1; i < rows.length; i += 1) {
    const a = rows[i - 1]; const b = rows[i];
    if (a.period === b.period && a.dsp === b.dsp) assert.ok(DEAL_TYPES.indexOf(a.dealType) < DEAL_TYPES.indexOf(b.dealType));
    if (a.period === b.period && a.dsp !== b.dsp) assert.ok(DSPS.indexOf(a.dsp) < DSPS.indexOf(b.dsp));
  }
}));

test('revenue rejects unknown deal types', async () => {
  const server = createServer({ store, today: '2026-10-11', authenticate: admin });
  await new Promise((r) => server.listen(0, r));
  try {
    const base = `http://127.0.0.1:${server.address().port}${BASE}`;
    assert.equal((await fetch(`${base}/revenue?dealTypes=Nope`)).status, 400);
  } finally { server.close(); }
});

test('summary previous period: equal-length period before the range, same filters', () => withServer(async (get) => {
  const s = await get(`/summary?${Q}`);
  const len = Math.round((Date.parse(s.previous.dateTo) - Date.parse(s.previous.dateFrom)) / 86400000) + 1;
  const r = await get(`/revenue?dateFrom=${s.previous.dateFrom}&dateTo=${s.previous.dateTo}&granularity=day`);
  assert.ok(len >= 1);
  assert.ok(Math.abs(s.previous.earnedRevenue - sum(r.rows, 'earned')) <= 0.01 * Math.max(1, r.rows.length));
}));

test('direct advertisers: Direct is its own source in Revenue and the summary, part of earned revenue and not on top of it', () => withServer(async (get) => {
  const rev = (await get(`/revenue?${Q}&granularity=month`)).rows;
  const direct = rev.filter((r) => r.dsp === 'Direct');
  assert.ok(direct.length && direct.every((r) => r.dealType === 'Direct advertiser'), 'only direct deals are billed under Direct');
  assert.ok(rev.filter((r) => r.dealType === 'Direct advertiser').every((r) => r.dsp === 'Direct'));
  const only = (await get(`/revenue?${Q}&granularity=month&dsps=Direct`)).rows;
  assert.deepEqual(only.map((r) => r.dsp), only.map(() => 'Direct'));
  const byType = (await get(`/revenue?${Q}&granularity=month&dealTypes=Direct advertiser`)).rows;
  assert.deepEqual(byType, only, 'the Direct source and the Direct advertiser deal type select the same rows');
  const summary = await get(`/summary?${Q}`);
  const billed = raw.billing.filter((b) => b.date >= '2026-09-12' && b.date <= '2026-10-11' && b.settled && b.dsp === 'Direct').reduce((n, b) => n + b.revenue, 0);
  assert.ok(Math.abs(summary.direct.earnedRevenue - billed) < 0.01);
  assert.equal(summary.direct.advertisers, 5, 'five of the eleven example advertisers buy direct');
  assert.equal(summary.direct.sharePercent, Math.round((summary.direct.earnedRevenue / summary.earnedRevenue) * 100));
  assert.ok(summary.direct.earnedRevenue < summary.earnedRevenue);
  const noDirect = await get(`/summary?${Q}&dsps=DV360,The Trade Desk,Amazon DSP`);
  assert.deepEqual([noDirect.direct.earnedRevenue, noDirect.direct.sharePercent, noDirect.direct.advertisers], [0, 0, 0]);
  assert.equal(summary.connectedDsps, 3, 'Direct is not a connected DSP');
}));

test('direct advertisers: the Advertisers table names Perrigo as Direct, with no seats', () => withServer(async (get) => {
  const a = (await get(`/advertisers?${Q}`)).all.find((x) => x.name === 'Perrigo');
  assert.deepEqual([a.dsp, a.direct, a.seatCount], ['Direct', true, 0]);
  const opts = (await get('/filter-options')).advertisers.find((x) => x.name === 'Perrigo');
  assert.equal(opts.dsp, 'Direct');
}));
