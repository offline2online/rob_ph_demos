'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');

const { raw, ctx } = generateTestRetailer({ days: 90 });
const store = new AggregateStore(buildAggregates(raw, ctx));

async function get(path, opts = {}) {
  const server = createServer({ store, today: '2026-10-11', ...opts });
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${BASE}${path}`);
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}
const pg = async (q) => (await get(`/deals?${q}`)).body.rows.find((r) => r.dealType === 'Programmatic Guaranteed');

test('deals: one row per named deal in standard order, Open auction excluded', async () => {
  const { status, body } = await get('/deals');
  assert.equal(status, 200);
  assert.deepEqual(body.rows.map((r) => r.dealType), ['Programmatic Guaranteed', 'Preferred deal', 'Private auction']);
  const d = body.rows[0];
  assert.ok(d.name && d.description && d.revenue > 0);
  assert.deepEqual(d.dealIds.map((x) => x.dsp), ['DV360', 'The Trade Desk']);
  assert.ok(d.dealIds.every((x) => x.dealId.startsWith('PH-')));
  assert.equal(d.slots[0].label, 'Advertiser slot 1 (loop slot 2)');
  assert.equal(d.slots[0].playlistZone, 'Window loop · Zone A');
  assert.equal(d.slots[0].iabZone, 'Entrance & out of category');
  assert.ok(d.fill.percent > 0 && d.fill.percent <= 100);
});

test('deals: PG pacing before, during and after the flight', async () => {
  const before = (await pg('dateFrom=2026-09-01&dateTo=2026-09-10')).pacing;
  assert.equal(before.startsInDays, 10); assert.equal(before.percent, null); assert.equal(before.daysElapsed, 0);
  const during = (await pg('dateFrom=2026-09-01&dateTo=2026-10-16')).pacing;
  assert.equal(during.daysElapsed, 27); assert.equal(during.flightDays, 62); assert.equal(during.daysRemaining, 35);
  assert.equal(during.startsInDays, null); assert.equal(during.flightEnded, false);
  assert.equal(during.guaranteedToDate, Math.round(4000000 * 0.9 * 27 / 62));
  const after = (await pg('dateFrom=2026-11-01&dateTo=2026-12-01')).pacing;
  assert.equal(after.daysRemaining, 0); assert.equal(after.flightEnded, true);
  assert.equal(after.guaranteedToDate, after.guaranteedForFlight);
  const others = (await get('/deals')).body.rows.filter((r) => r.dealType !== 'Programmatic Guaranteed');
  assert.ok(others.every((r) => r.pacing === null));
});

test('deals: dealType filter, 400 on unknown, CPM floor for Private auction', async () => {
  const { body } = await get('/deals?dealType=Preferred deal');
  assert.deepEqual(body.rows.map((r) => r.dealType), ['Preferred deal']);
  assert.equal(body.rows[0].cpm.kind, 'fixed');
  assert.equal((await get('/deals?dealType=Nope')).status, 400);
  assert.equal((await get('/deals?dealType=Private auction')).body.rows[0].cpm.kind, 'floor');
});

test('advertisers: shares add to 100, revenue equals billing, top 10 and all', async () => {
  const q = 'dateFrom=2026-09-12&dateTo=2026-10-11';
  const { body } = await get(`/advertisers?${q}`);
  assert.equal(body.all.reduce((a, r) => a + r.share, 0), 100);
  assert.ok(body.top.length <= 10 && body.top.length === body.all.length);
  const billed = raw.billing.filter((b) => b.date >= '2026-09-12').reduce((a, b) => a + b.revenue, 0);
  assert.ok(Math.abs(body.all.reduce((a, r) => a + r.revenue, 0) - billed) < 0.5 * body.all.length);
  const a = body.all.find((r) => r.advertiserId === 'adv-acme');
  assert.deepEqual(a.dealsOn.map((d) => d.dealType), ['Programmatic Guaranteed', 'Preferred deal']);
  assert.ok(a.slotsCovered === 4 && a.slotsWonPercent > 0 && a.effectiveCpm > 0 && a.dsp);
  assert.equal(body.slotsWon.complete, true);
});

test('advertisers: slotsWon incomplete beyond 90 days of retention', async () => {
  assert.equal((await get('/advertisers?dateFrom=2026-07-01&dateTo=2026-10-11')).body.slotsWon.complete, false);
});

test('advertiser login sees only its own deals, buyer, DSP deal ID and row', async () => {
  const auth = () => ({ advertiserId: 'adv-nova' });
  const deals = (await get('/deals', { authenticate: auth })).body.rows;
  assert.deepEqual(deals.map((r) => r.dealType), ['Private auction']);
  assert.deepEqual(deals[0].advertisers.map((a) => a.advertiserId), ['adv-nova']);
  assert.deepEqual(deals[0].dealIds.map((x) => x.dsp), ['Amazon DSP']);
  const adv = (await get('/advertisers', { authenticate: auth })).body;
  assert.deepEqual(adv.all.map((r) => r.advertiserId), ['adv-nova']);
  assert.equal(adv.all[0].share, 100);
  assert.ok(!JSON.stringify(adv).includes('Acme'));
});
