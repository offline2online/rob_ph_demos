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

// The bar state from a real instant, evaluated in the store's own timezone (store_location.store_timezone).
const stateAt = (iso, tz, sessions = beaumaris) => storeState(sessions, storeNow(tz, new Date(iso))).state;

test('bar state from a real UTC instant in each store timezone', () => {
  // Friday 20 Nov 2026 07:50Z: 18:50 in Melbourne (AEDT), 15:50 in Perth (AWST), 17:50 in Brisbane (AEST, no DST)
  assert.equal(stateAt('2026-11-20T07:50:00Z', 'Australia/Melbourne'), 'closing');
  assert.equal(stateAt('2026-11-20T07:50:00Z', 'Australia/Perth'), 'open');
  assert.equal(stateAt('2026-11-20T07:50:00Z', 'Australia/Brisbane'), 'open');
  // Friday 20:00 in Melbourne is 09:00Z: before opening in no store, after close in Melbourne
  assert.equal(stateAt('2026-11-20T09:00:00Z', 'Australia/Melbourne'), 'closed');
  // Friday 07:00 in Melbourne (20:00Z Thursday): before opening, ${OpenTime} today
  const s = storeState(beaumaris, storeNow('Australia/Melbourne', new Date('2026-11-19T20:00:00Z')));
  assert.equal(s.state, 'before');
  assert.equal(s.openTime, '08:30');
  // Sunday (no hours) is a closed day all day, whatever the time
  assert.equal(stateAt('2026-11-22T01:00:00Z', 'Australia/Melbourne'), 'closed');
  // Saturday 13:00-13:30 in Melbourne is the last 30 minutes
  assert.equal(stateAt('2026-11-21T02:15:00Z', 'Australia/Melbourne'), 'closing');
  assert.equal(stateAt('2026-11-21T01:59:00Z', 'Australia/Melbourne'), 'open');
});

test('daylight saving: Melbourne clocks go forward on Sunday 4 Oct 2026', () => {
  assert.deepEqual(storeNow('Australia/Melbourne', new Date('2026-10-03T15:30:00Z')), { day: 'sun', min: 90 });
  assert.deepEqual(storeNow('Australia/Melbourne', new Date('2026-10-03T16:30:00Z')), { day: 'sun', min: 210 });
  // Brisbane has no daylight saving: the same instant is an hour earlier there
  assert.deepEqual(storeNow('Australia/Brisbane', new Date('2026-10-03T16:30:00Z')), { day: 'sun', min: 150 });
});

test('${CloseTime} / ${OpenTime} for a session crossing midnight, from the store time', async () => {
  const { timeTokens } = await import('../js/tokens.js');
  const late = parseOpeningHours([day('FRIDAY', '20:00', '02:00', 'SATURDAY')]);
  const bar = (iso) => {
    const s = storeState(late, storeNow('Australia/Melbourne', new Date(iso)));
    return [s.state, timeTokens('${CloseTime}|${OpenTime}', fmtShort(s.closeTime, true), fmtShort(s.openTime, true))];
  };
  assert.deepEqual(bar('2026-11-20T13:00:00Z'), ['open', '2AM|8PM']); // Sat 00:00, inside Friday's session
  assert.deepEqual(bar('2026-11-20T14:40:00Z'), ['closing', '2AM|8PM']); // Sat 01:40
  assert.deepEqual(bar('2026-11-20T15:00:00Z'), ['closed', '2AM|8PM']); // Sat 02:00: next opening is next Friday
  assert.deepEqual(bar('2026-11-20T08:00:00Z'), ['before', '2AM|8PM']); // Fri 19:00
});
