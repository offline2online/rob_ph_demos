// node --test Retail-media-insights/frontend/test
const test = require('node:test');
const assert = require('node:assert');
const SC = require('../slot-charts.js');
const F = require('../fixtures.js');

const types = SC.typesById(F.displayTypes);
const typeOf = (r) => types[r.displayTypeId];
const flat = (m) => m.sections.flatMap((s) => s.rows.map((r) => r.join(': ') + (s.note ? '' : '')));
const text = (m) => JSON.stringify(m);
const val = (m, label) => { for (const s of m.sections) for (const r of s.rows) if (r[0] === label) return r[1]; };

test('display types read in shopper-journey order', () => {
  const names = SC.journeyOrder(F.slotValue.rows, typeOf).map((r) => types[r.displayTypeId].name);
  assert.deepStrictEqual(names, ['Window Portrait', 'Endcap Shelf-edge', 'Queue Screen', 'Dispensary Screen']);
});

test('a type with no zone sorts last', () => {
  const rows = [{ displayTypeId: 'x' }, { displayTypeId: 'window' }];
  const t = Object.assign({}, types, { x: { id: 'x', name: 'X' } });
  assert.deepStrictEqual(SC.journeyOrder(rows, (r) => t[r.displayTypeId]).map((r) => r.displayTypeId), ['window', 'x']);
});

test('display type card shows stored fields only, never opening times or IAB classification', () => {
  const full = SC.displayTypeCard(types.window, F.META);
  assert.strictEqual(val(full, 'Operating hours'), '24 hours');
  assert.strictEqual(val(full, 'Display canvas size'), '1080 × 1920 px');
  assert.strictEqual(val(full, 'Share of loop time'), '6s advertiser slot ÷ 60s loop = 10%');
  assert.match(text(full), /Averages across all 10 connected Window Portrait displays in 5 stores, 12 Sep – 11 Oct\./);
  const sparse = SC.displayTypeCard({ id: 's', name: 'Sparse', zone: 'Checkout', operatingHours: '08:00-22:00' }, F.META);
  assert.deepStrictEqual(flat(sparse), ['IAB store zone: Checkout']);
  assert.ok(!/08:00|Not set|Touch Point|VAC-d/.test(text(sparse)));
});

test('slot value hover: per slot per day = CPM x average views / 1000, totals add up', () => {
  F.slotValue.rows.forEach((r) => {
    const dt = types[r.displayTypeId];
    assert.ok(Math.abs(r.perSlotPerDay - r.effectiveCpm * dt.avgAssumedViewsPerSlotPerDay / 1000) < 0.005, r.displayTypeId);
    assert.ok(Math.abs(r.effectiveCpm - r.earnedRevenue / (r.assumedViews / 1000)) < 0.01, r.displayTypeId);
    assert.strictEqual(r.advertiserSlots, r.advertiserSlotsPerLoop * r.connectedDisplays);
  });
  const w = F.slotValue.rows.find((r) => r.displayTypeId === 'window');
  const m = SC.slotValueHover(w, types.window, F.META);
  assert.strictEqual(val(m, 'Effective CPM'), '$18.00 (total $8,640 earned on 480k assumed views, 12 Sep – 11 Oct)');
  assert.strictEqual(val(m, 'Floor CPM'), '$8.00');
  assert.strictEqual(val(m, 'Per slot per day'), '$3.60 (total $288 per day across 80 advertiser slots on 10 displays)');
  assert.strictEqual(m.title, 'Window Portrait');
});

test('slot allocation: advertiser + own = slots per loop and the loop adds up', () => {
  F.slotAllocation.rows.forEach((r) => {
    assert.strictEqual(r.advertiserSlots + r.ownContentSlots, r.slotsPerLoop);
    assert.strictEqual(r.advertiserSlots * r.advertiserSlotSeconds + r.ownContentSlots * r.ownContentSlotSeconds, r.loopSeconds);
  });
});

test('loop hovers read "8 x 6s = 48s (80% of the loop)"', () => {
  const w = F.slotAllocation.rows.find((r) => r.displayTypeId === 'window');
  const loop = SC.allocationHover(w, 'loop');
  assert.strictEqual(val(loop, 'Advertiser slots'), '8 × 6s = 48s (80% of the loop)');
  assert.strictEqual(val(loop, 'Own-content slots'), '4 × 3s = 12s (20% of the loop)');
  assert.strictEqual(val(loop, 'Total loop length'), '60s');
  assert.strictEqual(val(SC.allocationHover(w, 'advertiser'), 'Share of the loop per slot'), '6s ÷ 60s = 10%');
  assert.strictEqual(val(SC.allocationHover(w, 'own'), 'Time in the loop'), '4 × 3s = 12s (20% of the loop)');
});

test('amber threshold is 85% and no other rows qualify', () => {
  const hot = F.slotAllocation.rows.filter((r) => r.advertiserSlotsSoldPct >= SC.AMBER_AT).map((r) => r.displayTypeId).sort();
  assert.deepStrictEqual(hot, ['endcap', 'queue']);
});

test('missed revenue: sold + unsold + offline = all slots, unsold + downtime = total, rows sum to the total row', () => {
  const rows = F.missedRevenue.rows.concat([F.missedRevenue.total]);
  rows.forEach((r) => assert.strictEqual(r.slotsSold + r.slotsUnsold + r.slotsOffline, r.slotsTotal));
  ['slotsTotal', 'slotsSold', 'slotsUnsold', 'slotsOffline', 'unsoldValue', 'downtimeLostRevenue', 'connectedDisplays'].forEach((k) => {
    assert.strictEqual(F.missedRevenue.rows.reduce((a, r) => a + r[k], 0), F.missedRevenue.total[k], k);
  });
});

test('missed hover shows every value with its total and parts as displayed', () => {
  const t = F.missedRevenue.total;
  const m = SC.missedHover(t, null, F.META, true);
  const p = SC.missedParts(t);
  assert.strictEqual(p.total, t.unsoldValue + t.downtimeLostRevenue);
  assert.strictEqual(val(m, 'Total missed revenue'), `$${p.total.toLocaleString('en-US')} ($${p.unsold.toLocaleString('en-US')} unsold + $${p.downtime.toLocaleString('en-US')} downtime)`);
  assert.strictEqual(val(m, 'Floor CPM'), '$5.50–$9.00 by display type');
  assert.match(val(m, 'Fill'), /^76% \(total 8,484 of 11,100 advertiser slots sold\)$/);
  assert.match(text(m), /Totals across all 50 connected displays in 5 stores, 12 Sep – 11 Oct\./);
  const row = F.missedRevenue.rows.find((r) => r.displayTypeId === 'dispensary');
  const d = SC.missedHover(row, types.dispensary, F.META, false);
  assert.match(text(d), /Totals across all 5 connected Dispensary Screen displays in 5 stores/);
  assert.strictEqual(d.sections[0].rows.filter((r) => r[0] === 'Connected displays').length, 0); // not repeated under the card
});

test('yield DSPs always read DV360, The Trade Desk, Amazon DSP and never Direct', () => {
  SC.DEAL_TYPES.forEach((dt) => {
    const names = SC.dspOrder(F.yieldFor(dt).rows).map((r) => r.dsp);
    assert.deepStrictEqual(names, ['DV360', 'The Trade Desk', 'Amazon DSP']);
  });
  assert.deepStrictEqual(SC.DEAL_TYPES, ['Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction']);
});

test('no hover or tooltip names a specific opening time or an IAB zone on chart faces', () => {
  const all = [
    ...F.slotValue.rows.map((r) => SC.slotValueHover(r, typeOf(r), F.META)),
    ...F.missedRevenue.rows.map((r) => SC.missedHover(r, typeOf(r), F.META, false)),
    ...Object.values(types).map((t) => SC.displayTypeCard(t, F.META)),
  ].map(text).join('');
  assert.ok(!/\b\d{1,2}:\d{2}\b|\b(am|pm)\b/i.test(all));
  assert.ok(/24 hours/.test(all) && /Store opening hours/.test(all));
});

test('formatting helpers', () => {
  assert.strictEqual(SC.fmtLabelMoney(18), '$18');
  assert.strictEqual(SC.fmtLabelMoney(3.6), '$3.60');
  assert.strictEqual(SC.fmtCompact(812600), '812.6k');
  assert.strictEqual(SC.dateRange(F.META), '12 Sep – 11 Oct');
});

test('fixture fetch supports empty and error states', async () => {
  assert.deepStrictEqual((await F.fetchJson('slot-value', {}, { delay: 0, state: 'empty' })).rows, []);
  await assert.rejects(F.fetchJson('yield', {}, { delay: 0, state: 'error' }));
});
