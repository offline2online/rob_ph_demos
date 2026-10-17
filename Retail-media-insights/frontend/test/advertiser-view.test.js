// node --test Retail-media-insights/frontend/test
const test = require('node:test');
const assert = require('node:assert');
const AV = require('../advertiser-view.js');
const F = require('../av-fixtures.js');

test('both metric tiles start on and the last one on cannot be switched off', () => {
  let m = AV.initialMetrics();
  assert.deepStrictEqual(m, { plays: true, spend: true });
  m = AV.toggleMetric(m, 'plays');
  assert.deepStrictEqual(m, { plays: false, spend: true });
  assert.deepStrictEqual(AV.toggleMetric(m, 'spend'), { plays: false, spend: true });
  assert.deepStrictEqual(AV.toggleMetric(m, 'plays'), { plays: true, spend: true });
});

test('Deal drop-down: All deals, each deal by name and type, Open auction last', () => {
  const o = AV.dealOptions(F.delivery());
  assert.deepStrictEqual(o.map((x) => x.label), ['All deals', 'Wellness PG · Programmatic guaranteed', 'Everyday Preferred · Preferred deal', 'Pharmacy Auction · Private auction', 'Open auction']);
  assert.strictEqual(o[0].value, '');
});

test('Pacing switch only for a Programmatic guaranteed deal', () => {
  const d = F.delivery();
  assert.strictEqual(AV.showPacingSwitch(d, 'd1'), true);
  assert.strictEqual(AV.showPacingSwitch(d, ''), false);
  assert.strictEqual(AV.showPacingSwitch(d, 'd3'), false);
  assert.strictEqual(AV.showPacingSwitch(d, 'd4'), false);
  assert.strictEqual(AV.showPacingSwitch(d, 'open-auction'), false);
});

test('day hover: totals, a block per deal, then change vs previous day', () => {
  const day = F.delivery().days[10];
  const t = AV.dayTooltip(day);
  const keys = t.rows.map((r) => r[0]);
  assert.strictEqual(keys[0], 'Plays won'); assert.strictEqual(keys[1], 'Spend');
  assert.deepStrictEqual(t.rows.filter((r) => r[2] === 'head').map((r) => r[0]),
    ['Wellness PG · Programmatic guaranteed', 'Everyday Preferred · Preferred deal', 'Pharmacy Auction · Private auction', 'Open auction · Open auction']);
  assert.deepStrictEqual(keys.slice(-2), ['Plays won vs previous day', 'Spend vs previous day']);
  assert.match(t.rows[t.rows.length - 1][1], /^[▲▼] \$/);
});

test('auction block: plays of all plays with share, your CPM, winning CPM avg and high, floor', () => {
  const rows = AV.dealBlockRows({ name: 'Pharmacy Auction', dealType: 'Private auction', playsWon: 32, allPlays: 114, sharePercent: 28, yourCpm: 9.4, winningCpm: { average: 9.18, highest: 10.11 }, floorCpm: { min: 9, max: 9 } });
  assert.deepStrictEqual(rows.slice(1), [['Plays won', '32 of 114 (28%)'], ['Your CPM', '$9.40'], ['Winning CPM', '$9.18 avg · $10.11 high'], ['Floor CPM', '$9.00']]);
});

test('no plays won, no winning CPM, floor range for the open auction', () => {
  const rows = AV.dealBlockRows({ name: 'Open auction', dealType: 'Open auction', playsWon: 0, allPlays: 40, floorCpm: { min: 5.5, max: 7.5 } });
  assert.deepStrictEqual(rows.slice(1), [['Plays won', '0 of 40'], ['Your CPM', 'No plays won'], ['Floor CPM', '$5.50–$7.50']]);
});

test('PG and Preferred blocks: plays won, fixed CPM, no other buyers', () => {
  const rows = AV.dealBlockRows({ name: 'Wellness PG', dealType: 'Programmatic guaranteed', playsWon: 620, fixedCpm: 22, otherBuyers: 'None' });
  assert.deepStrictEqual(rows.slice(1), [['Plays won', '620'], ['Fixed CPM', '$22.00'], ['Other buyers', 'None']]);
});

test('change vs previous day uses arrows and percent', () => {
  assert.strictEqual(AV.changeText({ change: 12, percent: 8 }, false), '▲ 12 (8%)');
  assert.strictEqual(AV.changeText({ change: -45.5, percent: -6 }, true), '▼ $45.50 (6%)');
});

test('deals table: display type row, then its deals; Share on each', () => {
  const rows = AV.tableRows(F.dealsByDisplayType());
  assert.deepStrictEqual(rows.map((r) => r.kind), ['type', 'deal', 'deal', 'type', 'deal']);
  assert.strictEqual(rows[0].name, 'Window Portrait');
  assert.strictEqual(rows[0].share + rows[3].share, 100);
  assert.strictEqual(rows[1].dealType, 'Programmatic guaranteed');
  assert.strictEqual(rows[1].slotsText, '1 slot');
});

test('deal hover: description and only the advertiser’s own DSP deal ID', () => {
  const deal = F.dealsByDisplayType().groups[0].deals[0];
  const t = AV.dealNameTooltip(deal);
  assert.deepStrictEqual(t.rows.map((r) => r[0]), ['Description', 'DV360']);
});

test('share hover: plays won, all plays, advertiser count — never names', () => {
  const t = AV.shareTooltip(F.dealsByDisplayType().groups[0].deals[1]);
  assert.deepStrictEqual(t.rows.map((r) => r[0]), ['Plays won', 'All plays on the deal', 'Advertisers on the deal']);
  assert.strictEqual(t.rows[2][1], '3');
});

test('slots hover lists each assigned slot', () => {
  const t = AV.slotsTooltip(F.dealsByDisplayType().groups[0].deals[0]);
  assert.strictEqual(t.rows[0][0], 'Window loop · Zone A');
  assert.strictEqual(t.rows[0][1], 'Advertiser slot 2 (loop slot 3) · 12 plays per window');
});

test('display type hover is facts only and omits what is not stored', () => {
  const full = AV.displayTypeTooltip(F.dealsByDisplayType().groups[0].displayType);
  const keys = full.rows.map((r) => r[0]);
  assert.ok(keys.includes('IAB store zone') && keys.includes('Average footfall past a display per day'));
  const sparse = AV.displayTypeTooltip(F.dealsByDisplayType().groups[1].displayType);
  assert.ok(!sparse.rows.some((r) => /Average|Canvas|Creative/.test(r[0])));
});

test('sparkline covers the trend; scheduling text; variable chips', () => {
  assert.match(AV.sparkline(F.audience().trend, 240, 48), /^M0\.0 /);
  assert.strictEqual(AV.sparkline([{ assumedViews: 1 }], 240, 48), '');
  assert.strictEqual(AV.schedulingText({ uses: true, scheduledCampaigns: 3, campaigns: 4, schedules: 5 }), 'Dayparted · 3 of 4 campaigns · 5 schedules');
  assert.match(AV.schedulingText({ uses: false }), /^Not used yet\. Set dayparts and schedules/);
  assert.strictEqual(AV.variableLabel({ label: 'Visitor Segments', kind: 'Personalised', personalisationType: 'Audience' }), 'Visitor Segments · Audience');
  assert.strictEqual(AV.variableLabel({ label: 'Audience segment', kind: 'Personalised', personalisationType: 'Audience' }), 'Audience segment');
});

test('fixtures never carry another advertiser, downtime or a second DSP’s deal ID', () => {
  const all = JSON.stringify([F.delivery(), F.dealsByDisplayType(), F.audience(), F.myTargeting()]);
  assert.ok(!/advertiserId|downtime|lostRevenue|offline/i.test(all));
  F.dealsByDisplayType().groups.forEach((g) => g.deals.forEach((d) => assert.strictEqual(d.dealIds.length, 1)));
});

test('nice axis maxima', () => {
  assert.strictEqual(AV.niceMax(0), 1); assert.strictEqual(AV.niceMax(6780), 10000); assert.strictEqual(AV.niceMax(3751), 5000); assert.strictEqual(AV.niceMax(1500), 2000);
});
