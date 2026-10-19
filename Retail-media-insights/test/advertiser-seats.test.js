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
const by = (body) => Object.fromEntries(body.all.map((a) => [a.advertiserId, a]));
const cents = (n) => Math.round(n * 100);

test('seats: an advertiser\'s seats add up to its row (revenue in cents, whole-percent shares to 100)', async () => {
  const { body } = await get('/advertisers');
  for (const a of body.all) {
    if (!a.seats.length) continue;
    assert.equal(a.seats.reduce((n, x) => n + cents(x.revenue), 0), cents(a.revenue), a.name);
    assert.equal(a.seats.reduce((n, x) => n + x.share, 0), 100, a.name);
    assert.equal(a.seatCount, a.seats.length);
    assert.ok(a.seats.every((x) => x.seatId && x.name && x.dsp && x.firstWin <= x.lastWin));
  }
  const haleon = by(body)['adv-haleon'];
  assert.deepEqual(haleon.seats.map((x) => x.name).sort(), ['GroupM AU', 'Haleon In-house']);
});

test('seats: a direct advertiser has no seat', async () => {
  const perrigo = by((await get('/advertisers')).body)['adv-perrigo'];
  assert.equal(perrigo.direct, true);
  assert.equal(perrigo.seatCount, 0);
  assert.deepEqual(perrigo.seats, []);
  assert.equal(by((await get('/advertisers')).body)['adv-haleon'].direct, false);
});

test('seats: a seat dropped from the DSP sync keeps its history and is flagged', async () => {
  const kenvue = by((await get('/advertisers?dateFrom=2026-07-13&dateTo=2026-10-11')).body)['adv-kenvue'];
  const old = kenvue.seats.find((x) => x.seatId === 'dv-mindshare-au');
  assert.ok(old && old.revenue > 0 && old.synced === false);
  assert.ok(kenvue.seats.find((x) => x.seatId === 'dv-publicis-au').synced);
  const recent = by((await get('/advertisers?dateFrom=2026-10-01&dateTo=2026-10-11')).body)['adv-kenvue'];
  assert.ok(!recent.seats.some((x) => x.seatId === 'dv-mindshare-au'), 'no wins in the range, no sub-row');
});

test('seats: page filters narrow the sub-rows and they still reconcile', async () => {
  const q = '/advertisers?dateFrom=2026-09-12&dateTo=2026-10-11&storeIds=store-1&displayTypeIds=window';
  const narrow = by((await get(q)).body); const wide = by((await get('/advertisers?dateFrom=2026-09-12&dateTo=2026-10-11')).body);
  for (const [id, a] of Object.entries(narrow)) {
    if (a.direct) continue;
    assert.equal(a.seats.reduce((n, x) => n + cents(x.revenue), 0), cents(a.revenue), id);
    assert.ok(a.revenue <= wide[id].revenue);
  }
  const one = (await get('/advertisers?advertiserIds=adv-reckitt')).body;
  assert.deepEqual(one.all.map((a) => a.advertiserId), ['adv-reckitt']);
  assert.ok(one.all[0].seats.length === 2);
});

test('seats: an advertiser login gets no seat data from the Advertisers route', async () => {
  const { body } = await get('/advertisers', { authenticate: advertiser('adv-reckitt'), routes: optIn('advertisers') });
  const text = JSON.stringify(body);
  assert.ok(!/seat|Dentsu|Trading Desk/i.test(text.replace(/"seats":\[\]|"seatCount":0/g, '')), 'no seat names, ids or other advertisers');
  assert.deepEqual(body.all[0].seats, []);
  assert.equal(body.all[0].direct, false);
});
