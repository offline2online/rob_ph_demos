'use strict';
// Browser checks for the Sales uplift chart (npm run test:ui): retailer and advertiser, desktop and 390px.
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

async function open(width, query) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ status: 200, body: '' }));
  await page.goto(`${base}/index.html${query}`);
  await page.waitForSelector('.up-svg');
  return { page, context, problems };
}
const scrollFits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('retailer: tiles, one chart, legend store lists, campaign drop-down, and it sits after the maturity section', async () => {
  const { page, context, problems } = await open(1163, '');
  try {
    assert.deepEqual(await page.$$eval('.up-tile-lbl', (e) => e.map((x) => x.textContent)), ['Uplift', 'Incremental sales (USD)', 'iROAS']);
    assert.equal(await page.$$eval('.up-svg', (e) => e.length), 1);
    assert.deepEqual(await page.$$eval('.up-key', (e) => e.map((x) => x.textContent.replace(/\d+/, 'n'))), ['Campaign stores (n)', 'Control stores (n)']);
    await page.locator('.up-key').nth(1).hover();
    assert.match(await page.innerText('.up-tip'), /Control stores \(2\)\s+Leeds Trinity\s+Glasgow Buchanan St/);
    await page.locator('.up-tile').first().hover();
    assert.match(await page.innerText('.up-tip'), /^Plays: .*% default/);
    await page.locator('.up-hit').nth(40).hover();
    assert.match(await page.innerText('.up-tip'), /Difference/);
    await page.locator('.up-title .up-info').hover();
    assert.match(await page.innerText('.up-tip'), /Windows: 30 days before, during, 30 days after\.$/);
    const after = await page.evaluate(() => document.getElementById('up').getBoundingClientRect().top > document.getElementById('dc').getBoundingClientRect().top);
    assert.ok(after);
    // Selecting a campaign without a Control stores exclusion.
    const opts = await page.$$eval('.up-select option', (o) => o.map((x) => x.value));
    await page.selectOption('.up-select', opts.find((v) => /-5$/.test(v)));
    await page.waitForFunction(() => /No control stores set for this campaign\./.test(document.querySelector('.up-empty')?.textContent || ''));
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('advertiser: the drop-down lists only its own campaigns; phone width has no sideways scroll', async () => {
  const { page, context, problems } = await open(390, '?role=advertiser');
  try {
    const labels = await page.$$eval('.up-select option', (o) => o.map((x) => x.textContent));
    assert.ok(labels.length > 0);
    assert.ok(labels.every((l) => l.startsWith('Blackmores ')), labels.join('|'));
    assert.ok(await scrollFits(page));
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});
