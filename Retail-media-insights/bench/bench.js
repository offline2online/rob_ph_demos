'use strict';
// 90-day query over ~865k pre-aggregated rows and a catalog of 250 Programmatic guaranteed deals. Times every
// endpoint handler (p50/p95) and fails if any p95 is 2000 ms or more.

const { performance } = require('perf_hooks');
const { AggregateStore } = require('../src/store');
const { rng, DISPLAY_TYPES, DEAL_CATALOG, ADVERTISERS, ADVERTISER_META } = require('../src/testdata');
const { DSPS } = require('../src/constants');
const { parseFilters } = require('../src/filters');

const DAYS = 90; const PER_DAY = 9360; const PG_DEALS = 250; const RUNS = 30; const LIMIT_MS = 2000;
const rand = rng(1);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const types = Object.keys(DISPLAY_TYPES);
const stores = Array.from({ length: 60 }, (_, i) => `store-${i + 1}`);

// Catalog: the four test deals plus enough Programmatic guaranteed deals that pacing would be slow if it scanned per deal.
const deals = { ...DEAL_CATALOG };
for (let i = 0; i < PG_DEALS - 1; i += 1) {
  const adv = ADVERTISERS[i % ADVERTISERS.length];
  const dsp = ADVERTISER_META[adv].dsp;
  deals[`pg${i}`] = {
    name: `PG deal ${i}`, description: 'Bench deal.', dealType: 'Programmatic guaranteed', phId: `PH-BENCH${i}`, cpm: 20,
    dealIds: { [dsp]: `PH-${String(i).padStart(10, 'B')}` },
    buyers: [{ advertiserId: adv, dsp }],
    slots: [{ displayTypeId: types[i % types.length], playlist: 'Loop', zone: 'Zone A', position: 1 + (i % 4), loopSlot: 1, playsPerWindow: 6 }],
    flight: { start: '2026-08-01', end: '2026-12-31' }, forecast: 200000, buffer: 0.1,
  };
}
const dealIds = Object.keys(deals);
const delivery = []; const inventory = [];
for (let d = 0; d < DAYS; d += 1) {
  const date = new Date(Date.parse('2026-10-11T00:00:00Z') - d * 86400000).toISOString().slice(0, 10);
  const settled = d >= 3;
  for (let i = 0; i < PER_DAY; i += 1) {
    const revenueUsd = rand() * 40;
    const dealId = pick(dealIds);
    const views = revenueUsd * 50;
    delivery.push({ date, displayTypeId: pick(types), storeId: pick(stores), dealId, dealType: deals[dealId].dealType,
      dsp: pick(DSPS), advertiserId: pick(ADVERTISERS), revenue: revenueUsd, earned: settled ? revenueUsd : 0, estimated: settled ? 0 : revenueUsd,
      views, earnedViews: settled ? views : 0, slots: 3, earnedSlots: settled ? 3 : 0 });
  }
  for (const storeId of stores) for (const displayTypeId of types) {
    inventory.push({ date, storeId, displayTypeId, sold: 40, unsold: 20, offline: 2, outsideHours: 0, unsoldViews: 2000, lostRevenue: 5 });
  }
}
const store = new AggregateStore({
  delivery, inventory, advertisers: ADVERTISER_META,
  campaigns: ADVERTISERS.map((advertiserId, i) => ({ id: `c${i}`, advertiserId, start: '2026-08-01', end: null, displayTypeIds: null, variables: [], level: 'Default only', scheduled: false, schedules: 0, targetedVersions: 0 })),
  catalog: {
    displayTypes: DISPLAY_TYPES, deals, sharedVariables: {},
    displays: stores.flatMap((storeId) => types.map((displayTypeId) => ({ id: `${displayTypeId}-${storeId}`, displayTypeId, storeId, footfall: 3000, visibility: 0.4 }))),
  },
});
console.log(`rows: ${delivery.length + inventory.length} (${delivery.length} delivery, ${inventory.length} inventory), ${DAYS} days, ${Object.values(deals).filter((d) => d.dealType === 'Programmatic guaranteed').length} PG deals`);

const admin = { principalType: 'admin', principalId: 'retailer', scopes: ['insights:read'] };
const ENDPOINTS = [
  ['summary', ''], ['revenue', 'granularity=week'], ['yield', ''], ['deals', ''], ['advertisers', ''], ['display-types', ''],
  ['slot-value', ''], ['slot-allocation', ''], ['missed-revenue', ''], ['maturity', ''],
  // Per advertiser (the advertiser view): pinned to one advertiser, as the server does for an advertiser login.
  ['delivery', 'advertiserIds=adv-blackmores'], ['deals-by-display-type', 'advertiserIds=adv-blackmores'],
  ['audience', 'advertiserIds=adv-blackmores'], ['my-targeting', 'advertiserIds=adv-blackmores'],
];

let worst = 0;
for (const [name, query] of ENDPOINTS) {
  if (process.env.BENCH_ONLY && process.env.BENCH_ONLY !== name) continue;
  const route = require(`../src/routes/${name}`);
  const params = new URLSearchParams(query);
  const filters = parseFilters(params, { today: '2026-10-11', defaultDays: DAYS });
  const t = [];
  for (let i = 0; i < RUNS; i += 1) {
    const s = performance.now();
    route.handler({ store, filters, params, principal: admin });
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  const p95 = t[Math.ceil(t.length * 0.95) - 1];
  worst = Math.max(worst, p95);
  console.log(`${name}: p50 ${t[RUNS >> 1].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
}
console.log(worst < LIMIT_MS ? `OK: every p95 < ${LIMIT_MS} ms (worst ${worst.toFixed(1)} ms)` : `FAIL: p95 ${worst.toFixed(1)} ms >= ${LIMIT_MS} ms`);
process.exit(worst < LIMIT_MS ? 0 : 1);
