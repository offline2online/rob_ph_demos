'use strict';
// 90-day query over ~865k pre-aggregated rows and a catalog of 250 Programmatic guaranteed deals. Times every
// endpoint handler (p50/p95) with no response cache and fails if any p95 is 250 ms or more (an event-loop turn: a handler
// is synchronous, so its p95 is how long /health can wait behind it). BENCH_ONLY=<route> times one endpoint.

const { performance } = require('perf_hooks');
const { parseFilters } = require('../src/filters');
const { buildBenchStore, TODAY, DAYS } = require('./dataset');

const RUNS = 30; const LIMIT_MS = 250;
const { store } = buildBenchStore();

const admin = { principalType: 'admin', principalId: 'retailer', scopes: ['insights:read'] };
const ENDPOINTS = [
  ['summary', ''], ['revenue', 'granularity=week'], ['deals', ''], ['advertisers', ''], ['display-types', ''],
  ['slot-value', ''], ['slot-allocation', ''], ['missed-revenue', ''], ['maturity', ''],
  // Per advertiser (the advertiser view): pinned to one advertiser, as the server does for an advertiser login.
  ['delivery', 'advertiserIds=adv-blackmores'], ['deals-by-display-type', 'advertiserIds=adv-blackmores'],
  ['audience', 'advertiserIds=adv-blackmores'], ['my-targeting', 'advertiserIds=adv-blackmores'], ['my-summary', 'advertiserIds=adv-blackmores'], ['revenue', 'granularity=month&aheadDays=81'],
];

let worst = 0;
for (const [name, query] of ENDPOINTS) {
  if (process.env.BENCH_ONLY && process.env.BENCH_ONLY !== name) continue;
  const route = require(`../src/routes/${name}`);
  const params = new URLSearchParams(query);
  const filters = parseFilters(params, { today: TODAY, defaultDays: DAYS });
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
