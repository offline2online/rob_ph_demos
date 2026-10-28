'use strict';
// Browser checks for Demand health and Targeting & scheduling maturity against the approved artifact (npm run test:ui).
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
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ status: 200, body: '' }));
  await page.goto(base + '/index.html');
  await page.waitForSelector('.dc-adv');
  await page.waitForSelector('.dc-adv .dc-level');
  await page.waitForSelector('.dc-panel:has(h3:text-is("Progress over time")) .dc-svg');
  return { page, context, problems };
}
const texts = (page, sel) => page.$$eval(sel, (e) => e.map((x) => x.textContent));
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('Demand health: section header, names only, "n deals" hover, Show all N advertisers', async () => {
  const { page, context, problems } = await open(1163);
  try {
    const head = page.locator('.dc-sechead:has(h2:text-is("Demand health"))');
    assert.equal(await head.locator('.dc-sec-icon').textContent(), 'handshake');
    assert.equal(await head.locator('.dc-info').count(), 1);
    assert.equal(await head.locator('h2').evaluate((e) => getComputedStyle(e).fontWeight), '600');
    assert.equal(await head.evaluate((e) => getComputedStyle(e).borderBottomWidth), '1px');
    await head.locator('.dc-info').hover();
    assert.match(await page.textContent('.dc-tip'), /^Which advertisers are on which deals/);

    assert.deepEqual(await texts(page, '.dc-adv thead th .dc-sort > span:first-child'), ['Advertiser', 'Revenue', 'Share of total revenue', 'Deals on', 'Slots covered', 'Effective CPM', 'Pacing', 'Maturity level']);
    const names = await texts(page, '.dc-adv tbody th');
    assert.equal(names.length, 10);
    assert.ok(names.every((n) => !/\(/.test(n)), `no DSP in the cell: ${names}`);
    const deals = await texts(page, '.dc-adv tbody td:nth-child(4)');
    assert.ok(deals.every((d) => /^\d+ deals?$/.test(d)), deals.join());
    const i = deals.findIndex((d) => d === '2 deals');
    assert.ok(i >= 0);
    const cell = page.locator('.dc-adv tbody tr').nth(i).locator('td').nth(2);
    await cell.hover();
    assert.match(await page.textContent('.dc-tip-title'), / \([^)]+\): deals on$/);
    assert.equal(await page.locator('.dc-adv tbody tr').nth(i).locator('td').nth(2).evaluate((e) => getComputedStyle(e).textDecorationStyle), 'dotted');

    const btn = page.locator('.dc-btn.dc-link');
    assert.equal(await btn.textContent(), 'Show all 11 advertisers');
    await btn.click();
    assert.equal((await texts(page, '.dc-adv tbody th')).length, 11);
    assert.equal(await btn.textContent(), 'Show top 10');
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('Advertisers table is advertiser level: no Seats column, no chevron, no sub-rows', async () => {
  const { page, context, problems } = await open(1163);
  try {
    await page.locator('.dc-btn.dc-link').click(); // all 11 advertisers
    assert.equal(await page.locator('.dc-adv .dc-expand').count(), 0);
    assert.equal(await page.locator('.dc-adv tbody tr.dc-seat').count(), 0);
    assert.equal(await page.locator('.dc-adv tbody tr').count(), 11);
    assert.equal(await page.locator('.dc-adv tbody tr').first().locator('td').count(), 7);
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('Maturity: order, filters, Variables in use, table cells, Progress over time last', async () => {
  const { page, context, problems } = await open(1163);
  try {
    assert.equal(await page.locator('.dc-sechead:has(h2:text-is("Targeting & scheduling maturity")) .dc-sec-icon').textContent(), 'stairs');
    assert.deepEqual(await texts(page, '.dc-panel h3'),
      ['Advertisers', 'Variables in use', 'Progress over time']);
    const box = (t) => page.locator(`.dc-panel:has(h3:text-is("${t}"))`).boundingBox();
    const [vars, pro] = await Promise.all(['Variables in use', 'Progress over time'].map(box));
    for (const b of [vars, pro]) assert.ok(b.width > 1000, `full width: ${b.width}`);
    assert.equal(await page.locator('.dc-panel:has(h3:text-is("Maturity ladder")), .dc-panel:has(h3:text-is("Scheduling"))').count(), 0, 'the ladder and scheduling charts are gone');

    const seg = page.locator('.dc-panel:has(h3:text-is("Variables in use")) .dc-seg-btn');
    assert.deepEqual(await seg.allTextContents(), ['Localised', 'Personalised']);
    assert.equal(await seg.first().getAttribute('aria-checked'), 'true');
    await seg.last().click();
    await page.waitForFunction(() => document.querySelector('.dc-panel:has(h3) .dc-seg-btn.on') && [...document.querySelectorAll('.dc-panel')].find((p) => p.querySelector('h3').textContent === 'Variables in use').querySelector('.dc-seg-btn.on').textContent === 'Personalised');
    await page.waitForFunction(() => [...document.querySelectorAll('.dc-panel')].find((p) => p.querySelector('h3').textContent === 'Variables in use').querySelector('.dc-bar.dc-l2'));

    assert.equal(await page.locator('.dc-panel:has(h3:text-is("Advertisers")) .dc-select').count(), 0, 'no filter dropdowns on the Advertisers table');
    assert.equal(await page.locator('h3:text-is("Advertiser targeting & scheduling")').count(), 0, 'the separate table is gone');
    assert.equal(await page.locator('.dc-mat').count(), 0);
    const levels = await texts(page, '.dc-adv tbody td:nth-child(8) .dc-level');
    assert.ok(levels.length === 10 && levels.every((l) => ['Default only', 'Localised', 'Personalised'].includes(l)), levels.join());
    const cells = await texts(page, '.dc-adv tbody td:nth-child(8)');
    assert.ok(cells.some((c) => /Scheduled$/.test(c)), 'scheduling tile beside the level chip');
    assert.ok(cells.some((c) => ['Default only', 'Localised', 'Personalised'].includes(c)), 'an advertiser that does not schedule shows only the level chip');
    assert.equal(await page.locator('.dc-adv tbody td:nth-child(8) .dc-none').filter({ hasText: 'Not used' }).count(), 0);
    const pacing = await texts(page, '.dc-adv tbody td:nth-child(7)');
    assert.ok(pacing.every((p) => p === '–' || /^\d+%$/.test(p)), pacing.join());
    assert.ok(pacing.some((p) => /%$/.test(p)) && pacing.includes('–'), pacing.join());
    await page.locator('.dc-adv tbody td:nth-child(8) .dc-level').first().hover();
    assert.match(await page.textContent('.dc-tip'), /Variables used/);
    await page.locator('.dc-adv tbody td:nth-child(8) .dc-sched').first().hover();
    assert.match(await page.textContent('.dc-tip'), /scheduled campaigns/);
    await page.locator('.dc-adv tbody td:nth-child(7).dc-dotted').first().hover();
    assert.match(await page.textContent('.dc-tip'), /programmatic guaranteed pacing/);
    // clicking a Variables in use bar still filters the table; the chip clears it
    await page.locator('.dc-panel:has(h3:text-is("Variables in use")) .dc-bar').first().click();
    await page.waitForSelector('.dc-clear:not([hidden])');
    assert.match(await page.textContent('.dc-filters > :first-child'), /^Clear filter/);
    await page.click('.dc-clear');
    await page.waitForFunction(() => document.querySelectorAll('.dc-adv tbody tr').length === 10);
    // revenue appears once on the page
    assert.equal(await page.locator('th:text-is("Revenue"), .dc-sort > span:text-is("Revenue")').count(), 1);

    const prog = page.locator('.dc-panel:has(h3:text-is("Progress over time"))');
    assert.deepEqual(await prog.locator('.dc-seg-btn.on').allTextContents(), ['Month']);
    assert.deepEqual(await prog.locator('.dc-axis').allTextContents().then((t) => t.filter((x) => /[A-Za-z]/.test(x))), ['Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('Progress over time ignores the date range; the advertiser table follows it', async () => {
  const { page, context } = await open(1163);
  try {
    const prog = () => page.locator('.dc-panel:has(h3:text-is("Progress over time")) .dc-svg').innerHTML();
    const revenue = () => page.locator('.dc-adv tbody td:nth-child(2)').allTextContents();
    const [p0, r0] = [await prog(), await revenue()];
    await page.click('#f-date');
    await page.click('.dr-preset[data-days="7"]');
    await page.click('#apply');
    await page.waitForFunction((b) => [...document.querySelectorAll('.dc-adv tbody td:nth-child(2)')].map((x) => x.textContent).join() !== b, r0.join());
    assert.notDeepEqual(await revenue(), r0);
    assert.equal(await prog(), p0);
  } finally { await context.close(); }
});

test('no sideways scroll at 390px', async () => {
  const { page, context, problems } = await open(390);
  try {
    assert.ok(await noHorizontalScroll(page), 'no horizontal scroll');
    assert.ok(await noHorizontalScroll(page));
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});
