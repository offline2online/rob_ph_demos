// node --test Retail-media-insights/frontend/test
const test = require('node:test');
const assert = require('node:assert');
const RD = require('../revenue-deals.js');
const F = require('../rd-fixtures.js');

test('bars stack DSP order then Programmatic guaranteed → Open auction, and total as returned', () => {
  const bars = RD.revenueBars(F.revenue({ dsps: ['Amazon DSP', 'DV360'] }));
  assert.strictEqual(bars.length, 30);
  const b = bars[0];
  assert.deepStrictEqual(b.stacks.map((s) => s.dsp + '/' + s.dealType).slice(0, 5),
    ['DV360/Programmatic guaranteed', 'DV360/Preferred deal', 'DV360/Private auction', 'DV360/Open auction', 'Amazon DSP/Programmatic guaranteed']);
  assert.strictEqual(b.earned, b.stacks.reduce((a, s) => a + s.amount, 0));
});

test('bar hover: period total first, then each DSP × deal type, then estimated', () => {
  const bar = RD.revenueBars(F.revenue({ dsps: ['DV360'] })).pop();
  const t = RD.barTooltip(bar, 'day');
  assert.strictEqual(t.rows[0][0], '11 Oct');
  assert.strictEqual(t.rows[0][1], RD.fmtMoney(bar.earned));
  assert.strictEqual(t.rows[1][0], 'DV360 · Programmatic guaranteed');
  assert.strictEqual(t.rows[t.rows.length - 1][0], 'Estimated revenue');
});

test('week and month regroup', () => {
  assert.ok(RD.revenueBars(F.revenue({ granularity: 'week' })).length < 8);
  assert.strictEqual(RD.revenueBars(F.revenue({ granularity: 'month' })).length, 2);
});

test('deal type filter narrows revenue', () => {
  const rows = F.revenue({ dealTypes: ['Private auction'] }).rows;
  assert.ok(rows.length && rows.every((r) => r.dealType === 'Private auction'));
});

test('deal name hover: description and per-DSP deal IDs', () => {
  const t = RD.nameTooltip(F.deals().rows[0]);
  assert.deepStrictEqual(t.rows.map((r) => r[0]), ['Description', 'DV360', 'The Trade Desk']);
  assert.strictEqual(t.rows[1][1], 'PH-A595WKW5P3');
});

test('slots label and Assigned slots hover', () => {
  const [pg, , , auction] = F.deals().rows;
  assert.strictEqual(RD.slotsLabel(pg), '2 slots');
  assert.strictEqual(RD.slotsLabel(auction), 'Not assigned');
  const t = RD.slotsTooltip(pg);
  assert.strictEqual(t.title, 'Assigned slots');
  assert.match(t.rows[0][1], /IAB zone: Entrance & out of category/);
  assert.match(t.rows[0][1], /Advertiser slot 2 \(slot 3 of the loop\) · 12 plays per window/);
});

test('advertisers hover lists "Name (DSP)"', () => {
  const t = RD.advertisersTooltip(F.deals().rows[0]);
  assert.deepStrictEqual(t.rows.map((r) => r[0]), ['Blackmores (DV360)', 'Haleon (The Trade Desk)']);
});

test('pacing hover: in flight and before the flight', () => {
  const rows = F.deals().rows;
  const live = Object.fromEntries(RD.pacingTooltip(rows[0].pacing).rows);
  assert.strictEqual(live['Days elapsed'], '27 of 62 (44%)');
  assert.strictEqual(live['Days remaining'], '35');
  assert.strictEqual(live.Flight, '15 Sep – 15 Nov (62 days)');
  assert.strictEqual(live.Buffer, '10%');
  const soon = Object.fromEntries(RD.pacingTooltip(rows[1].pacing).rows);
  assert.strictEqual(soon.Status, 'Starts in 7 days');
  assert.ok(!('Days elapsed' in soon));
});

test('CPM hover names floor vs fixed', () => {
  const rows = F.deals().rows;
  assert.strictEqual(RD.cpmTooltip(rows[3].cpm).rows[0][0], 'Floor CPM');
  assert.strictEqual(RD.cpmTooltip(rows[0].cpm).rows[0][0], 'Fixed CPM');
});
