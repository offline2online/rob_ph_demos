import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpeningHours, storeState, storeNow, parseTestTime, fmtShort, fmtLong, weeklyRows } from '../js/hours.js';

const day = (d, o, c, cd = d) => ({ open_day: d, open_time: o + ':00', close_day: cd, close_time: c + ':00', is_active: true });
const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
const beaumaris = parseOpeningHours([...WEEKDAYS.map((d) => day(d, '08:30', '19:00')), day('SATURDAY', '09:00', '13:30')]);
const at = (d, t) => ({ day: d, min: +t.split(':')[0] * 60 + +t.split(':')[1] });

test('open, last 30 minutes, before opening and after closing', () => {
  assert.equal(storeState(beaumaris, at('wed', '12:00')).state, 'open');
  assert.equal(storeState(beaumaris, at('wed', '18:30')).state, 'closing');
  assert.equal(storeState(beaumaris, at('wed', '18:29')).state, 'open');
  assert.equal(storeState(beaumaris, at('wed', '19:00')).state, 'closed');
  const b = storeState(beaumaris, at('wed', '07:00'));
  assert.equal(b.state, 'before');
  assert.equal(b.openTime, '08:30');
  assert.equal(storeState(beaumaris, at('wed', '12:00')).closeTime, '19:00');
});

test('a day with no hours is closed, and ${OpenTime} points at the next opening', () => {
  const s = storeState(beaumaris, at('sun', '11:00'));
  assert.equal(s.state, 'closed');
  assert.equal(s.openTime, '08:30');
  assert.equal(s.session.day, 'mon');
});

test('sessions that cross midnight', () => {
  const late = parseOpeningHours([day('SATURDAY', '20:00', '02:00', 'SUNDAY'), day('SUNDAY', '22:00', '01:00', 'MONDAY')]);
  assert.equal(storeState(late, at('sat', '23:00')).state, 'open');
  assert.equal(storeState(late, at('sun', '01:45')).state, 'closing');
  assert.equal(storeState(late, at('sun', '01:45')).closeTime, '02:00');
  assert.equal(storeState(late, at('sun', '02:00')).state, 'before');
  // Sunday 22:00 -> Monday 01:00 wraps the end of the week
  assert.equal(storeState(late, at('mon', '00:15')).state, 'open');
  assert.equal(storeState(late, at('mon', '00:45')).state, 'closing');
  // same-day close earlier than open also means "next day"
  const same = parseOpeningHours([day('FRIDAY', '21:00', '03:00')]);
  assert.equal(storeState(same, at('sat', '02:00')).state, 'open');
});

test('inactive and malformed rows are ignored', () => {
  const s = parseOpeningHours([{ ...day('MONDAY', '09:00', '17:00'), is_active: false }, { open_day: 'XYZ', open_time: '09:00:00', close_time: '10:00:00' }, null]);
  assert.deepEqual(s, []);
  assert.equal(storeState(s, at('mon', '10:00')).state, 'closed');
});

test('store time is taken in the store timezone', () => {
  const d = new Date('2026-11-20T01:30:00Z'); // Friday 12:30 in Melbourne (AEDT, UTC+11)
  assert.deepEqual(storeNow('Australia/Melbourne', d), { day: 'fri', min: 12 * 60 + 30 });
  assert.deepEqual(storeNow('Australia/Perth', d), { day: 'fri', min: 9 * 60 + 30 });
  assert.deepEqual(storeNow('Australia/Melbourne', d, { day: 'mon', min: 5 }), { day: 'mon', min: 5 });
});

test('test-time parameter', () => {
  assert.deepEqual(parseTestTime('fri-18:45'), { day: 'fri', min: 1125 });
  assert.deepEqual(parseTestTime('Saturday 09:05'), { day: 'sat', min: 545 });
  assert.deepEqual(parseTestTime('07:00', 'tue'), { day: 'tue', min: 420 });
  assert.equal(parseTestTime('nonsense'), null);
});

test('time formats', () => {
  assert.equal(fmtShort('19:00', true), '7PM');
  assert.equal(fmtShort('08:30'), '8.30am');
  assert.equal(fmtShort('00:00'), '12am');
  assert.equal(fmtShort(''), '');
  assert.equal(fmtLong('13:30'), '1.30pm');
  const rows = weeklyRows(beaumaris);
  assert.equal(rows[0].text, '8.30am – 7.00pm');
  assert.equal(rows[5].text, '9.00am – 1.30pm');
  assert.equal(rows[6].text, null);
});
