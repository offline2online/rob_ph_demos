'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const { describeCampaign, transactionsFor } = require('../src/uplift');
const { eachDay, addDays } = require('../src/dealing');
const { admin, advertiser } = require('./helpers');

const { raw, ctx } = generateTestRetailer({ days: 120 });
const store = new AggregateStore(buildAggregates(raw, ctx));

async function get(path, authenticate = admin) {
  const server = createServer({ store, today: '2026-10-11', authenticate });
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${BASE}${path}`);
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}
const campaignWhere = (pred) => store.campaigns.map((c) => describeCampaign(c, store, store.lastPlayedDay)).find(pred);

test('the chart is advertiser-callable and the tiles reconcile to source transactions and billing spend', async () => {
  const d = campaignWhere((c) => c.hasPos && c.excludesControl && c.flightEnded && c.advertiserId === 'adv-blackmores');
  const { status, body } = await get(`/sales-uplift?campaignId=${d.id}`);
  assert.equal(status, 200);
  assert.equal(body.state, 'ok');
  const sales = transactionsFor(store);
  const during = eachDay(d.start, d.flightEnd);
  const flight = during.reduce((n, date) => n + d.campaignStores.reduce((m, s) => m + sales(d, s, date), 0), 0);
  assert.equal(body.series.filter((r) => r.phase === 'during').reduce((n, r) => n + r.campaignSales, 0), flight);
  assert.deepEqual(body.series.map((r) => r.phase).filter((p, i, a) => a.indexOf(p) === i), ['before', 'during', 'after']);
  assert.equal(body.series[0].date, addDays(d.start, -30));
  // Both lines start level: each group's before-period mean is index 100.
  const before = body.series.filter((r) => r.phase === 'before');
  for (const k of ['campaignIndex', 'controlIndex']) assert.ok(Math.abs(before.reduce((n, r) => n + r[k], 0) / before.length - 100) < 0.5, k);
  // Spend is the advertiser's billed revenue in the campaign's stores and display types, shared with overlapping campaigns.
  assert.ok(body.tiles.spend > 0);
  assert.equal(body.tiles.iroas, Math.round((body.tiles.incrementalSales / body.tiles.spend) * 100) / 100);
  assert.ok(body.tiles.upliftPercent > 0);
  assert.ok(Number.isInteger(body.tiles.upliftPercent));
});

test('legend counts match the store groups, control stores are never campaign stores, and the tier mix adds to 100', async () => {
  const { body } = await get('/sales-uplift');
  assert.equal(body.campaignStores.count, body.campaignStores.names.length);
  assert.equal(body.controlStores.count, body.controlStores.names.length);
  assert.ok(body.controlStores.count > 0);
  assert.equal(body.campaignStores.names.filter((n) => body.controlStores.names.includes(n)).length, 0);
  assert.equal(body.tierMix.reduce((n, t) => n + t.percent, 0), 100);
});

test('empty states: no POS data, no Control stores exclusion, product name only', async () => {
  const noPos = campaignWhere((c) => !c.hasPos);
  assert.equal((await get(`/sales-uplift?campaignId=${noPos.id}`)).body.state, 'no-pos');
  const noControl = campaignWhere((c) => c.hasPos && !c.excludesControl);
  const nc = (await get(`/sales-uplift?campaignId=${noControl.id}`)).body;
  assert.equal(nc.state, 'no-control');
  assert.equal(nc.tiles, undefined);
  const byName = campaignWhere((c) => c.hasPos && c.excludesControl && c.matchedOn === 'product name');
  const bn = (await get(`/sales-uplift?campaignId=${byName.id}`)).body;
  assert.equal(bn.matchedOn, 'product name');
  assert.equal(bn.product.sku, undefined);
});

test('the Advertiser filter narrows the drop-down; an advertiser login sees only its own campaigns and products', async () => {
  const all = (await get('/sales-uplift')).body.campaigns;
  assert.ok(new Set(all.map((c) => c.advertiserId)).size > 1);
  const narrowed = (await get('/sales-uplift?advertiserIds=adv-haleon')).body;
  assert.ok(narrowed.campaigns.length > 0 && narrowed.campaigns.every((c) => c.advertiserId === 'adv-haleon'));
  const mine = await get('/sales-uplift', advertiser('adv-haleon'));
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.campaigns, narrowed.campaigns);
  // A forged advertiserIds or another advertiser's campaignId gets nothing of theirs.
  assert.deepEqual((await get('/sales-uplift?advertiserIds=adv-blackmores', advertiser('adv-haleon'))).body, mine.body);
  const theirs = all.find((c) => c.advertiserId === 'adv-blackmores');
  assert.equal((await get(`/sales-uplift?campaignId=${theirs.id}`, advertiser('adv-haleon'))).status, 400);
  const text = JSON.stringify(mine.body);
  for (const other of Object.values(ctx.advertisers).filter((a) => a.name !== ctx.advertisers['adv-haleon'].name)) assert.ok(!text.includes(other.name), other.name);
});

test('Advertisers iROAS rolls up measured campaigns only and reconciles with the chart; advertisers cannot call it', async () => {
  const f = '?dateFrom=2026-09-12&dateTo=2026-10-11';
  const { body } = await get(`/advertisers${f}`);
  assert.equal(body.posData, true);
  const all = store.campaigns.filter((c) => c.start <= store.lastPlayedDay).map((c) => describeCampaign(c, store, store.lastPlayedDay));
  for (const a of body.all) {
    const mine = all.filter((c) => c.advertiserId === a.advertiserId && c.start <= '2026-10-11' && c.flightEnd >= '2026-09-12');
    assert.equal(a.iroas.totalCampaigns, mine.length);
    if (!a.iroas.measuredCampaigns) { assert.equal(a.iroas.value, null); continue; }
    let inc = 0; let spend = 0;
    for (const c of mine) {
      const t = (await get(`/sales-uplift?campaignId=${c.id}&advertiserIds=${c.advertiserId}`)).body;
      if (t.state === 'ok') { inc += t.tiles.incrementalSales; spend += t.tiles.spend; }
    }
    assert.ok(Math.abs(a.iroas.incrementalSales - inc) < 0.05 * a.iroas.measuredCampaigns);
    assert.ok(Math.abs(a.iroas.value - inc / spend) < 0.01);
  }
  assert.equal(body.all.find((a) => a.name === 'Perrigo').iroas.value, null);
  assert.notEqual((await get(`/advertisers${f}`, advertiser('adv-blackmores'))).status, 200);
});

test('the tier mix lists each variation under its tier and the shares add up to 100%', async () => {
  const d = campaignWhere((c) => c.hasPos && c.excludesControl && c.level === 'Personalised' && c.advertiserId === 'adv-blackmores');
  const { body } = await get(`/sales-uplift?campaignId=${d.id}`);
  const personalised = body.tierMix.find((t) => t.tier === 'personalised');
  assert.deepEqual(personalised.variations.map((v) => [v.name, v.percent]), [['New to brand', 3], ['Existing buyer', 2]]);
  assert.equal(body.tierMix.reduce((n, t) => n + t.variations.reduce((m, v) => m + v.percent, 0), 0), 100);
  for (const t of body.tierMix) assert.equal(t.variations.reduce((n, v) => n + v.percent, 0), t.percent);
  assert.equal(body.tierMix.find((t) => t.tier === 'default').variations[0].name, 'Default');
  assert.equal(personalised.variations[0].audienceNote, 'Audience shared only with this advertiser');
});

test('By product: SKU rows add up to the incremental sales tile, shares cover positive contribution only, thin SKUs are flagged', async () => {
  const multi = campaignWhere((c) => c.hasPos && c.excludesControl && c.products.length === 3 && c.advertiserId === 'adv-blackmores')
    || campaignWhere((c) => c.hasPos && c.excludesControl && c.products.length === 3);
  const { body } = await get(`/sales-uplift?campaignId=${multi.id}`);
  assert.equal(body.state, 'ok');
  const rows = body.bySku;
  assert.equal(rows.length, 3);
  const measured = rows.filter((r) => r.measurable);
  assert.ok(Math.abs(measured.reduce((n, r) => n + r.incrementalSales, 0) - body.tiles.incrementalSales) < 0.011);
  assert.deepEqual(measured.map((r) => r.incrementalSales), [...measured.map((r) => r.incrementalSales)].sort((a, b) => b - a));
  const pos = measured.filter((r) => r.incrementalSales > 0);
  assert.ok(Math.abs(pos.reduce((n, r) => n + r.sharePercent, 0) - 100) < 0.05);
  for (const r of measured.filter((x) => x.incrementalSales <= 0)) assert.equal(r.sharePercent, null);
  assert.ok(measured.some((r) => r.incrementalSales < 0), 'the sample has a cannibalised SKU');
  const thin = rows.filter((r) => !r.measurable);
  for (const r of thin) assert.equal(r.incrementalSales, undefined);
});

test('By product: a product-name-only campaign has one row matched on product name; an advertiser cannot reach another advertiser\'s', async () => {
  const byName = campaignWhere((c) => c.hasPos && c.excludesControl && c.matchedOn === 'product name');
  const rows = (await get(`/sales-uplift?campaignId=${byName.id}`)).body.bySku;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].matchedOn, 'product name');
  assert.equal(rows[0].sku, undefined);
  const other = campaignWhere((c) => c.advertiserId === 'adv-blackmores');
  assert.equal((await get(`/sales-uplift?campaignId=${other.id}`, advertiser('adv-haleon'))).status, 400);
  const noPos = campaignWhere((c) => !c.hasPos);
  assert.equal((await get(`/sales-uplift?campaignId=${noPos.id}`)).body.bySku, undefined);
});
