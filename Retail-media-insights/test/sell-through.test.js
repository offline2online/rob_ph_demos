'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { dispatch, BASE } = require('../src/dispatch');
const fs = require('fs');
const path = require('path');

const { raw, ctx } = generateTestRetailer();
const store = new AggregateStore(buildAggregates(raw, ctx));
const routes = fs.readdirSync(path.join(__dirname, '../src/routes')).map((f) => require(`../src/routes/${f}`)).filter((r) => r.path);
const ADMIN = { principalType: 'admin', principalId: 'hq', scopes: ['insights:read'] };
const get = (p) => dispatch({ store, routes, url: `${BASE}${p}`, principal: ADMIN, today: '2026-10-11' }).body;

test('sell-through varies by display type, store and day, so the amber signal appears', () => {
  const alloc = Object.fromEntries(get('/slot-allocation?dateFrom=2026-09-12&dateTo=2026-10-11').rows.map((r) => [r.id, r.advertiserSlotsSoldPercent]));
  assert.ok(alloc.queue >= 88 && alloc.queue <= 92 && alloc.queue >= 85, `queue ${alloc.queue}`);
  assert.ok(alloc.endcap >= 75 && alloc.endcap <= 85, `endcap ${alloc.endcap}`);
  assert.ok(alloc.window >= 65 && alloc.window <= 75, `window ${alloc.window}`);
  assert.ok(alloc.dispensary >= 55 && alloc.dispensary <= 62, `dispensary ${alloc.dispensary}`);
  const byStore = ['store-1', 'store-5'].map((s) => get(`/missed-revenue?dateFrom=2026-09-12&dateTo=2026-10-11&storeIds=${s}`).total.fillPercent);
  assert.ok(byStore[0] < byStore[1], `stores differ: ${byStore}`);
  const byDay = new Set(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((d) => get(`/missed-revenue?dateFrom=${d}&dateTo=${d}`).total.slotsSold));
  assert.ok(byDay.size > 1, 'days differ');
});
