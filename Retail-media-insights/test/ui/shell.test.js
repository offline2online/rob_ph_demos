'use strict';
// Page shell checks (npm run test:ui): date range control, filter controls, tabs, scope banner and the summary cards.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

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
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function open(url, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ status: 200, body: '' }));
  await page.goto(base + url);
  return { page, context, problems };
}
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const onScreen = (page, sel, width) => page.$eval(sel, (el, w) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= w + 0.5; }, width);

test('retailer shell: date range, filters, tabs and the four-tile summary card', async () => {
  const { page, context, problems } = await open('/index.html', 1163);
  try {
    await page.waitForSelector('[data-tile="sold"]');
    assert.equal(await text(page, '#f-date'), '12 Sep, 2026→11 Oct, 2026calendar_month');
    assert.equal(await text(page, '#strip .card-title'), 'Retail Media Summary (12 Sep – 11 Oct)');
    assert.deepEqual(await page.$$eval('#strip .tile .lbl', (l) => l.map((x) => x.firstChild.textContent)), ['Earned revenue', 'Estimated revenue', 'Effective CPM', 'Inventory sold']);
    assert.match(await text(page, '[data-tile="earned"] .sub'), /^via 3 connected DSPs \+ direct \(\d+%\)$/);
    assert.match(await text(page, '[data-tile="estimated"] .sub'), /^booked for the next 30 days$/);
    assert.match(await text(page, '[data-tile="cpm"] .val'), /^\$\d+\.\d\d$/);
    assert.equal(await text(page, '[data-tile="cpm"] .sub'), 'per 1,000 assumed views (VAC-d)');
    assert.match(await text(page, '[data-tile="sold"] .val'), /^\d+%$/);
    assert.equal(await page.$eval('.tile', (t) => getComputedStyle(t).backgroundColor), 'rgb(245, 245, 245)');
    assert.equal(await page.$eval('.tile .val', (t) => getComputedStyle(t).fontSize), '24px');
    assert.equal(await page.$('#scope:not([hidden])'), null, 'no scope banner for a retailer');

    assert.deepEqual(await page.$$eval('.tab, .tab-sep', (t) => t.map((x) => x.className === 'tab-sep' ? '|' : x.textContent.replace(/^$/, ''))).then((t) => t.filter(Boolean)),
      ['Retail Media Performance', 'Campaign Performance', 'Visitor Insights', 'Store Insights', 'Upcoming Appointments', '|', 'Downloads']);
    assert.equal(await page.$$eval('#filters select', (s) => s.every((x) => x.getAttribute('aria-label'))), true);
    assert.equal(await page.$$eval('#filters > label', (l) => l.length), 0, 'filters are unlabelled');
    assert.equal(await page.$eval('#f-store option', (o) => o.textContent), 'All Stores (5)');
    assert.equal(await page.$eval('#f-display option', (o) => o.textContent), 'All Display Types (4)');
    assert.equal(await page.$eval('#f-adv option', (o) => o.textContent), 'All Advertisers (11)');

    // presets
    await page.click('#f-date');
    assert.deepEqual(await page.$$eval('.dr-preset', (b) => b.map((x) => x.textContent)), ['Last 7 days', 'Last 14 days', 'Last 30 days', 'Last 90 days']);
    await page.click('.dr-preset[data-days="7"]');
    assert.equal(await page.isVisible('#apply'), true);
    assert.equal(await page.isVisible('#dr-panel'), false);
    await page.click('#apply');
    await page.waitForFunction(() => /\(5 Oct – 11 Oct\)/.test(document.querySelector('#strip .card-title').textContent));
    assert.equal(await page.isVisible('#reset'), true);
    assert.equal(await text(page, '#f-date'), '05 Oct, 2026→11 Oct, 2026calendar_month');
    // the estimated tile does not follow the range
    assert.match(await text(page, '[data-tile="estimated"] .sub'), /next 30 days/);

    // custom range: two clicks in the calendar; days outside the data are disabled
    await page.click('#f-date');
    assert.equal(await text(page, '.dr-title'), 'Oct 2026');
    assert.equal(await page.isDisabled('.dr-day[data-date="2026-10-12"]'), true);
    assert.equal(await page.isDisabled('.dr-day[data-date="2026-06-13"]').catch(() => true), true);
    await page.click('.dr-nav[aria-label="Previous month"]');
    await page.click('.dr-day[data-date="2026-09-01"]');
    await page.click('.dr-day[data-date="2026-09-15"]');
    assert.equal(await page.isVisible('#dr-panel'), false);
    await page.click('#apply');
    await page.waitForFunction(() => /\(1 Sep – 15 Sep\)/.test(document.querySelector('#strip .card-title').textContent));
    // a later end picked first swaps into order
    await page.click('#f-date');
    await page.click('.dr-day[data-date="2026-09-20"]');
    await page.click('.dr-day[data-date="2026-09-10"]');
    assert.equal(await text(page, '#f-date'), '10 Sep, 2026→20 Sep, 2026calendar_month');
    await page.click('#cancel');
    assert.equal(await text(page, '#f-date'), '01 Sep, 2026→15 Sep, 2026calendar_month');
    await page.click('#reset');
    await page.waitForFunction(() => /\(12 Sep – 11 Oct\)/.test(document.querySelector('#strip .card-title').textContent));
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('advertiser shell: banner, one tab, locked chip and the summary card matching Delivery', async () => {
  const { page, context, problems } = await open('/index.html?role=advertiser', 1163);
  try {
    await page.waitForSelector('.av-tile-val');
    await page.waitForSelector('[data-tile="spend"]');
    assert.match(await text(page, '#scope'), /^lockSigned in as Blackmores\. Everything on this page is scoped to your advertiser account\. Other advertisers’ data and the retailer’s inventory aren’t shown\.$/);
    assert.deepEqual(await page.$$eval('.tab', (t) => t.map((x) => x.textContent)), ['Retail Media Performance']);
    assert.equal(await page.getAttribute('#adv-chip', 'title'), 'Scoped to your advertiser account. You only ever see your own data.');
    assert.equal(await text(page, '#mysum .card-title'), 'Retail Media Summary · Blackmores (12 Sep – 11 Oct)');
    assert.equal(await page.$('#mysum .pg-info'), null, 'no ⓘ on the advertiser card');
    assert.deepEqual(await page.$$eval('#mysum .tile .lbl', (l) => l.map((x) => x.textContent)), ['Spend', 'Plays won', 'Deals you’re on']);
    assert.match(await text(page, '[data-tile="deals"] .val'), /^\d+$/);
    // above Delivery, and equal to its totals
    assert.equal(await page.evaluate(() => document.getElementById('mysum').compareDocumentPosition(document.getElementById('av')) & Node.DOCUMENT_POSITION_FOLLOWING), 4);
    const delivery = await page.$$eval('.av-tile', (t) => Object.fromEntries(t.map((x) => [x.querySelector('.av-tile-lbl').textContent, x.querySelector('.av-tile-val').textContent])));
    assert.equal(await text(page, '[data-tile="spend"] .val'), delivery.Spend);
    assert.equal(await text(page, '[data-tile="plays"] .val'), delivery['Plays won']);
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('phone width: no sideways scroll and the date panel stays on screen', async () => {
  for (const url of ['/index.html', '/index.html?role=advertiser']) {
    const { page, context } = await open(url, 390);
    try {
      await page.waitForSelector('#f-date');
      await page.click('#f-date');
      assert.ok(await onScreen(page, '#dr-panel', 390), 'panel on screen');
      await page.click('.dr-nav[aria-label="Previous month"]');
      assert.ok(await onScreen(page, '#dr-panel', 390));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${url}: no horizontal scroll`);
    } finally { await context.close(); }
  }
});

test('a filter selection keeps the scroll position while the page redraws', async () => {
  const { page, context, problems } = await open('/index.html', 1280);
  await page.waitForSelector('#strip .tile, #strip *');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); // the bottom: any shrink clamps it
  const before = await page.evaluate(() => window.pageYOffset);
  assert.ok(before > 100, 'page is scrolled');
  // Redraw a panel the way a filter change does: skeleton first, then content again.
  await page.evaluate(() => {
    const rd = document.getElementById('rd');
    const kids = Array.from(rd.childNodes);
    document.getElementById('frame').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    kids.forEach((k) => rd.removeChild(k));
    const sk = document.createElement('div'); sk.className = 'rd-skel'; rd.appendChild(sk);
    setTimeout(() => { rd.removeChild(sk); kids.forEach((k) => rd.appendChild(k)); }, 150);
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.pageYOffset), before, 'no jump while loading');
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => window.pageYOffset), before, 'no jump after loading');
  assert.deepEqual(problems, []);
  await context.close();
});
