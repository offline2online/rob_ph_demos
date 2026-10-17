// node --test Retail-media-insights/frontend/test
const test = require('node:test');
const assert = require('node:assert');
const AV = require('../advertiser-view.js');
const { get, ADVERTISER } = require('./api.js');

const mine = (path, params) => get(path, params, ADVERTISER);

test('both metric tiles start on and the last one on cannot be switched off', () => {
  let m = AV.initialMetrics();
  assert.deepStrictEqual(m, { plays: true, spend: true });
  m = AV.toggleMetric(m, 'plays');
  assert.deepStrictEqual(m, { plays: false, spend: true });
  assert.deepStrictEqual(AV.toggleMetric(m, 'spend'), { plays: false, spend: true });
  assert.deepStrictEqual(AV.toggleMetric(m, 'plays'), { plays: true, spend: true });
});

test('Deal drop-down: All deals, each deal by name and type, Open auction last', async () => {
  const o = AV.dealOptions(await mine('/delivery'));
  assert.deepStrictEqual(o.map((x) => x.label), ['All deals', 'Wellness PG · Programmatic guaranteed', 'Pharmacy Private · Private auction', 'Open auction']);
  assert.strictEqual(o[0].value, '');
});

test('Pacing switch only for a Programmatic guaranteed deal with pacing data', async () => {
  const d = await mine('/delivery');
  assert.strictEqual(AV.showPacingSwitch(d, 'd1'), true);
  assert.strictEqual(AV.showPacingSwitch(d, ''), false);
  assert.strictEqual(AV.showPacingSwitch(d, 'd3'), false);
  assert.strictEqual(AV.showPacingSwitch(d, 'open-auction'), false);
});

test('day hover: totals, a block per deal, then change vs previous day', async () => {
  const day = (await mine('/delivery')).days[10];
  const t = AV.dayTooltip(day);
  const keys = t.rows.map((r) => r[0]);
  assert.strictEqual(keys[0], 'Plays won'); assert.strictEqual(keys[1], 'Spend');
  assert.deepStrictEqual(t.rows.filter((r) => r[2] === 'head').map((r) => r[0]),
    ['Wellness PG · Programmatic guaranteed', 'Pharmacy Private · Private auction', 'Open auction · Open auction']);
  assert.deepStrictEqual(keys.slice(-2), ['Plays won vs previous day', 'Spend vs previous day']);
});

test('auction block: plays of all plays with share, your CPM, winning CPM avg and high, floor', () => {
  const rows = AV.dealBlockRows({ name: 'Pharmacy Auction', dealType: 'Private auction', playsWon: 32, allPlays: 114, sharePercent: 28, yourCpm: 9.4, winningCpm: { average: 9.18, highest: 10.11 }, floorCpm: { min: 9, max: 9 } });
  assert.deepStrictEqual(rows.slice(1), [['Plays won', '32 of 114 (28%)'], ['Your CPM', '$9.40'], ['Winning CPM', '$9.18 avg · $10.11 high'], ['Floor CPM', '$9.00']]);
});

test('no plays won, no winning CPM, floor range for the open auction', () => {
  const rows = AV.dealBlockRows({ name: 'Open auction', dealType: 'Open auction', playsWon: 0, allPlays: 40, floorCpm: { min: 5.5, max: 7.5 } });
  assert.deepStrictEqual(rows.slice(1), [['Plays won', '0 of 40'], ['Your CPM', 'No plays won'], ['Floor CPM', '$5.50–$7.50']]);
});

test('PG and Preferred blocks: plays won, fixed CPM, no other buyers', async () => {
  const pg = (await mine('/delivery')).days[0].deals.find((d) => d.dealType === 'Programmatic guaranteed');
  assert.deepStrictEqual(AV.dealBlockRows(pg).slice(1), [['Plays won', AV.fmtInt(pg.playsWon)], ['Fixed CPM', '$22.00'], ['Other buyers', 'None']]);
});

test('change vs previous day uses arrows and percent', () => {
  assert.strictEqual(AV.changeText({ change: 12, percent: 8 }, false), '▲ 12 (8%)');
  assert.strictEqual(AV.changeText({ change: -45.5, percent: -6 }, true), '▼ $45.50 (6%)');
});

test('deals table: display type row, then its deals; Share on each', async () => {
  const data = await mine('/deals-by-display-type');
  const rows = AV.tableRows(data);
  assert.strictEqual(rows[0].kind, 'type');
  assert.strictEqual(rows[0].name, 'Window Portrait');
  assert.ok(rows.filter((r) => r.kind === 'type').every((r, i, all) => i === 0 || r.name !== all[i - 1].name));
  const wellness = rows.find((r) => r.name === 'Wellness PG');
  assert.strictEqual(wellness.dealType, 'Programmatic guaranteed');
  assert.strictEqual(wellness.slotsText, '1 slot');
  assert.strictEqual(wellness.share, 100);
});

test('deal hover: description and only the advertiser’s own DSP deal ID', async () => {
  const groups = (await mine('/deals-by-display-type')).groups;
  groups.forEach((g) => g.deals.forEach((d) => assert.strictEqual(d.dealIds.length, 1)));
  const t = AV.dealNameTooltip(groups[0].deals[0]);
  assert.strictEqual(t.rows.length, 2);
  assert.strictEqual(t.rows[0][0], 'Description');
  assert.match(t.rows[1][0], /^Google DSP \(DV360\): PH-[A-Z0-9]{10}$/);
});

test('share hover: plays won, all plays, advertiser count — never names', async () => {
  const deal = (await mine('/deals-by-display-type')).groups[0].deals.find((d) => d.dealType === 'Private auction');
  const t = AV.shareTooltip({ ...deal, share: { playsWon: 5, allPlays: 20, advertisersOnDeal: 3 } });
  assert.deepStrictEqual(t.rows.map((r) => r[0]), ['Plays won', 'All plays on the deal', 'Advertisers on the deal']);
  assert.match(t.rows[2][1], /^\d+$/);
  // The back end omits allPlays and percent when exactly one other buyer won: the hover and the row still render.
  const bare = AV.shareTooltip({ ...deal, share: { playsWon: 5, advertisersOnDeal: 2 } });
  assert.deepStrictEqual(bare.rows.map((r) => r[0]), ['Plays won', 'Advertisers on the deal']);
  assert.ok(!JSON.stringify(bare).match(/NaN|undefined|not set/));
  const row = AV.tableRows({ groups: [{ displayType: { name: 'T' }, dealCount: 1, slots: 1, playsWon: 5, assumedViews: 1, spend: 1, deals: [{ ...deal, share: { playsWon: 5, advertisersOnDeal: 2 } }] }] })[1];
  assert.equal(row.share, undefined);
});

test('slots hover lists each assigned slot', async () => {
  const t = AV.slotsTooltip((await mine('/deals-by-display-type')).groups[0].deals[0]);
  assert.strictEqual(t.rows[0][0], 'Window loop · Zone A');
  assert.strictEqual(t.rows[0][1], 'Advertiser slot 1 (loop slot 2) · 12 plays per window');
});

test('display type hover is facts only and omits what is not stored', async () => {
  const full = AV.displayTypeTooltip((await mine('/deals-by-display-type')).groups[0].displayType);
  const keys = full.rows.map((r) => r[0]);
  assert.ok(keys.includes('IAB store zone') && keys.includes('Average footfall past a display per day'));
  assert.ok(keys.includes('Display orientation'));
  const sparse = AV.displayTypeTooltip({ id: 's', name: 'Sparse', iabZone: 'Checkout' });
  assert.deepStrictEqual(sparse.rows.map((r) => r[0]), ['IAB store zone']);
});

test('sparkline covers the trend; scheduling text; variable chips', async () => {
  assert.match(AV.sparkline((await mine('/audience')).trend, 240, 48), /^M0\.0 /);
  assert.strictEqual(AV.sparkline([{ assumedViews: 1 }], 240, 48), '');
  const targeting = await mine('/my-targeting');
  assert.strictEqual(AV.schedulingText(targeting.scheduling), 'Dayparted · 1 of 2 campaigns');
  assert.match(AV.schedulingText({ uses: false }), /^Not used yet\. Set dayparts and schedules/);
  assert.deepStrictEqual(targeting.variablesUsed.map((v) => AV.variableLabel(v)), ['State', 'Visitor Segments · Identified visitor']);
  assert.strictEqual(AV.variableLabel({ label: 'Audience segment', kind: 'Personalised', personalisationType: 'Audience' }), 'Audience segment');
});

test('the advertiser’s responses never carry another advertiser, downtime or a second DSP’s deal ID', async () => {
  const all = JSON.stringify([await mine('/delivery'), await mine('/deals-by-display-type'), await mine('/audience'), await mine('/my-targeting')]);
  assert.ok(!/advertiserId|downtime|lostRevenue|offline|Acme|Nova/i.test(all));
});

test('nice axis maxima', () => {
  assert.strictEqual(AV.niceMax(0), 1); assert.strictEqual(AV.niceMax(6780), 10000); assert.strictEqual(AV.niceMax(3751), 5000); assert.strictEqual(AV.niceMax(1500), 2000);
});
