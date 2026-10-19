// node --test Retail-media-insights/frontend/test
const test = require('node:test');
const assert = require('node:assert');
const UP = require('../uplift-chart.js');
const { get, ADMIN, ADVERTISER } = require('./api.js');

test('three tiles in order, whole-number uplift, money under $10k whole dollars, and the tier mix on the Uplift hover', async () => {
  const data = await get('/sales-uplift', {}, ADMIN);
  const t = UP.tiles(data);
  assert.deepStrictEqual(t.map((x) => x.label), ['Uplift', 'Incremental sales (USD)', 'iROAS']);
  assert.match(t[0].value, /^\d+%$/);
  assert.match(t[0].hover, /^Plays: (\d+% (default|localised|personalised)( · )?)+$/);
  assert.match(t[2].value, /^\d+\.\d\dx$/);
  assert.strictEqual(UP.fmtMoney(9155.28), '$9,155');
  assert.strictEqual(UP.fmtMoney(13120), '$13.1k');
});

test('tier mix text leaves out tiers with no plays', () => {
  assert.strictEqual(UP.tierMixText([{ tier: 'default', percent: 70 }, { tier: 'localised', percent: 25 }, { tier: 'personalised', percent: 5 }]), 'Plays: 70% default · 25% localised · 5% personalised');
  assert.strictEqual(UP.tierMixText([{ tier: 'default', percent: 100 }, { tier: 'localised', percent: 0 }]), 'Plays: 100% default');
});

test('legend shows store counts and the store names for the hover', async () => {
  const data = await get('/sales-uplift', {}, ADMIN);
  const l = UP.legend(data);
  assert.strictEqual(l[0].label, `Campaign stores (${data.campaignStores.count})`);
  assert.strictEqual(l[1].label, `Control stores (${data.controlStores.count})`);
  assert.deepStrictEqual(l[1].stores, data.controlStores.names);
});

test('day hover is facts only: both groups per store and the difference', async () => {
  const data = await get('/sales-uplift', {}, ADMIN);
  const rows = UP.dayRows(data.series[40]);
  assert.deepStrictEqual(rows.map((r) => r[0]), ['Campaign stores, sales per store', 'Control stores, sales per store', 'Difference']);
});

test('geometry shades the flight and both lines start level', async () => {
  const data = await get('/sales-uplift', {}, ADMIN);
  const g = UP.geometry(data.series, 720, 260, { l: 40, r: 12, t: 12, b: 28 });
  assert.ok(g.flight[0] < g.flight[1]);
  assert.ok(Math.abs(g.campaign[0][1] - g.control[0][1]) < 30);
});

test('an advertiser login gets only its own campaigns; empty states carry the exact messages', async () => {
  const mine = await get('/sales-uplift', {}, ADVERTISER);
  assert.ok(mine.campaigns.every((c) => c.advertiserId === 'adv-blackmores'));
  assert.strictEqual(UP.MESSAGES['no-pos'], 'Requires a POS integration into the Personalisation Hub Transaction API.');
  assert.strictEqual(UP.MESSAGES['no-control'], 'No control stores set for this campaign.');
  assert.match(UP.TITLE_TIP, /^Compares sales of this campaign’s products in stores where it played with sales in your Control stores segment\./);
});

test('By product: sorted rows, top ten with "+ n more", thin SKUs say too few sales, product-name-only rows are flagged', () => {
  const sale = { before: { campaign: 900, control: 800 }, during: { campaign: 1500, control: 900 } };
  const rows = Array.from({ length: 12 }, (_, i) => ({ name: 'P' + i, sku: 'S' + i, measurable: true, incrementalSales: 100 - i, sharePercent: 8.3, upliftPercent: 12, transactions: 90, sales: sale }));
  rows.push({ name: 'Thin', measurable: false, transactions: 4, sales: sale });
  const m = UP.bySkuModel({ bySku: rows }, false);
  assert.strictEqual(m.rows.length, 10);
  assert.strictEqual(m.more, 3);
  assert.strictEqual(m.rows[0].figures, '$100 · 8.3% · 12%');
  assert.strictEqual(UP.bySkuModel({ bySku: rows }, true).rows.length, 13);
  const last = UP.bySkuModel({ bySku: rows }, true).rows[12];
  assert.strictEqual(last.figures, 'Too few sales to measure');
  assert.strictEqual(last.id, 'Matched on product name');
  const neg = UP.bySkuModel({ bySku: [{ name: 'N', sku: 'N1', measurable: true, incrementalSales: -250, sharePercent: null, upliftPercent: -4, transactions: 80, sales: sale }] }, false);
  assert.strictEqual(neg.rows[0].figures, '-$250 · no share · -4%');
});
