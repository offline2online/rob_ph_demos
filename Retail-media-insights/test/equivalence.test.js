'use strict';
// The rollup / per-store partition / precomputed-cell path must answer exactly what the straight scan of the fine cube does,
// for every endpoint. `indexed: false` keeps the straight scan: it is the reference implementation, built from its own copy of
// the same aggregates.
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer, rng, ADVERTISERS, DISPLAY_TYPES, DEAL_CATALOG, OPEN_AUCTION_DEAL } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { dispatch } = require('../src/dispatch');
const { DEAL_TYPES } = require('../src/constants');
const { loadRoutes } = require('../src/server');

const TODAY = '2026-10-11';
const { raw, ctx } = generateTestRetailer({ days: 370, stores: 5 });
const fast = new AggregateStore(buildAggregates(raw, ctx));
const scan = new AggregateStore(buildAggregates(raw, ctx), { indexed: false });
const routes = loadRoutes();

const principals = [
  { principalType: 'admin', principalId: 'retailer', scopes: ['insights:read'] },
  ...ADVERTISERS.map((id) => ({ principalType: 'advertiser', principalId: id, scopes: ['insights:read'] })),
];
const dayFrom = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - (n - 1) * 86400000).toISOString().slice(0, 10);
const RANGES = [7, 30, 90, 366];
// Each filter variant is a query string; the advertiser views need exactly one advertiser, so a retailer is given one.
const FILTERS = [
  '', 'storeIds=store-1', 'storeIds=store-3', 'storeIds=store-1,store-2', 'storeIds[]=store-4&storeIds[]=store-5&displayTypeIds=queue',
  ...Object.keys(DISPLAY_TYPES).map((t) => `displayTypeIds=${t}`),
  ...ADVERTISERS.map((a) => `advertiserIds=${a}`),
  ...DEAL_TYPES.map((t) => `dealType=${encodeURIComponent(t)}&dealTypes=${encodeURIComponent(t)}`),
  'dsps=DV360&storeIds=store-2', 'storeIds=nope',
];
const PATHS = routes.filter((r) => !r.public && r.path !== '/dataset').map((r) => r.path);
const DATASETS = ['revenue', 'deals', 'delivery', 'advertisers'];

const get = (store, principal, url) => dispatch({ store, routes, url: `/insights/v1/retail-media${url}`, principal, today: TODAY });

test('every endpoint answers the same through the rollup, partitions and cells as through the straight scan', () => {
  let compared = 0;
  for (const principal of principals) {
    for (const days of RANGES) {
      for (const filter of FILTERS) {
        const range = `dateFrom=${dayFrom(days)}&dateTo=${TODAY}`;
        // The 366-day range is the heavy one: spot-check it with a subset of the filters.
        if (days === 366 && !['', 'storeIds=store-1', 'displayTypeIds=queue', `advertiserIds=${ADVERTISERS[0]}`].includes(filter)) continue;
        const urls = PATHS.map((p) => `${p}?${range}${filter ? `&${filter}` : ''}`);
        // A retailer reaches the advertiser views by naming an advertiser: give it one when the filter does not.
        if (principal.principalType === 'admin' && !filter.startsWith('advertiserIds')) {
          for (const p of ['/delivery', '/deals-by-display-type', '/audience', '/my-targeting']) urls.push(`${p}?${range}${filter ? `&${filter}` : ''}&advertiserIds=${ADVERTISERS[0]}`);
        }
        if (days === 90) for (const d of DATASETS) urls.push(`/dataset?name=${d}&${range}${filter ? `&${filter}` : ''}&advertiserIds=${ADVERTISERS[1]}`);
        for (const url of urls) {
          const a = get(fast, principal, url); const b = get(scan, principal, url);
          assert.deepStrictEqual(a, b, `${principal.principalType}:${principal.principalId} ${url}`);
          compared += 1;
        }
      }
    }
  }
  assert.ok(compared > 3000, `compared ${compared} responses`);
});

test('the matrix reaches real data, not only empty answers', () => {
  const admin = principals[0];
  const rev = get(fast, admin, `/revenue?dateFrom=${dayFrom(90)}&dateTo=${TODAY}`).body;
  assert.ok(rev.rows.length > 50);
  const one = get(fast, admin, `/summary?dateFrom=${dayFrom(30)}&dateTo=${TODAY}&storeIds=store-1`).body;
  const all = get(fast, admin, `/summary?dateFrom=${dayFrom(30)}&dateTo=${TODAY}`).body;
  assert.ok(one.earnedRevenue > 0 && one.earnedRevenue < all.earnedRevenue);
  const del = get(fast, principals[1], `/delivery?dateFrom=${dayFrom(30)}&dateTo=${TODAY}`).body;
  assert.ok(del.days.some((d) => d.deals.some((b) => b.playsWon > 0)));
  
});

test('the rollup is smaller than the fine cube and the partitions hold every fine row once', () => {
  assert.ok(fast.deliveryRollup.length < fast.delivery.length);
  assert.ok(fast.inventoryRollup.length < fast.inventory.length);
  const parts = [...fast.deliveryByStore.values()].reduce((n, p) => n + p.length, 0);
  assert.equal(parts, fast.delivery.length);
  const totals = (rows, k) => rows.reduce((n, r) => n + r[k], 0);
  assert.equal(totals(fast.deliveryRollup, 'earnedSlots'), totals(fast.delivery, 'earnedSlots'));
  assert.equal(totals(fast.inventoryRollup, 'sold'), totals(fast.inventory, 'sold'));
});

// A busy open auction: six advertisers bid on every store with a different clearing price per row, so the highest CPM seen
// by a fine row differs from the CPM of the stores added together (advertiser Delivery's "highest winning CPM").
test('the aggregate winning CPM of a busy auction is the same through the rollup as through the straight scan', () => {
  const rand = rng(11);
  const advs = Array.from({ length: 6 }, (_, i) => `adv-x${i}`);
  const stores = ['s1', 's2', 's3', 's4'];
  const types = Object.keys(DISPLAY_TYPES);
  const delivery = []; const inventory = [];
  for (let d = 0; d < 40; d += 1) {
    const date = new Date(Date.parse(`${TODAY}T00:00:00Z`) - d * 86400000).toISOString().slice(0, 10);
    for (const storeId of stores) for (const displayTypeId of types) {
      for (const advertiserId of advs) {
        const views = 100 + Math.floor(rand() * 900);
        const revenue = (views / 1000) * (8 + rand() * 12);
        const settled = d >= 3;
        delivery.push({ date, displayTypeId, storeId, dealId: OPEN_AUCTION_DEAL, dealType: 'Open auction', dsp: 'DV360', advertiserId,
          revenue, earned: settled ? revenue : 0, estimated: settled ? 0 : revenue, views, earnedViews: settled ? views : 0, slots: 5, earnedSlots: settled ? 5 : 0 });
      }
      inventory.push({ date, storeId, displayTypeId, sold: 30, unsold: 10, offline: 1, outsideHours: 0, unsoldViews: 900, lostRevenue: 2 });
    }
  }
  const make = (opts) => new AggregateStore({
    delivery: delivery.map((r) => ({ ...r })), inventory: inventory.map((r) => ({ ...r })), advertisers: Object.fromEntries(advs.map((a) => [a, { name: a, dsp: 'DV360' }])),
    campaigns: advs.map((advertiserId, i) => ({ id: `c${i}`, advertiserId, start: '2026-08-01', end: null, displayTypeIds: types, variables: [], level: 'Default only', scheduled: false, schedules: 0, targetedVersions: 0 })),
    catalog: { displayTypes: DISPLAY_TYPES, deals: { ...DEAL_CATALOG }, sharedVariables: {}, stores: {}, displays: stores.flatMap((storeId) => types.map((displayTypeId) => ({ id: `${displayTypeId}-${storeId}`, displayTypeId, storeId, footfall: 3000, visibility: 0.4 }))) },
  }, opts);
  const a = make({}); const b = make({ indexed: false });
  const p = { principalType: 'advertiser', principalId: advs[0], scopes: ['insights:read'] };
  let withCpm = 0;
  for (const filter of ['', 'storeIds=s1', 'storeIds=s2,s3', 'displayTypeIds=queue', 'displayTypeIds=queue,window&storeIds=s4']) {
    const url = `/delivery?dateFrom=${dayFrom(30)}&dateTo=${TODAY}${filter ? `&${filter}` : ''}`;
    const x = get(a, p, url); const y = get(b, p, url);
    assert.deepStrictEqual(x, y, url);
    withCpm += x.body.days.filter((day) => day.deals.some((blk) => blk.winningCpm)).length;
  }
  assert.ok(withCpm > 100, `winning CPMs were exercised (${withCpm} days)`);
  for (const path of ['summary', 'yield', 'revenue', 'advertisers', 'deals', 'maturity']) {
    const url = `/${path}?dateFrom=${dayFrom(30)}&dateTo=${TODAY}`;
    assert.deepStrictEqual(get(a, principals[0], url), get(b, principals[0], url), url);
  }
});
