'use strict';
// Browser checks for Sales response after personalised plays: retailer and advertiser placement, toggles, controls, hover (npm run test:ui).
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

async function open(query, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ status: 200, body: '' }));
  await page.goto(`${base}/index.html${query}`);
  await page.waitForSelector('.sr-panel .sr-svg');
  return { page, context, problems };
}

test('retailer: the chart sits in Targeting & scheduling maturity with three lines, toggles, tooltips and a hover', async () => {
  const { page, context, problems } = await open('', 1163);
  try {
    assert.equal(await page.locator('.dc-section:has(h2:text-is("Targeting & scheduling maturity")) .sr-panel').count(), 1);
    assert.equal(await page.locator('.sr-panel h3').textContent(), 'Sales response after personalised plays');
    assert.equal(await page.locator('.sr-svg polyline').count(), 3);
    assert.deepEqual(await page.$$eval('.sr-legend-btn', (e) => e.map((x) => x.textContent)), ['After a personalised play', 'After a localised play', 'Control stores, same clock time']);
    await page.locator('.sr-title .sr-info').hover();
    assert.match(await page.textContent('.sr-tip'), /^Shows sales of this campaign’s product in the minutes after it played/);
    await page.locator('.sr-legend-item', { hasText: 'After a localised play' }).locator('.sr-info').hover();
    assert.match(await page.textContent('.sr-tip'), /^The same measure after a localised variant/);
    // Legend toggles: off removes the line, and the last one stays on.
    await page.locator('.sr-legend-btn', { hasText: 'localised' }).click();
    assert.equal(await page.locator('.sr-svg polyline').count(), 2);
    await page.locator('.sr-legend-btn', { hasText: 'Control' }).click();
    await page.locator('.sr-legend-btn', { hasText: 'personalised' }).click();
    assert.equal(await page.locator('.sr-svg polyline').count(), 1);
    await page.locator('.sr-legend-btn', { hasText: 'personalised' }).click();
    assert.equal(await page.locator('.sr-svg polyline').count(), 1, 'at least one line stays on');
    await page.locator('.sr-legend-btn', { hasText: 'localised' }).click();
    await page.locator('.sr-hit').nth(2).hover();
    const tip = await page.textContent('.sr-tip');
    assert.match(tip, /Minute 2 after play/);
    for (const k of ['Sales per 1,000 shoppers', 'Plays', 'Sales counted', 'Shoppers (footfall)', 'Stores', 'Dates']) assert.match(tip, new RegExp(k.replace(/[()]/g, '\\$&')));
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('controls: window, step, view and hour change the chart; the step list never exceeds the window; custom window is capped at 120', async () => {
  const { page, context, problems } = await open('', 1163);
  try {
    const dots = () => page.locator('.sr-svg polyline').first().getAttribute('points').then((p) => p.split(' ').length);
    assert.equal(await dots(), 10);
    await page.selectOption('select[aria-label="Window"]', '30');
    await page.waitForFunction(() => document.querySelector('.sr-svg polyline').getAttribute('points').split(' ').length === 30);
    await page.selectOption('select[aria-label="Step"]', '5');
    await page.waitForFunction(() => document.querySelector('.sr-svg polyline').getAttribute('points').split(' ').length === 6);
    await page.selectOption('select[aria-label="Window"]', '5');
    await page.waitForFunction(() => document.querySelector('.sr-svg polyline').getAttribute('points').split(' ').length === 5 || document.querySelector('.sr-svg polyline').getAttribute('points').split(' ').length === 1);
    assert.deepEqual(await page.$$eval('select[aria-label="Step"] option', (o) => o.map((x) => x.value)), ['1', '5']);
    await page.selectOption('select[aria-label="Window"]', 'custom');
    await page.fill('input[aria-label^="Custom window"]', '121');
    await page.dispatchEvent('input[aria-label^="Custom window"]', 'change');
    assert.ok(await page.locator('input[aria-label^="Custom window"].sr-bad').count());
    await page.fill('input[aria-label^="Custom window"]', '120');
    await page.dispatchEvent('input[aria-label^="Custom window"]', 'change');
    await page.waitForFunction(() => document.querySelector('.sr-svg polyline').getAttribute('points').split(' ').length === 24);
    await page.selectOption('select[aria-label="Window"]', '10');
    await page.click('.sr-seg-btn:text-is("Running total")');
    await page.waitForFunction(() => /^Running total/.test(document.querySelector('.sr-unit').textContent));
    await page.selectOption('select[aria-label="Hour of day"]', { index: 2 });
    await page.waitForSelector('.sr-svg polyline');
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('campaign drop-down follows the Advertiser filter; a campaign with no Control stores shows the note and hides the line', async () => {
  const { page, context, problems } = await open('', 1163);
  try {
    const all = await page.locator('select[aria-label="Campaign"] option').count();
    assert.ok(all > 5);
    const kenvue = await page.locator('select[aria-label="Campaign"] option', { hasText: 'Kenvue' }).first().getAttribute('value');
    await page.selectOption('select[aria-label="Campaign"]', kenvue);
    await page.waitForSelector('.sr-legend-item.sr-off');
    assert.equal(await page.locator('.sr-legend-item.sr-off').textContent(), 'Control stores — none set for this campaign.');
    assert.equal(await page.locator('.sr-svg polyline').count(), 2);
    assert.equal(await page.locator('.sr-flag').textContent(), 'Matched on product name');
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('advertiser login: the chart sits with Your targeting & scheduling, own campaigns only, and fits a phone', async () => {
  const { page, context, problems } = await open('?role=advertiser', 390);
  try {
    assert.equal(await page.locator('.av-sr .sr-panel').count(), 1);
    const options = await page.$$eval('select[aria-label="Campaign"] option', (o) => o.map((x) => x.textContent));
    assert.ok(options.length > 0 && options.every((t) => !/Haleon|L’Oréal|Kenvue|—/.test(t)), options.join('|'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no horizontal scroll at 390px');
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});
