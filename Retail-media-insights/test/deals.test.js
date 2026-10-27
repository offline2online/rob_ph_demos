'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const { admin, advertiser, optIn } = require('./helpers');

const { raw, ctx } = generateTestRetailer({ days: 90 });
const store = new AggregateStore(buildAggregates(raw, ctx));

async function get(path, opts = {}) {
  const server = createServer({ store, today: '2026-10-11', authenticate: admin, ...opts });
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${BASE}${path}`);
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}
const pg = async (q) => (await get(`/deals?${q}`)).body.rows.find((r) => r.name === 'Immune — winter launch');

test('deals: one row per named deal in standard order, Open auction excluded; the direct deal leads', async () => {
  const { status, body } = await get('/deals');
  assert.equal(status, 200);
  assert.deepEqual(body.rows.map((r) => r.dealType), ['Direct advertiser', 'Direct advertiser', 'Direct advertiser', 'Direct advertiser', 'Direct advertiser', 'Direct advertiser', 'Direct advertiser', 'Programmatic guaranteed', 'Programmatic guaranteed', 'Programmatic guaranteed']);
  assert.equal(body.rows.filter((r) => r.dealType === 'Direct advertiser').length, 7, '7 of the 10 named deals are sold direct');
  const d = body.rows.find((r) => r.name === 'Immune — winter launch');
  assert.ok(d.name && d.description && d.revenue > 0);
  assert.deepEqual(d.dealIds, [{ dsp: 'DV360', dspLabel: 'Google DSP (DV360)', dealId: ctx.dealCatalog.d1.dealIds.DV360 }]);
  assert.ok(d.dealIds.every((x) => /^PH-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/.test(x.dealId)));
  assert.equal(d.advertisers.length, 1, 'Programmatic guaranteed has exactly one buyer');
  assert.equal(d.name, 'Immune — winter launch');
  assert.equal(d.slots[0].label, 'Advertiser slot 1 (loop slot 1)');
  assert.equal(d.slots[0].playlistZone, 'Window loop · Store front');
  assert.equal(d.slots[0].iabZone, 'Entrance & out of category');
  assert.ok(d.fill.percent > 0 && d.fill.percent <= 100 && d.fill.slotsWon <= d.fill.slotsAvailable);
});

test('deals: PG pacing before, during and after the flight', async () => {
  const before = (await pg('dateFrom=2026-09-01&dateTo=2026-09-10')).pacing;
  assert.equal(before.startsInDays, 5); assert.equal(before.percent, null); assert.equal(before.daysElapsed, 0);
  const during = (await pg('dateFrom=2026-09-01&dateTo=2026-10-16')).pacing;
  assert.equal(during.daysElapsed, 32); assert.equal(during.flightDays, 62); assert.equal(during.daysRemaining, 30);
  assert.equal(during.startsInDays, null); assert.equal(during.flightEnded, false);
  assert.equal(during.guaranteedToDate, Math.round(ctx.dealCatalog.d1.forecast * 0.9 * 32 / 62));
  const after = (await pg('dateFrom=2026-11-01&dateTo=2026-12-01')).pacing;
  assert.equal(after.daysRemaining, 0); assert.equal(after.flightEnded, true);
  assert.equal(after.guaranteedToDate, after.guaranteedForFlight);
  const others = (await get('/deals')).body.rows.filter((r) => r.dealType !== 'Programmatic guaranteed');
  assert.ok(others.every((r) => r.pacing === null));
});

test('deals: dealType filter, 400 on unknown; the launch deal types are all fixed price', async () => {
  const { body } = await get('/deals?dealType=Programmatic guaranteed');
  assert.deepEqual(body.rows.map((r) => r.dealType), ['Programmatic guaranteed', 'Programmatic guaranteed', 'Programmatic guaranteed']);
  assert.equal(body.rows[0].cpm.kind, 'fixed');
  assert.equal((await get('/deals?dealType=Direct advertiser')).body.rows.length, 7);
  assert.equal((await get('/deals?dealType=Nope')).status, 400);
  assert.equal((await get('/deals?dealType=Private auction')).body.rows.length, 0, 'the example retailer sells no private auctions at launch');
  assert.ok((await get('/deals')).body.rows.every((r) => r.cpm.kind === 'fixed'));
});

test('advertisers: shares add to 100, revenue equals billing, top 10 and all', async () => {
  const q = 'dateFrom=2026-09-12&dateTo=2026-10-11';
  const { body } = await get(`/advertisers?${q}`);
  assert.equal(body.all.reduce((a, r) => a + r.share, 0), 100);
  assert.equal(body.all.length, 11);
  assert.equal(body.top.length, 10);
  const billed = raw.billing.filter((b) => b.date >= '2026-09-12' && b.settled).reduce((a, b) => a + b.revenue, 0); // Revenue is earned (settled) revenue
  assert.ok(Math.abs(body.all.reduce((a, r) => a + r.revenue, 0) - billed) < 0.01 * body.all.length);
  const a = body.all.find((r) => r.advertiserId === 'adv-haleon');
  assert.deepEqual(a.dealsOn.map((d) => d.dealType), ['Programmatic guaranteed']);
  assert.ok(a.slotsCovered === 1 && a.slotsWonPercent > 0 && a.effectiveCpm > 0 && a.dsp);
  assert.equal(body.slotsWon.complete, true);
});

test('advertisers: slotsWon incomplete beyond 90 days of retention', async () => {
  assert.equal((await get('/advertisers?dateFrom=2026-07-01&dateTo=2026-10-11')).body.slotsWon.complete, false);
});

test('advertiser login sees only its own deals, buyer, DSP deal ID and row', async () => {
  const opts = { authenticate: advertiser('adv-reckitt'), routes: optIn('deals', 'advertisers') };
  const deals = (await get('/deals', opts)).body.rows;
  assert.deepEqual(deals.map((r) => r.dealType), ['Programmatic guaranteed']);
  assert.deepEqual(deals[0].advertisers.map((a) => a.advertiserId), ['adv-reckitt']);
  assert.deepEqual(deals[0].dealIds.map((x) => x.dsp), ['Amazon DSP']);
  const adv = (await get('/advertisers', opts)).body;
  assert.deepEqual(adv.all.map((r) => r.advertiserId), ['adv-reckitt']);
  assert.equal(adv.all[0].share, 100);
  assert.ok(!JSON.stringify(adv).includes('Haleon'));
});

test('deals: the ten named deals — fill, pacing, CPM, buyers and deal IDs follow the example retailer', async () => {
  const { body } = await get('/deals?dateFrom=2026-09-12&dateTo=2026-10-11');
  const by = Object.fromEntries(body.rows.map((r) => [r.name, r]));
  const fills = ['Immune — winter launch', 'Sensodyne always-on', 'Revitalift takeover', 'Dispensary guaranteed', 'Health & wellness windows', 'Dispensary screens', 'Beauty endcaps', 'Queue screens', 'Store-wide wellness', 'Perrigo — pharmacy takeover'].map((n) => by[n].fill.percent);
  [95, 95, 72, 55, 92, 84, 52, 90, 56, 56].forEach((want, i) => assert.ok(Math.abs(fills[i] - want) <= 2, `fill ${i + 1}: ${fills[i]} vs ${want}`));
  assert.ok(Math.abs(by['Immune — winter launch'].pacing.percent - 93) <= 1 && Math.abs(by['Sensodyne always-on'].pacing.percent - 101) <= 1 && Math.abs(by['Dispensary guaranteed'].pacing.percent - 97) <= 1);
  assert.deepEqual([by['Immune — winter launch'].pacing.flightStart, by['Immune — winter launch'].pacing.flightEnd], ['2026-09-15', '2026-11-15']);
  assert.deepEqual([by['Sensodyne always-on'].pacing.flightStart, by['Sensodyne always-on'].pacing.flightEnd], ['2026-08-01', '2026-12-31']);
  assert.deepEqual([by['Immune — winter launch'].cpm, by['Health & wellness windows'].cpm, by['Queue screens'].cpm], [{ value: 9.5, kind: 'fixed' }, { value: 7.5, kind: 'fixed' }, { value: 5.5, kind: 'fixed' }]);
  assert.equal(by['Health & wellness windows'].advertisers.length, 3);
  assert.equal(by['Beauty endcaps'].advertisers.length, 2);
  assert.equal(by['Immune — winter launch'].description, 'Guaranteed Window Portrait plays for the Blackmores Immune winter launch, 15 Sep – 15 Nov.');
  // One deal ID per DSP with an invited buyer, PH- plus 10 characters.
  for (const r of body.rows) {
    assert.deepEqual(r.dealIds.map((x) => x.dsp), [...new Set(r.advertisers.map((a) => a.dsp))].filter((d) => d !== 'Direct').sort((x, y) => ['DV360', 'The Trade Desk', 'Amazon DSP'].indexOf(x) - ['DV360', 'The Trade Desk', 'Amazon DSP'].indexOf(y)), r.name);
    assert.ok(r.dealIds.every((x) => /^PH-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/.test(x.dealId)));
  }
  assert.deepEqual(by['Store-wide wellness'].slots.map((s) => `${s.displayTypeId}#${s.advertiserSlot}`), ['endcap#5']);
  // A direct advertiser's deal: owned slot, fixed CPM, no DSP and so no deal ID.
  const direct = by['Perrigo — pharmacy takeover'];
  assert.deepEqual([direct.dealType, direct.cpm, direct.dealIds], ['Direct advertiser', { value: 6, kind: 'fixed' }, []]);
  assert.deepEqual(direct.advertisers.map((a) => [a.name, a.dsp]), [['Perrigo', 'Direct']]);
  assert.deepEqual(direct.slots.map((s) => `${s.displayTypeId}#${s.advertiserSlot}`), ['dispensary#5']);
});

test('advertisers: eleven example advertisers, each with the DSP it buys through', async () => {
  const { body } = await get('/advertisers?dateFrom=2026-09-12&dateTo=2026-10-11');
  assert.deepEqual(body.all.map((a) => [a.name, a.dsp]).sort(), [['Bayer Consumer Health', 'Amazon DSP'], ['Blackmores', 'DV360'], ['Haleon', 'The Trade Desk'], ['Kenvue', 'DV360'], ["L'Oréal Paris", 'Direct'], ['Nestlé Health Science', 'Direct'], ['Perrigo', 'Direct'], ['Procter & Gamble', 'Direct'], ['Reckitt', 'Amazon DSP'], ['Unilever', 'Amazon DSP'], ['Vitabiotics', 'Direct']]);
  assert.ok(!body.all.some((a) => ['Acme', 'Nova'].includes(a.name)));
  assert.ok(body.all.filter((a) => a.direct).length === 5 && body.all.every((a) => a.direct === (a.dsp === 'Direct')), 'five direct advertisers, no seats');
});
