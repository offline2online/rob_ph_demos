// The landscape opening-hours screen (promo=closed, orientation=landscape) in headless Chromium: the hours card
// fills most of the screen right of the brand arrow, its rows are large enough to read from a distance, and nothing
// collides (the arrow's tip, the holiday note, a day with two sessions).
//   npm run test:ui     (uses the sandbox's preinstalled Playwright/Chromium; CHROMIUM_PATH for another binary)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { serve } from '../../tools/serve.mjs';
import { geom } from '../../js/fit-text.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let server, browser, base;
before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}/pharmacy-screen.html`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser.close(); server.close(); });

// The Closed promotion's first scene at full size, measured in screen pixels.
async function measure(device, orientation = 'landscape') {
  const land = orientation === 'landscape';
  const ctx = await browser.newContext({ viewport: land ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 } });
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}?mockapi=1&device=${device}&orientation=${orientation}&promo=closed&scene=0&now=wed-22:00&date=2027-06-02`); // a date with no special hours ahead (test/ui/special-hours.test.mjs has those)
    await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.ready);
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(async () => {
      window.pharmacyScreen.show('closed', 0);
      await window.pharmacyScreen.settled();
      const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const px = (e, p) => parseFloat(getComputedStyle(e)[p]);
      const card = document.querySelector('.s-card');
      return {
        card: box(card),
        note: box(document.querySelector('.s-note')),
        title: px(card.querySelector('.ch h3'), 'fontSize'),
        rows: [...card.querySelectorAll('.s-row')].map((row) => {
          const [day, time] = [...row.children];
          return { text: row.textContent, multi: row.classList.contains('multi'), row: box(row), day: box(day), time: box(time), dayPx: px(day, 'fontSize'), timePx: px(time, 'fontSize') };
        }),
        problems: window.pharmacyScreen.audit(),
      };
    });
  } finally { await ctx.close(); }
}

test('landscape: the opening hours card fills most of the screen beside the brand arrow', async () => {
  const m = await measure('DEVICE-VIC-MP-001');
  const G = geom(true, true), tip = Math.max(...G.pts.map((p) => p[0]));
  assert.deepEqual(m.problems, []);
  // the card starts clear of the arrow's tip and stays on the screen
  assert.ok(m.card.l >= tip + 40, `card starts at ${m.card.l}, arrow tip at ${tip}`);
  assert.ok(m.card.r <= G.W - 40 && m.card.t >= 24 && m.card.b <= G.H, JSON.stringify(m.card));
  // it takes most of the width and most of the height the arrow leaves free
  assert.ok(m.card.w >= 0.9 * (G.W - tip), `card is ${m.card.w}px wide of the ${G.W - tip}px right of the arrow`);
  assert.ok(m.card.h >= 0.75 * G.H, `card is ${m.card.h}px tall on a ${G.H}px screen`);
  // seven large rows: day names and times at 56px or more, the card title larger still
  assert.equal(m.rows.length, 7);
  for (const r of m.rows) {
    assert.ok(r.dayPx >= 56 && r.timePx >= 56, `${r.text}: ${r.dayPx}px / ${r.timePx}px`);
    assert.ok(r.row.h >= 96, `${r.text}: row ${r.row.h}px tall`);
  }
  assert.ok(m.title >= 64, `card title ${m.title}px`);
  // the public holiday note sits under the card, on the screen
  assert.ok(m.note.t >= m.card.b && m.note.b <= G.H, JSON.stringify({ card: m.card, note: m.note }));
});

test('landscape: a day with two sessions keeps its times on one line, inside its row', async () => {
  const m = await measure('TEST-LATE-NIGHT');
  assert.deepEqual(m.problems, []);
  const multi = m.rows.filter((r) => r.multi);
  assert.equal(multi.length, 1, 'the fixture has one day with two sessions (Saturday)');
  const [r] = multi;
  assert.match(r.text, /^Saturday.+, .+/);
  assert.ok(r.time.h < 60, `times wrap: ${r.time.h}px tall`);
  assert.ok(r.time.t >= r.row.t && r.time.b <= r.row.b, 'times stay inside the row');
  assert.ok(r.time.l >= r.day.r + 16, `times ${r.time.l} run into the day name ${r.day.r}`);
  assert.ok(r.dayPx >= 56, 'the day name stays large');
  for (const o of m.rows.filter((x) => !x.multi)) assert.ok(o.timePx >= 56, `${o.text}: ${o.timePx}px`);
});

test('portrait: the opening hours card is unchanged', async () => {
  const m = await measure('TEST-LATE-NIGHT', 'portrait');
  assert.deepEqual(m.problems, []);
  assert.deepEqual([Math.round(m.card.l), Math.round(m.card.r), Math.round(m.card.t)], [64, 1016, 930]);
  for (const r of m.rows) assert.equal(r.dayPx, 44);
  for (const r of m.rows) assert.equal(r.timePx, 44);
});
