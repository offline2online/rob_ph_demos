'use strict';
// Browser checks for the Revenue chart and Deals table (npm run test:ui): Today marker, booked-ahead bars, DSP colour
// families, legend, and the Deals column formats, at desktop and phone width.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchChromium } = require('./browser');

const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let server; let base; let browser;
test.before(async () => {
  server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await launchChromium();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function open(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ status: 200, body: '' }));
  await page.goto(`${base}/index.html`);
  await page.waitForSelector('.rd-total');
  await page.waitForSelector('.rd-table');
  return { page, context, problems };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const width of [1163, 390]) {
  test(`revenue chart at ${width}px: Today marker, booked-ahead bars, colour families`, async () => {
    const { page, context, problems } = await open(width);
    try {
      assert.equal(await page.$$eval('.rd-col', (c) => c.length), 44);
      assert.equal(await page.$$eval('.rd-today', (c) => c.length), 1);
      assert.equal(await page.textContent('.rd-today-label'), 'Today');
      assert.equal(await page.$$eval('.rd-cols > .rd-today ~ .rd-col', (c) => c.length), 14, '14 booked-ahead bars follow the marker');
      assert.equal(await page.$$eval('.rd-cols > .rd-today ~ .rd-col .rd-seg-fill', (c) => c.length), 0, 'booked-ahead bars carry no earned segments');
      assert.match(await page.textContent('.rd-legend'), /DV360 · Programmatic guaranteed.*Estimated \(booked ahead, not yet played\)/);
      assert.equal(await page.$$eval('.rd-legend-item', (c) => c.length), 5);
      assert.equal(await page.textContent('.rd-total'), (await page.textContent('.rd-total')).replace(/ · .*/, ''), 'the total is earned only');
      const est = await page.$eval('.rd-seg-est', (e) => { const s = getComputedStyle(e); return [s.backgroundColor, s.borderTopColor]; });
      assert.deepEqual(est, ['rgb(238, 244, 250)', 'rgb(122, 167, 214)']);

      await page.click('.rd-chip:has-text("The Trade Desk")');
      await page.click('.rd-chip:has-text("Amazon DSP")');
      await page.waitForFunction(() => document.querySelectorAll('.rd-legend-item').length === 13);
      assert.match(await page.textContent('.rd-legend'), /The Trade Desk · Preferred deal/);
      // Direct is a source beside the DSPs: one chip, one legend entry (its only deal type), its own colour.
      await page.click('.rd-chip:has-text("Direct")');
      await page.waitForFunction(() => document.querySelectorAll('.rd-legend-item').length === 14);
      assert.match(await page.textContent('.rd-legend'), /Direct · Direct advertiser/);
      assert.ok((await page.$$eval('.rd-seg-fill', (e) => e.map((x) => getComputedStyle(x).backgroundColor))).includes('rgb(107, 63, 160)'), 'Direct draws in its purple');
      const fills = await page.$$eval('.rd-seg-fill', (e) => new Set(e.map((x) => getComputedStyle(x).backgroundColor)).size);
      assert.ok(fills > 4, `several colour families drawn: ${fills}`);

      await page.click('.rd-seg-btn:has-text("Week")');
      await page.waitForFunction(() => document.querySelectorAll('.rd-cols > .rd-today ~ .rd-col').length === 6);
      assert.match(await page.textContent('.rd-xlabel:not(:empty)'), /^w\/c \d+ [A-Z][a-z]{2}$/);
      await page.click('.rd-seg-btn:has-text("Month")');
      await page.waitForFunction(() => { const c = document.querySelectorAll('.rd-col'); return c.length === 4 && /^Dec /.test(c[3].getAttribute('aria-label')); }); // labels thin out on a phone, bars do not
      assert.ok(await noHScroll(page), 'no horizontal scroll');
      assert.deepEqual(problems, []);
    } finally { await context.close(); }
  });

  test(`deals table at ${width}px: bars, labels and hovers`, async () => {
    const { page, context, problems } = await open(width);
    try {
      const rows = await page.$$eval('.rd-table tbody tr', (r) => r.map((x) => [...x.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim())));
      assert.equal(rows.length, 10);
      // Rows are sorted by Revenue, highest first, by default; look rows up by deal name so a sort change
      // doesn't silently re-point every assertion at a different deal.
      const money = (s) => Number(s.replace(/[^0-9.]/g, ''));
      const revenue = rows.map((r) => money(r[6]));
      assert.deepEqual(revenue, [...revenue].sort((a, b) => b - a), 'default order is Revenue, highest first');
      assert.equal(await page.getAttribute('.rd-table thead th[aria-sort="descending"] .rd-sort', 'aria-label'), 'Sort by Revenue, currently highest first');
      const idx = (name) => { const i = rows.findIndex((r) => r[0] === name); assert.ok(i >= 0, `deal ${name} listed`); return i; };
      const pg = rows[idx('Immune — winter launch')];
      const pd = rows[idx('Dispensary first look')];
      const pa = rows[idx('Beauty endcaps')];
      assert.match(pg[3], /^\d+ advertisers?$/);
      assert.match(pg[4], /^\d+%$/);
      assert.match(pg[5], /^\d+% of guaranteed$/);
      assert.equal(pd[5], '', 'pacing only on Programmatic guaranteed');
      assert.match(pg[7], /fixed$/);
      assert.match(pa[7], /floor$/);
      assert.match(pg[2], /^2 slots$/);
      const bar = await page.$eval('.rd-fill-bar', (e) => { const r = e.getBoundingClientRect(); return [e.offsetWidth, r.height, getComputedStyle(e).backgroundColor]; });
      assert.equal(bar[0], width === 390 ? 56 : 90);
      assert.equal(bar[1], 6);
      assert.equal(bar[2], 'rgb(240, 240, 240)');

      const adv = (await page.$$('.rd-table tbody tr'))[idx('Beauty endcaps')];
      await (await adv.$('td:nth-child(4) .rd-hov')).hover();
      assert.match(await page.textContent('.rd-tip'), /Kenvue \(DV360\)/);
      await (await (await page.$$('.rd-table tbody tr'))[idx('Immune — winter launch')].$('td:nth-child(3) .rd-hov')).hover();
      assert.match(await page.textContent('.rd-tip'), /Window Portrait \(Portrait screen in the store window at the entrance\)/);
      assert.match(await page.textContent('.rd-tip'), /slot 1 of \d+\)/);
      await page.hover('.rd-name');
      assert.match(await page.textContent('.rd-tip'), /Deal IDs.*PH-/);
      assert.ok(await noHScroll(page), 'no horizontal scroll');
      assert.deepEqual(problems, []);
    } finally { await context.close(); }
  });
}
