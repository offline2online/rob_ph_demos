'use strict';
// Browser checks for the slot charts (npm run test:ui): Missed revenue & fill, Yield, Slot allocation hovers, Slot value
// legend and labels, and the 390px layout. Chromium comes from PLAYWRIGHT_BROWSERS_PATH; Google Fonts are stubbed.
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
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ status: 200, body: '' }));
  await page.goto(base + '/index.html');
  await page.waitForSelector('.sc-row[data-fill]');
  await page.waitForSelector('.sc-table');
  await page.waitForSelector('.sc-heat-cell[data-hour]');
  await page.waitForFunction(() => [...document.querySelectorAll('.sc-body')].every((b) => b.getAttribute('aria-busy') === 'false'));
  return { page, context };
}
const panel = (page, title) => page.locator(`.sc-panel[aria-label="${title}"]`);

test('Missed revenue & fill: title, legend, stacked bars, label, order, total row', async () => {
  const { page, context } = await open(1163);
  try {
    const p = panel(page, 'Missed revenue & fill');
    assert.equal(await p.locator('h2').textContent(), 'Missed revenue & fill');
    assert.deepEqual(await p.locator('.sc-legend-item').allTextContents(), ['Filled', 'Unsold slots (at floor CPM)', 'Display downtime']);
    const rows = await p.locator('.sc-row').all();
    assert.ok(rows.length > 2);
    for (const row of rows) {
      assert.match(await row.locator('.sc-value').textContent(), /^\d+% filled · \$[\d,]+ \+ \$[\d,]+ missed$/);
      const widths = await row.locator('.sc-stack i').evaluateAll((is) => is.map((i) => i.getBoundingClientRect().width));
      const total = await row.locator('.sc-stack').evaluate((s) => s.getBoundingClientRect().width);
      assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - total) < 1, 'three widths fill the bar');
      assert.match(await row.locator('.sc-stack').getAttribute('aria-label'), /^.+: \d+% filled, \$[\d,]+ unsold, \$[\d,]+ lost to downtime$/);
    }
    const names = (loc) => loc.locator('.sc-row:not(.sc-total) .sc-label').allTextContents().then((a) => a.map((t) => t.replace(/\s*\(\d+\)\s*$/, '').trim()));
    const svNames = await names(panel(page, 'Slot value'));
    assert.deepEqual(await names(p), svNames, 'same display type order as Slot value');
    assert.match(await p.locator('.sc-row').last().textContent(), /^All display types \(\d+\)/);
    assert.equal(await p.locator('.sc-row.sc-total').count(), 1);
    assert.equal(await p.locator('.sc-m-unsold').first().evaluate((e) => getComputedStyle(e).color), 'rgb(173, 104, 0)');
    assert.equal(await p.locator('.sc-m-down').first().evaluate((e) => getComputedStyle(e).color), 'rgb(207, 19, 34)');
  } finally { await context.close(); }
});

test('Missed revenue & fill: hovering the bar shows the same hover as its numbers; the name keeps the display type card', async () => {
  const { page, context } = await open(1163);
  try {
    const row = panel(page, 'Missed revenue & fill').locator('.sc-row').first();
    const tip = page.locator('.sc-tip:not([hidden])');
    await row.locator('.sc-value').hover();
    const fromNumbers = await tip.textContent();
    assert.match(fromNumbers, /Total missed revenue/);
    await page.mouse.move(0, 0);
    await row.locator('.sc-track').hover();
    assert.equal(await tip.textContent(), fromNumbers, 'bar hover matches the numbers hover');
    await page.mouse.move(0, 0);
    await row.locator('.sc-label').hover();
    assert.doesNotMatch(await tip.textContent(), /Total missed revenue/, 'the name still shows the display type card');
  } finally { await context.close(); }
});

test('Yield: defaults to All deal types, coloured eCPM bars highest first, empty state when nothing cleared', async () => {
  const { page, context } = await open(1163);
  try {
    const p = panel(page, 'Yield');
    const opts = await p.locator('select option').allTextContents();
    assert.deepEqual(opts, ['All deal types', 'Direct advertiser', 'Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction']);
    assert.equal(await p.locator('select').inputValue(), '');
    const labels = await p.locator('.sc-value').allTextContents();
    assert.ok(labels.length >= 1 && labels.every((l) => /^\$\d+\.\d\d eCPM$/.test(l)), labels.join('|'));
    const cpms = labels.map((l) => parseFloat(l.slice(1)));
    assert.deepEqual(cpms, cpms.slice().sort((a, b) => b - a));
    const colours = { DV360: 'rgb(235, 104, 52)', 'The Trade Desk': 'rgb(42, 120, 214)', 'Amazon DSP': 'rgb(27, 175, 122)', Direct: 'rgb(107, 63, 160)' };
    for (const row of await p.locator('.sc-row').all()) {
      const name = await row.locator('.sc-label').textContent();
      assert.equal(await row.locator('.sc-bar').evaluate((b) => getComputedStyle(b).backgroundColor), colours[name], name);
    }
    for (const type of ['Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction']) {
      await p.locator('select').selectOption({ label: type });
      await page.waitForFunction(() => document.querySelector('.sc-panel[aria-label="Yield"] .sc-body').getAttribute('aria-busy') === 'false');
      const names = await p.locator('.sc-label').allTextContents();
      assert.ok(!(await p.textContent('.sc-body')).includes('No delivery'));
      if (!names.length) assert.equal(await p.locator('.sc-state').textContent(), 'bar_chart_offNothing cleared on this deal type in scope.');
    }
  } finally { await context.close(); }
});

test('Slot allocation hover headings, four columns and no sold bar; Slot value legend and labels', async () => {
  const { page, context } = await open(1163);
  try {
    const n = page.locator('.sc-table td.sc-num').first();
    await n.hover();
    const tip = page.locator('.sc-tip:not([hidden])');
    assert.match(await tip.locator('.sc-tip-title').textContent(), /^.+: loop$/);
    assert.match(await tip.textContent(), /Total loop length\d+sSlots per loop\d+Average slot duration\d+\.\ds/);
    await page.locator('.sc-table tr').nth(1).locator('td.sc-num').nth(1).hover();
    assert.match(await tip.locator('.sc-tip-title').textContent(), /^.+: advertiser slots$/);
    await page.locator('.sc-table tr').nth(1).locator('td.sc-num').nth(2).hover();
    assert.match(await tip.locator('.sc-tip-title').textContent(), /^.+: own-content slots$/);
    assert.deepEqual(await page.locator('.sc-table th > span:first-child').evaluateAll((e) => e.map((x) => x.textContent.trim())), ['Display type', 'Slots per loop', 'Advertiser slots', 'Own-content slots']);
    assert.equal(await page.locator('.sc-mini').count(), 0);

    const sv = panel(page, 'Slot value');
    assert.deepEqual(await sv.locator('.sc-legend-item').allTextContents(), ['Effective CPM', 'Floor CPM']);
    assert.match(await sv.locator('.sc-value').first().textContent(), /^\$\d+\.\d\d CPM$/);
    assert.equal(await sv.locator('.sc-floor-mark').first().evaluate((e) => getComputedStyle(e).borderLeftColor), 'rgb(237, 161, 0)');
    await sv.locator('.sc-track-in').first().hover();
    assert.match(await tip.textContent(), /Effective CPM/, 'hovering the bar shows the same card as the value');
    await page.mouse.move(0, 0);
    await sv.locator('.sc-value').first().hover();
    assert.match(await tip.textContent(), /Effective CPM/);
    await sv.locator('.sc-seg-btn[data-mode="per"]').click();
    assert.deepEqual(await sv.locator('.sc-legend-item').allTextContents(), ['Earned revenue per advertiser slot per day']);
    assert.match(await sv.locator('.sc-value').first().textContent(), /^\$\d+\.\d\d per available slot per day$/);
  } finally { await context.close(); }
});

test('at 390px there is no sideways scroll and the missed-revenue label sits above the bar', async () => {
  const { page, context } = await open(390);
  try {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    const row = panel(page, 'Missed revenue & fill').locator('.sc-row').first();
    const [l, t] = await Promise.all([row.locator('.sc-label').boundingBox(), row.locator('.sc-track').boundingBox()]);
    assert.ok(l.y + l.height <= t.y + 1, 'label above the bar');
  } finally { await context.close(); }
});

test('Fill and effective CPM by hour: under Yield, full width, toggle, operating hours, hover facts', async () => {
  const { page, context } = await open(1163);
  try {
    const p = panel(page, 'Fill and effective CPM by hour');
    assert.equal(await p.locator('h2').textContent(), 'Fill and effective CPM by hour');
    const [y, h] = await Promise.all([panel(page, 'Yield').boundingBox(), p.boundingBox()]);
    assert.ok(h.y >= y.y + y.height - 1, 'directly under Yield');
    const grid = await page.locator('.sc-grid').boundingBox();
    assert.ok(h.width > grid.width * 0.95, 'full width');
    assert.equal(await p.locator('.sc-seg-btn.on').textContent(), 'Fill');
    const rowOf = (name) => p.locator('.sc-heat-row', { has: page.locator(`.sc-heat-label:has-text("${name}")`) });
    assert.match(await rowOf('Window Portrait').locator('.sc-heat-cell[data-hour]').first().textContent(), /^\d+%$/);
    assert.equal(await rowOf('Window Portrait').locator('.sc-heat-cell[data-hour]').count(), 24);
    const queue = await rowOf('Queue Screen').locator('.sc-heat-cell[data-hour]').count();
    assert.ok(queue > 0 && queue < 24);
    await p.locator('.sc-seg-btn[data-mode="cpm"]').click();
    assert.match(await rowOf('Window Portrait').locator('.sc-heat-cell[data-hour]').first().textContent(), /^\$\d+\.\d\d$|^–$/);
    await rowOf('Window Portrait').locator('.sc-heat-cell[data-hour]').nth(10).hover();
    const tip = await page.locator('.sc-tip').textContent();
    assert.match(tip, /Hour/); assert.match(tip, /advertiser slots sold/); assert.match(tip, /assumed views/); assert.match(tip, /Totals across all/);
    await p.locator('.sc-seg-btn[data-mode="fill"]').click();
    assert.match(await rowOf('Window Portrait').locator('.sc-heat-cell[data-hour]').first().textContent(), /^\d+%$/);
  } finally { await context.close(); }
});
