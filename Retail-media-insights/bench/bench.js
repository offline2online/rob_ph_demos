'use strict';
// 90-day query over ~865k pre-aggregated rows. Reports p50/p95 per endpoint handler.

const { performance } = require('perf_hooks');
const { AggregateStore } = require('../src/store');
const { rng, DEALS, ADVERTISERS } = require('../src/testdata');
const { DSPS } = require('../src/constants');
const summary = require('../src/routes/summary');
const revenue = require('../src/routes/revenue');

const DAYS = 90; const PER_DAY = 9360;
const rand = rng(1);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const types = ['window', 'endcap', 'queue', 'dispensary'];
const stores = Array.from({ length: 60 }, (_, i) => `store-${i + 1}`);
const dealIds = Object.keys(DEALS);
const delivery = []; const inventory = [];
for (let d = 0; d < DAYS; d += 1) {
  const date = new Date(Date.parse('2026-10-11T00:00:00Z') - d * 86400000).toISOString().slice(0, 10);
  for (let i = 0; i < PER_DAY; i += 1) {
    const revenueUsd = rand() * 40;
    delivery.push({ date, displayTypeId: pick(types), storeId: pick(stores), dealId: pick(dealIds), dealType: DEALS[pick(dealIds)].dealType,
      dsp: pick(DSPS), advertiserId: pick(ADVERTISERS), revenue: revenueUsd, earned: revenueUsd, estimated: 0, views: revenueUsd * 50, slots: 3 });
  }
  for (const storeId of stores) for (const displayTypeId of types) {
    inventory.push({ date, storeId, displayTypeId, sold: 40, unsold: 20, offline: 2, outsideHours: 0, unsoldViews: 2000 });
  }
}
const store = new AggregateStore({ delivery, inventory });
const filters = { dateFrom: '2026-07-14', dateTo: '2026-10-11', storeIds: null, displayTypeIds: null, advertiserIds: null };
console.log(`rows: ${delivery.length + inventory.length} (${delivery.length} delivery, ${inventory.length} inventory), ${DAYS} days`);

let worst = 0;
for (const [name, route] of [['summary', summary], ['revenue', revenue]]) {
  const t = [];
  for (let i = 0; i < 30; i += 1) {
    const s = performance.now();
    route.handler({ store, filters, params: new URLSearchParams('granularity=week') });
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  const p95 = t[Math.ceil(t.length * 0.95) - 1];
  worst = Math.max(worst, p95);
  console.log(`${name}: p50 ${t[15].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
}
console.log(worst < 2000 ? `OK: p95 ${worst.toFixed(1)} ms < 2000 ms` : `FAIL: p95 ${worst.toFixed(1)} ms`);
process.exit(worst < 2000 ? 0 : 1);
