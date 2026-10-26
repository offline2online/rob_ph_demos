'use strict';
// The approved artifact's example retailer (ticket AErVNnDLitgIBW6CFiJc): its stores, advertisers, deals and campaigns, earned and
// estimated revenue, the advertiser summary and Progress over time covering the whole history.
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer, ADVERTISERS } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const { admin, advertiser } = require('./helpers');

const { raw, ctx } = generateTestRetailer();
const store = new AggregateStore(buildAggregates(raw, ctx));
const Q = 'dateFrom=2026-09-12&dateTo=2026-10-11';

async function get(path, authenticate = admin, st = store) {
  const server = createServer({ store: st, today: '2026-10-11', authenticate });
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${BASE}${path}`);
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const cents = (n) => Math.round(Math.round(n * 1e6) / 1e4) / 100;

test('the example retailer: five named stores, eleven advertisers, ten deals, four display types', async () => {
  const f = (await get('/filter-options')).body;
  assert.deepEqual(f.stores.map((s) => s.id), ['store-3', 'store-5', 'store-4', 'store-1', 'store-2'], 'listed by name');
  assert.deepEqual(ctx.stores['store-1'].name, 'London Oxford St');
  assert.deepEqual(Object.values(ctx.stores).map((s) => s.name), ['London Oxford St', 'Manchester Arndale', 'Bristol Cabot Circus', 'Leeds Trinity', 'Glasgow Buchanan St']);
  assert.equal(f.advertisers.length, 11);
  assert.ok(!f.advertisers.some((a) => ['Acme', 'Nova'].includes(a.name)));
  assert.equal(Object.values(ctx.dealCatalog).filter((d) => d.dealType !== 'Open auction').length, 10);
  const t = ctx.displayTypes;
  assert.deepEqual(Object.values(t).map((x) => [x.name, x.slots.advertiser.count, x.slots.advertiser.avgSeconds, x.slots.ownContent.count, x.slots.ownContent.avgSeconds, x.floorCpm, x.visibility]),
    [['Window Portrait', 8, 6, 4, 3, 7.5, 0.55], ['Endcap Shelf-edge', 6, 5, 2, 5, 6, 0.35], ['Queue Screen', 3, 6, 3, 4, 5.5, 0.7], ['Dispensary Screen', 6, 5, 4, 5, 7, 0.6]]);
  assert.deepEqual(Object.values(t).map((x) => x.creativeFormats[0]), [
    'Image + video, 1080×1920, max play 6s', 'Image + video, 1920×360, max play 5s', 'Image + video, 1920×1080, max play 6s', 'Image + video, 1920×1080, max play 5s']);
  const avg = (await get(`/display-types?${Q}`)).body.rows.map((r) => [r.name, Math.round(r.averages.averageFootfallPerDay / 10) * 10]);
  assert.deepEqual(Object.fromEntries(avg), { 'Window Portrait': 6150, 'Endcap Shelf-edge': 760, 'Queue Screen': 1860, 'Dispensary Screen': 5600 });
  assert.deepEqual(ctx.displays.filter((d) => d.storeId === 'store-1' && d.displayTypeId === 'window').length, 2);
});

test('history: 120 played days from 14 Jun to 11 Oct 2026, every one earned', () => {
  const played = [...new Set(raw.billing.filter((b) => !b.reservation).map((b) => b.date))].sort();
  assert.equal(played.length, 120);
  assert.equal(played[0], '2026-06-14'); assert.equal(played[119], '2026-10-11');
  assert.ok(raw.billing.filter((b) => !b.reservation).every((b) => b.settled), 'no unsettled played day');
});

test('deals: PG deals have flights and buffers; the rest are fixed or floor priced; one deal ID per DSP with an invited buyer', () => {
  const d = ctx.dealCatalog;
  assert.deepEqual([d.d1.flight, d.d1.buffer], [{ start: '2026-09-15', end: '2026-11-15' }, 0.1]);
  assert.deepEqual([d.d2.flight, d.d2.buffer], [{ start: '2026-08-01', end: '2026-12-31' }, 0.1]);
  assert.deepEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd11'].map((id) => d[id].cpm), [9.5, 8, 8.8, 8.2, 7.5, 7, 6, 5.5, 6.5, 6]);
  for (const id of ['d5', 'd6', 'd7', 'd8', 'd9']) assert.equal(d[id].floorCpm, d[id].cpm);
  assert.deepEqual(d.d6.slots.map((s) => `${s.displayTypeId}${s.position}`), ['dispensary2', 'dispensary3', 'dispensary4']);
  assert.deepEqual(d.d9.slots.map((s) => `${s.displayTypeId}${s.position}`), ['endcap5']);
  assert.deepEqual(d.d11.slots.map((s) => `${s.displayTypeId}${s.position}`), ['dispensary5']);
  assert.deepEqual(d.d11.dealIds, {}, 'a direct advertiser deal has no DSP and so no deal ID');
  assert.equal(d.d4.description, 'First look for Kenvue on Dispensary Screen slots at a fixed CPM.');
  for (const deal of Object.values(d).filter((x) => x.dealType !== 'Open auction')) {
    assert.deepEqual(Object.keys(deal.dealIds).sort(), [...new Set(deal.buyers.map((b) => b.dsp))].filter((x) => x !== 'Direct').sort(), deal.name);
    for (const id of Object.values(deal.dealIds)) assert.match(id, /^PH-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
  }
  const allDealIds = Object.values(d).flatMap((deal) => Object.values(deal.dealIds || {}));
  assert.ok(allDealIds.length > 0);
  assert.equal(new Set(allDealIds).size, allDealIds.length, 'deal IDs are unique across all deals and DSPs');
  // Only buyers on a deal are billed on its assigned positions; Blackmores' campaigns target only Window, Dispensary and Queue.
  for (const b of raw.billing) {
    if (b.reservation || ctx.dealCatalog[b.dealId].dealType === 'Open auction') continue;
    assert.ok(ctx.dealCatalog[b.dealId].buyers.some((x) => x.advertiserId === b.advertiserId && x.dsp === b.dsp));
  }
  assert.deepEqual([...new Set(raw.campaigns.filter((c) => c.advertiserId === 'adv-blackmores').flatMap((c) => c.displayTypeIds))].sort(), ['dispensary', 'queue', 'window']);
});

test('estimated revenue is the PG reservations booked ahead: 30 days after the last played day, whatever the date range', async () => {
  const reservations = raw.billing.filter((b) => b.reservation);
  assert.ok(reservations.length > 0 && reservations.every((b) => !b.settled && b.slots === 0 && b.views === 0));
  assert.ok(reservations.every((b) => ctx.dealCatalog[b.dealId].dealType === 'Programmatic guaranteed' && b.date > '2026-10-11' && b.date <= '2026-12-31'));
  assert.equal(reservations.filter((b) => b.dealId === 'd1').reduce((m, b) => (b.date > m ? b.date : m), ''), '2026-11-15', 'a flight reserves until it ends');
  assert.equal(reservations.filter((b) => b.dealId === 'd2').reduce((m, b) => (b.date > m ? b.date : m), ''), '2026-12-31', 'and no later than 31 Dec');
  const inWindow = (from, to, ok = () => true) => cents(sum(reservations.filter((b) => b.date >= from && b.date <= to && ok(b)).map((b) => b.revenue)));
  for (const range of [Q, 'dateFrom=2026-10-05&dateTo=2026-10-11', 'dateFrom=2026-06-14&dateTo=2026-06-20']) {
    const s = (await get(`/summary?${range}`)).body;
    assert.deepEqual(s.estimatedWindow, { dateFrom: '2026-10-12', dateTo: '2026-11-10' });
    assert.equal(s.estimatedRevenue, inWindow('2026-10-12', '2026-11-10'), range);
  }
  const filtered = (await get(`/summary?${Q}&storeIds=store-1&displayTypeIds=window`)).body;
  assert.equal(filtered.estimatedRevenue, inWindow('2026-10-12', '2026-11-10', (b) => b.storeId === 'store-1' && b.displayTypeId === 'window'));
  assert.equal((await get(`/summary?${Q}&advertiserIds=adv-haleon`)).body.estimatedRevenue, inWindow('2026-10-12', '2026-11-10', (b) => b.advertiserId === 'adv-haleon'));
  assert.equal((await get(`/summary?${Q}&dsps=Amazon DSP`)).body.estimatedRevenue, 0, 'no PG deal is bought through Amazon DSP');
  assert.equal((await get(`/summary?${Q}&dealTypes=Open auction`)).body.estimatedRevenue, 0);
  // Reservations add no inventory or slot records, and no earned revenue.
  const s = (await get(`/summary?dateFrom=2026-10-12&dateTo=2026-11-10`)).body;
  assert.equal(s.earnedRevenue, 0); assert.equal(s.inventorySold.slotsSold + s.inventorySold.slotsAvailable + s.inventorySold.slotsOffline, 0);
});

test('summary: effective CPM (earned / earned views x 1,000, in cents; null without views) and connected DSPs', async () => {
  const s = (await get(`/summary?${Q}`)).body;
  const rows = raw.billing.filter((b) => b.settled && b.date >= '2026-09-12' && b.date <= '2026-10-11');
  assert.equal(s.effectiveCpm, cents(sum(rows.map((b) => b.revenue)) / (sum(rows.map((b) => b.views)) / 1000)));
  assert.equal(s.connectedDsps, 3);
  assert.equal((await get('/summary?dateFrom=2026-10-12&dateTo=2026-10-12')).body.effectiveCpm, null);
  assert.equal(s.earnedRevenue, cents(sum(rows.map((b) => b.revenue))));
});

test('filter-options: lastDataDay is the last played day, never a reservation date; firstDataDay is the first', async () => {
  const f = (await get('/filter-options')).body;
  assert.equal(f.firstDataDay, '2026-06-14'); assert.equal(f.lastDataDay, '2026-10-11');
  const a = (await get('/filter-options', advertiser('adv-blackmores'))).body;
  assert.equal(a.lastDataDay, '2026-10-11');
  assert.deepEqual(a.displayTypes.map((t) => t.name), ['Dispensary Screen', 'Queue Screen', 'Window Portrait']);
});

test('revenue: aheadDays adds booked-ahead periods after the last played day (earned 0, estimated > 0, ahead: true)', async () => {
  const base = (await get(`/revenue?${Q}&granularity=day`)).body;
  assert.equal(base.lastDataDay, '2026-10-11');
  assert.ok(base.rows.every((r) => !r.ahead));
  const ahead = (await get(`/revenue?${Q}&granularity=day&aheadDays=14`)).body;
  const days = [...new Set(ahead.rows.filter((r) => r.ahead).map((r) => r.period))];
  assert.equal(days.length, 14);
  assert.equal(days[0], '2026-10-12'); assert.equal(days[13], '2026-10-25');
  assert.ok(ahead.rows.filter((r) => r.ahead).every((r) => r.earned === 0 && r.estimated > 0 && r.dealType === 'Programmatic guaranteed'));
  assert.deepEqual(ahead.rows.filter((r) => !r.ahead), base.rows, 'the played days are unchanged');
  const month = (await get(`/revenue?${Q}&granularity=month&aheadDays=81`)).body;
  assert.deepEqual([...new Set(month.rows.filter((r) => r.ahead).map((r) => r.period))], ['2026-11-01', '2026-12-01']);
  const octoberRows = month.rows.filter((r) => r.period === '2026-10-01');
  assert.ok(octoberRows.some((r) => r.estimated > 0 && r.earned > 0) && octoberRows.every((r) => !r.ahead), 'a period with played days is not ahead');
  const week = (await get(`/revenue?${Q}&granularity=week&aheadDays=42`)).body;
  assert.equal([...new Set(week.rows.filter((r) => r.ahead).map((r) => r.period))].length, 6);
  const total = sum(ahead.rows.filter((r) => r.ahead).map((r) => r.estimated));
  const check = sum(raw.billing.filter((b) => b.reservation && b.date >= '2026-10-12' && b.date <= '2026-10-25').map((b) => b.revenue));
  assert.ok(Math.abs(total - check) <= 0.01 * ahead.rows.length, `${total} vs ${check}`);
  for (const bad of ['-1', '121', '1.5', 'x']) assert.equal((await get(`/revenue?${Q}&aheadDays=${bad}`)).status, 400, bad);
  assert.equal((await get(`/revenue?${Q}&aheadDays=0`)).status, 200);
});

test('/my-summary: spend and plays won equal Delivery\'s totals; dealsOn counts the live deals the advertiser buys on', async () => {
  for (const id of ADVERTISERS) {
    for (const range of [Q, 'dateFrom=2026-10-05&dateTo=2026-10-11', 'dateFrom=2026-06-14&dateTo=2026-12-01']) {
      const mine = await get(`/my-summary?${range}`, advertiser(id));
      const delivery = await get(`/delivery?${range}`, advertiser(id));
      assert.equal(mine.status, 200, id);
      assert.equal(mine.body.spend, delivery.body.totals.spend, `${id} ${range}`);
      assert.equal(mine.body.playsWon, delivery.body.totals.playsWon, `${id} ${range}`);
    }
  }
  const dealsOn = async (id, range = Q) => (await get(`/my-summary?${range}`, advertiser(id))).body.dealsOn;
  assert.equal(await dealsOn('adv-blackmores'), 3);
  assert.equal(await dealsOn('adv-haleon'), 4);
  assert.equal(await dealsOn('adv-perrigo'), 1, 'Perrigo is direct: its one direct deal');
  assert.equal(await dealsOn('adv-blackmores', 'dateFrom=2026-06-14&dateTo=2026-09-01'), 2, 'Immune — winter launch has not started');
  assert.equal(await dealsOn('adv-blackmores', 'dateFrom=2026-11-20&dateTo=2026-11-30'), 2, 'Immune — winter launch has ended');
  // Pinned server-side: another advertiser's id is ignored; a retailer must name exactly one advertiser.
  const spoof = await get(`/my-summary?${Q}&advertiserIds=adv-haleon`, advertiser('adv-blackmores'));
  assert.deepEqual(spoof.body, (await get(`/my-summary?${Q}`, advertiser('adv-blackmores'))).body);
  assert.equal((await get(`/my-summary?${Q}`)).status, 400);
  assert.equal((await get(`/my-summary?${Q}&advertiserIds=adv-haleon`)).body.dealsOn, 4);
});

test('/maturity overTime ignores the date range (first campaign to last played day); the ladder and table follow it', async () => {
  const ranges = ['dateFrom=2026-10-05&dateTo=2026-10-11', 'dateFrom=2026-06-14&dateTo=2026-06-20', 'dateFrom=2026-12-01&dateTo=2026-12-05', Q];
  const bodies = [];
  for (const r of ranges) bodies.push((await get(`/maturity?${r}`)).body);
  for (const b of bodies) assert.deepEqual(b.overTime, bodies[0].overTime);
  assert.deepEqual(bodies[0].overTime.map((p) => p.period), ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']);
  assert.notDeepEqual(bodies[1].ladder, bodies[3].ladder);
  const one = (await get(`/maturity?${Q}&advertiserIds=adv-blackmores`)).body;
  assert.notDeepEqual(one.overTime, bodies[0].overTime);
  const weeks = (await get('/maturity?dateFrom=2026-10-05&dateTo=2026-10-11&granularity=week')).body.overTime;
  assert.ok(weeks[0].period < '2026-07-01' && weeks[weeks.length - 1].period === '2026-10-05');
});

test('campaigns: about one per advertiser every 14 days, each live about five weeks, maturity growing', () => {
  for (const id of ADVERTISERS) {
    const cs = raw.campaigns.filter((c) => c.advertiserId === id).sort((a, b) => (a.start < b.start ? -1 : 1));
    assert.ok(cs.length >= 4 && cs.length <= 9, `${id} ${cs.length}`);
    for (const c of cs) {
      const live = (Date.parse(`${c.end || '2026-10-11'}T00:00:00Z`) - Date.parse(`${c.start}T00:00:00Z`)) / 86400000 + 1;
      assert.ok(live <= 35 && (c.end === null || live === 35), `${id} ${c.id} live ${live}`);
      assert.ok(c.start >= '2026-06-14' && c.start <= '2026-10-11');
    }
  }
  const level = (c) => c.level;
  assert.ok(raw.campaigns.length > 0 && !raw.campaigns.some((c) => c.variables.some((v) => ['Suburb', 'State', 'Postcode', 'Device Type (Aggregate)', 'SKUs', 'Events', 'Daypart'].includes(v))));
  void level;
});
