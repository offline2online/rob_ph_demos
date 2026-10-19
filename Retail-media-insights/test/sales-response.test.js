'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const { admin, advertiser } = require('./helpers');

const { raw, ctx } = generateTestRetailer({ days: 120 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const Q = 'dateFrom=2026-09-12&dateTo=2026-10-11';

async function get(path, { authenticate = admin, from = store } = {}) {
  const server = createServer({ store: from, today: '2026-10-11', authenticate });
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${BASE}${path}`);
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}
const line = (b, key) => b.lines.find((l) => l.key === key);

test('three lines render for a campaign with localised and personalised plays and a Control stores exclusion', async () => {
  const { status, body } = await get(`/sales-response?${Q}&advertiserIds=adv-blackmores`);
  assert.equal(status, 200);
  assert.deepEqual(body.lines.map((l) => [l.key, l.available]), [['personalised', true], ['localised', true], ['control', true]]);
  assert.equal(body.window, 10); assert.equal(body.step, 1); assert.equal(body.view, 'step');
  for (const l of body.lines) assert.equal(l.points.length, 10);
  assert.equal(body.lines[0].points[0].label, 'Minute 0 after play');
  // The personalised effect: the first minutes sit above the control line and fall back towards it.
  const p = line(body, 'personalised').points; const c = line(body, 'control').points;
  assert.ok(p[0].value > 2 * c[0].value, `${p[0].value} vs ${c[0].value}`);
  assert.ok(p[9].value < p[0].value);
  assert.ok(body.campaigns.every((x) => x.advertiserId === 'adv-blackmores'), 'the page Advertiser filter narrows the drop-down');
  assert.equal(body.coverage.controlStores, 1);
  assert.ok(body.coverage.storeNames.length === 4 && !body.coverage.storeNames.includes('Glasgow Buchanan St'), 'Control stores are not treated stores');
});

test('window, step, view and hour controls change the chart; the step cannot exceed the window; a custom window is capped at 120', async () => {
  const base = `/sales-response?${Q}&advertiserIds=adv-blackmores`;
  const w30 = (await get(`${base}&window=30&step=5`)).body;
  assert.equal(w30.lines[0].points.length, 6);
  assert.deepEqual(w30.lines[0].points.slice(0, 2).map((x) => x.label), ['Minutes 0–4 after play', 'Minutes 5–9 after play']);
  const custom = (await get(`${base}&window=7&step=5`)).body;
  assert.deepEqual(custom.lines[0].points.map((x) => [x.from, x.to]), [[0, 5], [5, 7]]);
  assert.equal((await get(`${base}&window=120&step=15`)).body.lines[0].points.length, 8);
  for (const bad of ['window=121', 'window=0', 'window=x', 'window=5&step=15', 'step=2', 'view=cumulative', 'hourFrom=9', 'hourFrom=12&hourTo=9', 'hourFrom=2&hourTo=3']) {
    assert.equal((await get(`${base}&${bad}`)).status, 400, bad);
  }
  const per = (await get(`${base}&window=15&step=5`)).body; const run = (await get(`${base}&window=15&step=5&view=running`)).body;
  let acc = 0;
  per.lines[0].points.forEach((pt, i) => { acc += pt.sales; assert.equal(run.lines[0].points[i].sales, acc); });
  assert.ok(run.lines[0].points[2].value > run.lines[0].points[0].value);
  const lunch = (await get(`${base}&hourFrom=12&hourTo=13`)).body; const all = (await get(base)).body;
  assert.ok(lunch.lines[0].plays > 0 && lunch.lines[0].plays < all.lines[0].plays);
  assert.deepEqual(lunch.hourBand, { from: 12, to: 13 });
});

test('rates reconcile: sales / transactions x 1,000 per point', async () => {
  const { body } = await get(`/sales-response?${Q}&advertiserIds=adv-haleon&window=15&step=5`);
  for (const l of body.lines.filter((x) => x.available)) {
    assert.ok(l.plays > 0);
    for (const pt of l.points) { assert.ok(pt.transactions > 0); assert.equal(pt.value, Math.round((pt.sales / pt.transactions) * 100000) / 100); }
  }
});

test('no footfall or shoppers anywhere in the response; control transactions come from control stores at the same clock minutes', async () => {
  const { body } = await get(`/sales-response?${Q}&advertiserIds=adv-haleon&window=10&step=5`);
  assert.doesNotMatch(JSON.stringify(body), /footfall|shopper/i);
  const [p, , c] = body.lines;
  if (c.available) for (let i = 0; i < c.points.length; i += 1) assert.ok(c.points[i].transactions > 0 && c.points[i].plays === p.plays);
});

test('a sale inside two overlapping windows is counted once, against the nearest preceding play', async () => {
  const { raw: r, ctx: c } = generateTestRetailer({ days: 3 });
  const s = new AggregateStore(buildAggregates(r, c));
  const camp = s.campaigns.find((x) => x.level === 'Personalised' && x.advertiserId === 'adv-blackmores' && x.start <= '2026-10-11' && (!x.end || x.end >= '2026-10-11'));
  const t0 = 12 * 3600;
  // Personalised play at 12:00:00, localised at 12:02:00; sales at 12:01:40 (only the first play precedes it), 12:02:30 (both
  // precede it: the nearest is the localised one) and 12:20:00 (outside both windows).
  const day = { plays: [{ t: t0, tier: 'personalised', displayTypeId: 'window' }, { t: t0 + 120, tier: 'localised', displayTypeId: 'window' }], sales: [t0 + 100, t0 + 150, t0 + 1200] };
  const empty = { plays: [], sales: [] };
  const q = new URLSearchParams('dateFrom=2026-10-11&dateTo=2026-10-11&window=10&hourFrom=12&hourTo=12&storeIds=store-1&displayTypeIds=window');
  const { filters } = (() => { const { parseFilters } = require('../src/filters'); return { filters: parseFilters(q, { today: '2026-10-11' }) }; })();
  const sr = require('../src/sales-response');
  sr.salesResponse(s, camp, filters, { window: 10, step: 1, view: 'step', hoursError: Error }); // creates the caches
  const cache = s.__salesResponse.days;
  cache.clear();
  cache.set(`${camp.id}|store-1|2026-10-11|0`, day);
  for (const sid of ['store-5']) cache.set(`${camp.id}|${sid}|2026-10-11|1`, empty);
  const out = sr.salesResponse(s, camp, filters, { window: 10, step: 1, view: 'step', hourFrom: 12, hourTo: 12, hoursError: Error });
  assert.deepEqual(out.lines.personalised.sales.map((n, i) => (n ? i : null)).filter((i) => i !== null), [1]);
  assert.equal(out.lines.personalised.sales.reduce((a, b) => a + b, 0), 1);
  assert.equal(out.lines.localised.sales.reduce((a, b) => a + b, 0), 1);
  assert.equal(out.lines.localised.sales[0], 1); // 12:02:30 is 30 seconds after the localised play
  assert.equal(out.lines.personalised.plays, 1); assert.equal(out.lines.localised.plays, 1);
});

test('advertiser login: own campaigns only, no other advertiser named, another advertiser’s campaign refused, retailer-only fields absent', async () => {
  const as = { authenticate: advertiser('adv-blackmores') };
  const { status, body } = await get(`/sales-response?${Q}`, as);
  assert.equal(status, 200);
  assert.ok(body.campaigns.length > 0 && body.campaigns.every((x) => x.id.startsWith('c-blackmores-')));
  for (const x of body.campaigns) assert.ok(!('advertiserId' in x) && !('dsp' in x));
  const other = (await get(`/sales-response?${Q}`)).body.campaigns.find((x) => x.advertiserId === 'adv-haleon');
  assert.equal((await get(`/sales-response?${Q}&campaignId=${other.id}`, as)).status, 400);
  // A client-supplied advertiser filter cannot widen the scope.
  const widened = (await get(`/sales-response?${Q}&advertiserIds=adv-haleon`, as)).body;
  assert.ok(widened.campaigns.every((x) => x.id.startsWith('c-blackmores-')));
  assert.ok(!JSON.stringify(body).includes('Haleon'));
});

test('only campaigns with personalised variants are listed', async () => {
  const { body } = await get(`/sales-response?${Q}`);
  const personalised = new Set(store.campaigns.filter((c) => c.level === 'Personalised').map((c) => c.id));
  assert.ok(body.campaigns.length > 0 && body.campaigns.every((c) => personalised.has(c.id)));
  assert.ok(!body.campaigns.some((c) => c.advertiserId === 'adv-unilever'), 'Default only advertisers are not listed');
});

test('empty states: no POS, no personalised plays, no Control stores; product-name matches are flagged', async () => {
  const noPos = new AggregateStore(buildAggregates(raw, { ...ctx, transactionApi: false }));
  const a = (await get(`/sales-response?${Q}`, { from: noPos })).body;
  assert.equal(a.emptyReason, 'no-pos'); assert.equal(a.emptyText, 'Requires a POS integration into the Personalisation Hub Transaction API.'); assert.deepEqual(a.lines, []);
  const b = (await get(`/sales-response?${Q}&advertiserIds=adv-blackmores&storeIds=store-5`)).body; // the only store selected is a Control store
  assert.equal(b.emptyReason, 'no-personalised-plays'); assert.equal(b.emptyText, 'No personalised plays for this campaign in the selected period.');
  const c = (await get(`/sales-response?${Q}&advertiserIds=adv-kenvue`)).body;
  assert.equal(c.matchedOnProductName, true);
  const ctl = line(c, 'control');
  assert.equal(ctl.available, false); assert.equal(ctl.note, 'Control stores — none set for this campaign.'); assert.deepEqual(ctl.points, []);
  assert.deepEqual(c.lines.filter((l) => l.available).map((l) => l.key), ['personalised', 'localised']);
  assert.equal((await get(`/sales-response?${Q}&advertiserIds=adv-blackmores`)).body.matchedOnProductName, false);
  const none = (await get(`/sales-response?${Q}&advertiserIds=adv-unilever`)).body;
  assert.equal(none.emptyReason, 'no-campaigns');
});
