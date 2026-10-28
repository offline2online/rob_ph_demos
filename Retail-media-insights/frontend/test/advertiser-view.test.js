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
  assert.deepStrictEqual(o.map((x) => x.label), ['All deals', 'Open auction', 'Immune — winter launch (Programmatic guaranteed)']);
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
    ['Immune — winter launch · Programmatic guaranteed', 'Open auction · Open auction']);
  assert.deepStrictEqual(keys.slice(-2), ['Plays won vs previous day', 'Spend vs previous day']);
  assert.match(t.rows[t.rows.length - 2][1], /^(▲|▼) \d+%$|^0%$/);
  const none = AV.dayTooltip({ date: '2026-09-12', playsWon: 1, spend: 1, deals: [], vsPreviousDay: {} });
  assert.deepStrictEqual(none.rows.slice(-2), [['Plays won vs previous day', 'No plays the previous day'], ['Spend vs previous day', 'No spend the previous day']]);
});

test('auction block: plays of all plays with share, your CPM, winning CPM range, floor', () => {
  const rows = AV.dealBlockRows({ name: 'Pharmacy Auction', dealType: 'Private auction', playsWon: 32, allPlays: 114, sharePercent: 28, yourCpm: 9.4, winningCpm: { p25: 8.4, median: 9.1, p75: 9.9 }, floorCpm: { min: 9, max: 9 } });
  assert.deepStrictEqual(rows.slice(1), [['Plays won', '32 of 114 (28%)'], ['Your CPM', '$9.40'], ['Winning CPM', '$8.40 – $9.90 (middle $9.10)'], ['Floor CPM', '$9.00']]);
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

test('deal hover: description, type, rate, flight, own DSP deal ID, per-slot totals and the deal total', async () => {
  const groups = (await mine('/deals-by-display-type')).groups;
  groups.forEach((g) => g.deals.filter((d) => d.dealType !== 'Open auction').forEach((d) => assert.strictEqual(d.dealIds.length, 1)));
  const deal = groups[0].deals.find((d) => d.dealType !== 'Open auction');
  const t = AV.dealNameTooltip(deal);
  const keys = t.rows.map((r) => r[0]);
  assert.strictEqual(t.rows[0][2], 'para');
  for (const k of ['Deal type', 'Rate', 'Flight', 'Period', 'Deal ID', 'Over the whole flight', 'Deal total']) assert.ok(keys.includes(k), k);
  assert.strictEqual(t.rows.find((r) => r[0] === 'Deal type')[1], 'Programmatic guaranteed');
  assert.match(t.rows.find((r) => r[0] === 'Rate')[1], /^\$\d+\.\d\d CPM fixed$/);
  assert.match(t.rows.find((r) => r[0] === 'Google DSP (DV360)')[1], /^PH-[A-Z0-9]{10}$/);
  assert.match(t.rows.find((r) => r[0] === 'Deal total')[1], /plays · .* assumed views · USD /);
  const slotRows = t.rows.filter((r) => / · slot \d+$/.test(r[0]));
  assert.ok(slotRows.length >= 1 && slotRows.length <= 5);
  slotRows.forEach((r) => assert.match(r[1], /plays · .* assumed views/));
  const many = { ...deal, terms: { ...deal.terms, slots: Array.from({ length: 7 }, (_, i) => ({ displayType: 'X', advertiserSlot: i + 1, termPlays: 1, termVacd: 1, termValue: 1 })) } };
  const m = AV.dealNameTooltip(many);
  assert.strictEqual(m.rows.filter((r) => / · slot \d+$/.test(r[0])).length, 5);
  assert.ok(m.rows.some((r) => r[0] === '+ 2 more slots'));
});

test('a direct advertiser’s deal hover shows the PH deal ID under Direct (no DSP) and the page has no Open auction', async () => {
  const loreal = { principalType: 'advertiser', principalId: 'adv-loreal-paris', scopes: ['insights:read'] };
  const data = await get('/deals-by-display-type', {}, loreal);
  const rows = data.groups.flatMap((g) => g.deals);
  assert.ok(rows.length > 0 && !rows.some((d) => d.dealType === 'Open auction'));
  const t = AV.dealNameTooltip(rows[0]);
  assert.match(t.rows.find((r) => r[0] === 'Direct (no DSP)')[1], /^PH-[A-Z0-9]{10}$/);
  assert.ok(!t.rows.some((r) => /DV360|Trade Desk|Amazon/.test(r[0])));
  assert.strictEqual(t.rows.find((r) => r[0] === 'Deal type')[1], 'Direct advertiser');
  const delivery = await get('/delivery', {}, loreal);
  assert.ok(!delivery.dealOptions.some((o) => o.dealId === 'open-auction'));
  assert.ok(!delivery.days.some((day) => day.deals.some((b) => b.dealType === 'Open auction')));
  assert.strictEqual(AV.showRangeColumn(AV.tableRows(data)), false);
});

test('Winning CPM range only on Open auction rows; the column hides when no row has one', async () => {
  const data = await mine('/deals-by-display-type');
  const rows = AV.tableRows(data);
  rows.forEach((r) => { if (r.range) assert.strictEqual(r.dealType, 'Open auction'); });
  rows.filter((r) => r.kind === 'type').forEach((r) => assert.strictEqual(r.range, ''));
  assert.strictEqual(AV.showRangeColumn(rows), rows.some((r) => r.dealType === 'Open auction' && r.range));
  assert.strictEqual(AV.showRangeColumn([{ range: '' }]), false);
  assert.strictEqual(AV.showRangeColumn([{ range: '' }, { range: '$1.00 – $2.00' }]), true);
});

test('Delivery day hover shows launch deal types only', async () => {
  const day = (await mine('/delivery')).days[0];
  const t = AV.dayTooltip({ ...day, deals: day.deals.concat([{ name: 'P', dealType: 'Private auction', playsWon: 1 }, { name: 'F', dealType: 'Preferred deal', playsWon: 1, otherBuyers: 'None' }]) });
  assert.ok(!t.rows.some((r) => /Private auction|Preferred deal/.test(r[0])));
});

test('share hover: plays won, all plays, advertiser count — never names', async () => {
  const deal = (await mine('/deals-by-display-type')).groups[0].deals.find((d) => d.dealType !== 'Open auction');
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
  assert.deepStrictEqual(t.rows.slice(0, 4).map((r) => r[0]), ['Window Portrait (Portrait screen in the store window at the entrance)', 'Window loop · Store front', 'IAB zone: Entrance & out of category', 'Advertiser slot 1 (slot 1 of 12) · 60 plays per window']);
  // When the back end supplies the loop's slot count the hover reads "slot n of N".
  const withN = AV.slotsTooltip({ slots: { assigned: [{ playlistZone: 'Window loop · Store front', advertiserSlot: 3, loopSlot: 3, loopSlotCount: 12, playsPerWindow: 10 }] } }, g.displayType);
  assert.strictEqual(withN.rows[3][0], 'Advertiser slot 3 (slot 3 of 12) · 10 plays per window');
});

test('display type hover matches the retailer card: paragraph, assumed views averages, share of loop time, footer', async () => {
  const t = AV.displayTypeTooltip((await mine('/deals-by-display-type')).groups[0].displayType);
  assert.strictEqual(t.rows[0][2], 'para');
  const rows = Object.fromEntries(t.rows.filter((r) => r[1]).map((r) => [r[0], r[1]]));
  for (const k of ['Connected displays', 'IAB store zone', 'Operating hours', 'Touch Point', 'Display canvas size (resolution)', 'Display orientation', 'Creative formats']) assert.ok(!(k in rows), `${k} removed`);
  for (const k of ['Average assumed views per slot per day', 'Average footfall past a display per day', 'Average visibility adjustment', 'Share of loop time']) assert.ok(k in rows, k);
  assert.deepStrictEqual(t.rows[t.rows.length - 1].slice(0, 3), ['Averages across all 10 connected Window Portrait displays in 5 stores, 12 Sep – 11 Oct.', '', 'note']);
});

test('pacing KPIs, targeting ladder and Audience model', async () => {
  const d = await mine('/delivery');
  assert.deepStrictEqual(AV.pacingKpis(AV.pacingFor(d, 'd1')).map((k) => k[0]), ['Delivered', 'Guaranteed to date', 'Guaranteed whole flight', 'Pacing']);
  assert.deepStrictEqual(AV.ladderRungs('Localised').map((r) => [r.name, r.here, r.next, r.above]), [['Personalised', false, true, true], ['Localised', true, false, false], ['Default only', false, false, false]]);
  assert.ok(!AV.ladderRungs('Personalised').some((r) => r.next));
  const a = await mine('/audience');
  const m = AV.audienceModel(a, { dateFrom: '2026-09-12', dateTo: '2026-10-11' });
  assert.strictEqual(m.caption, 'Assumed views delivered, 12 Sep – 11 Oct');
  assert.strictEqual(m.hero, AV.fmtBig(a.assumedViews));
  const peak = AV.peakOf(a.trend);
  assert.ok(m.tip[0].includes(`the peak was ${AV.fmtBig(peak.assumedViews)} on `));
  assert.strictEqual(AV.fmtCompact(551234), '551k'); assert.strictEqual(AV.fmtCompact(17712), '17.7k');
});

test('display type hover is facts only and omits what is not stored', async () => {
  const full = AV.displayTypeTooltip((await mine('/deals-by-display-type')).groups[0].displayType);
  assert.ok(full.rows.map((r) => r[0]).includes('Average footfall past a display per day'));
  const sparse = AV.displayTypeTooltip({ id: 's', name: 'Sparse', iabZone: 'Checkout', description: 'A screen.' });
  assert.deepStrictEqual(sparse.rows.map((r) => r[0]), ['A screen.']);
});

test('sparkline covers the trend; scheduling text; variable chips', async () => {
  assert.match(AV.sparkline((await mine('/audience')).trend, 240, 48), /^M0\.0 /);
  assert.strictEqual(AV.sparkline([{ assumedViews: 1 }], 240, 48), '');
  const targeting = await mine('/my-targeting');
  assert.strictEqual(AV.schedulingText(targeting.scheduling), 'Scheduled');
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

test('table rows: the Open auction row shows its slot count and every slots hover lists each slot; type rows carry a slots hover', () => {
  const slot = (n) => ({ playlistZone: 'Checkout loop · Tills', advertiserSlot: n, loopSlot: n, loopSlotCount: 6, playsPerWindow: 10 });
  const dt = { id: 'queue', name: 'Queue Screen', description: 'In-queue screen.' };
  const data = { groups: [{ displayType: dt, dealCount: 1, slots: 3, slotsAssigned: [slot(1), slot(2), slot(3)], playsWon: 1, assumedViews: 1, spend: 1, sharePercent: 100, deals: [
    { id: 'open-auction', name: 'Open auction', dealType: 'Open auction', slots: { count: 2, assigned: [slot(4), slot(5)] }, playsWon: 1, assumedViews: 1, spend: 1 },
  ] }] };
  const rows = AV.tableRows(data);
  assert.strictEqual(rows[1].slotsText, '2 slots');
  assert.strictEqual(rows[1].slotsTip.rows.filter((r) => /^Advertiser slot/.test(r[0])).length, 2);
  assert.match(rows[1].slotsTip.rows.find((r) => /^Advertiser slot 4/.test(r[0]))[0], /^Advertiser slot 4 \(slot 4 of 6\) · 10 plays per window$/);
  assert.strictEqual(rows[0].slotsTip.rows.filter((r) => /^Advertiser slot/.test(r[0])).length, 3);
  assert.ok(!JSON.stringify(rows).includes('VAC-d'));
});
