'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SR = require('../sales-response.js');
const { get, ADVERTISER } = require('./api.js');

test('steps never exceed the window; a custom window is whole minutes from 1 to 120', () => {
  assert.deepEqual(SR.stepOptions(5), [1, 5]);
  assert.deepEqual(SR.stepOptions(10), [1, 5]);
  assert.deepEqual(SR.stepOptions(30), [1, 5, 15]);
  for (const ok of ['1', '45', '120']) assert.notEqual(SR.parseCustomWindow(ok), null, ok);
  for (const bad of ['0', '121', '2.5', 'x', '', '-3']) assert.equal(SR.parseCustomWindow(bad), null, bad);
});

test('legend toggles keep at least one line on', () => {
  assert.deepEqual(SR.toggleLine(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(SR.toggleLine(['b'], 'b'), ['b']);
  assert.deepEqual(SR.toggleLine(['b'], 'a'), ['b', 'a']);
});

test('point hover shows minute, each visible line, plays, sales, transactions, stores and dates, from the real endpoint', async () => {
  const d = await get('/sales-response', { advertiserIds: 'adv-blackmores' });
  const m = SR.pointHover(d, 3, ['personalised', 'control']);
  assert.equal(m.title, 'Minute 3 after play');
  assert.deepEqual(m.sections.map((s) => s.head), ['After a personalised play', 'Control stores, same clock time']);
  assert.deepEqual(m.sections[0].rows.map((r) => r[0]), ['Sales per 1,000 transactions', 'Plays', 'Sales counted', 'Transactions (all baskets) behind the rate']);
  assert.deepEqual(m.rows.map((r) => r[0]), ['Stores', 'Dates']);
});

test('advertiser drop-down labels carry no other advertiser', async () => {
  const d = await get('/sales-response', {}, ADVERTISER);
  for (const c of d.campaigns) assert.ok(!SR.campaignLabel(c).includes('—'));
});

test('legend toggles follow the lines: new variation lines start on, vanished ones drop out, one always stays on', () => {
  const seen = [];
  let on = SR.syncOn([], seen, [{ key: 'personalised', available: true }, { key: 'localised', available: true }]);
  assert.deepEqual(on, ['personalised', 'localised']);
  on = SR.toggleLine(on, 'localised');
  on = SR.syncOn(on, seen, [{ key: 'personalised:a', available: true }, { key: 'personalised:b', available: false }, { key: 'localised', available: true }]);
  assert.deepEqual(on, ['personalised:a']);
});

test('a variation’s hover names its tier, rules, plays, stores and private audience', () => {
  const m = SR.variationHover({ label: 'New to brand', tier: 'personalised', rules: ['Visitor segments is one of: Blackmores · new to brand'], plays: 120, stores: { count: 2, names: ['A', 'B'] }, audienceNote: 'Audience shared only with this advertiser' });
  assert.equal(m.title, 'New to brand');
  const text = JSON.stringify(m.rows);
  for (const want of ['Personalised', 'Visitor segments is one of', '"120"', '"2"', 'A, B', 'Audience shared only with this advertiser']) assert.ok(text.includes(want), want);
});
