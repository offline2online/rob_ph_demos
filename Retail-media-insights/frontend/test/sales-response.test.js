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

test('point hover shows minute, each visible line, plays, sales, shoppers, stores and dates, from the real endpoint', async () => {
  const d = await get('/sales-response', { advertiserIds: 'adv-blackmores' });
  const m = SR.pointHover(d, 3, ['personalised', 'control']);
  assert.equal(m.title, 'Minute 3 after play');
  assert.deepEqual(m.sections.map((s) => s.head), ['After a personalised play', 'Control stores, same clock time']);
  assert.deepEqual(m.sections[0].rows.map((r) => r[0]), ['Sales per 1,000 shoppers', 'Plays', 'Sales counted', 'Shoppers (footfall)']);
  assert.deepEqual(m.rows.map((r) => r[0]), ['Stores', 'Dates']);
});

test('advertiser drop-down labels carry no other advertiser', async () => {
  const d = await get('/sales-response', {}, ADVERTISER);
  for (const c of d.campaigns) assert.ok(!SR.campaignLabel(c).includes('—'));
});
