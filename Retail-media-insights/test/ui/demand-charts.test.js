'use strict';
// Browser checks for Demand health and Targeting & scheduling maturity against the approved artifact (npm run test:ui).
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
  await page.waitForSelector('.dc-mat');
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

    assert.deepEqual(await texts(page, '.dc-adv thead th .dc-sort > span:first-child'), ['Advertiser', 'Seats', 'Revenue', 'Share of total revenue', 'Deals on', 'Slots covered', 'Slots won', 'Effective CPM', 'iROAS']);
    const names = await texts(page, '.dc-adv tbody th');
    assert.equal(names.length, 10);
    assert.ok(names.every((n) => !/\(/.test(n)), `no DSP in the cell: ${names}`);
    const deals = await texts(page, '.dc-adv tbody td:nth-child(5)');
    assert.ok(deals.every((d) => /^\d+ deals?$/.test(d)), deals.join());
    const i = deals.findIndex((d) => d === '3 deals');
    assert.ok(i >= 0);
    const cell = page.locator('.dc-adv tbody tr').nth(i).locator('td').nth(3);
    await cell.hover();
    assert.match(await page.textContent('.dc-tip-title'), / \([^)]+\): deals on$/);
    assert.equal(await page.locator('.dc-adv tbody tr').nth(i).locator('td').nth(3).evaluate((e) => getComputedStyle(e).textDecorationStyle), 'dotted');

    const btn = page.locator('.dc-btn.dc-link');
    assert.equal(await btn.textContent(), 'Show all 11 advertisers');
    await btn.click();
    assert.equal((await texts(page, '.dc-adv tbody th')).length, 11);
    assert.equal(await btn.textContent(), 'Show top 10');
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('Demand by DSP seat: Seats column, expand chevron, sub-rows add up, Direct has no chevron', async () => {
  const { page, context, problems } = await open(1163);
  try {
    await page.locator('.dc-btn.dc-link').click(); // all 11 advertisers
    const money = (t) => Math.round(parseFloat(t.replace(/[$,]/g, '')) * 100);
    const row = (id) => page.locator(`.dc-adv tbody tr[data-advertiser="${id}"]`);
    assert.equal(await row('adv-perrigo').locator('td').first().textContent(), 'Direct');
    assert.equal(await row('adv-perrigo').locator('.dc-expand').count(), 0);
    assert.equal(await row('adv-haleon').locator('td').first().textContent(), '2');
    await row('adv-haleon').locator('.dc-expand').hover();
    assert.equal(await page.textContent('.dc-tip'), 'Show spend by DSP seat.');
    await row('adv-haleon').locator('.dc-expand').click();
    const subs = page.locator('.dc-adv tbody tr.dc-seat');
    assert.equal(await subs.count(), 2);
    assert.match(await subs.first().locator('th').textContent(), /^(GroupM AU|Haleon In-house) \u00b7 The Trade Desk$/);
    let sum = 0;
    for (let i = 0; i < 2; i += 1) sum += money(await subs.nth(i).locator('td').nth(1).textContent());
    assert.equal(sum, money(await row('adv-haleon').locator('td').nth(1).textContent()));
    await subs.first().locator('th').hover();
    assert.match(await page.textContent('.dc-tip'), /Seat ID/);
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('Maturity: order, ladder, Variables in use, table cells, Progress over time last', async () => {
  const { page, context, problems } = await open(1163);
  try {
    assert.equal(await page.locator('.dc-sechead:has(h2:text-is("Targeting & scheduling maturity")) .dc-sec-icon').textContent(), 'stairs');
    assert.deepEqual(await texts(page, '.dc-panel h3'),
      ['Advertisers', 'Maturity ladder', 'Scheduling', 'Variables in use', 'Advertiser targeting & scheduling', 'Progress over time']);
    const box = (t) => page.locator(`.dc-panel:has(h3:text-is("${t}"))`).boundingBox();
    const [lad, sch, vars, tab, pro] = await Promise.all(['Maturity ladder', 'Scheduling', 'Variables in use', 'Advertiser targeting & scheduling', 'Progress over time'].map(box));
    assert.ok(Math.abs(lad.y - sch.y) < 2 && sch.x > lad.x, 'ladder and scheduling side by side');
    for (const b of [vars, tab, pro]) assert.ok(b.width > 1000, `full width: ${b.width}`);

    const ladder = page.locator('.dc-panel:has(h3:text-is("Maturity ladder"))');
    assert.deepEqual(await texts(page, '.dc-panel:has(h3:text-is("Maturity ladder")) .dc-label'), ['Personalised', 'Localised', 'Default only']);
    assert.deepEqual(await ladder.locator('.dc-bar').evaluateAll((b) => b.map((x) => getComputedStyle(x).backgroundColor)),
      ['rgb(23, 74, 140)', 'rgb(106, 167, 224)', 'rgb(217, 217, 217)']);
    assert.match(await ladder.locator('.dc-value').first().innerHTML(), /^<b>5<\/b> advertisers$/);
    await ladder.locator('.dc-row').first().hover();
    assert.ok((await page.textContent('.dc-tip')).includes('Blackmores (DV360) · '));

    const seg = page.locator('.dc-panel:has(h3:text-is("Variables in use")) .dc-seg-btn');
    assert.deepEqual(await seg.allTextContents(), ['Localised', 'Personalised']);
    assert.equal(await seg.first().getAttribute('aria-checked'), 'true');
    await seg.last().click();
    await page.waitForFunction(() => document.querySelector('.dc-panel:has(h3) .dc-seg-btn.on') && [...document.querySelectorAll('.dc-panel')].find((p) => p.querySelector('h3').textContent === 'Variables in use').querySelector('.dc-seg-btn.on').textContent === 'Personalised');
    await page.waitForFunction(() => [...document.querySelectorAll('.dc-panel')].find((p) => p.querySelector('h3').textContent === 'Variables in use').querySelector('.dc-bar.dc-l2'));

    const filters = page.locator('.dc-panel:has(h3:text-is("Advertiser targeting & scheduling")) .dc-select');
    assert.deepEqual(await filters.evaluateAll((s) => s.map((x) => x.getAttribute('aria-label'))), ['Maturity level', 'Variable', 'Scheduling']);
    assert.deepEqual(await filters.first().locator('option').allTextContents(), ['All levels', 'Default only', 'Localised', 'Personalised']);
    assert.equal(await filters.last().locator('option').first().textContent(), 'All scheduling');
    const rows = await texts(page, '.dc-mat tbody th');
    assert.ok(rows.every((n) => !/\(/.test(n)), 'name only');
    const sched = await texts(page, '.dc-mat tbody td:nth-child(4)');
    assert.ok(sched.includes('Dayparted · 3 of 4 campaigns') && sched.includes('Not used'), sched.join());
    assert.ok((await texts(page, '.dc-mat .dc-none')).includes('Not used'));
    await page.selectOption('.dc-select[aria-label="Maturity level"]', 'Localised');
    await page.waitForSelector('.dc-clear');
    await page.waitForFunction(() => document.querySelectorAll('.dc-mat tbody tr').length === 4);
    assert.match(await page.textContent('.dc-filters > :first-child'), /^Clear filter/);

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
    const revenue = () => page.locator('.dc-mat tbody td:last-child').allTextContents();
    const [p0, r0] = [await prog(), await revenue()];
    await page.click('#f-date');
    await page.click('.dr-preset[data-days="7"]');
    await page.click('#apply');
    await page.waitForFunction((b) => [...document.querySelectorAll('.dc-mat tbody td:last-child')].map((x) => x.textContent).join() !== b, r0.join());
    assert.notDeepEqual(await revenue(), r0);
    assert.equal(await prog(), p0);
  } finally { await context.close(); }
});

test('empty states and no sideways scroll at 390px', async () => {
  const { page, context, problems } = await open(390);
  try {
    assert.ok(await noHorizontalScroll(page), 'no horizontal scroll');
    await page.selectOption('.dc-select[aria-label="Scheduling"]', 'uses');
    await page.selectOption('.dc-select[aria-label="Maturity level"]', 'Default only');
    await page.waitForFunction(() => /No advertisers match this filter\./.test(document.body.innerText));
    assert.ok(await noHorizontalScroll(page));
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});
