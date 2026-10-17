'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');

const { raw, ctx } = generateTestRetailer({ days: 10 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const Q = 'dateFrom=2026-10-02&dateTo=2026-10-11';

async function get(path, opts = {}) {
  const server = createServer({ store, today: '2026-10-11', ...opts });
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${BASE}${path}`);
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}

test('display-types: hover cards in shopper-journey order with stored fields only', async () => {
  const { body } = await get(`/display-types?${Q}`);
  assert.deepEqual(body.rows.map((r) => r.name), ['Endcap Shelf-edge', 'Window Portrait', 'Queue Screen', 'Dispensary Screen']);
  const w = body.rows.find((r) => r.name === 'Window Portrait');
  assert.deepEqual(w.connectedDisplays, { displays: 10, stores: 5 });
  assert.equal(w.operatingHours, '24 hours');
  assert.equal(body.rows.find((r) => r.name === 'Queue Screen').operatingHours, 'Store opening hours');
  assert.equal(w.canvas.label, '1080 × 1920 px');
  assert.equal(w.displayOrientation, '90°');
  assert.equal(w.averages.averageAssumedViewsPerSlotPerDay, 200);
  assert.equal(w.averages.averageFootfallPerDay, 4000);
  assert.equal(w.averages.shareOfLoopTime.percent, 10);
  assert.equal(w.averages.averagesCover.label, 'Averages across all 10 connected Window Portrait displays in 5 stores, 2 Oct – 11 Oct.');
  assert.ok(!JSON.stringify(body).includes('"open"'), 'no specific opening times');
});

test('display-types: a field that is not stored is omitted; store and type filters apply', async () => {
  const bare = new AggregateStore({ delivery: [], inventory: [], catalog: {
    displayTypes: { x: { name: 'Bare', zone: 'Checkout' } }, displays: [{ id: 'd', displayTypeId: 'x', storeId: 's' }],
  } });
  const server = createServer({ store: bare, today: '2026-10-11' });
  await new Promise((r) => server.listen(0, r));
  const res = await (await fetch(`http://127.0.0.1:${server.address().port}${BASE}/display-types`)).json();
  server.close();
  assert.deepEqual(Object.keys(res.rows[0]).sort(), ['connectedDisplays', 'iabZone', 'id', 'name']);
  const { body } = await get(`/display-types?${Q}&storeIds[]=store-1&displayTypeIds=window`);
  assert.equal(body.rows.length, 1);
  assert.deepEqual(body.rows[0].connectedDisplays, { displays: 2, stores: 1 });
  assert.equal(body.rows[0].averages.averageFootfallPerDay, 3600);
});

test('slot-value: per slot per day and network totals reconcile', async () => {
  const { body } = await get(`/slot-value?${Q}`);
  assert.equal(body.rows.length, 4);
  for (const r of body.rows) {
    assert.ok(r.effectiveCpm > 0 && r.floorCpm > 0);
    assert.ok(Math.abs(r.perSlotPerDay * r.totals.advertiserSlots * r.totals.days - r.totals.earnedRevenue) <= r.totals.advertiserSlots * r.totals.days * 0.01 + 1);
  }
  assert.equal(body.network.earnedRevenue, Math.round(body.rows.reduce((n, r) => n + r.totals.earnedRevenue, 0)) );
  const w = body.rows.find((r) => r.name === 'Window Portrait');
  assert.equal(w.totals.advertiserSlots, 80);
});

test('slot-allocation: counts and durations add to the loop', async () => {
  const { body } = await get(`/slot-allocation?${Q}`);
  for (const r of body.rows) {
    assert.equal(r.advertiserSlots.count + r.ownContentSlots.count, r.slotsPerLoop);
    assert.equal(r.advertiserSlots.count * r.advertiserSlots.avgSeconds + r.ownContentSlots.count * r.ownContentSlots.avgSeconds, r.loopSeconds);
    assert.equal(r.advertiserSlots.totalSeconds + r.ownContentSlots.totalSeconds, r.loopSeconds);
    assert.equal(r.advertiserSlots.percentOfLoop + r.ownContentSlots.percentOfLoop, 100);
    assert.ok(r.advertiserSlotsSoldPercent > 0 && r.advertiserSlotsSoldPercent <= 100);
  }
  const w = body.rows.find((r) => r.name === 'Window Portrait');
  assert.equal(w.advertiserSlots.percentOfLoop, 80);
});

test('missed-revenue: parts add to totals, including the all-types row', async () => {
  const { body } = await get(`/missed-revenue?${Q}`);
  for (const r of [...body.rows, body.total]) {
    assert.equal(r.slotsSold + r.slotsUnsold + r.slotsOffline, r.slotsTotal);
    assert.equal(r.unsoldValueAtFloor + r.downtimeLostRevenue, r.totalMissed);
  }
  for (const k of ['slotsTotal', 'unsoldValueAtFloor', 'downtimeLostRevenue', 'totalMissed']) {
    assert.equal(body.rows.reduce((n, r) => n + r[k], 0), body.total[k]);
  }
  assert.deepEqual(body.total.floorCpm, { min: 6, max: 12 });
  assert.equal(body.total.connectedDisplays.displays, 50);
  assert.ok(body.total.downtimeLostRevenue > 0 && body.total.slotsOffline > 0);
});

test('missed-revenue is refused for advertiser logins', async () => {
  const { status } = await get(`/missed-revenue?${Q}`, { authenticate: () => ({ advertiserId: 'adv-acme' }) });
  assert.equal(status, 403);
});
