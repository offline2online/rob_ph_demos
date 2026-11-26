// Special opening hours on the screen, in headless Chromium (mock data, mockapi=1): the opening hours template lists
// them under the weekly hours in place of "Public Holidays: Please call to confirm" and still fits with 0, 1, 6 and 10
// special days (10: cut to the nearest 6), a day with two sessions included, in portrait and landscape (the copy-fit
// audit, tools/overflow-audit.mjs); the "Open today" bar on and around special dates, in the store's time zone; a
// passed date is no longer listed; a store with none looks exactly as before.
//   npm run test:ui     (uses the sandbox's preinstalled Playwright/Chromium; CHROMIUM_PATH for another binary)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runAudit } from '../../tools/overflow-audit.mjs';
import { serve } from '../../tools/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CAMPAIGN = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/campaign-data.json'), 'utf8'));
const copy = (d) => JSON.parse(JSON.stringify(d));
const BEAUMARIS = 'DEVICE-VIC-MP-001';

// Ten special days from 3 Dec 2026, the second with two sessions and long names, so the nearest 6 fill the list.
const TEN = [
  { name: 'Late night shopping', date: '2026-12-03', open: true, openTime: '08:30', closeTime: '21:00' },
  { name: 'Christmas Eve', date: '2026-12-24', open: true, openTime: '08:30', closeTime: '12:00' },
  { name: 'Christmas Eve', date: '2026-12-24', open: true, openTime: '13:00', closeTime: '17:00' },
  { name: 'Christmas Day', date: '2026-12-25', open: false },
  { name: 'Boxing Day', date: '2026-12-26', open: false },
  { name: 'Christmas Day (additional public holiday)', date: '2026-12-28', open: false },
  { name: "New Year's Eve", date: '2026-12-31', open: true, openTime: '08:30', closeTime: '19:00' },
  { name: "New Year's Day", date: '2027-01-01', open: false },
  { name: 'Australia Day', date: '2027-01-26', open: false },
  { name: 'Labour Day', date: '2027-03-08', open: true, openTime: '10:00', closeTime: '16:00' },
  { name: 'Good Friday', date: '2027-03-26', open: false },
];
const withSpecial = (list) => {
  const c = copy(CAMPAIGN);
  const si = c.devices[BEAUMARIS].data.store_info;
  delete si.specialHours;
  if (list) si.specialHours = list;
  return c;
};

let server, browser, base;
before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}/pharmacy-screen.html`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser.close(); server.close(); });

for (const [n, list] of [[0, null], [1, TEN.slice(0, 1)], [6, TEN.slice(0, 7)], [10, TEN]]) {
  test(`fits with ${n} special day(s), portrait and landscape (the copy-fit audit)`, async () => {
    const r = await runAudit({ browser, devices: [BEAUMARIS], times: { open: 'wed-12:00' }, campaign: withSpecial(list), date: '2026-12-02' });
    assert.deepEqual(r.failures, [], r.failures.join('\n'));
    assert.ok(r.scenes.some((s) => s.promo === 'closed' && s.orientation === 'landscape') && r.scenes.some((s) => s.promo === 'closed' && s.orientation === 'portrait'));
  });
}

// The screen for Beaumaris at one store date and time, with one promotion's first scene shown.
async function look({ campaign, date, now, promo = 'closed', orientation = 'portrait' }) {
  const land = orientation === 'landscape';
  const ctx = await browser.newContext({ viewport: land ? { width: 960, height: 540 } : { width: 540, height: 960 } });
  try {
    if (campaign) {
      const body = JSON.stringify(campaign);
      await ctx.route('**/fixtures/campaign-data.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body }));
    }
    const page = await ctx.newPage();
    await page.goto(`${base}?mockapi=1&device=${BEAUMARIS}&orientation=${orientation}&promo=${promo}&scene=0${now ? `&now=${now}` : ''}${date ? `&date=${date}` : ''}`);
    await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.ready);
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(async (p) => {
      const info = window.pharmacyScreen.show(p, 0);
      await window.pharmacyScreen.settled();
      const q = (s) => document.querySelector(s);
      return {
        info,
        special: [...document.querySelectorAll('.s-sp')].map((r) => [...r.children].map((c) => c.textContent.trim()).join(' | ')),
        weekly: document.querySelectorAll('.s-row:not(.s-sp)').length,
        note: q('.s-note') ? q('.s-note').textContent.trim() : null,
        heading: q('.s-sph') ? q('.s-sph').textContent.trim() : null,
        bar: q('.s-foot') ? q('.s-foot').textContent.trim() : null,
        cls: q('#screen').className,
        problems: window.pharmacyScreen.audit(),
      };
    }, promo);
  } finally { await ctx.close(); }
}

test('Beaumaris (the mock data): the dated list from 26 Nov 2026, as set in Personalisation Hub, in both orientations', async () => {
  for (const orientation of ['portrait', 'landscape']) {
    const m = await look({ date: '2026-11-26', now: 'thu-22:00', orientation });
    assert.deepEqual(m.problems, []);
    assert.equal(m.weekly, 7);
    assert.equal(m.heading, 'Special hours');
    assert.deepEqual(m.special, [
      'Thu 24 Dec | Christmas Eve | 8.30am – 7.00pm', 'Fri 25 Dec | Christmas Day | Closed', 'Sat 26 Dec | Boxing Day | Closed',
      "Thu 31 Dec | New Year's Eve | 8.30am – 7.00pm", "Fri 1 Jan | New Year's Day | Closed", 'Tue 26 Jan | Australia Day | Closed',
    ], orientation);
    // the special hours replace the "call to confirm" note (and its default headline); the phone line stays
    assert.ok(!/Please call to confirm/.test(m.note), m.note);
    assert.match(m.note, /Phone 03 9589 2676/);
    assert.equal(m.info.scenes.length, 2);
  }
});

test('a passed special date is no longer listed', async () => {
  const m = await look({ date: '2026-12-26', now: 'sat-20:00' });
  assert.equal(m.special[0], 'Sat 26 Dec | Boxing Day | Closed'); // today still is
  const next = await look({ date: '2026-12-27', now: 'sun-08:00' });
  assert.equal(next.special[0], "Thu 31 Dec | New Year's Eve | 8.30am – 7.00pm");
  assert.ok(!next.special.some((r) => /Dec \| (Christmas|Boxing)/.test(r)), next.special.join('\n'));
});

test('a pharmacy with no special hours looks exactly as before', async () => {
  const m = await look({ campaign: withSpecial(null), date: '2026-11-26', now: 'thu-22:00' });
  assert.deepEqual(m.special, []);
  assert.equal(m.heading, null);
  assert.ok(!/\bspecial\b/.test(m.cls), m.cls);
  assert.match(m.note, /^Public Holidays: Please call to confirm/);
  assert.equal(m.info.scenes.length, 3);
  // and once Beaumaris's own special dates have all passed, the same
  const later = await look({ date: '2027-06-02', now: 'wed-22:00' });
  assert.deepEqual(later.special, []);
  assert.match(later.note, /^Public Holidays: Please call to confirm/);
});

test('the "Open today" bar on special dates, in the store\'s time zone (Australia/Melbourne)', async () => {
  // Christmas Day (a Friday, weekly 8.30am-7pm): closed all day, Morning and Afternoon do not say "Open today until"
  for (const promo of ['morning', 'afternoon']) {
    const xmas = await look({ date: '2026-12-25', now: 'fri-10:00', promo });
    assert.equal(xmas.info.state, 'closed', promo);
    assert.ok(!/open today/i.test(xmas.bar), `${promo}: ${xmas.bar}`);
  }
  // Christmas Eve with shorter hours (8.30am-5pm in this data): the bar shows 5PM, not the weekly 7PM
  const short = copy(withSpecial(TEN.slice(0, 1).concat([{ name: 'Christmas Eve', date: '2026-12-24', open: true, openTime: '08:30', closeTime: '17:00' }])));
  const eve = await look({ campaign: short, date: '2026-12-24', now: 'thu-10:00', promo: 'morning' });
  assert.equal(eve.info.state, 'open');
  assert.match(eve.bar, /open today until 5pm/i);
  assert.equal((await look({ campaign: short, date: '2026-12-24', now: 'thu-16:45', promo: 'morning' })).info.state, 'closing');
  assert.equal((await look({ campaign: short, date: '2026-12-24', now: 'thu-17:30', promo: 'morning' })).info.state, 'closed');
  // the day before Christmas Eve: an ordinary Wednesday
  const before = await look({ campaign: short, date: '2026-12-23', now: 'wed-10:00', promo: 'morning' });
  assert.match(before.bar, /open today until 7pm/i);
  // with now= alone (no date=), the clock's own date is used: a weekday that is not today is the next such date
  const w = await look({ date: '', now: 'wed-12:00', promo: 'morning' });
  assert.equal(w.info.state, 'open');
});
