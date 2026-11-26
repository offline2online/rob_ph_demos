// Special opening hours (dated exceptions set in Personalisation Hub: Christmas Day closed, Christmas Eve 08:30-19:00):
// parsing, the open/closed state on and around them in the store's time zone, and the list on the opening hours
// template. Data in the shape the account owner pasted for Beaumaris (26 Nov 2026).
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOpeningHours, parseSpecialHours, storeState, storeStateOn, storeClock, storeNow, storeDate, upcomingSpecialHours,
  sessionsOn, weekdayOf, addDays, fmtSpecialDate, SPECIAL_MAX_SHOWN,
} from '../js/hours.js';
import { storeModel, storeStateFor, resolvePromotion, sequence, HOLIDAY_HEADLINE, defaultContent } from '../js/render.js';

const day = (d, o, c, cd = d) => ({ open_day: d, open_time: o + ':00', close_day: cd, close_time: c + ':00', is_active: true });
const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
const weekly = parseOpeningHours([...WEEKDAYS.map((d) => day(d, '08:30', '19:00')), day('SATURDAY', '09:00', '13:30')]);
const BEAUMARIS = [
  { name: 'Christmas Eve', date: '2026-12-24', open: true, openTime: '08:30', closeTime: '17:00', appointmentSlots: 0 },
  { name: 'Christmas Day', date: '2026-12-25', open: false },
  { name: 'Boxing Day', date: '2026-12-26', open: false },
  { name: "New Year's Eve", date: '2026-12-31', open: true, openTime: '08:30', closeTime: '19:00', appointmentSlots: 0 },
  { name: "New Year's Day", date: '2027-01-01', open: false },
  { name: 'Australia Day', date: '2027-01-26', open: false },
  { name: 'Labour Day', date: '2027-03-01', open: true, openTime: '08:30', closeTime: '19:00', appointmentSlots: 0 },
  { name: 'Good Friday', date: '2027-03-26', open: false },
];
const special = parseSpecialHours(BEAUMARIS);
const at = (ymd, t) => ({ ymd, day: weekdayOf(ymd), min: +t.split(':')[0] * 60 + +t.split(':')[1] });
const stateAt = (sp, ymd, t, w = weekly) => storeStateOn(w, sp, at(ymd, t));

test('parse: PH shape and the proxy shape, strictly; sorted by date and time', () => {
  assert.equal(special.length, 8);
  assert.deepEqual(special[0], { date: '2026-12-24', name: 'Christmas Eve', open: true, openTime: '08:30', closeTime: '17:00' });
  assert.deepEqual(special[1], { date: '2026-12-25', name: 'Christmas Day', open: false, openTime: '', closeTime: '' });
  const proxy = parseSpecialHours([{ name: '', date: '2026-12-25', open: false, open_time: null, close_time: null }, { name: 'X', date: '2026-12-24', open: true, open_time: '08:30', close_time: '12:00' }]);
  assert.deepEqual(proxy.map((x) => x.date), ['2026-12-24', '2026-12-25']);
  assert.deepEqual(parseSpecialHours([{ date: '2026-02-30', open: false }, { date: '2026-12-24', open: 'yes' }, { date: '2026-12-24', open: true }, { date: '2026-12-24', open: true, openTime: '8:30', closeTime: '17:00' }, null]), []);
  assert.deepEqual(parseSpecialHours(undefined), []);
});

test('no special hours: exactly the weekly state', () => {
  for (const [ymd, t] of [['2026-12-02', '12:00'], ['2026-12-02', '18:45'], ['2026-12-02', '07:00'], ['2026-12-02', '22:00'], ['2026-12-06', '10:00']]) {
    const c = at(ymd, t);
    assert.deepEqual(storeStateOn(weekly, [], c), storeState(weekly, { day: c.day, min: c.min }), `${ymd} ${t}`);
  }
});

test('a closed special day is closed all day, and ${OpenTime} is the next real opening', () => {
  for (const t of ['00:00', '08:30', '12:00', '18:45', '23:59']) assert.equal(stateAt(special, '2026-12-25', t).state, 'closed', t);
  const s = stateAt(special, '2026-12-25', '12:00');
  // Boxing Day (Sat) closed, Sunday has no hours: Monday 28 Dec 8.30am
  assert.equal(s.openTime, '08:30');
  assert.equal(s.openDate, '2026-12-28');
  // the day before: closes as usual, and the next opening skips Christmas Day and Boxing Day
  const eve = stateAt(special, '2026-12-24', '17:30');
  assert.equal(eve.state, 'closed');
  assert.equal(eve.openDate, '2026-12-28');
});

test('a shortened special day replaces its weekday\'s hours', () => {
  assert.equal(stateAt(special, '2026-12-24', '12:00').state, 'open');
  assert.equal(stateAt(special, '2026-12-24', '12:00').closeTime, '17:00');
  assert.equal(stateAt(special, '2026-12-24', '16:30').state, 'closing');
  assert.equal(stateAt(special, '2026-12-24', '17:00').state, 'closed');
  assert.equal(stateAt(special, '2026-12-24', '07:00').state, 'before');
  // the same times as the weekly ones still count as this date's own hours
  assert.equal(stateAt(special, '2026-12-31', '18:45').state, 'closing');
  // a special day open on a weekday the weekly table has closed (a Sunday)
  const sun = parseSpecialHours([{ name: 'Christmas trading', date: '2026-12-20', open: true, openTime: '10:00', closeTime: '16:00' }]);
  assert.equal(stateAt(sun, '2026-12-20', '11:00').state, 'open');
  assert.equal(stateAt(sun, '2026-12-19', '20:00').openDate, '2026-12-20');
  assert.equal(stateAt(sun, '2026-12-19', '20:00').openTime, '10:00');
});

test('two periods on one date are two sessions', () => {
  const two = parseSpecialHours([
    { name: 'Christmas Eve', date: '2026-12-24', open: true, openTime: '13:00', closeTime: '17:00' },
    { name: 'Christmas Eve', date: '2026-12-24', open: true, openTime: '08:30', closeTime: '12:00' },
  ]);
  assert.equal(stateAt(two, '2026-12-24', '09:00').state, 'open');
  assert.equal(stateAt(two, '2026-12-24', '09:00').closeTime, '12:00');
  const lunch = stateAt(two, '2026-12-24', '12:30');
  assert.equal(lunch.state, 'before');
  assert.equal(lunch.openTime, '13:00');
  assert.equal(stateAt(two, '2026-12-24', '14:00').closeTime, '17:00');
  assert.equal(stateAt(two, '2026-12-24', '17:30').state, 'closed');
  assert.deepEqual(upcomingSpecialHours(two, '2026-12-01')[0].times, ['8.30am – 12.00pm', '1.00pm – 5.00pm']);
});

test('a special period crossing midnight behaves like a weekly one', () => {
  const late = parseSpecialHours([{ name: "New Year's Eve", date: '2026-12-31', open: true, openTime: '20:00', closeTime: '02:00' }]);
  assert.equal(stateAt(late, '2026-12-31', '23:00').state, 'open');
  assert.equal(stateAt(late, '2026-12-31', '23:00').closeTime, '02:00');
  assert.equal(stateAt(late, '2027-01-01', '01:45').state, 'closing');
  assert.equal(stateAt(late, '2027-01-01', '02:00').state, 'before'); // Friday 1 Jan's weekly hours still follow
  assert.equal(stateAt(late, '2026-12-31', '12:00').state, 'before'); // the special hours replace Thursday's day hours
  // a weekly late session running into a closed special date stops at midnight
  const nights = parseOpeningHours([day('THURSDAY', '20:00', '02:00', 'FRIDAY')]);
  const closedFri = parseSpecialHours([{ name: 'Christmas Day', date: '2026-12-25', open: false }]);
  assert.equal(stateAt(closedFri, '2026-12-24', '23:00', nights).state, 'open');
  assert.equal(stateAt(closedFri, '2026-12-24', '23:45', nights).state, 'closing');
  assert.equal(stateAt(closedFri, '2026-12-24', '23:00', nights).session.end % 1440, 0);
  assert.equal(stateAt([], '2026-12-24', '23:45', nights).state, 'open'); // without it, open until 2am as usual
  assert.equal(stateAt(closedFri, '2026-12-25', '01:00', nights).state, 'closed');
  assert.deepEqual(sessionsOn(nights, closedFri, '2026-12-25'), []);
});

test('year boundary: 31 Dec to 1 Jan', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  const s = stateAt(special, '2026-12-31', '20:00');
  assert.equal(s.state, 'closed');
  assert.equal(s.openDate, '2027-01-02'); // New Year's Day (Fri) closed: Saturday 2 Jan, 9am
  assert.equal(s.openTime, '09:00');
  assert.equal(stateAt(special, '2027-01-01', '10:00').state, 'closed');
  assert.equal(stateAt(special, '2027-01-02', '10:00').state, 'open');
});

test('time zone: the store\'s date, not UTC\'s, decides which special day applies', () => {
  const store = { tz: 'Australia/Melbourne', sessions: weekly, special };
  // 14:30 UTC on 24 Dec is 01:30 on Christmas Day in Melbourne (AEDT, UTC+11)
  const instant = new Date('2026-12-24T14:30:00Z');
  assert.deepEqual(storeDate('Australia/Melbourne', instant), { y: 2026, m: 12, d: 25 });
  const s = storeStateFor(store, storeNow('Australia/Melbourne', instant), storeDate('Australia/Melbourne', instant));
  assert.equal(s.ymd, '2026-12-25');
  // 22:00 UTC on 24 Dec is 09:00 on Christmas Day: closed, though Friday's weekly hours say open
  const morning = new Date('2026-12-24T22:00:00Z');
  const m = storeStateFor(store, storeNow('Australia/Melbourne', morning), storeDate('Australia/Melbourne', morning));
  assert.equal(m.ymd, '2026-12-25');
  assert.equal(m.state, 'closed');
  // and at 22:00 UTC on 23 Dec (09:00 Christmas Eve) it is open until 5pm
  const eve = new Date('2026-12-23T22:00:00Z');
  const e = storeStateFor(store, storeNow('Australia/Melbourne', eve), storeDate('Australia/Melbourne', eve));
  assert.deepEqual([e.ymd, e.state, e.closeTime], ['2026-12-24', 'open', '17:00']);
});

test('test clock: a weekday on a date takes the next date with that weekday', () => {
  assert.equal(storeClock({ day: 'thu', min: 600 }, { y: 2026, m: 11, d: 26 }).ymd, '2026-11-26');
  assert.equal(storeClock({ day: 'wed', min: 600 }, { y: 2026, m: 11, d: 26 }).ymd, '2026-12-02');
  assert.equal(storeClock({ day: 'fri', min: 600 }, { y: 2026, m: 12, d: 25 }).ymd, '2026-12-25');
});

test('the list: nearest first, past dates never, at most 6, no more than 90 days ahead', () => {
  const from26Nov = upcomingSpecialHours(special, '2026-11-26');
  assert.equal(SPECIAL_MAX_SHOWN, 6);
  assert.deepEqual(from26Nov.map((r) => `${r.label} ${r.name} ${r.text || 'Closed'}`), [
    'Thu 24 Dec Christmas Eve 8.30am – 5.00pm', 'Fri 25 Dec Christmas Day Closed', 'Sat 26 Dec Boxing Day Closed',
    "Thu 31 Dec New Year's Eve 8.30am – 7.00pm", "Fri 1 Jan New Year's Day Closed", 'Tue 26 Jan Australia Day Closed',
  ]);
  // today is listed; yesterday is not
  assert.equal(upcomingSpecialHours(special, '2026-12-25')[0].date, '2026-12-25');
  assert.equal(upcomingSpecialHours(special, '2026-12-26')[0].date, '2026-12-26');
  // 90 days: from 27 Jan, Labour Day (1 Mar) and Good Friday (26 Mar) are both within 90 days
  assert.deepEqual(upcomingSpecialHours(special, '2027-01-27').map((r) => r.date), ['2027-03-01', '2027-03-26']);
  assert.deepEqual(upcomingSpecialHours(special, '2026-12-27').map((r) => r.date).slice(-1), ['2027-03-26']);
  assert.deepEqual(upcomingSpecialHours(special, '2026-12-27', 10, 88).map((r) => r.date).slice(-1), ['2027-03-01']);
  assert.equal(upcomingSpecialHours(special, '2026-11-01').length, 6); // 10+ ahead: the nearest 6
  assert.deepEqual(upcomingSpecialHours(special, '2027-04-01'), []);
  // no name: the date alone
  assert.equal(upcomingSpecialHours(parseSpecialHours([{ date: '2026-12-24', open: false }]), '2026-12-01')[0].name, '');
  assert.equal(fmtSpecialDate('2027-01-26'), 'Tue 26 Jan');
});

test('the store model reads them; the default holiday headline steps aside only while they are listed', () => {
  const cfg = {
    pharmacies: [{ storeCode: 'VIC-MP-001', name: 'Beaumaris Pharmacy', content: {} }],
    promotions: [{ id: 'closed', promoId: 'closed', type: 'hours', template: 't_hours' }],
  };
  const data = (sp) => ({ data: { store_location: { store_code: 'VIC-MP-001', store_timezone: 'Australia/Melbourne' }, store_info: { opening_hours: [], ...sp } } });
  const withSp = storeModel(data({ special_hours: [{ name: 'Christmas Day', date: '2026-12-25', open: false, open_time: null, close_time: null }] }), cfg);
  assert.equal(withSp.special.length, 1);
  assert.equal(storeModel(data({ specialHours: BEAUMARIS }), cfg).special.length, 8);
  const none = storeModel(data({}), cfg);
  assert.deepEqual(none.special, []);
  assert.equal(defaultContent('hours').headlines[2], HOLIDAY_HEADLINE);
  const listed = resolvePromotion(cfg, withSp, 'closed', { today: { y: 2026, m: 12, d: 1 } });
  assert.deepEqual(listed.content.headlines, ["Sorry, we're closed", 'Serving ${Suburb}']);
  assert.deepEqual(sequence(listed).map((x) => x.t), [2.7, 2.7]);
  // past, or none: all three, as today
  assert.equal(resolvePromotion(cfg, withSp, 'closed', { today: { y: 2026, m: 12, d: 26 } }).content.headlines.length, 3);
  assert.equal(resolvePromotion(cfg, none, 'closed', { today: { y: 2026, m: 12, d: 1 } }).content.headlines.length, 3);
  // edited copy is kept
  const edited = { ...cfg, pharmacies: [{ ...cfg.pharmacies[0], content: { closed: { headlines: ['A', 'B', 'Public holidays: call us'] } } }] };
  assert.equal(resolvePromotion(edited, storeModel(data({ specialHours: BEAUMARIS }), edited), 'closed', { today: { y: 2026, m: 12, d: 1 } }).content.headlines.length, 3);
});
