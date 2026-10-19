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
