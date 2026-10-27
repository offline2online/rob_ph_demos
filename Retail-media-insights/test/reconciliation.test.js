'use strict';
// "Every figure reconciles" (REQUIREMENTS.md section 8): loads the test retailer and checks that the endpoints
// agree with each other and with the raw billing, under the default filters and under every single store,
// display type and advertiser filter. Also pins the README sample-data rules the test retailer must obey.
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer, ADVERTISERS } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { parseFilters } = require('../src/filters');
const calc = require('../src/calc');

const { raw, ctx } = generateTestRetailer({ days: 90 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const admin = { principalType: 'admin', principalId: 'retailer', scopes: ['insights:read'] };
const TODAY = '2026-10-11';
const LAST_SETTLED = '2026-10-08'; // settledThroughDaysAgo is 3
const run = (name, q = '', today = TODAY) => {
  const route = require(`../src/routes/${name}`);
  const params = new URLSearchParams(q);
  return route.handler({ store, filters: parseFilters(params, { today }), params, principal: admin });
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

const SCENARIOS = [
  ['default filters', ''],
  ...Array.from({ length: 5 }, (_, i) => [`store-${i + 1}`, `storeIds=store-${i + 1}`]),
  ...Object.keys(ctx.displayTypes).map((t) => [`display type ${t}`, `displayTypeIds=${t}`]),
  ...ADVERTISERS.map((a) => [`advertiser ${a}`, `advertiserIds=${a}`]),
];

for (const [label, q] of SCENARIOS) {
  test(`reconciles under ${label}: earned revenue everywhere, shares, fill, caps`, () => {
    const summary = run('summary', q);
    const revenue = run('revenue', q);
    const advertisers = run('advertisers', q);
    const deals = run('deals', q);
    let openEarned = 0;
    store.scanDelivery(parseFilters(new URLSearchParams(q), { today: TODAY }), (r) => { if (r.dealType === 'Open auction') openEarned += r.earned; });

    assert.ok(summary.earnedRevenue > 0, 'there is revenue to reconcile');
    near(sum(revenue.rows.map((r) => r.earned)), summary.earnedRevenue, 0.01 * revenue.rows.length, 'revenue chart earned');
    near(sum(advertisers.all.map((a) => a.revenue)), summary.earnedRevenue, 0.01 * advertisers.all.length, 'advertisers revenue');
    near(sum(deals.rows.map((d) => d.revenue)) + openEarned, summary.earnedRevenue, 0.01 * (deals.rows.length + 1), 'deals revenue + open auction');
    assert.equal(sum(advertisers.all.map((a) => a.share)), 100);

    const missed = run('missed-revenue', q);
    assert.equal(missed.total.fillPercent, summary.inventorySold.percent, 'missed-revenue fill = inventory sold %');
    assert.equal(missed.total.slotsTotal, summary.inventorySold.slotsSold + summary.inventorySold.slotsAvailable + summary.inventorySold.slotsOffline);
    const alloc = run('slot-allocation', q);
    for (const r of alloc.rows) assert.equal(r.advertiserSlotsSoldPercent, missed.rows.find((m) => m.id === r.id).fillPercent, `slot allocation = missed fill for ${r.id}`);

    // No fill or Slots won above 100, checked on the counts before any rounding (and no cap hiding it).
    for (const d of deals.rows) {
      assert.ok(d.fill.slotsWon <= d.fill.slotsAvailable, `${d.name}: ${d.fill.slotsWon} won of ${d.fill.slotsAvailable}`);
      if (d.fill.slotsAvailable === 0) assert.equal(d.fill.percent, null);
    }
    for (const a of advertisers.all) {
      assert.ok(a.slotsWonCount <= a.slotsOpportunity, `${a.name}: ${a.slotsWonCount} won of ${a.slotsOpportunity}`);
      if (a.slotsOpportunity === 0) assert.equal(a.slotsWonPercent, null);
    }
  });
}

test('the advertiser view spend for X is the advertisers revenue for X (settled range, every filter)', () => {
  for (const [label, q] of SCENARIOS) {
    if (q.startsWith('advertiserIds')) continue;
    for (const x of ADVERTISERS) {
      const query = `${q}${q ? '&' : ''}advertiserIds=${x}&dateTo=${LAST_SETTLED}`;
      const spend = run('delivery', query).totals.spend;
      const mine = run('advertisers', query).all.find((a) => a.advertiserId === x);
      near(spend, mine ? mine.revenue : 0, 0.01 * 31, `${x} under ${label}`);
    }
  }
});

test('no clearing price is below its floor (every billing row)', () => {
  let auctions = 0;
  for (const b of raw.billing) {
    const deal = ctx.dealCatalog[b.dealId];
    if (deal.dealType !== 'Open auction' && deal.dealType !== 'Private auction') continue;
    if (b.views === 0) continue; // a play too small to carry a whole view bills nothing
    const floor = deal.dealType === 'Open auction' ? ctx.displayTypes[b.displayTypeId].floorCpm : deal.floorCpm;
    assert.ok(calc.effectiveCpm(b.revenue, b.views) >= floor, `${b.dealId} ${b.displayTypeId} ${b.date}: ${calc.effectiveCpm(b.revenue, b.views)} < ${floor}`);
    auctions += 1;
  }
  assert.ok(auctions > 100);
});

test('slot value: per slot per day = effective CPM x average views per slot per day / 1,000 x sold share, on every display type', () => {
  for (const q of ['', 'storeIds=store-2', 'dateFrom=2026-10-01&dateTo=2026-10-08']) {
    const { rows } = run('slot-value', q);
    assert.equal(rows.length, 4);
    for (const r of rows) {
      assert.ok(r.advertiserSlotsSoldShare > 0 && r.advertiserSlotsSoldShare <= 1, `${r.name} share ${r.advertiserSlotsSoldShare}`);
      near(r.perSlotPerDay, (r.effectiveCpm * r.averageAssumedViewsPerSlotPerDay) / 1000 * r.advertiserSlotsSoldShare, 0.01, `${r.name} ${q}`);
    }
  }
});

// ---- the README sample-data rules the test retailer must obey ---------------------------------------------

test('inventory scales with the estate: displays x advertiser slots x loops per hour, per operating hour', () => {
  const oneDay = 'dateFrom=2026-10-09&dateTo=2026-10-09';
  const { rows } = run('missed-revenue', oneDay);
  for (const [id, type] of Object.entries(ctx.displayTypes)) {
    const { advertiser, ownContent } = type.slots;
    const loops = 3600 / (advertiser.count * advertiser.avgSeconds + ownContent.count * ownContent.avgSeconds);
    const hours = type.is24Hour ? 24 : 12;
    assert.equal(rows.find((r) => r.id === id).slotsTotal, 5 * type.displaysPerStore * advertiser.count * loops * hours, id);
  }
  const totals = rows.map((r) => r.slotsTotal);
  assert.equal(new Set(totals).size, totals.length, 'no two display types share a count just because they share a template');
});

test('realised VAC-d agrees with the inputs: one sold slot-day delivers the average assumed views per slot per day', () => {
  for (const r of raw.slotRecords) {
    const type = ctx.displayTypes[r.displayTypeId];
    const display = ctx.displays.find((d) => d.storeId === r.storeId && d.displayTypeId === r.displayTypeId);
    const { advertiser, ownContent } = type.slots;
    const loopSeconds = advertiser.count * advertiser.avgSeconds + ownContent.count * ownContent.avgSeconds;
    const window = calc.operatingWindow(type, ctx.stores[r.storeId]);
    const perDay = r.views * (3600 / loopSeconds) * (window.close - window.open);
    near(perDay, calc.assumedViewsPerSlotPerDay(display.footfall, display.visibility, advertiser.avgSeconds, loopSeconds), 1e-6, `${r.displayTypeId} ${r.storeId}`);
  }
  // Window Portrait over 30 days can never exceed displays x slots x views x days (480,000 with the default 5 stores).
  const w = run('slot-value', 'displayTypeIds=window').rows[0];
  assert.ok(w.totals.assumedViews <= w.averageAssumedViewsPerSlotPerDay * w.totals.advertiserSlots * w.totals.days * 1.0001);
});

test('billing follows the buyers lists: own DSP seat, own display types, one buyer on PG and Preferred', () => {
  for (const deal of Object.values(ctx.dealCatalog)) {
    if (deal.dealType === 'Programmatic guaranteed' || deal.dealType === 'Preferred deal') assert.equal(deal.buyers.length, 1, deal.name);
  }
  for (const b of raw.billing) {
    const deal = ctx.dealCatalog[b.dealId];
    if (deal.dealType === 'Open auction') { assert.equal(b.dsp, ctx.advertisers[b.advertiserId].dsp); continue; }
    const buyer = deal.buyers.find((x) => x.advertiserId === b.advertiserId);
    assert.ok(buyer, `${b.advertiserId} is not a buyer on ${deal.name}`);
    assert.equal(b.dsp, buyer.dsp, `${deal.name} billed through the wrong DSP seat`);
    assert.ok(deal.slots.some((s) => s.displayTypeId === b.displayTypeId), `${deal.name} billed on ${b.displayTypeId}`);
  }
});

test('deal IDs: PH- plus 10 upper-case alphanumerics, one per DSP with an invited buyer, from the catalog map', () => {
  const labels = { DV360: 'Google DSP (DV360)', 'The Trade Desk': 'The Trade Desk', 'Amazon DSP': 'Amazon Ads DSP' };
  for (const row of run('deals').rows) {
    const deal = ctx.dealCatalog[row.id];
    assert.deepEqual(row.dealIds.map((x) => x.dsp), [...new Set(deal.buyers.map((b) => b.dsp))].filter((d) => d !== 'Direct').sort(calc.compareDsps));
    for (const x of row.dealIds) {
      assert.match(x.dealId, /^PH-[A-Z0-9]{10}$/);
      assert.equal(x.dealId, deal.dealIds[x.dsp]);
      assert.equal(x.dspLabel, labels[x.dsp]);
    }
  }
});

test('operating hours default from the zone; a store with no hours fails closed', () => {
  const store8to20 = { open: 8, close: 20 };
  assert.deepEqual(calc.operatingWindow({ zone: 'Exterior' }, store8to20), { open: 0, close: 24 }, 'Exterior with no flag runs 24 hours');
  assert.deepEqual(calc.operatingWindow({ zone: 'Exterior', is24Hour: false }, store8to20), store8to20, 'an explicit flag overrides the zone default');
  assert.deepEqual(calc.operatingWindow({ zone: 'Entrance & out of category', is24Hour: true }, store8to20), { open: 0, close: 24 }, 'window screens stay 24 hours');
  assert.deepEqual(calc.operatingWindow({ zone: 'Checkout' }, store8to20), store8to20);
  const none = calc.operatingWindow({ zone: 'Checkout' }, undefined);
  for (let h = 0; h < 24; h += 1) assert.equal(calc.insideOperatingHours(h, none), false, `hour ${h}`);
  assert.deepEqual(calc.operatingWindow({ zone: 'Exterior' }, undefined), { open: 0, close: 24 });
  // A store with no opening hours on record adds no inventory (and so no unsold or missed revenue) for in-store types.
  const closed = buildAggregates(raw, { ...ctx, stores: { ...ctx.stores, 'store-1': undefined } });
  const inv = new AggregateStore(closed);
  const f = parseFilters(new URLSearchParams('storeIds=store-1'), { today: TODAY });
  let unsold = 0; let window = 0;
  inv.scanInventory(f, (r) => { if (r.displayTypeId === 'window') window += r.sold + r.unsold; else unsold += r.sold + r.unsold + r.offline; });
  assert.equal(unsold, 0);
  assert.ok(window > 0, 'a 24-hour type does not depend on store hours');
});

test('hover operating hours follow the same default', () => {
  const { hoverCard } = require('../src/display-types');
  const card = (def) => hoverCard({ id: 'x', def: { name: 'X', ...def }, displays: [], storeCount: 0 }).operatingHours;
  assert.equal(card({ zone: 'Exterior' }), '24 hours');
  assert.equal(card({ zone: 'Checkout' }), 'Store opening hours');
  assert.equal(card({ zone: 'Entrance & out of category', is24Hour: true }), '24 hours');
});

test('deals: the display type filter applies to every part of a row, and a deal with none of those types drops out', () => {
  const all = run('deals').rows;
  const queue = run('deals', 'displayTypeIds=queue').rows;
  assert.deepEqual(queue.map((d) => d.name).sort(), ['Queue screens', 'Sensodyne always-on']);
  for (const d of queue) {
    assert.ok(d.slots.length > 0 && d.slots.every((s) => s.displayTypeId === 'queue'));
    const full = all.find((x) => x.id === d.id);
    assert.ok(d.fill.slotsAvailable <= full.fill.slotsAvailable, `${d.name} fill covers only the filtered type`);
  }
  const noOpp = run('deals', 'displayTypeIds=queue&dateFrom=2000-01-01&dateTo=2000-01-02').rows;
  for (const d of noOpp) assert.equal(d.fill.percent, null);
});

test('advertisers: Slots covered counts only covered slots on the filtered types; Slots won only own wins on those deals', () => {
  const covered = (id, q = '') => run('advertisers', q).all.find((a) => a.advertiserId === id);
  const full = covered('adv-perrigo');
  const window = covered('adv-perrigo', 'displayTypeIds=window');
  assert.equal(full.slotsCovered, 8); // Window 3-5 (Health & wellness windows), Dispensary 2-5 (Dispensary screens, Perrigo — pharmacy takeover), Queue 2 (Queue screens)
  assert.equal(window.slotsCovered, 3);
  assert.deepEqual(window.dealsOn.map((d) => d.id), full.dealsOn.map((d) => d.id));
  // Reckitt buys its guaranteed Dispensary slot and the open auction on other types; none of that may count as a win on its deal positions.
  const reckitt = covered('adv-reckitt');
  let ownDealWins = 0; let allWins = 0;
  store.scanDelivery(parseFilters(new URLSearchParams(''), { today: TODAY }), (r) => {
    if (r.advertiserId !== 'adv-reckitt') return;
    allWins += r.slots;
    if (r.dealType !== 'Open auction') ownDealWins += r.slots;
  });
  assert.equal(reckitt.slotsWonCount, ownDealWins);
  assert.ok(allWins > ownDealWins);
  // A direct advertiser never bids in the open auction, so every one of its plays is on its own deals.
  let perrigoWins = 0; let perrigoDealWins = 0;
  store.scanDelivery(parseFilters(new URLSearchParams(''), { today: TODAY }), (r) => {
    if (r.advertiserId !== 'adv-perrigo') return;
    perrigoWins += r.slots;
    if (r.dealType !== 'Open auction') perrigoDealWins += r.slots;
  });
  assert.equal(perrigoWins, perrigoDealWins);
  assert.equal(full.slotsWonCount, perrigoDealWins);
});

test('deals: Advertisers on deal are ordered by DSP, then name', () => {
  const deal = run('deals', 'dealType=Direct advertiser').rows.find((r) => r.name === 'Health & wellness windows');
  assert.deepEqual(deal.advertisers.map((a) => [a.dsp, a.name]), [['Direct', 'Nestlé Health Science'], ['Direct', 'Perrigo'], ['Direct', 'Vitabiotics']]);
});

test('Revenue is earned and to the cent in the maturity table', () => {
  const t = run('maturity').table;
  const adv = run('advertisers').all;
  for (const row of t) near(row.revenue, adv.find((a) => a.advertiserId === row.advertiserId).revenue, 0.005, row.name);
  assert.ok(t.some((r) => !Number.isInteger(r.revenue)), 'not rounded to whole dollars');
});

test('PG pacing: delivered is settled VAC-d and the page filters do not change it', () => {
  const immune = (q) => run('deals', `dealType=Programmatic guaranteed${q}`).rows.find((r) => r.name === 'Immune — winter launch').pacing;
  const base = immune('');
  for (const q of ['storeIds=store-1', 'displayTypeIds=window', 'storeIds=store-1&displayTypeIds=window']) {
    const p = immune(`&${q}`);
    assert.equal(p.delivered, base.delivered, q);
    assert.equal(p.percent, base.percent, q);
  }
  let settled = 0; let all = 0;
  store.scanDelivery({ dateFrom: '2026-09-15', dateTo: TODAY, storeIds: null, displayTypeIds: null, advertiserIds: null }, (r) => { if (r.dealId === 'd1') { settled += r.earnedViews; all += r.views; } });
  assert.equal(base.delivered, Math.round(settled));
  assert.equal(all, settled, 'reservations carry no views, and every played day is settled');
  assert.ok(base.percent > 50 && base.percent < 150);
});

// ---- the advertiser view reconciles with the retailer view
const { allowedDisplayTypeIds, scopeFilters } = require('../src/scope');
const principalOf = (id) => ({ principalType: 'advertiser', principalId: id, scopes: ['insights:read'] });
const asAdv = (name, id, q = '') => {
  const route = require(`../src/routes/${name}`);
  const params = new URLSearchParams(q);
  const filters = scopeFilters(parseFilters(new URLSearchParams(`advertiserIds=${id}&${q}`), { today: TODAY }), principalOf(id), store);
  return route.handler({ store, filters, params, principal: principalOf(id) });
};
const RANGE = `dateFrom=2026-09-12&dateTo=${TODAY}`;

test('advertiser view: own spend = the retailer Advertisers revenue, in total and per display type', () => {
  for (const id of ADVERTISERS) {
    const mine = run('advertisers', `advertiserIds=${id}`).all.find((a) => a.advertiserId === id);
    const delivery = asAdv('delivery', id, RANGE);
    near(delivery.totals.spend, mine.revenue, 0.01 * 31, `${id} spend vs retailer revenue`);
    for (const t of Object.keys(ctx.displayTypes)) {
      const retailer = run('advertisers', `advertiserIds=${id}&displayTypeIds=${t}`).all.find((a) => a.advertiserId === id);
      const view = asAdv('delivery', id, `${RANGE}&displayTypeIds=${t}`);
      near(view.totals.spend, retailer ? retailer.revenue : 0, 0.01 * 31, `${id} on ${t}`);
    }
  }
});

test('advertiser view: deals-by-display-type spend + open auction spend = Delivery spend; Audience = earned views', () => {
  for (const id of ADVERTISERS) {
    const delivery = asAdv('delivery', id, RANGE);
    const deals = asAdv('deals-by-display-type', id, RANGE);
    const open = asAdv('delivery', id, `${RANGE}&dealId=open-auction`);
    near(deals.totals.spend + open.totals.spend, delivery.totals.spend, 0.01 * 120, `${id} deals + open auction vs Delivery`);
    let earnedViews = 0;
    store.scanDelivery(scopeFilters(parseFilters(new URLSearchParams(`${RANGE}&advertiserIds=${id}`), { today: TODAY }), principalOf(id), store), (r) => { earnedViews += r.earnedViews; });
    near(asAdv('audience', id, RANGE).assumedViews, earnedViews, 31, `${id} Audience vs earned views`);
  }
});

test('advertiser view: every display type an advertiser is billed on is one it is allowed to see', () => {
  for (const id of ADVERTISERS) {
    const allowed = allowedDisplayTypeIds(store, id);
    const billed = new Set(raw.billing.filter((b) => b.advertiserId === id).map((b) => b.displayTypeId));
    for (const t of billed) assert.ok(allowed.includes(t), `${id} is billed on ${t}, which is outside ${allowed}`);
  }
  // README sample: Blackmores sees Window Portrait, Queue Screen and Dispensary Screen, not Endcap Shelf-edge.
  assert.deepEqual(allowedDisplayTypeIds(store, 'adv-blackmores').sort(), ['dispensary', 'queue', 'window']);
});

test('advertiser view: booked-ahead (reservation) rows are not delivery', () => {
  const booked = 'dateFrom=2026-10-12&dateTo=2026-11-10'; // the days after the last played day hold only reservations
  for (const id of ADVERTISERS) {
    const d = asAdv('delivery', id, booked);
    assert.equal(d.totals.playsWon, 0, id); assert.equal(d.totals.spend, 0, id);
    assert.equal(asAdv('audience', id, booked).assumedViews, 0, id);
    assert.equal(asAdv('deals-by-display-type', id, booked).totals.playsWon, 0, id);
  }
});
