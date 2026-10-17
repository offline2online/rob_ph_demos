'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const { admin, advertiser, optIn } = require('./helpers');
const calc = require('../src/calc');

const { raw, ctx } = generateTestRetailer({ days: 120 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const Q = 'dateFrom=2026-08-13&dateTo=2026-10-11';

async function get(path, opts = {}) {
  const server = createServer({ store, today: '2026-10-11', authenticate: admin, ...opts });
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${BASE}${path}`);
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}

test('calc: Daypart and unknown labels are never variables; level is the highest used', () => {
  assert.deepEqual(calc.sharedVariables(['Daypart', 'Nonsense']), []);
  assert.equal(calc.campaignLevel(['Daypart']), 'Default only');
  assert.equal(calc.campaignLevel(['State']), 'Localised');
  assert.equal(calc.campaignLevel(['State', 'Gender (Computer Vision)']), 'Personalised');
});

const Q_TARGET = 'dateFrom=2026-09-12&dateTo=2026-10-11';
const names = (list) => list.map((a) => a.name).sort();

test('ladder: the example retailer has 2 Default only, 4 Localised and 5 Personalised advertisers; lists carry DSP and type', async () => {
  const { body } = await get(`/maturity?${Q_TARGET}`);
  assert.deepEqual(body.ladder.map((l) => [l.level, l.advertisers]), [['Default only', 2], ['Localised', 4], ['Personalised', 5]]);
  assert.deepEqual(names(body.ladder[0].list), ['Perrigo', 'Unilever']);
  assert.deepEqual(names(body.ladder[1].list), ['Bayer Consumer Health', 'Nestlé Health Science', 'Reckitt', 'Vitabiotics']);
  const types = Object.fromEntries(body.ladder[2].list.map((a) => [a.name, a.personalisationTypes]));
  assert.deepEqual(types, {
    Blackmores: ['Aggregate', 'Computer Vision'], Haleon: ['Computer Vision'], Kenvue: ['Computer Vision'], 'Procter & Gamble': ['Computer Vision'],
    "L'Oréal Paris": ['Computer Vision', 'Identified visitor'],
  });
  assert.deepEqual(body.ladder[2].list.find((a) => a.name === 'Blackmores'), { advertiserId: 'adv-blackmores', name: 'Blackmores', dsp: 'DV360', personalisationTypes: ['Aggregate', 'Computer Vision'] });
});

test('variables in use: only the Shared Targeting Variables the example advertisers use, Daypart excluded, ranked with advertiser lists', async () => {
  const { body } = await get(`/maturity?${Q_TARGET}`);
  const labels = body.variablesInUse.map((v) => v.variable);
  assert.ok(!labels.includes('Daypart'));
  const allowed = new Set(['Store Open / Closed', 'Fixed Store Segments', 'Variable Store Segments', 'Display Tag(s)', 'Gender (Computer Vision)', 'Estimated Age (Computer Vision)',
    'Reason for Visit (Aggregate)', 'Purchase History', 'Purchase Intent', 'Visitor Segments']);
  assert.ok(labels.every((l) => allowed.has(l)), labels.join('; '));
  for (const none of ['Suburb', 'State', 'Postcode', 'Device Type (Aggregate)', 'SKUs', 'Events']) assert.ok(!labels.includes(none), none);
  for (let i = 1; i < body.variablesInUse.length; i += 1) assert.ok(body.variablesInUse[i - 1].advertisers >= body.variablesInUse[i].advertisers);
  const per = (await get(`/maturity?${Q_TARGET}&kind=Personalised`)).body.variablesInUse;
  assert.ok(per.length > 0 && per.every((v) => v.kind === 'Personalised'));
});

test('scheduling: Blackmores 3 of 4 campaigns and 5 schedules, Haleon 3 of 4 and 7, L\'Oréal 1 of 2 and 1, Procter & Gamble 1 of 2 and 3, Nestlé 2 of 4 and 5; the other 6 use none', async () => {
  const { body } = await get(`/maturity?${Q_TARGET}`);
  const [uses, none] = body.scheduling;
  assert.equal(uses.advertisers, 5);
  assert.equal(none.advertisers, 6);
  const got = Object.fromEntries(uses.list.map((a) => [a.name, [a.scheduledCampaigns, a.campaigns, a.schedules]]));
  assert.deepEqual(got, { Blackmores: [3, 4, 5], Haleon: [3, 4, 7], "L'Oréal Paris": [1, 2, 1], 'Procter & Gamble': [1, 2, 3], 'Nestlé Health Science': [2, 4, 5] });
});

test('table sorts by level then revenue and filters by level, variable and scheduling', async () => {
  const all = (await get(`/maturity?${Q_TARGET}`)).body.table;
  assert.deepEqual(all.map((r) => r.level), [...Array(5).fill('Personalised'), ...Array(4).fill('Localised'), ...Array(2).fill('Default only')]);
  assert.ok(all.every((r) => r.revenue > 0));
  assert.deepEqual((await get(`/maturity?${Q_TARGET}&level=Default only`)).body.table.map((r) => r.name).sort(), ['Perrigo', 'Unilever']);
  assert.deepEqual((await get(`/maturity?${Q_TARGET}&variable=Purchase History`)).body.table.map((r) => r.name), ["L'Oréal Paris"]);
  assert.equal((await get(`/maturity?${Q_TARGET}&scheduling=none`)).body.table.length, 6);
  assert.equal((await get(`/maturity?${Q_TARGET}&level=Gold`)).status, 400);
  assert.equal((await get(`/maturity?${Q_TARGET}&scheduling=maybe`)).status, 400);
});

test('over time: share of campaigns by level adds to 100 per period and covers the whole history, whatever the date range', async () => {
  const month = (await get(`/maturity?${Q}`)).body;
  assert.equal(month.granularity, 'month');
  for (const p of month.overTime) assert.equal(p.levels.reduce((s, l) => s + l.percent, 0), 100);
  assert.deepEqual(month.overTime.map((p) => p.period), ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']);
  // Maturity grows: Personalised rises and Default only falls from the first month to the last.
  const share = (p, level) => p.levels.find((l) => l.level === level).percent;
  assert.ok(share(month.overTime[0], 'Default only') > share(month.overTime[4], 'Default only'));
  assert.ok(share(month.overTime[0], 'Personalised') < share(month.overTime[4], 'Personalised'));
  const week = (await get(`/maturity?${Q}&granularity=week`)).body;
  assert.ok(week.overTime.length > month.overTime.length);
  assert.ok(week.overTime[0].period.startsWith('2026-06'), week.overTime[0].period);
  assert.equal((await get(`/maturity?${Q}&granularity=day`)).status, 400);
  // Identical for every date range; the ladder still follows the range.
  const ranges = ['dateFrom=2026-10-05&dateTo=2026-10-11', 'dateFrom=2026-06-14&dateTo=2026-06-20', 'dateFrom=2026-09-12&dateTo=2026-10-11'];
  const bodies = [];
  for (const r of ranges) bodies.push((await get(`/maturity?${r}`)).body);
  for (const b of bodies) assert.deepEqual(b.overTime, bodies[0].overTime);
  assert.notDeepEqual(bodies[1].ladder, bodies[2].ladder);
  // Store, display type and advertiser still apply.
  const one = (await get(`/maturity?${Q_TARGET}&advertiserIds=adv-perrigo`)).body;
  assert.ok(one.overTime.every((p) => p.levels.find((l) => l.level === 'Default only').percent === 100));
  assert.notDeepEqual(one.overTime, bodies[0].overTime);
});

test('advertiser logins only ever see themselves', async () => {
  const { body } = await get(`/maturity?${Q}&advertiserIds=adv-unilever`, { authenticate: advertiser('adv-haleon'), routes: optIn('maturity') });
  assert.deepEqual(body.table.map((r) => r.name), ['Haleon']);
  assert.ok(!JSON.stringify(body).includes('Blackmores'));
});
