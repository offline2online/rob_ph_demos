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

test('Deal drop-down: All deals, Open auction, then each deal as name (type)', async () => {
  const o = AV.dealOptions(await mine('/delivery'));
  assert.deepStrictEqual(o.map((x) => x.label), ['All deals', 'Open auction', 'Immune — winter launch (Programmatic guaranteed)', 'Health & wellness windows (Private auction)', 'Dispensary screens (Private auction)']);
  assert.strictEqual(o[0].value, '');
});

test('Pacing switch only for a Programmatic guaranteed deal with pacing data', async () => {
  const d = await mine('/delivery');
  assert.strictEqual(AV.showPacingSwitch(d, 'd1'), true);
  assert.strictEqual(AV.showPacingSwitch(d, ''), false);
  assert.strictEqual(AV.showPacingSwitch(d, 'd5'), false);
  assert.strictEqual(AV.showPacingSwitch(d, 'open-auction'), false);
});

test('day hover: totals, a block per deal, then change vs previous day', async () => {
  const day = (await mine('/delivery')).days[10];
  const t = AV.dayTooltip(day);
  const keys = t.rows.map((r) => r[0]);
  assert.strictEqual(keys[0], 'Plays won'); assert.strictEqual(keys[1], 'Spend');
  assert.deepStrictEqual(t.rows.filter((r) => r[2] === 'head').map((r) => r[0]),
    ['Immune — winter launch · Programmatic guaranteed', 'Health & wellness windows · Private auction', 'Dispensary screens · Private auction', 'Open auction · Open auction']);
  assert.deepStrictEqual(keys.slice(-2), ['Plays won vs previous day', 'Spend vs previous day']);
  assert.match(t.rows[t.rows.length - 2][1], /^(▲|▼) \d+%$|^0%$/);
  const none = AV.dayTooltip({ date: '2026-09-12', playsWon: 1, spend: 1, deals: [], vsPreviousDay: {} });
  assert.deepStrictEqual(none.rows.slice(-2), [['Plays won vs previous day', 'No plays the previous day'], ['Spend vs previous day', 'No spend the previous day']]);
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
  assert.deepStrictEqual(AV.dealBlockRows(pg).slice(1), [['Plays won', AV.fmtInt(pg.playsWon)], ['Fixed CPM', '$9.50'], ['Other buyers', 'None']]);
});

test('change vs previous day uses arrows and percent', () => {
  assert.strictEqual(AV.changeText({ change: 12, percent: 2 }), '▲ 2%');
  assert.strictEqual(AV.changeText({ change: -45.5, percent: -3 }), '▼ 3%');
  assert.strictEqual(AV.changeText({ change: 0, percent: 0 }), '0%');
  assert.strictEqual(AV.changeText(undefined), null);
});

test('deals table: display type row, then its deals; Share on each', async () => {
  const data = await mine('/deals-by-display-type');
  const rows = AV.tableRows(data);
  assert.strictEqual(rows[0].kind, 'type');
  assert.strictEqual(rows[0].name, 'Window Portrait');
  assert.ok(rows.filter((r) => r.kind === 'type').every((r, i, all) => i === 0 || r.name !== all[i - 1].name));
  const wellness = rows.find((r) => r.name === 'Immune — winter launch');
  assert.strictEqual(wellness.dealType, 'Programmatic guaranteed');
  assert.strictEqual(wellness.slotsText, '2 slots');
  assert.strictEqual(wellness.share, 100);
});

test('deal hover: description and only the advertiser’s own DSP deal ID', async () => {
  const groups = (await mine('/deals-by-display-type')).groups;
  groups.forEach((g) => g.deals.forEach((d) => assert.strictEqual(d.dealIds.length, 1)));
  const t = AV.dealNameTooltip(groups[0].deals[0]);
  assert.strictEqual(t.rows.length, 2);
  assert.strictEqual(t.rows[0][2], 'para');
  assert.strictEqual(t.rows[1][0], 'Deal ID');
  assert.match(t.rows[1][1], /^Google DSP \(DV360\): PH-[A-Z0-9]{10}$/);
});

test('share hover: plays won, all plays, advertiser count — never names', async () => {
  const deal = (await mine('/deals-by-display-type')).groups[0].deals.find((d) => d.dealType === 'Private auction');
  const t = AV.shareTooltip({ ...deal, share: { playsWon: 5, allPlays: 20, advertisersOnDeal: 3 } }, 'Window Portrait');
  assert.strictEqual(t.title, `${deal.name} · Window Portrait`);
  assert.deepStrictEqual(t.rows.map((r) => r[0]), ['Plays you won', 'All plays on this deal here', 'Advertisers on the deal']);
  assert.match(t.rows[2][1], /^\d+$/);
  // The back end omits allPlays and percent when exactly one other buyer won: the hover and the row still render.
  const bare = AV.shareTooltip({ ...deal, share: { playsWon: 5, advertisersOnDeal: 2 } });
  assert.deepStrictEqual(bare.rows.map((r) => r[0]), ['Plays you won', 'Advertisers on the deal']);
  assert.ok(!JSON.stringify(bare).match(/NaN|undefined|not set/));
  const row = AV.tableRows({ groups: [{ displayType: { name: 'T' }, dealCount: 1, slots: 1, playsWon: 5, assumedViews: 1, spend: 1, deals: [{ ...deal, share: { playsWon: 5, advertisersOnDeal: 2 } }] }] })[1];
  assert.equal(row.share, undefined);
});

test('slots hover: display type (description), playlist · zone, IAB zone, slot n of N and plays per window', async () => {
  const g = (await mine('/deals-by-display-type')).groups[0];
  const t = AV.slotsTooltip(g.deals[0], g.displayType);
  assert.strictEqual(t.title, 'Assigned slots');
  assert.deepStrictEqual(t.rows.slice(0, 4).map((r) => r[0]), ['Window Portrait (Portrait screen in the store window at the entrance)', 'Window loop · Store front', 'IAB zone: Entrance & out of category', 'Advertiser slot 1 (slot 1 of the loop) · 60 plays per window']);
  // When the back end supplies the loop's slot count the hover reads "slot n of N".
  const withN = AV.slotsTooltip({ slots: { assigned: [{ playlistZone: 'Window loop · Store front', advertiserSlot: 3, loopSlot: 3, loopSlotCount: 12, playsPerWindow: 10 }] } }, g.displayType);
  assert.strictEqual(withN.rows[3][0], 'Advertiser slot 3 (slot 3 of 12) · 10 plays per window');
});

test('display type hover matches the retailer card: paragraph, labelled facts, averages, footer', async () => {
  const t = AV.displayTypeTooltip((await mine('/deals-by-display-type')).groups[0].displayType);
  assert.strictEqual(t.rows[0][2], 'para');
  const rows = Object.fromEntries(t.rows.filter((r) => r[1]).map((r) => [r[0], r[1]]));
  assert.strictEqual(rows['Connected displays'], '10 across 5 stores');
  for (const k of ['IAB store zone', 'Operating hours', 'Touch Point', 'Display canvas size (resolution)', 'Display orientation', 'Creative formats', 'Share of loop time']) assert.ok(k in rows, k);
  assert.ok(!('Description' in rows) && !('Canvas' in rows) && !('Touch point' in rows));
  assert.deepStrictEqual(t.rows[t.rows.length - 1].slice(0, 3), ['Averages across all 10 connected Window Portrait displays in 5 stores, 12 Sep – 11 Oct.', '', 'note']);
});

test('pacing KPIs, targeting ladder and Audience model', async () => {
  const d = await mine('/delivery');
  assert.deepStrictEqual(AV.pacingKpis(AV.pacingFor(d, 'd1')).map((k) => k[0]), ['Delivered', 'Guaranteed to date', 'Guaranteed whole flight', 'Pacing']);
  assert.deepStrictEqual(AV.ladderRungs('Localised').map((r) => [r.name, r.here, r.next, r.above]), [['Personalised', false, true, true], ['Localised', true, false, false], ['Default only', false, false, false]]);
  assert.ok(!AV.ladderRungs('Personalised').some((r) => r.next));
  const a = await mine('/audience');
  const m = AV.audienceModel(a, { dateFrom: '2026-09-12', dateTo: '2026-10-11' });
  assert.strictEqual(m.caption, 'Assumed views (VAC-d) delivered, 12 Sep – 11 Oct');
  assert.strictEqual(m.hero, AV.fmtCompact(a.assumedViews));
  const peak = AV.peakOf(a.trend);
  assert.ok(m.tip[0].includes(`the peak was ${AV.fmtCompact(peak.assumedViews)} on `));
  assert.strictEqual(AV.fmtCompact(551234), '551k'); assert.strictEqual(AV.fmtCompact(17712), '17.7k');
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
  assert.strictEqual(AV.schedulingText(targeting.scheduling), 'Dayparted · 3 of 4 campaigns · 5 schedules');
  assert.strictEqual(AV.schedulingText({ uses: false }), null);
  assert.match(AV.NO_SCHEDULING, /^Not used yet\. Set dayparts and schedules/);
  assert.deepStrictEqual(targeting.variablesUsed.map((v) => AV.variableLabel(v)), ['Display Tag(s)', 'Fixed Store Segments', 'Gender (Computer Vision)', 'Reason for Visit (Aggregate)', 'Store Open / Closed', 'Variable Store Segments']);
  assert.strictEqual(AV.variableLabel({ label: 'Audience segment', kind: 'Personalised', personalisationType: 'Audience' }), 'Audience segment');
});

test('the advertiser’s responses never carry another advertiser, downtime or a second DSP’s deal ID', async () => {
  const all = JSON.stringify([await mine('/delivery'), await mine('/deals-by-display-type'), await mine('/audience'), await mine('/my-targeting')]);
  assert.ok(!/advertiserId|downtime|lostRevenue|offline|Haleon|Unilever/i.test(all));
});

test('nice axis maxima', () => {
  assert.strictEqual(AV.niceMax(0), 1); assert.strictEqual(AV.niceMax(6780), 10000); assert.strictEqual(AV.niceMax(3751), 5000); assert.strictEqual(AV.niceMax(1500), 2000);
});
