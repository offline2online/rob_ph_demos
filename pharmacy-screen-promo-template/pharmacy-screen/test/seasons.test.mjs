// The Seasonal promotion's dates (js/render.js "season dates"): each season's default dates, Easter worked out per
// year, dates set in the editor, and the screen playing the season whose dates hold the store's date by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { activeOccasion, seasonDates, easterSunday, cleanMonthDay, inSeason, fmtMonthDay, occasionCopy, storeModel, resolvePromotion, liveOccasion, activationOn, activationUntil, scheduledOccasion, sequence } from '../js/render.js';
import { storeDate, parseTestDate } from '../js/hours.js';
import { fromPublishedConfig } from '../js/live-data.js';

const require = createRequire(import.meta.url);
const { buildScreenConfig } = require('../config-api/src/publish.js');

const day = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };

test('default dates: Christmas 15-27 Dec, New Year\'s 28 Dec-5 Jan, one-day seasons on their day, Easter Good Friday to Easter Monday', () => {
  const want = {
    '2026-12-14': '', '2026-12-15': 'christmas', '2026-12-25': 'christmas', '2026-12-27': 'christmas',
    '2026-12-28': 'new-year', '2026-12-31': 'new-year', '2027-01-01': 'new-year', '2027-01-05': 'new-year', '2027-01-06': '',
    '2027-01-25': '', '2027-01-26': 'australia-day', '2027-01-27': '',
    '2027-02-14': 'valentines-day', '2027-02-15': '',
    '2027-03-25': '', '2027-03-26': 'easter', '2027-03-29': 'easter', '2027-03-30': '',
    '2026-04-03': 'easter', '2026-04-06': 'easter', '2026-04-07': '',
    '2027-04-25': 'anzac-day', '2027-04-26': '', '2027-07-01': '',
  };
  for (const [d, id] of Object.entries(want)) assert.equal(activeOccasion({}, day(d)), id, d);
  assert.deepEqual(easterSunday(2026), { m: 4, d: 5 });
  assert.deepEqual(easterSunday(2027), { m: 3, d: 28 });
  assert.deepEqual(easterSunday(2030), { m: 4, d: 21 });
  assert.deepEqual(seasonDates('easter', null, 2027), { from: '03-26', to: '03-29' });
  assert.equal(activeOccasion({}, null), '', 'no date: nothing is picked by date');
});

test('dates set in the editor win over the defaults; where two overlap, the one that started most recently plays', () => {
  const occ = { christmas: { from: '12-01', to: '12-31', beats: [] }, 'anzac-day': { from: '04-20', to: '04-26', beats: [] } };
  assert.equal(activeOccasion(occ, day('2026-12-01')), 'christmas');
  assert.equal(activeOccasion(occ, day('2026-12-29')), 'new-year', 'New Year\'s started on the 28th, inside the longer Christmas');
  assert.equal(activeOccasion(occ, day('2027-04-21')), 'anzac-day');
  // Half-set or invalid dates fall back to the defaults.
  assert.equal(activeOccasion({ christmas: { from: '12-01', beats: [] } }, day('2026-12-01')), '');
  assert.equal(cleanMonthDay('02-29'), '02-29');
  assert.equal(cleanMonthDay('02-30'), '');
  assert.equal(cleanMonthDay('13-01'), '');
  assert.equal(inSeason('01-02', { from: '12-28', to: '01-05' }), true);
  assert.equal(inSeason('06-01', { from: '12-28', to: '01-05' }), false);
  assert.equal(fmtMonthDay('12-15'), '15 Dec');
  // Saved dates are kept with the copy.
  assert.deepEqual(occasionCopy('christmas', { from: '12-10', to: '12-24', beats: [] }).from, '12-10');
});

test('the store\'s date in its time zone, and the date= test parameter', () => {
  // 13:30 UTC on 14 Dec is already 15 Dec in Melbourne (UTC+11).
  assert.deepEqual(storeDate('Australia/Melbourne', new Date('2026-12-14T13:30:00Z')), { y: 2026, m: 12, d: 15 });
  assert.deepEqual(storeDate('Australia/Perth', new Date('2026-12-14T13:30:00Z')), { y: 2026, m: 12, d: 14 });
  assert.deepEqual(parseTestDate('2026-12-20'), { y: 2026, m: 12, d: 20 });
  assert.deepEqual(parseTestDate('1-26', 2027), { y: 2027, m: 1, d: 26 });
  assert.equal(parseTestDate('2027-02-30'), null);
  assert.equal(parseTestDate('soon', 2027), null);
});

test('the published screen config: promo=occasions plays the season for the store\'s date, else the Fallback', () => {
  const ph = { id: 'rec-ph', storeCode: 'VIC-MP-001', name: 'Beaumaris Pharmacy', colours: { primary: '#0f1050', accent: '#5ee6b0' }, logo: null,
    content: { 'rec-occ': { occasions: { valentines: null, 'australia-day': { from: '01-20', to: '01-27', beats: [{ text: 'Aussie, ${Suburb}' }] } } } } };
  const promos = [{ id: 'rec-occ', promoId: 'occasions', name: 'Seasonal', templateId: 'builtin-occasion-easter' }];
  const cfg = fromPublishedConfig(buildScreenConfig(ph, promos, [], '2026-11-20T00:00:00.000Z'));
  const store = storeModel({ data: { store_location: { store_code: 'VIC-MP-001' }, store_info: { address_info: { suburb: 'Beaumaris' } } } }, cfg);
  const xmas = resolvePromotion(cfg, store, 'occasions', { today: day('2026-12-20') });
  assert.equal(xmas.occasion, 'christmas');
  assert.equal(xmas.auto, true);
  assert.equal(resolvePromotion(cfg, store, 'occasions', { today: day('2027-01-02') }).occasion, 'new-year');
  const aus = resolvePromotion(cfg, store, 'occasions', { today: day('2027-01-21') });
  assert.equal(aus.occasion, 'australia-day', 'the pharmacy\'s own dates');
  assert.equal(aus.content.beats[0].text, 'Aussie, ${Suburb}');
  // Outside every season: the Fallback (never nothing), and the day after a season ends too.
  const off = resolvePromotion(cfg, store, 'occasions', { today: day('2027-07-01') });
  assert.equal(off.occasion, 'fallback');
  assert.equal(off.auto, true);
  assert.equal(resolvePromotion(cfg, store, 'occasions', { today: day('2026-12-28') }).occasion, 'new-year');
  assert.equal(resolvePromotion(cfg, store, 'occasions', { today: day('2027-01-06') }).occasion, 'fallback');
  assert.equal(resolvePromotion(cfg, store, 'occasions', { today: day('2027-02-14') }).occasion, 'valentines-day');
  assert.equal(resolvePromotion(cfg, store, 'occasions', { today: day('2027-02-15') }).occasion, 'fallback');
  // opts.occasion (the copy-fit audit) wins over the date.
  assert.equal(resolvePromotion(cfg, store, 'occasions', { today: day('2026-12-20'), occasion: 'anzac-day' }).occasion, 'anzac-day');
});

test('Activate on display: runs to the season\'s scheduled end date, then the schedule; never carries into next year', () => {
  // Christmas activated early (23 Nov): it plays now, to 27 Dec; New Year's on its own dates; then the Fallback.
  const until = activationUntil('christmas', {}, day('2026-11-23'));
  assert.equal(until, '2026-12-27');
  const c = { activation: { occasion: 'christmas', until } };
  assert.equal(liveOccasion(c, day('2026-11-23')), 'christmas');
  assert.equal(liveOccasion(c, day('2026-12-27')), 'christmas');
  assert.equal(liveOccasion(c, day('2026-12-28')), 'new-year');
  assert.equal(liveOccasion(c, day('2027-01-06')), 'fallback');
  // Next year: back to the standard dates (nothing on 23 Nov 2027, Christmas from 15 Dec).
  assert.equal(liveOccasion(c, day('2027-11-23')), 'fallback');
  assert.equal(liveOccasion(c, day('2027-12-15')), 'christmas');
  // A range over New Year ends in the next year; Easter is worked out for its year; on now: the end of this run.
  assert.equal(activationUntil('new-year', {}, day('2026-12-20')), '2027-01-05');
  assert.equal(activationUntil('new-year', {}, day('2027-01-02')), '2027-01-05');
  assert.equal(activationUntil('easter', {}, day('2027-03-01')), '2027-03-29');
  assert.equal(activationUntil('christmas', {}, day('2026-12-28')), '2027-12-27');
  // A pharmacy's own dates (Dates card) are its schedule every year, and an activation ends on them.
  const own = { christmas: { from: '12-01', to: '12-24' } };
  assert.equal(activationUntil('christmas', own, day('2026-11-20')), '2026-12-24');
  assert.equal(scheduledOccasion(own, day('2027-12-01')), 'christmas');
  assert.equal(scheduledOccasion(own, day('2027-12-25')), 'fallback');
  // The Fallback during a season runs to that season's end; with no season on there is nothing to activate.
  assert.equal(activationUntil('fallback', {}, day('2026-12-20')), '2026-12-27');
  assert.equal(activationUntil('fallback', {}, day('2026-03-15')), '');
  assert.equal(liveOccasion({ activation: { occasion: 'fallback', until: '2026-12-27' } }, day('2026-12-20')), 'fallback');
  // Malformed activations are ignored: the schedule plays.
  for (const a of [null, 'christmas', { occasion: 'halloween', until: '2026-12-27' }, { occasion: 'christmas', until: '12-27' }, { occasion: 'christmas' }]) {
    assert.equal(activationOn(a, day('2026-11-23')), null, JSON.stringify(a));
    assert.equal(liveOccasion({ activation: a }, day('2026-11-23')), 'fallback');
  }
  // No date known: the Fallback, never nothing.
  assert.equal(liveOccasion({}, null), 'fallback');
});

test('the Fallback: never empty, exactly 7 s in three beats, the store\'s own name and suburb', () => {
  const cfg = { pharmacies: [{ storeCode: 'A', name: 'Alpha Pharmacy', brand: { p: '#123456', a: '#abcdef' }, content: {} }, { storeCode: 'B', name: 'Beta Chemist', content: {} }],
    promotions: [{ id: 'occasions', promoId: 'occasions', name: 'Seasonal', template: 't_occ_fallback' }], templates: [] };
  for (const [code, suburb, name] of [['A', 'Ocean Grove', 'Alpha Pharmacy'], ['B', 'Mount Martha', 'Beta Chemist']]) {
    const store = storeModel({ data: { store_location: { store_code: code }, store_info: { address_info: { suburb } } } }, cfg);
    for (const d of ['2026-03-15', '2026-12-28', '2027-07-01', '2027-04-25']) {
      const play = resolvePromotion(cfg, store, 'occasions', { today: day(d) });
      assert.ok(play.occasion, `${code} ${d}: something plays`);
    }
    const play = resolvePromotion(cfg, store, 'occasions', { today: day('2026-03-15') });
    assert.equal(play.occasion, 'fallback');
    assert.deepEqual(sequence(play).map((x) => x.t), [2, 3, 2]);
    assert.deepEqual(play.content.beats.map((b) => b.text), ['Thank you, ${Suburb}', 'for supporting your local pharmacy', '${StoreName}']);
    assert.equal(store.name, name);
    assert.equal(store.suburb, suburb);
  }
});
