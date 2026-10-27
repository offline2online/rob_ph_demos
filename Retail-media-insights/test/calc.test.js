'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../src/calc');

test('README worked example: 4,000 x 0.5 x 1/10 = 200 views; $20 CPM = $4/day', () => {
  const views = calc.assumedViewsPerSlotPerDay(4000, 0.5, 6, 60);
  assert.equal(views, 200);
  assert.equal(calc.revenueAtCpm(20, views), 4);
  assert.equal(calc.shareOfLoop(6, 60), 0.1);
});

test('average assumed views returns display and store counts', () => {
  const d = (storeId, footfall) => ({ storeId, footfall, visibility: 0.5, slotSeconds: 6, loopSeconds: 60 });
  const r = calc.averageAssumedViews([d('a', 4000), d('a', 2000), d('b', 6000)]);
  assert.equal(r.value, 200);
  assert.equal(r.displayCount, 3);
  assert.equal(r.storeCount, 2);
  assert.deepEqual(calc.averageAssumedViews([]), { value: 0, displayCount: 0, storeCount: 0 });
});

test('effective CPM = revenue / (VAC-d / 1000)', () => {
  assert.equal(calc.effectiveCpm(4, 200), 20);
  assert.equal(calc.effectiveCpm(4, 0), 0);
});

test('revenue per available slot divides by slots, displays and days', () => {
  assert.equal(calc.perSlotPerDayPerDisplay(600, 5, 2, 3), 20);
  assert.equal(calc.perSlotPerDay(600, 5, 3), 40);
  assert.equal(calc.perSlotPerDayPerDisplay(600, 0, 2, 3), 0);
});

test('24-hour display types ignore store hours; others follow them', () => {
  const store = { open: 8, close: 20 };
  assert.deepEqual(calc.operatingWindow({ is24Hour: true }, store), { open: 0, close: 24 });
  assert.deepEqual(calc.operatingWindow({ is24Hour: false }, store), store);
  assert.deepEqual(calc.operatingWindow({ zone: 'Exterior' }, store), { open: 0, close: 24 }, 'Exterior defaults to 24 hours');
  assert.deepEqual(calc.operatingWindow({ is24Hour: false }, undefined), { open: 0, close: 0 }, 'no store hours: fail closed');
  assert.equal(calc.insideOperatingHours(7, store), false);
  assert.equal(calc.insideOperatingHours(8, store), true);
  assert.equal(calc.insideOperatingHours(20, store), false);
});

test('slots outside operating hours are never unsold', () => {
  const w = { open: 8, close: 20 };
  assert.equal(calc.classifySlot({ hour: 3, status: 'unsold' }, w), 'outsideHours');
  assert.equal(calc.classifySlot({ hour: 9, status: 'unsold' }, w), 'unsold');
  assert.equal(calc.classifySlot({ hour: 9, status: 'sold' }, w), 'sold');
  assert.equal(calc.classifySlot({ hour: 9, status: 'offline' }, w), 'offline');
});

test('fill is whole-number sold / (sold + unsold + offline)', () => {
  assert.equal(calc.fillPercent(2, 1), 67);
  assert.equal(calc.fillPercent(0, 0), 0);
  assert.equal(calc.fillPercent(1, 1, 2), 25);
});

test('fill matches the README worked example: 7,629 of 12,425 advertiser slots is 61%', () => {
  assert.equal(7629 + 4424 + 372, 12425);
  assert.equal(calc.fillPercent(7629, 4424, 372), 61);
});

test('missed revenue = unsold at floor CPM + downtime', () => {
  const m = calc.missedRevenue(10000, 8, 25);
  assert.equal(m.unsold, 80);
  assert.equal(m.downtime, 25);
  assert.equal(m.total, 105);
});

test('PG guarantee = forecast x (1 - buffer); pacing = delivered / guaranteed to date', () => {
  assert.equal(calc.guaranteedVolume(1000, 0.1), 900);
  const p = calc.pgPacing({ delivered: 450, forecast: 1000, buffer: 0.1, daysElapsed: 5, totalDays: 10 });
  assert.equal(p.guaranteedToDate, 450);
  assert.equal(p.pacing, 1);
  assert.equal(calc.pgPacing({ delivered: 1, forecast: 1000, buffer: 0, daysElapsed: 0, totalDays: 10 }).pacing, 0);
});

test('maturity is the highest level across campaigns', () => {
  assert.equal(calc.maturityLevel(['Default only', 'Personalised', 'Localised']), 'Personalised');
  assert.equal(calc.maturityLevel(['Default only']), 'Default only');
  assert.equal(calc.maturityLevel([]), null);
});

test('parts add to the total as returned; percent split adds to 100', () => {
  const r = calc.roundParts([33.4, 33.4, 33.4]);
  assert.equal(r.total, r.parts.reduce((a, b) => a + b, 0));
  const split = calc.percentSplit([1, 1, 1]);
  assert.equal(split.reduce((a, b) => a + b, 0), 100);
  assert.equal(calc.wholePercent(1, 3), 33);
});

test('USD formatting', () => {
  assert.equal(calc.formatUsd(12345), '$12,345');
  assert.equal(calc.formatUsd(4, 2), '$4.00');
});

test('standard orderings: deal types, DSPs, shopper-journey zones', () => {
  const dt = ['Open auction', 'Private auction', 'Programmatic guaranteed', 'Preferred deal'].sort(calc.compareDealTypes);
  assert.deepEqual(dt, ['Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction']);
  assert.deepEqual(['Amazon DSP', 'DV360', 'The Trade Desk'].sort(calc.compareDsps), ['DV360', 'The Trade Desk', 'Amazon DSP']);
  const z = ['Checkout', 'Exterior', 'In aisles', 'Entrance & out of category'].sort(calc.compareZones);
  assert.deepEqual(z, ['Exterior', 'Entrance & out of category', 'In aisles', 'Checkout']);
});

test('hoursMode labels 24 hours, custom hours and store opening hours without naming times', () => {
  assert.strictEqual(calc.hoursMode({ is24Hour: true, customHours: { open: 8, close: 20 } }), '24 hours');
  assert.strictEqual(calc.hoursMode({ is24Hour: false, customHours: { open: 8, close: 20 } }), 'Custom hours');
  assert.strictEqual(calc.hoursMode({ is24Hour: false }), 'Store opening hours');
  assert.deepStrictEqual(calc.operatingWindow({ is24Hour: false, customHours: { open: 8, close: 20 } }, { open: 9, close: 17 }), { open: 8, close: 20 });
});

test('roundToTotal: rounded parts add to the rounded sum', () => {
  const parts = calc.roundToTotal([1.004, 1.004, 1.004], 2);
  assert.equal(Math.round(parts.reduce((a, b) => a + b, 0) * 100), 301);
  assert.deepEqual(calc.roundToTotal([0.4, 0.4, 0.4], 0), [1, 0, 0]);
});
