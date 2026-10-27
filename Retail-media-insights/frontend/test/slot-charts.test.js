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

test('display type card shows the description, operating hours and labelled averages only; other facts are not repeated in the hover', async () => {
  const types = await typesP;
  const full = SC.displayTypeCard(types.window, RANGE);
  ['Connected displays', 'IAB store zone', 'Touch Point', 'Display canvas size (resolution)', 'Display orientation', 'Creative formats'].forEach((k) => assert.strictEqual(val(full, k), undefined, k));
  assert.strictEqual(val(full, 'Operating hours'), '24 hours');
  assert.strictEqual(val(full, 'Share of loop time'), '6s advertiser slot ÷ 60s loop = 10%');
  const noLoop = SC.displayTypeCard(types.window, RANGE, { omitShareOfLoop: true }); // Slot value's name hover
  assert.strictEqual(val(noLoop, 'Share of loop time'), undefined);
  assert.ok(val(noLoop, 'Average footfall past a display per day') && val(noLoop, 'Average visibility adjustment') && val(noLoop, 'Average assumed views (VAC-d) per slot per day'));
  assert.match(text(full), /Averages across all 10 connected Window Portrait displays in 5 stores, 12 Sep – 11 Oct\./);
  const sparse = SC.displayTypeCard({ id: 's', name: 'Sparse', iabZone: 'Checkout', operatingHours: '08:00-22:00' }, RANGE);
  assert.deepStrictEqual(sparse.sections, []); // a specific time is never shown
  assert.deepStrictEqual(SC.displayTypeCard({ id: 's', name: 'S', operatingHours: 'Custom hours' }, RANGE).sections, [{ rows: [['Operating hours', 'Custom hours']], lead: true }]);
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
  assert.strictEqual(val(m, 'Floor CPM'), '$7.50');
  assert.match(val(m, 'Revenue per available slot'), /^\$\d+\.\d\d \(total \$\d+ per day across 80 advertiser slots on 10 displays\)$/);
  const line = /^\$(\d+\.\d\d) CPM × ([\d,.]+) average assumed views ÷ 1,000 × (\d+)% of advertiser slot capacity earned \(settled billing\) = \$(\d+\.\d\d)$/.exec(val(m, 'How it adds up'));
  assert.ok(line, val(m, 'How it adds up'));
  // The line adds up as displayed: the result is computed from the displayed factors.
  assert.strictEqual(line[4], (+line[1] * +line[2].replace(/,/g, '') / 1000 * (+line[3] / 100)).toFixed(2));
  assert.match(val(m, 'Fill'), /^\d+% of advertiser slot capacity earned/);
  assert.match(text(m), /Revenue per available slot = effective CPM × average assumed views per slot per day ÷ 1,000 × fill/);
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
  const q = rows.find((r) => r.id === 'queue'); // 18s + 12s of a 30s loop: 60% + 40%
  const loop = SC.allocationHover(q, 'loop');
  assert.strictEqual(val(loop, 'Advertiser slots'), '3 × 6s = 18s (60% of the loop)');
  assert.strictEqual(val(loop, 'Own-content slots'), '3 × 4s = 12s (40% of the loop)');
  assert.strictEqual(val(loop, 'Total loop length'), '30s');
  assert.strictEqual(val(loop, 'Average slot duration'), '5.0s');
  assert.strictEqual(val(loop, 'Slots per loop'), '6');
  assert.strictEqual(loop.title, 'Queue Screen: loop');
  assert.strictEqual(val(SC.allocationHover(q, 'advertiser'), 'Share of loop per slot'), '6s ÷ 30s = 20%');
  assert.strictEqual(val(SC.allocationHover(q, 'advertiser'), 'Time in the loop'), '3 × 6s = 18s of the 30s loop (60%)');
  assert.strictEqual(val(SC.allocationHover(q, 'advertiser'), 'Advertiser slots'), '3');
  assert.strictEqual(SC.allocationHover(q, 'advertiser').title, 'Queue Screen: advertiser slots');
  assert.strictEqual(SC.allocationHover(q, 'own').title, 'Queue Screen: own-content slots');
  assert.strictEqual(val(SC.allocationHover(q, 'own'), 'Time in the loop'), '3 × 4s = 12s of the 30s loop (40%)');
  assert.strictEqual(val(SC.allocationHover(q, 'own'), 'Own-content slots'), '3');
});

test('column definitions exist for every Slot allocation heading', () => {
  ['Display type', 'Slots per loop', 'Advertiser slots', 'Own-content slots'].forEach((c) => assert.ok(SC.COLUMN_TIPS[c].length > 20, c));
});

test('Slot allocation has no sold column: COLUMN_TIPS lists only the four headings and the amber threshold is gone', () => {
  assert.deepStrictEqual(Object.keys(SC.COLUMN_TIPS), ['Display type', 'Slots per loop', 'Advertiser slots', 'Own-content slots']);
  assert.strictEqual(SC.AMBER_AT, undefined);
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
  assert.strictEqual(val(t, 'Floor CPM'), '$5.50–$7.50 by display type');
  assert.match(val(t, 'Fill'), new RegExp(`^${d.total.fillPercent}% \\(total [\\d,]+ of [\\d,]+ advertiser slots sold\\)$`));
  assert.match(text(t), /Totals across all 10 connected displays in 1 store, 12 Sep – 11 Oct\./);
  const row = d.rows.find((r) => r.id === 'dispensary');
  assert.match(val(SC.missedHover(row, types.dispensary, RANGE, false), 'Floor CPM'), /^\$\d+\.\d\d per 1,000 assumed views \(VAC-d\)$/);
  const m = SC.missedHover(row, types.dispensary, RANGE, false);
  assert.match(text(m), /Totals across all 1 connected Dispensary Screen displays in 1 store/);
  assert.strictEqual(m.sections.flatMap((s) => s.rows).filter((r) => r[0] === 'Connected displays').length, 0, 'not shown in the missed revenue hover');
});

test('missed revenue & fill: rows follow the Slot value order; the stack is the back end’s counts and adds to 100%', async () => {
  const d = await get('/missed-revenue');
  const sv = await get('/slot-value');
  const leaders = SC.metricOrder(sv.rows, 'cpm');
  const ids = SC.missedOrder(d.rows.slice().reverse(), leaders, () => null).map((r) => r.id);
  assert.deepStrictEqual(ids, leaders.map((r) => r.id).filter((id) => ids.includes(id)));
  d.rows.concat([d.total]).forEach((r) => {
    const s = SC.missedShares(r);
    assert.ok(Math.abs(s.filled + s.unsold + s.down - 100) < 1e-9, r.name || 'total');
    assert.ok(Math.abs(s.filled - 100 * r.slotsSold / r.slotsTotal) < 1e-9);
  });
  const w = d.rows.find((r) => r.id === 'window');
  assert.strictEqual(SC.missedAria('Window Portrait', w), `Window Portrait: ${w.fillPercent}% filled, $${w.unsoldValueAtFloor.toLocaleString('en-US')} unsold, $${w.downtimeLostRevenue.toLocaleString('en-US')} lost to downtime`);
});

test('missed revenue hover store count is per display type, not the page total', async () => {
  const d = await get('/missed-revenue');
  const rows = d.rows.map((r) => r.connectedDisplays.stores);
  assert.ok(rows.every((s) => s === 5));
  const filtered = await get('/missed-revenue', { storeIds: ['store-1', 'store-2'] });
  assert.ok(filtered.rows.every((r) => r.connectedDisplays.stores === 2));
});

test('yield: all deal types by default, only DSPs with delivery, highest effective CPM first, in each DSP’s shade', async () => {
  const d = await get('/yield');
  assert.strictEqual(d.dealType, null);
  const rows = SC.yieldRows(d.rows.slice().reverse());
  assert.ok(rows.length >= 1 && rows.every((r) => r.effectiveCpm !== null));
  assert.deepStrictEqual(rows.map((r) => r.effectiveCpm), rows.map((r) => r.effectiveCpm).sort((a, b) => b - a));
  assert.deepStrictEqual(SC.DSP_COLOURS, { 'DV360': '#eb6834', 'The Trade Desk': '#2a78d6', 'Amazon DSP': '#1baf7a', 'Direct': '#6b3fa0' });
  assert.strictEqual(val(SC.yieldHover(rows[0], SC.ALL_DEAL_TYPES, RANGE), 'Deal type'), 'All deal types');
  const pg = await get('/yield', { dealType: 'Programmatic guaranteed' });
  assert.ok(SC.yieldRows(pg.rows).length < pg.rows.length, 'a DSP with no programmatic guaranteed delivery is left out');
});

test('yield: DSPs read DV360, The Trade Desk, Amazon DSP, then Direct; a DSP with no delivery shows "No delivery", never NaN', async () => {
  const d = await get('/yield', { dealType: 'Programmatic guaranteed' });
  assert.deepStrictEqual(SC.dspOrder(d.rows.slice().reverse()).map((r) => r.dsp), ['DV360', 'The Trade Desk', 'Amazon DSP', 'Direct']);
  const none = d.rows.find((r) => r.effectiveCpm === null);
  assert.ok(none, 'the test retailer has a DSP with no Programmatic guaranteed delivery');
  const m = SC.yieldHover(none, 'Programmatic guaranteed', RANGE);
  assert.strictEqual(val(m, 'Effective CPM'), 'No delivery');
  assert.ok(!/NaN|null|undefined/.test(JSON.stringify(m.sections)));
  const live = SC.yieldHover(d.rows.find((r) => r.effectiveCpm !== null), 'Programmatic guaranteed', RANGE, d.rows);
  assert.match(val(live, 'Effective CPM'), /^\$9\.50$/);
  assert.match(val(live, 'Share of total revenue'), /^\d+% of Programmatic guaranteed revenue$/);
  const all = await get('/yield');
  const shares = SC.yieldRows(all.rows).map((r) => parseInt(val(SC.yieldHover(r, SC.ALL_DEAL_TYPES, RANGE, all.rows), 'Share of total revenue'), 10));
  assert.ok(shares.every((n) => n >= 0 && n <= 100) && Math.abs(shares.reduce((a, b) => a + b, 0) - 100) <= shares.length, 'shares add to ~100%');
  assert.deepStrictEqual(SC.DEAL_TYPES, ['Direct advertiser', 'Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction']);
});

test('the Missed revenue & fill and Yield ⓘ explain the new bars', () => {
  assert.match(SC.TIPS.missed, /^Fill = advertiser slots sold ÷ all advertiser slots, across all deal types/);
  assert.match(SC.TIPS.yield, /^Effective CPM for each connected DSP and for Direct \(the retailer’s direct advertisers, billed through PH with no DSP\): cleared revenue per 1,000 assumed views \(VAC-d\), from billing line items and reservations\./);
});

test('the Yield and Missed revenue ⓘ carry the VAC-d explanation and the worked example', () => {
  for (const k of ['slotValue', 'missed', 'yield']) {
    assert.match(SC.TIPS[k], /VAC-d/);
    assert.match(SC.TIPS[k], /Example: 4,000 footfall × 0\.5 visibility × 1\/10 of the loop = 200/);
  }
});

test('every display type hover carries the operating hours', async () => {
  const types = await typesP;
  const w = types.window, q = types.queue || Object.values(types).find((t) => t.operatingHours === 'Store opening hours');
  assert.strictEqual(q.operatingHours, 'Store opening hours');
  const sv = (await get('/slot-value')).rows.find((r) => r.id === 'window');
  const sa = (await get('/slot-allocation')).rows.find((r) => r.id === 'window');
  const mr = (await get('/missed-revenue')).rows.find((r) => r.id === 'window');
  const hr = (await get('/hourly')).rows.find((r) => r.id === 'window');
  for (const m of [SC.slotValueHover(sv, RANGE), SC.allocationHover(sa, 'loop', w), SC.missedHover(mr, w, RANGE, false), SC.hourlyHover(hr, hr.hours[9], w, RANGE)]) {
    assert.strictEqual(val(m, 'Operating hours'), '24 hours', m.title);
  }
  assert.strictEqual(SC.hoursText('Custom hours'), 'Custom hours');
  assert.strictEqual(SC.hoursText('08:00-22:00'), null);
});

test('no hover names a specific opening time', async () => {
  const types = await typesP;
  const all = [
    ...(await get('/slot-value')).rows.map((r) => SC.slotValueHover(r, RANGE)),
    ...Object.values(types).map((t) => SC.displayTypeCard(t, RANGE)),
  ].map(text).join('');
  assert.ok(!/\b\d{1,2}:\d{2}\b|\b(am|pm)\b/i.test(all));
});

test('formatting helpers', () => {
  assert.strictEqual(SC.fmtCompact(812600), '812.6k');
  assert.strictEqual(SC.dateRange(RANGE), '12 Sep – 11 Oct');
});

test('slot value sorts by the selected metric and slot allocation follows it', async () => {
  const sv = (await get('/slot-value')).rows;
  const sa = (await get('/slot-allocation')).rows;
  for (const mode of ['cpm', 'per']) {
    const key = mode === 'cpm' ? 'effectiveCpm' : 'perSlotPerDay';
    const order = SC.metricOrder(sv, mode);
    for (let i = 1; i < order.length; i++) assert.ok(order[i - 1][key] >= order[i][key]);
    const types = await typesP;
    assert.deepStrictEqual(SC.followOrder(sa.slice().reverse(), order, (r) => types[r.id]).map((r) => r.id), order.map((r) => r.id).filter((id) => sa.some((a) => a.id === id)));
  }
});

test('hourly: cell text, shading and hover facts', async () => {
  const body = await get('/hourly');
  const row = body.rows.find((r) => r.name === 'Window Portrait');
  assert.equal(row.hours.length, 24);
  const cell = row.hours[9];
  assert.match(SC.hourlyCellText(cell, 'fill'), /^\d+%$/);
  assert.equal(SC.hourlyCellText({ fillPercent: 50, effectiveCpm: null }, 'cpm'), '–');
  assert.equal(SC.hourlyShade(null, 10).bg, 'transparent');
  assert.equal(SC.hourlyMax(body.rows, 'fill') >= cell.fillPercent, true);
  const m = SC.hourlyHover(row, cell, (await typesP)[row.id], RANGE);
  assert.equal(val(m, 'Hour'), '09:00–10:00');
  assert.match(val(m, 'Fill'), /advertiser slots sold; .* unsold, .* offline\)$/);
  assert.match(text(m), /Totals across all/);
});

test('value hovers carry the figures only; the description and averages sit on the display type name', async () => {
  const types = await typesP;
  const w = (await get('/slot-value')).rows.find((r) => r.id === 'window');
  const m = SC.slotValueHover(w, RANGE);
  assert.strictEqual(m.desc, null);
  assert.ok(!/Average assumed views \(VAC-d\)/.test(text(m)));
  assert.match(text(SC.displayTypeCard(types.window, RANGE)), /Average assumed views \(VAC-d\) per slot per day/);
  const row = (await get('/missed-revenue')).rows.find((r) => r.id === 'dispensary');
  assert.strictEqual(SC.missedHover(row, types.dispensary, RANGE, false).desc, null);
});
