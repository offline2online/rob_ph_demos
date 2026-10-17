// node --test Retail-media-insights/frontend/test
const test = require('node:test');
const assert = require('node:assert');
const RD = require('../revenue-deals.js');
const { get } = require('./api.js');

test('bars stack DSP order then Programmatic guaranteed → Open auction; the earned total is the back end’s parts', async () => {
  const data = await get('/revenue', { dsps: ['Amazon DSP', 'DV360'] });
  const bars = RD.revenueBars(data);
  assert.strictEqual(bars.length, 30);
  const dsps = bars[0].stacks.map((s) => s.dsp);
  assert.deepStrictEqual(dsps, dsps.slice().sort((a, b) => RD.DSP_ORDER.indexOf(a) - RD.DSP_ORDER.indexOf(b)));
  assert.deepStrictEqual(bars[0].stacks.filter((s) => s.dsp === 'DV360').map((s) => s.dealType),
    RD.DEAL_TYPES.filter((t) => bars[0].stacks.some((s) => s.dsp === 'DV360' && s.dealType === t)));
  const sum = data.rows.reduce((n, r) => n + Math.round(r.earned * 100), 0) / 100;
  assert.strictEqual(RD.revenueTotals(data).earned, sum);
});

test('Revenue total with every DSP on equals the summary’s earned revenue', async () => {
  const all = await get('/revenue', { dsps: ['DV360', 'The Trade Desk', 'Amazon DSP'] });
  const summary = await get('/summary');
  assert.strictEqual(Math.round(RD.revenueTotals(all).earned), Math.round(summary.earnedRevenue));
});

test('bar hover: period total first, then each DSP × deal type, then estimated', async () => {
  const bars = RD.revenueBars(await get('/revenue', { dsps: ['DV360'] }));
  const bar = bars[bars.length - 1];
  const last = RD.barTooltip(bar, 'day').rows.map((r) => r[0]);
  assert.strictEqual(last[0], '11 Oct');
  assert.ok(last.length > 1 && !last.includes('Estimated revenue'), 'every played day is earned: nothing is estimated on the last one');
  const settled = bars[bars.length - 5];
  settled.estimated = 1; // an estimated part is listed last
  const t = RD.barTooltip(settled, 'day');
  assert.strictEqual(t.rows[0][1], RD.fmtMoney(settled.earned));
  assert.match(t.rows[1][0], /^DV360 · /);
  assert.strictEqual(t.rows[t.rows.length - 1][0], 'Estimated revenue');
});

test('week and month regroup, and the x-axis thins to what fits', async () => {
  assert.ok(RD.revenueBars(await get('/revenue', { granularity: 'week' })).length < 8);
  assert.strictEqual(RD.revenueBars(await get('/revenue', { granularity: 'month' })).length, 2);
  assert.strictEqual(RD.labelStep(30, 600, 52), 3);
  assert.ok(RD.labelStep(30, 300, 52) > RD.labelStep(30, 600, 52), 'a phone shows fewer labels');
  assert.strictEqual(RD.labelStep(4, 300, 52), 1);
});

test('deal type filter narrows revenue', async () => {
  const rows = (await get('/revenue', { dealTypes: ['Private auction'] })).rows;
  assert.ok(rows.length && rows.every((r) => r.dealType === 'Private auction'));
});

test('deal name hover: description and per-DSP deal IDs from {dsp, dspLabel, dealId}', async () => {
  const deal = (await get('/deals')).rows.find((d) => d.dealIds.length === 2);
  const t = RD.nameTooltip(deal);
  assert.deepStrictEqual(t.rows.map((r) => r[0]), ['Description'].concat(deal.dealIds.map((d) => `${d.dspLabel}: ${d.dealId}`)));
  assert.match(t.rows[1][0], /^(Google DSP \(DV360\)|The Trade Desk|Amazon Ads DSP): PH-[A-Z0-9]{10}$/);
});

test('slots label and Assigned slots hover', async () => {
  const rows = (await get('/deals')).rows;
  const pg = rows.find((d) => d.dealType === 'Programmatic guaranteed');
  assert.strictEqual(RD.slotsLabel(pg), '2 slots');
  assert.strictEqual(RD.slotsLabel({ slots: [] }), 'Not assigned');
  const t = RD.slotsTooltip(pg);
  assert.strictEqual(t.title, 'Assigned slots');
  assert.match(t.rows[0][1], /IAB zone: Entrance & out of category/);
  assert.strictEqual(t.rows[0][1].split('\n')[0], pg.slots[0].displayTypeDescription, 'the display type description sits under its name');
  assert.ok(pg.slots.every((s) => s.displayTypeDescription));
  assert.match(t.rows[0][1], /Advertiser slot 1 \(slot 1 of the loop\) · 60 plays per window/);
});

test('advertisers hover lists "Name (DSP)"', async () => {
  const deal = (await get('/deals')).rows.find((d) => d.dealType === 'Private auction');
  assert.deepStrictEqual(RD.advertisersTooltip(deal).rows.map((r) => r[0]), ['Kenvue (DV360)', "L'Oréal Paris (DV360)"]);
});

test('pacing hover: in flight', async () => {
  const pg = (await get('/deals')).rows.find((d) => d.dealType === 'Programmatic guaranteed');
  assert.ok(pg.pacing, 'a Programmatic guaranteed deal carries pacing');
  const rows = Object.fromEntries(RD.pacingTooltip(pg.pacing).rows);
  assert.ok(rows.Delivered && rows['Guaranteed to date'] && rows.Flight);
  const before = Object.fromEntries(RD.pacingTooltip({ delivered: 0, flightStart: '2026-11-01', flightEnd: '2026-12-01', flightDays: 31, startsInDays: 7 }).rows);
  assert.strictEqual(before.Status, 'Starts in 7 days');
  assert.ok(!('Days elapsed' in before));
});

test('CPM hover names floor vs fixed', async () => {
  const rows = (await get('/deals')).rows;
  assert.strictEqual(RD.cpmTooltip(rows.find((d) => d.dealType === 'Private auction').cpm).rows[0][0], 'Floor CPM');
  assert.strictEqual(RD.cpmTooltip(rows.find((d) => d.dealType === 'Programmatic guaranteed').cpm).rows[0][0], 'Fixed CPM');
});
