'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { scopeFilters } = require('../src/filters');

const { raw, ctx } = generateTestRetailer();
const aggregates = buildAggregates(raw, ctx);
const store = new AggregateStore(aggregates);
const ALL = { dateFrom: '2026-07-14', dateTo: '2026-10-11', storeIds: null, displayTypeIds: null, advertiserIds: null };

function deliveryTotals(f) {
  const t = { revenue: 0, views: 0, slots: 0 };
  store.scanDelivery(f, (r) => { t.revenue += r.revenue; t.views += r.views; t.slots += r.slots; });
  return t;
}
function rawTotals(f) {
  const t = { revenue: 0, views: 0, slots: 0 };
  for (const b of raw.billing) {
    if (b.date < f.dateFrom || b.date > f.dateTo) continue;
    if (f.storeIds && !f.storeIds.includes(b.storeId)) continue;
    if (f.displayTypeIds && !f.displayTypeIds.includes(b.displayTypeId)) continue;
    if (f.advertiserIds && !f.advertiserIds.includes(b.advertiserId)) continue;
    t.revenue += b.revenue; t.views += b.views; t.slots += b.slots;
  }
  return t;
}
function assertReconciles(f) {
  const a = deliveryTotals(f); const r = rawTotals(f);
  assert.ok(Math.abs(a.revenue - r.revenue) < 1e-6, 'revenue');
  assert.equal(a.views, r.views);
  assert.equal(a.slots, r.slots);
}

test('test retailer has 5 stores and covers 90 days', () => {
  assert.equal(new Set(raw.billing.map((b) => b.storeId)).size, 5);
  assert.equal(new Set(raw.billing.map((b) => b.date)).size, 90);
});

test('delivery aggregates equal raw billing, unfiltered', () => assertReconciles(ALL));

test('delivery aggregates equal raw billing under store, display type, advertiser and date filters', () => {
  assertReconciles({ ...ALL, storeIds: ['store-1', 'store-3'] });
  assertReconciles({ ...ALL, displayTypeIds: ['queue'] });
  assertReconciles({ ...ALL, advertiserIds: ['adv-acme'] });
  assertReconciles({ dateFrom: '2026-09-01', dateTo: '2026-09-15', storeIds: ['store-2'], displayTypeIds: ['window', 'endcap'], advertiserIds: ['adv-nova'] });
});

test('sold slots in inventory equal slots billed', () => {
  let sold = 0; store.scanInventory(ALL, (r) => { sold += r.sold; });
  assert.equal(sold, deliveryTotals(ALL).slots);
});

test('unsold + offline + outside-hours + sold slots equal all slot records', () => {
  let n = 0;
  store.scanInventory(ALL, (r) => { n += r.sold + r.unsold + r.offline + r.outsideHours; });
  assert.equal(n, raw.slotRecords.reduce((a, s) => a + s.count, 0));
});

test('window screens (24h) never have outside-hours slots; other types never count 08:00-20:00 exclusions as unsold', () => {
  store.scanInventory(ALL, (r) => {
    if (r.displayTypeId === 'window') assert.equal(r.outsideHours, 0);
  });
  // Re-derive unsold from raw records inside 08:00-20:00 and compare with the aggregate.
  for (const typeId of ['endcap', 'queue', 'dispensary']) {
    let expected = 0; let outside = 0;
    for (const s of raw.slotRecords) {
      if (s.displayTypeId !== typeId) continue;
      if (s.hour >= 8 && s.hour < 20) { if (s.status === 'unsold') expected += s.count; } else outside += s.count;
    }
    let unsold = 0; let outsideAgg = 0;
    store.scanInventory(ALL, (r) => { if (r.displayTypeId === typeId) { unsold += r.unsold; outsideAgg += r.outsideHours; } });
    assert.equal(unsold, expected);
    assert.equal(outsideAgg, outside);
    assert.ok(outside > 0);
  }
});

test('unsold inventory ignores the advertiser filter', () => {
  const sum = (f) => { let u = 0; store.scanInventory(f, (r) => { u += r.unsold; }); return u; };
  assert.equal(sum({ ...ALL, advertiserIds: ['adv-acme'] }), sum(ALL));
});

test('an advertiser principal is pinned to its own advertiser server-side', () => {
  const scoped = scopeFilters({ ...ALL, advertiserIds: ['adv-nova'] }, { advertiserId: 'adv-acme' });
  assert.deepEqual(scoped.advertiserIds, ['adv-acme']);
  assert.deepEqual(scopeFilters(ALL, {}).advertiserIds, null);
});
