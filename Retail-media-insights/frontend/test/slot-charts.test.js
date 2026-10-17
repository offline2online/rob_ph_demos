// node --test Retail-media-insights/frontend/test
const test = require('node:test');
const assert = require('node:assert');
const SC = require('../slot-charts.js');
const { get, RANGE } = require('./api.js');

const val = (m, label) => { for (const s of m.sections) for (const r of s.rows) if (r[0] === label) return r[1]; };
const text = (m) => JSON.stringify(m);
const typesP = get('/display-types').then(SC.typesById);

test('display types read in shopper-journey order from the back end’s iabZone', async () => {
  const types = await typesP;
  const names = SC.journeyOrder((await get('/slot-value')).rows.slice().reverse(), (r) => types[r.id]).map((r) => r.name);
  assert.deepStrictEqual(names, ['Window Portrait', 'Endcap Shelf-edge', 'Queue Screen', 'Dispensary Screen']);
  assert.deepStrictEqual(SC.journeyOrder([{ id: 'x' }, { id: 'window' }], (r) => ({ x: { iabZone: undefined }, window: types.window })[r.id]).map((r) => r.id), ['window', 'x']);
});

test('display type card shows stored fields only, never opening times; canvas and orientation are labelled and constrained', async () => {
  const types = await typesP;
  const full = SC.displayTypeCard(types.window, RANGE);
  assert.strictEqual(val(full, 'Operating hours'), '24 hours');
  assert.strictEqual(val(full, 'Display canvas size (resolution)'), '1080 × 1920 px');
  assert.strictEqual(val(full, 'Display orientation'), '90°');
  assert.strictEqual(val(full, 'Share of loop time'), '6s advertiser slot ÷ 60s loop = 10%');
  assert.strictEqual(val(full, 'Connected displays'), '10 across 5 stores');
  assert.match(text(full), /Averages across all 10 connected Window Portrait displays in 5 stores, 12 Sep – 11 Oct\./);
  const sparse = SC.displayTypeCard({ id: 's', name: 'Sparse', iabZone: 'Checkout', operatingHours: '08:00-22:00' }, RANGE);
  assert.deepStrictEqual(sparse.sections[0].rows, [['IAB store zone', 'Checkout']]);
  assert.ok(!/08:00/.test(text(sparse)));
  ['Not set', '90°', '180°', '270°'].forEach((o) => assert.strictEqual(SC.orientationText(o), o));
  assert.strictEqual(SC.orientationText('45°'), 'Not set');
});

test('slot value: the hover shows the back end’s link, CPM × average views ÷ 1,000 × sold share', async () => {
  const data = await get('/slot-value');
  data.rows.forEach((r) => {
    const link = r.effectiveCpm * r.averageAssumedViewsPerSlotPerDay / 1000 * r.advertiserSlotsSoldShare;
    assert.ok(Math.abs(link - r.perSlotPerDay) < 0.01, `${r.id}: ${link} vs ${r.perSlotPerDay}`);
  });
  const w = data.rows.find((r) => r.id === 'window');
  const m = SC.slotValueHover(w, RANGE);
  assert.strictEqual(m.title, 'Window Portrait');
  assert.strictEqual(val(m, 'Effective CPM'), `$${w.effectiveCpm.toFixed(2)} (total $${w.totals.earnedRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })} earned on ${SC.fmtCompact(w.totals.assumedViews)} assumed views, 12 Sep – 11 Oct)`);
  assert.strictEqual(val(m, 'Floor CPM'), '$12.00');
  assert.match(val(m, 'Per slot per day'), /^\$\d+\.\d\d \(total \$\d+ per day across 80 advertiser slots on 10 displays\)$/);
  assert.match(val(m, 'How it adds up'), /^\$15\.55 CPM × 200 average assumed views ÷ 1,000 × \d+(\.\d+)?% of advertiser slots sold = \$1\.95$/);
  assert.match(text(m), /× the share of advertiser slots sold/);
});

test('CPM labels are always to the cent', () => {
  assert.strictEqual(SC.fmtLabelMoney(18), '$18.00');
  assert.strictEqual(SC.fmtLabelMoney(3.6), '$3.60');
  assert.strictEqual(SC.fmtLabelMoney(15.555), '$15.56');
});

test('slot allocation: advertiser + own = slots per loop; loop shares are the back end’s and never re-rounded', async () => {
  const rows = (await get('/slot-allocation')).rows;
  rows.forEach((r) => {
    assert.strictEqual(r.advertiserSlots.count + r.ownContentSlots.count, r.slotsPerLoop);
    assert.strictEqual(r.advertiserSlots.totalSeconds + r.ownContentSlots.totalSeconds, r.loopSeconds);
    assert.strictEqual(r.advertiserSlots.percentOfLoop + r.ownContentSlots.percentOfLoop, 100);
  });
  const q = rows.find((r) => r.id === 'queue'); // 60s + 30s of a 90s loop: 67% + 33%, not 66.7 / 33.3 recomputed
  const loop = SC.allocationHover(q, 'loop');
  assert.strictEqual(val(loop, 'Advertiser slots'), '6 × 10s = 60s (67% of the loop)');
  assert.strictEqual(val(loop, 'Own-content slots'), '2 × 15s = 30s (33% of the loop)');
  assert.strictEqual(val(loop, 'Total loop length'), '90s');
  assert.strictEqual(val(loop, 'Average slot duration'), '11.3s');
  assert.strictEqual(val(SC.allocationHover(q, 'advertiser'), 'Share of the loop per slot'), '10s ÷ 90s = 11%');
  assert.strictEqual(val(SC.allocationHover(q, 'own'), 'Time in the loop'), '2 × 15s = 30s (33% of the loop)');
});

test('column definitions exist for every Slot allocation heading', () => {
  ['Display type', 'Slots per loop', 'Advertiser slots', 'Own-content slots', 'Advertiser slots sold'].forEach((c) => assert.ok(SC.COLUMN_TIPS[c].length > 20, c));
});

test('amber threshold is 85%: Queue Screen is amber and the others are not', async () => {
  const hot = (await get('/slot-allocation')).rows.filter((r) => r.advertiserSlotsSoldPercent >= SC.AMBER_AT).map((r) => r.id);
  assert.deepStrictEqual(hot, ['queue']);
});

test('missed revenue: sold + unsold + offline = all slots, unsold + downtime = total, rows sum to the total row', async () => {
  const d = await get('/missed-revenue');
  d.rows.concat([d.total]).forEach((r) => {
    assert.strictEqual(r.slotsSold + r.slotsUnsold + r.slotsOffline, r.slotsTotal);
    assert.strictEqual(r.unsoldValueAtFloor + r.downtimeLostRevenue, r.totalMissed);
  });
  ['slotsTotal', 'slotsSold', 'slotsUnsold', 'slotsOffline', 'unsoldValueAtFloor', 'downtimeLostRevenue', 'totalMissed'].forEach((k) => {
    assert.strictEqual(d.rows.reduce((a, r) => a + r[k], 0), d.total[k], k);
  });
  assert.strictEqual(d.total.connectedDisplays.displays, d.rows.reduce((a, r) => a + r.connectedDisplays.displays, 0));
  assert.strictEqual(SC.missedParts(d.total).total, d.total.totalMissed);
});

test('missed hover shows every value as the back end returned it, with the store count per display type', async () => {
  const types = await typesP;
  const d = await get('/missed-revenue', { storeIds: ['store-1'] });
  const t = SC.missedHover(d.total, null, RANGE, true);
  const p = SC.missedParts(d.total);
  assert.strictEqual(val(t, 'Total missed revenue'), `$${p.total.toLocaleString('en-US')} ($${p.unsold.toLocaleString('en-US')} unsold + $${p.downtime.toLocaleString('en-US')} downtime)`);
  assert.strictEqual(val(t, 'Floor CPM'), '$6.00–$12.00 by display type');
  assert.match(val(t, 'Fill'), new RegExp(`^${d.total.fillPercent}% \\(total [\\d,]+ of [\\d,]+ advertiser slots sold\\)$`));
  assert.match(text(t), /Totals across all 10 connected displays in 1 store, 12 Sep – 11 Oct\./);
  const row = d.rows.find((r) => r.id === 'dispensary');
  const m = SC.missedHover(row, types.dispensary, RANGE, false);
  assert.match(text(m), /Totals across all 1 connected Dispensary Screen displays in 1 store/);
  assert.strictEqual(m.sections.flatMap((s) => s.rows).filter((r) => r[0] === 'Connected displays').length, 1, 'shown once, not repeated under the card');
});

test('missed revenue hover store count is per display type, not the page total', async () => {
  const d = await get('/missed-revenue');
  const rows = d.rows.map((r) => r.connectedDisplays.stores);
  assert.ok(rows.every((s) => s === 5));
  const filtered = await get('/missed-revenue', { storeIds: ['store-1', 'store-2'] });
  assert.ok(filtered.rows.every((r) => r.connectedDisplays.stores === 2));
});

test('yield: DSPs read DV360, The Trade Desk, Amazon DSP; a DSP with no delivery shows "No delivery", never NaN', async () => {
  const d = await get('/yield', { dealType: 'Programmatic guaranteed' });
  assert.deepStrictEqual(SC.dspOrder(d.rows.slice().reverse()).map((r) => r.dsp), ['DV360', 'The Trade Desk', 'Amazon DSP']);
  const none = d.rows.find((r) => r.effectiveCpm === null);
  assert.ok(none, 'the test retailer has a DSP with no Programmatic guaranteed delivery');
  const m = SC.yieldHover(none, 'Programmatic guaranteed', RANGE);
  assert.strictEqual(val(m, 'Effective CPM'), 'No delivery');
  assert.ok(!/NaN|null|undefined/.test(JSON.stringify(m.sections)));
  const live = SC.yieldHover(d.rows.find((r) => r.effectiveCpm !== null), 'Programmatic guaranteed', RANGE);
  assert.match(val(live, 'Effective CPM'), /^\$22\.00$/);
  assert.deepStrictEqual(SC.DEAL_TYPES, ['Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction']);
});

test('the Yield and Missed revenue ⓘ carry the VAC-d explanation and the worked example', () => {
  for (const k of ['slotValue', 'missed', 'yield']) {
    assert.match(SC.TIPS[k], /VAC-d/);
    assert.match(SC.TIPS[k], /Example: 4,000 footfall × 0\.5 visibility × 1\/10 of the loop = 200/);
  }
});

test('no hover names a specific opening time', async () => {
  const types = await typesP;
  const all = [
    ...(await get('/slot-value')).rows.map((r) => SC.slotValueHover(r, RANGE)),
    ...Object.values(types).map((t) => SC.displayTypeCard(t, RANGE)),
  ].map(text).join('');
  assert.ok(!/\b\d{1,2}:\d{2}\b|\b(am|pm)\b/i.test(all));
  assert.ok(/24 hours/.test(all) && /Store opening hours/.test(all));
});

test('formatting helpers', () => {
  assert.strictEqual(SC.fmtCompact(812600), '812.6k');
  assert.strictEqual(SC.dateRange(RANGE), '12 Sep – 11 Oct');
});
