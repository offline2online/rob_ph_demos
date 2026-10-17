'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE } = require('../src/server');
const calc = require('../src/calc');

const { raw, ctx } = generateTestRetailer({ days: 90 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const Q = 'dateFrom=2026-08-13&dateTo=2026-10-11';

async function get(path, opts = {}) {
  const server = createServer({ store, today: '2026-10-11', ...opts });
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

test('ladder: an advertiser with one personalised campaign is Personalised; lists carry DSP and type', async () => {
  const { body } = await get(`/maturity?${Q}`);
  assert.deepEqual(body.ladder.map((l) => [l.level, l.advertisers]), [['Default only', 1], ['Localised', 1], ['Personalised', 1]]);
  const p = body.ladder[2].list[0];
  assert.deepEqual(p, { advertiserId: 'adv-blackmores', name: 'Blackmores', dsp: 'DV360', personalisationTypes: ['Identified visitor'] });
});

test('variables in use: Shared Targeting Variables only, Daypart excluded, ranked with advertiser lists', async () => {
  const { body } = await get(`/maturity?${Q}`);
  const labels = body.variablesInUse.map((v) => v.variable);
  assert.ok(!labels.includes('Daypart'));
  assert.equal(labels[0], 'State');
  assert.equal(body.variablesInUse[0].advertisers, 2);
  assert.deepEqual(body.variablesInUse[0].list.map((a) => a.name), ['Acme', 'Blackmores']);
  assert.deepEqual(new Set(labels), new Set(['State', 'Visitor Segments', 'Postcode', 'Suburb']));
  const per = (await get(`/maturity?${Q}&kind=Personalised`)).body.variablesInUse;
  assert.deepEqual(per.map((v) => v.variable), ['Visitor Segments']);
});

test('scheduling counts advertisers with campaign and schedule counts', async () => {
  const { body } = await get(`/maturity?${Q}`);
  const [uses, none] = body.scheduling;
  assert.equal(uses.advertisers, 2);
  assert.deepEqual(uses.list.find((a) => a.name === 'Blackmores'), { advertiserId: 'adv-blackmores', name: 'Blackmores', dsp: 'DV360', scheduledCampaigns: 1, campaigns: 2, schedules: 2 });
  assert.deepEqual(none.list.map((a) => a.name), ['Nova']);
});

test('table sorts by level then revenue and filters by level, variable and scheduling', async () => {
  const all = (await get(`/maturity?${Q}`)).body.table;
  assert.deepEqual(all.map((r) => r.level), ['Personalised', 'Localised', 'Default only']);
  assert.ok(all.every((r) => r.revenue > 0));
  assert.deepEqual((await get(`/maturity?${Q}&level=Localised`)).body.table.map((r) => r.name), ['Acme']);
  assert.deepEqual((await get(`/maturity?${Q}&variable=Visitor Segments`)).body.table.map((r) => r.name), ['Blackmores']);
  assert.deepEqual((await get(`/maturity?${Q}&scheduling=none`)).body.table.map((r) => r.name), ['Nova']);
  assert.equal((await get(`/maturity?${Q}&level=Gold`)).status, 400);
  assert.equal((await get(`/maturity?${Q}&scheduling=maybe`)).status, 400);
});

test('over time: share of campaigns by level adds to 100 per period; week and month', async () => {
  const month = (await get(`/maturity?${Q}`)).body;
  assert.equal(month.granularity, 'month');
  for (const p of month.overTime) assert.equal(p.levels.reduce((s, l) => s + l.percent, 0), 100);
  assert.equal(month.overTime[0].period, '2026-08-01');
  const week = (await get(`/maturity?${Q}&granularity=week`)).body;
  assert.ok(week.overTime.length > month.overTime.length);
  assert.equal(week.overTime[0].period, '2026-08-10');
  assert.equal((await get(`/maturity?${Q}&granularity=day`)).status, 400);
});

test('advertiser logins only ever see themselves', async () => {
  const { body } = await get(`/maturity?${Q}&advertiserIds=adv-nova`, { authenticate: () => ({ advertiserId: 'adv-acme' }) });
  assert.deepEqual(body.table.map((r) => r.name), ['Acme']);
  assert.ok(!JSON.stringify(body).includes('Blackmores'));
});
