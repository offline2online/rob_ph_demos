'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer, ADVERTISERS, OPEN_AUCTION_DEAL } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const { scopeFilters } = require('../src/scope');
const { MIN_OTHER_BUYERS_FOR_WINNING_CPM } = require('../src/constants');
const calc = require('../src/calc');
const { admin, advertiser } = require('./helpers');

const { raw, ctx } = generateTestRetailer({ days: 90 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const Q = 'dateFrom=2026-10-05&dateTo=2026-10-11';
const ENDPOINTS = ['delivery', 'deals-by-display-type', 'audience', 'my-targeting'];
const NAMES = Object.fromEntries(Object.entries(ctx.advertisers).map(([id, a]) => [id, a.name]));

async function get(path, { authenticate = admin, st = store } = {}) {
  const server = createServer({ store: st, today: '2026-10-11', authenticate });
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${BASE}${path}`);
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}
const as = (id, path, st) => get(path, { authenticate: advertiser(id), st });
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const cents = (n) => Math.round(n * 100) / 100;

/** What billing says for an advertiser (settled rows only), under the same scoping the server applies. */
function billing(id, q = {}) {
  const f = scopeFilters({ dateFrom: '2026-10-05', dateTo: '2026-10-11', storeIds: null, displayTypeIds: null, advertiserIds: [id], ...q }, { principalType: 'advertiser', principalId: id }, store);
  const rows = []; store.scanDelivery(f, (r) => rows.push({ ...r, revenue: r.earned, views: r.earnedViews, slots: r.earnedSlots }));
  return rows;
}

test('the four advertiser view routes are advertiser-callable; a retailer must name one advertiser', async () => {
  for (const e of ENDPOINTS) {
    assert.equal(require(`../src/routes/${e}`).advertiserAccess, true, e);
    assert.equal((await as('adv-unilever', `/${e}?${Q}`)).status, 200, e);
    assert.equal((await get(`/${e}?${Q}`)).status, 400, `${e} without an advertiser`);
    assert.equal((await get(`/${e}?${Q}&advertiserIds=adv-unilever,adv-haleon`)).status, 400, `${e} with two`);
    assert.equal((await get(`/${e}?${Q}&advertiserIds=adv-unilever`)).status, 200, e);
  }
});

test('an advertiser is pinned to its own data whatever advertiserIds or displayTypeIds say', async () => {
  for (const e of ENDPOINTS) {
    const base = (await as('adv-unilever', `/${e}?${Q}`)).body;
    for (const forged of ['&advertiserIds=adv-haleon', '&advertiserIds[]=adv-haleon&advertiserIds[]=adv-blackmores', '&displayTypeIds=window,endcap,queue,dispensary']) {
      assert.deepEqual((await as('adv-unilever', `/${e}?${Q}${forged}`)).body, base, `${e}${forged}`);
    }
  }
});

test('cross-advertiser leak: no other advertiser id or name anywhere in any response, nor downtime fields', async () => {
  const queries = ['', '&dealId=d3', '&dealId=open-auction', '&dealId=d1', '&storeIds=store-1,store-2', '&dateFrom=2026-08-01'];
  for (const me of ADVERTISERS) {
    for (const e of ENDPOINTS) {
      for (const extra of queries) {
        const { status, body } = await as(me, `/${e}?${Q}${extra}`);
        if (status !== 200) { assert.equal(status, 400, `${me} ${e}${extra}`); continue; } // dealId of a deal that is not this advertiser's
        const text = JSON.stringify(body).toLowerCase();
        for (const other of ADVERTISERS.filter((a) => a !== me)) {
          assert.ok(!text.includes(other.toLowerCase()), `${me} ${e}${extra} leaked id ${other}`);
          assert.ok(!text.includes(NAMES[other].toLowerCase()), `${me} ${e}${extra} leaked name ${NAMES[other]}`);
        }
        assert.ok(!/downtime|offline|lostrevenue|"buyers"|"advertiserid"/.test(text), `${me} ${e}${extra} has a forbidden field`);
      }
    }
  }
});

test('delivery: plays won and spend reconcile to billing, day by day and in total', async () => {
  for (const me of ADVERTISERS) {
    const { body } = await as(me, `/delivery?${Q}`);
    const rows = billing(me);
    assert.equal(body.days.length, 7);
    assert.equal(body.totals.playsWon, sum(rows.map((r) => r.slots)));
    assert.ok(Math.abs(body.totals.spend - sum(rows.map((r) => r.revenue))) < 0.005 * 7, me);
    // The total is rounded once, the days one by one, so they can differ by a cent per day.
    assert.ok(Math.abs(body.totals.spend - sum(body.days.map((d) => d.spend))) < 0.005 * 7 + 1e-9, me);
    for (const d of body.days) {
      assert.equal(d.playsWon, sum(rows.filter((r) => r.date === d.date).map((r) => r.slots)));
      assert.ok(Math.abs(d.spend - sum(rows.filter((r) => r.date === d.date).map((r) => r.revenue))) < 0.005 * rows.length + 1e-9, `${me} ${d.date}`); // per-deal amounts are rounded to the cent before adding
    }
    // The per-deal blocks add up to the day's plays (every own row is on a deal or the open auction).
    for (const d of body.days) assert.equal(sum(d.deals.map((b) => b.playsWon)), d.playsWon, `${me} ${d.date}`);
  }
});

test('delivery: day-on-day change, including the day before the range', async () => {
  const { body } = await as('adv-haleon', `/delivery?${Q}`);
  const rows = billing('adv-haleon', { dateFrom: '2026-10-04' });
  const plays = (date) => sum(rows.filter((r) => r.date === date).map((r) => r.slots));
  const [first, second] = body.days;
  assert.equal(first.vsPreviousDay.playsWon.change, first.playsWon - plays('2026-10-04'));
  assert.equal(second.vsPreviousDay.playsWon.change, second.playsWon - first.playsWon);
  assert.equal(second.vsPreviousDay.spend.change, cents(second.spend - first.spend));
  assert.equal(second.vsPreviousDay.playsWon.percent, Math.round(((second.playsWon - first.playsWon) / first.playsWon) * 100) + 0); // + 0: JSON has no -0
});

test('delivery: the Deal filter narrows the lines and the blocks; an unknown or foreign deal is 400', async () => {
  const all = (await as('adv-perrigo', `/delivery?${Q}`)).body;
  const one = (await as('adv-perrigo', `/delivery?${Q}&dealId=d6`)).body;
  assert.ok(one.totals.playsWon > 0 && one.totals.playsWon < all.totals.playsWon);
  assert.equal(one.totals.playsWon, sum(billing('adv-perrigo').filter((r) => r.dealId === 'd6').map((r) => r.slots)));
  assert.ok(one.days.every((d) => d.deals.length === 1 && d.deals[0].dealId === 'd6'));
  assert.deepEqual(one.pacing, []);
  const open = (await as('adv-unilever', `/delivery?${Q}&dealId=open-auction`)).body;
  assert.ok(open.days.every((d) => d.deals.length === 1 && d.deals[0].dealType === 'Open auction'));
  assert.equal((await as('adv-unilever', `/delivery?${Q}&dealId=nope`)).status, 400);
  // Unilever is on no named deal and has delivery only in the open auction here, so another buyer's deal is unknown to it.
  const st = fixture([{ adv: 'adv-unilever', cpm: 20 }]);
  assert.equal((await as('adv-unilever', '/delivery?dateFrom=2026-10-10&dateTo=2026-10-10&dealId=d1', st)).status, 400);
  assert.equal((await as('adv-unilever', '/delivery?dateFrom=2026-10-10&dateTo=2026-10-10&dealId=d6', st)).status, 400);
  const direct = fixture([{ adv: 'adv-perrigo', cpm: 20 }]);
  assert.equal((await as('adv-perrigo', '/delivery?dateFrom=2026-10-10&dateTo=2026-10-10&dealId=d1', direct)).status, 400);
  assert.equal((await as('adv-perrigo', '/delivery?dateFrom=2026-10-10&dateTo=2026-10-10&dealId=d6', direct)).status, 200);
});

test('delivery: auction blocks show plays won of all plays, share, own CPM and the floor; fixed-price and direct deals have no auction', async () => {
  const { body } = await as('adv-unilever', `/delivery?${Q}`);
  for (const d of body.days) for (const b of d.deals) {
    assert.equal(b.dealType, 'Open auction', 'Unilever buys only through the open auction');
    if (!('allPlays' in b)) { assert.ok(!('sharePercent' in b), 'share needs allPlays'); } else assert.ok(b.playsWon <= b.allPlays, b.dealId);
    if (b.allPlays > 0) assert.equal(b.sharePercent, calc.wholePercent(b.playsWon, b.allPlays));
    assert.equal('yourCpm' in b, b.playsWon > 0);
    assert.ok(b.floorCpm.min <= b.floorCpm.max);
  }
  const oa = body.days[0].deals.find((b) => b.dealType === 'Open auction');
  assert.deepEqual(oa.floorCpm, { min: 5.5, max: 7.5 }, 'range of the floors of the display types its campaigns run on');
  // A direct advertiser's deals are fixed price: the agreed CPM, no other buyers, no auction figures, and no open auction block.
  const direct = (await as('adv-procter-gamble', `/delivery?${Q}`)).body;
  for (const d of direct.days) for (const b of d.deals) {
    assert.equal(b.dealType, 'Direct advertiser');
    assert.equal(b.otherBuyers, 'None');
    assert.ok(b.fixedCpm > 0 && !('allPlays' in b) && !('winningCpm' in b) && !('floorCpm' in b));
  }
});

test('delivery: open auction in the test data never clears below its floor; a source that does is passed through unchanged', async () => {
  const { body } = await as('adv-blackmores', `/delivery?${Q}`);
  let seen = 0;
  for (const d of body.days) for (const b of d.deals.filter((x) => x.dealType === 'Open auction')) {
    if (b.yourCpm != null) { seen += 1; assert.ok(b.yourCpm >= b.floorCpm.min, `${d.date} ${b.dealId}`); }
    if (b.winningCpm) assert.ok(b.winningCpm.p25 >= b.floorCpm.min && b.winningCpm.median >= b.winningCpm.p25 && b.winningCpm.p75 >= b.winningCpm.median);
  }
  assert.ok(seen > 0);
  const st = fixture([{ adv: 'adv-unilever', cpm: 5 }, { adv: 'adv-haleon', cpm: 6 }, { adv: 'adv-blackmores', cpm: 7 }]);
  const low = (await as('adv-unilever', `/delivery?dateFrom=2026-10-10&dateTo=2026-10-10`, st)).body.days[0].deals.find((b) => b.dealId === 'open-auction');
  assert.equal(low.yourCpm, 5, 'the source cleared below the floor; not clamped');
  assert.ok(low.yourCpm < low.floorCpm.min);
});

/** One day, one display type (window, floor $7.50), one open auction, the given winners at the given CPMs, 10 plays x 200 views each. */
function fixture(winners, { dealId = OPEN_AUCTION_DEAL } = {}) {
  const billingRows = winners.map((w) => ({
    date: '2026-10-10', storeId: 'store-1', displayTypeId: 'window', dealId, dsp: 'DV360', advertiserId: w.adv,
    revenue: calc.revenueAtCpm(w.cpm, 2000), views: 2000, slots: 10, settled: true,
  }));
  const f = generateTestRetailer({ days: 1 });
  const campaigns = [{ id: 'cx', advertiserId: 'adv-unilever', start: '2026-09-01', end: null, displayTypeIds: ['window'], variables: [], scheduled: false }];
  return new AggregateStore(buildAggregates({ billing: billingRows, slotRecords: [], campaigns }, f.ctx));
}

test('winning CPM: shown only when at least MIN_OTHER_BUYERS_FOR_WINNING_CPM other buyers won; never per buyer', async () => {
  assert.equal(MIN_OTHER_BUYERS_FOR_WINNING_CPM, 2);
  const day = async (winners) => (await as('adv-unilever', '/delivery?dateFrom=2026-10-10&dateTo=2026-10-10', fixture(winners))).body.days[0].deals.find((b) => b.dealId === 'open-auction');
  const alone = await day([{ adv: 'adv-unilever', cpm: 20 }]);
  assert.ok(!('winningCpm' in alone));
  const one = await day([{ adv: 'adv-unilever', cpm: 20 }, { adv: 'adv-haleon', cpm: 30 }]);
  assert.ok(!('winningCpm' in one), 'one other buyer would reveal that buyer\'s CPM');
  assert.equal(one.playsWon, 10);
  assert.ok(!('allPlays' in one) && !('sharePercent' in one), 'all plays minus own plays would be that buyer\'s plays');
  const two = await day([{ adv: 'adv-unilever', cpm: 20 }, { adv: 'adv-haleon', cpm: 30 }, { adv: 'adv-blackmores', cpm: 40 }]);
  assert.deepEqual(two.winningCpm, { p25: 25, median: 30, p75: 35 });
  assert.equal(two.allPlays, 30); assert.equal(two.yourCpm, 20);
  const onlyOthers = await day([{ adv: 'adv-haleon', cpm: 30 }, { adv: 'adv-blackmores', cpm: 40 }]);
  assert.equal(onlyOthers.playsWon, 0); assert.ok(!('yourCpm' in onlyOthers));
  assert.deepEqual(onlyOthers.winningCpm, { p25: 32.5, median: 35, p75: 37.5 });
  assert.ok(!JSON.stringify(two).match(/haleon|blackmores/i));
  const bare = Object.keys(two).sort();
  assert.deepEqual(bare, ['allPlays', 'dealId', 'dealType', 'floorCpm', 'name', 'playsWon', 'sharePercent', 'winningCpm', 'yourCpm']);
});

test('delivery: PG pacing is the advertiser\'s own guarantee against its own delivered VAC-d, cumulative from the flight start', async () => {
  const { body } = await as('adv-blackmores', `/delivery?${Q}`);
  assert.deepEqual(body.pacing.map((p) => p.dealId), ['d1']);
  const p = body.pacing[0];
  assert.equal(p.series.length, 7);
  // Delivered is settled VAC-d only, over the whole deal: the store and display type page filters do not change it.
  const own = []; store.scanDelivery({ dateFrom: '2026-09-15', dateTo: '2026-10-11', storeIds: null, displayTypeIds: null, advertiserIds: ['adv-blackmores'] }, (r) => { if (r.dealId === 'd1') own.push(r); });
  const last = p.series[6];
  assert.equal(last.date, '2026-10-11');
  assert.equal(last.delivered, Math.round(sum(own.map((r) => r.earnedViews))));
  assert.equal(last.guaranteed, Math.round(ctx.dealCatalog.d1.forecast * 0.9 * 27 / 62));
  const narrowed = (await as('adv-blackmores', `/delivery?${Q}&storeIds=store-1&displayTypeIds=window`)).body.pacing[0];
  assert.deepEqual(narrowed.series, p.series, 'pacing ignores the store and display type filters');
  assert.ok(p.series.every((s, i) => i === 0 || (s.delivered >= p.series[i - 1].delivered && s.guaranteed > p.series[i - 1].guaranteed)));
  assert.deepEqual((await as('adv-procter-gamble', `/delivery?${Q}&dealId=d8`)).body.pacing, [], 'no pacing for other deal types');
});

test('deals-by-display-type: groups in shopper-journey order, rows reconcile to billing, shares add up', async () => {
  for (const me of ADVERTISERS) {
    const { body } = await as(me, `/deals-by-display-type?${Q}`);
    const rows = billing(me).filter((r) => r.dealType !== 'Open auction');
    assert.ok(body.groups.length > 0, me);
    if (!rows.length) continue; // an open-auction-only advertiser has no deal rows: the open auction is kept out of the totals
    assert.equal(body.totals.playsWon, sum(rows.map((r) => r.slots)));
    assert.ok(Math.abs(body.totals.spend - sum(rows.map((r) => r.revenue))) < 0.01 * body.groups.reduce((n, g) => n + g.deals.length, 0));
    assert.equal(body.totals.spend, cents(sum(body.groups.map((g) => g.spend))));
    assert.equal(sum(body.groups.map((g) => g.sharePercent)), 100);
    const zones = body.groups.map((g) => ['Exterior', 'Entrance & out of category', 'In aisles', 'Checkout', 'Other & connected store'].indexOf(g.displayType.iabZone));
    assert.deepEqual(zones, [...zones].sort((a, b) => a - b));
    for (const g of body.groups) {
      // The Open auction row (last, one per display type the advertiser runs on) is kept out of the group's own totals.
      const dealRows = g.deals.filter((d) => d.dealType !== 'Open auction');
      assert.equal(g.spend, cents(sum(dealRows.map((d) => d.spend))));
      assert.equal(g.playsWon, sum(dealRows.map((d) => d.playsWon)));
      assert.equal(g.assumedViews, sum(dealRows.map((d) => d.assumedViews)));
      assert.equal(g.dealCount, dealRows.length);
      assert.ok(g.deals.filter((d) => d.dealType === 'Open auction').length <= 1);
      for (const d of dealRows) {
        if ('allPlays' in d.share) assert.ok(d.share.playsWon <= d.share.allPlays); else assert.ok(!('percent' in d.share));
        if (d.share.allPlays > 0) assert.equal(d.share.percent, calc.wholePercent(d.share.playsWon, d.share.allPlays));
        assert.ok(d.share.advertisersOnDeal >= 1);
        for (const id of d.dealIds) assert.equal(id.dsp, ctx.advertisers[me].dsp, 'only the advertiser\'s own DSP deal ID');
        if (d.assumedViews > 0) assert.ok(Math.abs(d.effectiveCpm - calc.effectiveCpm(d.spend, d.assumedViews)) < 0.01 + 5 / d.assumedViews, 'within the rounding of spend (cents) and views');
      }
    }
  }
});

test('deals-by-display-type: a deal\'s share is the advertiser\'s plays of all plays on that deal and display type', async () => {
  const { body } = await as('adv-unilever', `/deals-by-display-type?${Q}`);
  const all = []; store.scanDelivery({ dateFrom: '2026-10-05', dateTo: '2026-10-11', storeIds: null, displayTypeIds: null, advertiserIds: null }, (r) => all.push({ ...r, slots: r.earnedSlots }));
  for (const g of body.groups) for (const d of g.deals.filter((x) => x.dealType !== 'Open auction')) {
    if (!('allPlays' in d.share)) continue; // omitted when exactly one other buyer won there
    assert.equal(d.share.allPlays, sum(all.filter((r) => r.dealId === d.id && r.displayTypeId === g.displayType.id).map((r) => r.slots)), `${d.id} ${g.displayType.id}`);
  }
  assert.ok(!JSON.stringify(body).match(/acme|blackmores/i));
});

test('audience: assumed views and the daily trend add up to billing', async () => {
  for (const me of ADVERTISERS) {
    const { body } = await as(me, `/audience?${Q}`);
    const rows = billing(me);
    assert.equal(body.trend.length, 7);
    assert.equal(body.assumedViews, sum(body.trend.map((t) => t.assumedViews)));
    assert.ok(Math.abs(body.assumedViews - sum(rows.map((r) => r.views))) <= 3.5);
  }
});

test('my-targeting: level, variables used (never Daypart), scheduling and the shared variables still unused', async () => {
  const b = (await as('adv-blackmores', `/my-targeting?${Q}`)).body;
  assert.equal(b.level, 'Personalised');
  assert.deepEqual(b.variablesUsed.map((v) => v.label), ['Display Tag(s)', 'Fixed Store Segments', 'Gender (Computer Vision)', 'Reason for Visit (Aggregate)', 'Variable Store Segments']);
  assert.deepEqual(b.variablesUsed.slice(2, 4).map((v) => v.personalisationType), ['Computer Vision', 'Aggregate']);
  assert.ok(!JSON.stringify(b).includes('Daypart'));
  assert.deepEqual(b.scheduling, { uses: true, scheduledCampaigns: 2, campaigns: 3, schedules: 3 });
  const labels = [...b.otherVariablesAvailable.Localised, ...b.otherVariablesAvailable.Personalised].map((v) => v.label);
  assert.ok(!labels.includes('Fixed Store Segments') && !labels.includes('Gender (Computer Vision)'));
  assert.ok(labels.includes('Suburb') && labels.includes('Purchase Intent'));
  assert.ok(!labels.includes('Postcode') && !labels.includes('Age'), 'not shared with the DSP, so not available');
  assert.ok(b.otherVariablesAvailable.Localised.every((v) => v.kind === 'Localised') && b.otherVariablesAvailable.Personalised.every((v) => v.kind === 'Personalised'));
  assert.equal(b.usesEverySharedVariable, false);
  const n = (await as('adv-unilever', `/my-targeting?${Q}`)).body;
  assert.equal(n.level, 'Default only'); assert.deepEqual(n.variablesUsed, []);
  assert.deepEqual(n.scheduling, { uses: false, scheduledCampaigns: 0, campaigns: 3, schedules: 0 });
});

test('my-targeting: no campaigns omits the level; a DSP with nothing configured defaults to Localisation only; using everything says so', async () => {
  const f = generateTestRetailer({ days: 1 });
  const mk = (campaigns, sharedVariables) => new AggregateStore(buildAggregates({ billing: [], slotRecords: [], campaigns }, { ...f.ctx, sharedVariables }));
  const empty = (await as('adv-unilever', '/my-targeting?dateFrom=2026-10-10&dateTo=2026-10-10', mk([], {}))).body;
  assert.ok(!('level' in empty));
  assert.deepEqual(empty.otherVariablesAvailable.Personalised, []);
  assert.equal(empty.otherVariablesAvailable.Localised.length, 8);
  const all = mk([{ id: 'c', advertiserId: 'adv-unilever', start: '2026-09-01', end: null, variables: ['Suburb', 'Purchase Intent'], scheduled: false }], { 'Amazon DSP': ['Suburb', 'Purchase Intent'] });
  const done = (await as('adv-unilever', '/my-targeting?dateFrom=2026-10-10&dateTo=2026-10-10', all)).body;
  assert.equal(done.usesEverySharedVariable, true);
  assert.deepEqual(done.otherVariablesAvailable, { Localised: [], Personalised: [] });
});

test('deals-by-display-type: winning CPM range on auction rows only, an Open auction row per display type, floors respected', async () => {
  let ranges = 0; let openRows = 0;
  for (const me of ADVERTISERS) {
    const { body } = await as(me, `/deals-by-display-type?${Q}`);
    for (const g of body.groups) {
      const open = g.deals.filter((d) => d.id === 'open-auction');
      assert.ok(open.length <= 1); openRows += open.length;
      if (open.length) assert.equal(g.deals[g.deals.length - 1], open[0], 'Open auction is listed last');
      const floor = g.displayType.floorCpm;
      for (const d of g.deals) {
        if (d.dealType === 'Programmatic guaranteed' || d.dealType === 'Preferred deal') { assert.ok(!('winningCpm' in d), `${me} ${d.id}: fixed CPM only`); continue; }
        if (!d.winningCpm) continue;
        ranges += 1;
        assert.ok(d.winningCpm.p25 <= d.winningCpm.median && d.winningCpm.median <= d.winningCpm.p75);
        if (d.id === 'open-auction' && floor != null) assert.ok(d.winningCpm.p25 >= floor, `${me} ${g.displayType.id}: open auction range at or above the floor`);
        assert.deepEqual(Object.keys(d.winningCpm).sort(), ['median', 'p25', 'p75'], 'aggregates only');
      }
    }
  }
  assert.ok(openRows > 0 && ranges > 0);
});

test('deals-by-display-type: the range needs at least MIN_OTHER_BUYERS_FOR_WINNING_CPM other winners, on the open auction row too', async () => {
  const day = async (winners) => (await as('adv-unilever', '/deals-by-display-type?dateFrom=2026-10-10&dateTo=2026-10-10', fixture(winners))).body.groups[0].deals.find((d) => d.id === 'open-auction');
  assert.ok(!('winningCpm' in await day([{ adv: 'adv-unilever', cpm: 20 }, { adv: 'adv-haleon', cpm: 30 }])));
  const row = await day([{ adv: 'adv-unilever', cpm: 20 }, { adv: 'adv-haleon', cpm: 30 }, { adv: 'adv-blackmores', cpm: 40 }]);
  assert.deepEqual(row.winningCpm, { p25: 25, median: 30, p75: 35 });
  assert.ok(!JSON.stringify(row).match(/haleon|blackmores/i));
});
