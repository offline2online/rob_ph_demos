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
  const all = await get('/revenue', { dsps: ['DV360', 'The Trade Desk', 'Amazon DSP', 'Direct'] });
  const summary = await get('/summary');
  assert.strictEqual(Math.round(RD.revenueTotals(all).earned), Math.round(summary.earnedRevenue));
});

test('bar hover: period total first, then each DSP × deal type, then estimated', async () => {
  const bars = RD.revenueBars(await get('/revenue', { dsps: ['DV360'] }));
  const bar = bars[bars.length - 1];
  const last = RD.barTooltip(bar, 'day').rows.map((r) => r[0]);
  assert.strictEqual(last[0], '11 Oct');
  assert.ok(last.length > 1 && !last.includes('Estimated (booked ahead)'), 'every played day is earned: nothing is estimated on the last one');
  const settled = bars[bars.length - 5];
  settled.estimated = 1; // an estimated part is listed last
  const t = RD.barTooltip(settled, 'day');
  assert.strictEqual(t.rows[0][1], RD.fmtMoney(settled.earned));
  assert.match(t.rows[1][0], /^DV360 · /);
  assert.strictEqual(t.rows[t.rows.length - 1][0], 'Estimated (booked ahead)');
});

test('week and month regroup, and the x-axis thins to what fits', async () => {
  assert.ok(RD.revenueBars(await get('/revenue', { granularity: 'week' })).length < 8);
  assert.strictEqual(RD.revenueBars(await get('/revenue', { granularity: 'month' })).length, 2);
  assert.strictEqual(RD.labelStep(30, 600, 52), 3);
  assert.ok(RD.labelStep(30, 300, 52) > RD.labelStep(30, 600, 52), 'a phone shows fewer labels');
  assert.strictEqual(RD.labelStep(4, 300, 52), 1);
});

test('deal type filter narrows revenue', async () => {
  const rows = (await get('/revenue', { dealTypes: ['Direct advertiser'] })).rows;
  assert.ok(rows.length && rows.every((r) => r.dealType === 'Direct advertiser' && r.dsp === 'Direct'));
});

test('deal name hover: description and per-DSP deal IDs from {dsp, dspLabel, dealId}', async () => {
  const deal = (await get('/deals')).rows.find((d) => d.dealIds.length === 1);
  const t = RD.nameTooltip(deal);
  assert.deepStrictEqual(t.rows.map((r) => r[0]), [deal.description, 'Deal IDs'].concat(deal.dealIds.map((d) => d.dspLabel)));
  assert.match(t.rows[2][0], /^(Google DSP \(DV360\)|The Trade Desk|Amazon Ads DSP)$/);
  assert.match(t.rows[2][1], /^PH-[A-Z0-9]{10}$/);
  assert.strictEqual(t.rows[2][2], 'rd-tip-mono');
  // A direct deal has no DSP and so no deal ID: the hover is its description alone.
  const direct = (await get('/deals')).rows.find((d) => d.dealType === 'Direct advertiser');
  assert.deepStrictEqual(direct.dealIds, []);
  assert.ok(!RD.nameTooltip(direct).rows.some((r) => r[0] === 'Deal IDs'));
});

test('slots label and Assigned slots hover', async () => {
  const rows = (await get('/deals')).rows;
  const pg = rows.find((d) => d.name === 'Immune — winter launch');
  assert.strictEqual(RD.slotsLabel(pg), '2 slots');
  assert.strictEqual(RD.slotsLabel({ slots: [] }), 'Not assigned');
  const t = RD.slotsTooltip(pg);
  assert.strictEqual(t.title, 'Assigned slots');
  assert.match(t.rows[0][1], /IAB zone: Entrance & out of category/);
  assert.strictEqual(t.rows[0][0], 'Window Portrait (Portrait screen in the store window at the entrance)');
  assert.strictEqual(t.rows[0][1].split('\n')[0], pg.slots[0].playlistZone);
  assert.match(RD.slotsTooltip(pg, { window: 12 }).rows[0][1], /Advertiser slot 1 \(slot 1 of 12\) · 60 plays per window/);
  assert.match(t.rows[0][1], /Advertiser slot 1 \(slot 1 of the loop\) · 60 plays per window/);
});

test('advertisers hover lists "Name (DSP)"', async () => {
  const deal = (await get('/deals')).rows.find((d) => d.name === 'Beauty endcaps');
  assert.strictEqual(RD.advertisersTooltip(deal).title, deal.name);
  assert.strictEqual(RD.advertisersLabel(deal), '2 advertisers');
  assert.strictEqual(RD.advertisersLabel({ advertisers: [1] }), '1 advertiser');
  assert.deepStrictEqual(RD.advertisersTooltip(deal).rows.map((r) => r[0]), ["L'Oréal Paris (Direct)", 'Procter & Gamble (Direct)']);
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
  assert.strictEqual(RD.cpmTooltip({ value: 7.5, kind: 'floor' }).rows[0][0], 'Floor CPM', 'the formatter still names a floor');
  assert.strictEqual(RD.cpmTooltip(rows.find((d) => d.dealType === 'Direct advertiser').cpm).rows[0][0], 'Fixed CPM');
  assert.strictEqual(RD.cpmTooltip(rows.find((d) => d.dealType === 'Programmatic guaranteed').cpm).rows[0][0], 'Fixed CPM');
});

test('booked-ahead bars follow the last played day, are not part of the earned total, and carry the ahead hover', async () => {
  const data = await get('/revenue', { dsps: ['DV360'], aheadDays: 14 });
  const bars = RD.revenueBars(data);
  assert.strictEqual(bars.filter((b) => b.ahead).length, 14);
  assert.strictEqual(bars.length, 44);
  assert.ok(bars.filter((b) => b.ahead).every((b) => b.earned === 0 && b.estimated > 0 && b.period > data.lastDataDay));
  assert.strictEqual(RD.revenueTotals(data).earned, RD.revenueTotals(await get('/revenue', { dsps: ['DV360'] })).earned);
  const t = RD.barTooltip(bars[bars.length - 1], 'day');
  assert.strictEqual(t.title, 'Estimated (booked ahead)');
});

test('ahead days per granularity, labels, and the year end cap', async () => {
  assert.strictEqual(RD.aheadDaysFor('day', '2026-10-11'), 14);
  assert.strictEqual(RD.aheadDaysFor('week', '2026-10-11'), 42);
  assert.strictEqual(RD.aheadDaysFor('month', '2026-10-11'), 81);
  const wk = RD.revenueBars(await get('/revenue', { granularity: 'week', aheadDays: 42 }));
  assert.strictEqual(wk.filter((b) => b.ahead).length, 6);
  assert.strictEqual(RD.periodLabel('2026-09-14', 'week'), 'w/c 14 Sep');
  assert.strictEqual(RD.periodLabel('2026-09-01', 'month'), 'Sep');
  const mo = RD.revenueBars(await get('/revenue', { granularity: 'month', aheadDays: 81 }));
  assert.strictEqual(mo[mo.length - 1].period, '2026-12-01');
});

test('colour families: four shades per DSP, legend per DSP × deal type', () => {
  assert.strictEqual(RD.shadeColour('DV360', 'Programmatic guaranteed'), '#9c3d14');
  assert.strictEqual(RD.shadeColour('The Trade Desk', 'Preferred deal'), '#2a78d6');
  assert.strictEqual(RD.shadeColour('Amazon DSP', 'Open auction'), '#b0e6d1');
  const all = RD.legendEntries(['Amazon DSP', 'DV360'], '');
  assert.strictEqual(all.length, 8);
  assert.strictEqual(all[0].label, 'DV360 · Programmatic guaranteed');
  assert.deepStrictEqual(RD.legendEntries(['DV360'], 'Private auction').map((e) => e.label), ['DV360 · Private auction']);
});

test('CPM note and deal columns', async () => {
  assert.strictEqual(RD.cpmNote({ value: 9.5, kind: 'fixed' }), 'fixed');
  assert.strictEqual(RD.cpmNote({ value: 9.5, kind: 'floor' }), 'floor');
  const pg = (await get('/deals')).rows.find((r) => r.dealType === 'Programmatic guaranteed');
  assert.ok(Object.fromEntries(RD.pacingTooltip(pg.pacing).rows)['Guaranteed, whole flight']);
});

test('deals default to Revenue highest first, and every column sorts both ways with empty values last', async () => {
  const rows = (await get('/deals')).rows;
  const rev = RD.sortDeals(rows, null).map((d) => d.revenue);
  assert.deepStrictEqual(rev, rev.slice().sort((a, b) => b - a));
  const asc = RD.sortDeals(rows, { key: 'revenue', dir: 'asc' }).map((d) => d.revenue);
  assert.deepStrictEqual(asc, asc.slice().sort((a, b) => a - b));
  const names = RD.sortDeals(rows, { key: 'name', dir: 'asc' }).map((d) => d.name.toLowerCase());
  assert.deepStrictEqual(names, names.slice().sort());
  RD.DEAL_COLS.forEach((c) => ['asc', 'desc'].forEach((dir) => {
    const out = RD.sortDeals(rows, { key: c.key, dir });
    assert.strictEqual(out.length, rows.length);
    const vals = out.map((d) => c.value(d));
    const firstNull = vals.indexOf(null);
    assert.ok(firstNull < 0 || vals.slice(firstNull).every((v) => v === null), c.key + ' keeps empty values last');
  }));
});

test('a column header cycles highest first → lowest first → default; Revenue starts from the default', () => {
  assert.deepStrictEqual(RD.nextDealSort(null, 'fill'), { key: 'fill', dir: 'desc' });
  assert.deepStrictEqual(RD.nextDealSort({ key: 'fill', dir: 'desc' }, 'fill'), { key: 'fill', dir: 'asc' });
  assert.strictEqual(RD.nextDealSort({ key: 'fill', dir: 'asc' }, 'fill'), null);
  assert.deepStrictEqual(RD.nextDealSort({ key: 'fill', dir: 'asc' }, 'cpm'), { key: 'cpm', dir: 'desc' });
  assert.deepStrictEqual(RD.nextDealSort(null, 'revenue'), { key: 'revenue', dir: 'asc' });
  assert.strictEqual(RD.nextDealSort({ key: 'revenue', dir: 'asc' }, 'revenue'), null);
});

test('bar hover shows the number of advertisers in brackets beside each DSP × deal type amount', async () => {
  const data = await get('/revenue', { dsps: ['DV360'] });
  assert.ok(data.rows.every((r) => Number.isInteger(r.advertisers) && r.advertisers >= 0));
  const bar = RD.revenueBars(data)[10];
  const t = RD.barTooltip(bar, 'day');
  assert.strictEqual(t.rows[0][1], RD.fmtMoney(bar.earned), 'the period total carries no count');
  bar.stacks.forEach((s, i) => assert.strictEqual(t.rows[i + 1][1], RD.fmtMoney(s.amount) + ' (' + s.advertisers + ')'));
  const week = RD.revenueBars(await get('/revenue', { dsps: ['DV360'], granularity: 'week' }))[1];
  assert.ok(week.stacks.every((s) => s.advertisers >= 1), 'a week counts distinct advertisers across its days');
});

test('Direct is a source beside the DSPs: one purple shade, one legend entry, first in the order', () => {
  assert.deepStrictEqual(RD.DSP_ORDER, ['Direct', 'DV360', 'The Trade Desk', 'Amazon DSP']);
  assert.deepStrictEqual(RD.DEAL_TYPES, ['Direct advertiser', 'Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction']);
  assert.deepStrictEqual(RD.legendEntries(['Direct'], '').map((e) => e.label), ['Direct · Direct advertiser']);
  assert.strictEqual(RD.legendEntries(['DV360', 'Direct'], '').length, 5);
  assert.deepStrictEqual(RD.legendEntries(['DV360'], 'Direct advertiser'), [], 'a DSP has no direct deals');
  assert.deepStrictEqual(RD.legendEntries(['The Trade Desk', 'Direct'], 'Direct advertiser').map((e) => e.label), ['Direct · Direct advertiser']);
});
