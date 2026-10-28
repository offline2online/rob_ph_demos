'use strict';
// VAC-d audit (27 Oct 2026): every money figure is plays x VAC-d / 1,000 x CPM, the way billing prices it (Broadsign model).
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../src/calc');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { parseFilters } = require('../src/filters');

test('seed slot: 1,000 plays x VAC-d 300 / 1,000 x $10 CPM is $3,000 in every library valuation', () => {
  const views = calc.playsVacd(1000, 300); // VAC-d delivered by 1,000 plays at 300 each
  assert.equal(views, 300000);
  assert.equal(calc.revenueAtCpm(10, views), 3000);
  assert.equal(calc.unsoldValueAtFloor(views, 10), 3000);
  assert.equal(calc.missedRevenue(views, 10, 0).total, 3000);
  assert.equal(calc.effectiveCpm(3000, views), 10);
});

test('vacdPerPlay spreads a slot-day of views over its plays', () => {
  assert.equal(calc.vacdPerPlay(200, 40), 5);
  assert.equal(calc.vacdPerPlay(200, 0), 0);
});

const { raw, ctx } = generateTestRetailer({ days: 90 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const params = new URLSearchParams('');
const filters = parseFilters(params, { today: '2026-10-11' });
const deals = require('../src/routes/deals').handler({ store, filters, params, principal: { principalType: 'admin', principalId: 'retailer', scopes: ['insights:read'] } });

test('Deals hover: slot value is plays x VAC-d / 1,000 x CPM, so it is below plays / 1,000 x CPM whenever a play delivers under 1,000 VAC-d', () => {
  let checked = 0;
  for (const row of deals.rows) {
    const rate = row.cpm.value;
    if (rate == null || !row.term) continue;
    for (const s of row.slots) {
      if (s.termPlays == null) continue;
      assert.ok(s.termVacd > 0, `${row.name} slot ${s.advertiserSlot} has VAC-d`);
      assert.ok(Math.abs(s.termValue - calc.revenueAtCpm(rate, s.termVacd)) <= rate * 0.0005 + 0.01, 'value = VAC-d / 1,000 x CPM');
      assert.notEqual(s.termValue, Math.round(s.termPlays / 1000 * rate * 100) / 100, 'not plays / 1,000 x CPM');
      checked += 1;
    }
    if (row.term.total) {
      assert.ok(Math.abs(row.term.total.value - row.slots.reduce((n, s) => n + s.termValue, 0)) <= 0.01 * row.slots.length);
      assert.ok(Math.abs(row.term.total.vacd - row.slots.reduce((n, s) => n + s.termVacd, 0)) <= row.slots.length);
    }
  }
  assert.ok(checked > 0);
});

test('Deals hover: a fixed-CPM deal slot reconciles with billing priced on the same VAC-d per play', () => {
  const d = deals.rows.find((r) => r.cpm.kind === 'fixed' && r.term && r.slots.some((s) => s.termVacd));
  const s = d.slots.find((x) => x.termVacd);
  // billing value of the same VAC-d at the same CPM, as the exchange cents it
  assert.ok(Math.abs(s.termValue - calc.revenueAtCpm(d.cpm.value, s.termVacd)) <= d.cpm.value * 0.0005 + 0.01); // termVacd is whole-number rounded
});
