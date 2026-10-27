'use strict';
// Audit (27 Oct 2026): every calculation that reads billing or inventory counts the direct advertisers. Slot value, Missed revenue
// & fill, Slot allocation, Inventory sold and Revenue must all agree with the raw billing, whatever the source of a line.
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { parseFilters } = require('../src/filters');

const { raw, ctx } = generateTestRetailer({ days: 90 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const admin = { principalType: 'admin', principalId: 'retailer', scopes: ['insights:read'] };
const FROM = '2026-09-12'; const TO = '2026-10-11';
const RANGE = `dateFrom=${FROM}&dateTo=${TO}`;
const run = (name, q = RANGE) => {
  const route = require(`../src/routes/${name}`);
  const params = new URLSearchParams(q);
  return route.handler({ store, filters: parseFilters(params, { today: TO }), params, principal: admin });
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const settled = raw.billing.filter((b) => b.settled && b.date >= FROM && b.date <= TO);
const direct = settled.filter((b) => b.dsp === 'Direct');

test('direct advertisers are a real share of the example retailer: 7 of 10 named deals, billed with no DSP and no seat', () => {
  assert.ok(direct.length > 0 && direct.every((b) => ctx.dealCatalog[b.dealId].dealType === 'Direct advertiser' && b.seatId === null));
  assert.ok(settled.filter((b) => b.dsp !== 'Direct').every((b) => b.seatId));
  const share = sum(direct.map((b) => b.revenue)) / sum(settled.map((b) => b.revenue));
  assert.ok(share > 0.3 && share < 0.7, `direct share of earned revenue ${share}`);
  assert.deepEqual([...new Set(settled.map((b) => ctx.dealCatalog[b.dealId].dealType))].sort(), ['Direct advertiser', 'Open auction', 'Programmatic guaranteed']);
});

test('Slot value: per display type and in total, earned revenue and views include the direct advertisers', () => {
  const { rows, network } = run('slot-value');
  for (const row of rows) {
    const billed = settled.filter((b) => b.displayTypeId === row.id);
    const directBilled = billed.filter((b) => b.dsp === 'Direct');
    assert.ok(directBilled.length > 0, `${row.id} has direct delivery`);
    assert.ok(Math.abs(row.totals.earnedRevenue - sum(billed.map((b) => b.revenue))) < 0.01 * 40, `${row.id} earned revenue`);
    assert.equal(row.totals.assumedViews, Math.round(sum(billed.map((b) => b.views))), `${row.id} assumed views`);
  }
  assert.ok(Math.abs(network.earnedRevenue - sum(settled.map((b) => b.revenue))) < 0.01 * rows.length);
  assert.ok(Math.abs(network.earnedRevenue - run('summary').earnedRevenue) < 0.01 * rows.length, 'slot value total = summary earned revenue');
});

test('Inventory sold, Missed revenue & fill and Slot allocation count the slots direct deals sell', () => {
  const missed = run('missed-revenue');
  const summary = run('summary');
  const alloc = run('slot-allocation');
  // Every settled play, whoever bought it, is a sold slot (inside operating hours; reservations carry none).
  for (const row of missed.rows) {
    const plays = sum(settled.filter((b) => b.displayTypeId === row.id).map((b) => b.slots));
    assert.equal(row.slotsSold, plays, `${row.id}: sold slots = plays billed to DSPs, direct advertisers and the open auction`);
    assert.equal(row.slotsTotal, row.slotsSold + row.slotsUnsold + row.slotsOffline);
    assert.equal(alloc.rows.find((a) => a.id === row.id).advertiserSlotsSoldPercent, row.fillPercent);
  }
  assert.equal(missed.total.slotsSold, sum(settled.map((b) => b.slots)));
  assert.equal(summary.inventorySold.slotsSold, missed.total.slotsSold);
  assert.equal(summary.inventorySold.percent, missed.total.fillPercent);
  // Plays sold on direct deals are part of those sold slots, not extra to them.
  const directPlays = sum(direct.map((b) => b.slots));
  assert.ok(directPlays > 0 && directPlays < missed.total.slotsSold);
  // Unsold value is priced at the floor on unsold slots only: a direct deal's sold slots add nothing to it.
  assert.equal(missed.total.totalMissed, missed.total.unsoldValueAtFloor + missed.total.downtimeLostRevenue);
});

test('Revenue and Summary: Direct is its own source and every source adds to earned revenue', () => {
  const summary = run('summary');
  const rev = run('revenue', `${RANGE}&granularity=month`).rows;
  const bySource = (dsp) => sum(rev.filter((r) => r.dsp === dsp).map((r) => r.earned));
  assert.ok(Math.abs(bySource('Direct') - sum(direct.map((b) => b.revenue))) < 0.04);
  assert.ok(Math.abs(sum(rev.map((r) => r.earned)) - summary.earnedRevenue) < 0.04);
  assert.equal(summary.direct.advertisers, 5);
});
