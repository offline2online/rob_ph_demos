'use strict';
// Browser checks for the advertiser view (npm run test:ui): Blackmores at ?role=advertiser, desktop and 390px.
// Chromium comes from PLAYWRIGHT_BROWSERS_PATH; Google Fonts are stubbed so the run needs no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchChromium } = require('./browser');

const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const HOSTILE = '<img src=x onerror=alert(1)>';

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

async function open(width, patchApi) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => { problems.push(`dialog: ${d.message()}`); d.dismiss(); });
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ status: 200, body: '' }));
  if (patchApi) {
    await page.route('**/frontend/local-api.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'frontend', 'local-api.js'), 'utf8') + patchApi }));
  }
  await page.goto(`${base}/index.html?role=advertiser`);
  await page.waitForSelector('.av-table');
  await page.waitForSelector('.av-metric');
  await page.waitForSelector('.av-target');
  await page.waitForSelector('.av-hit');
  return { page, context, problems };
}
const tipText = async (page, selector, nth = 0) => {
  await page.locator(selector).nth(nth).hover();
  await page.waitForSelector('.av-tip:not([hidden])');
  return page.innerText('.av-tip');
};
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('targeting & scheduling: ladder, blocks, Audience full width', async () => {
  const { page, context, problems } = await open(1163);
  try {
    const rungs = await page.$$eval('.av-rung', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(rungs, ['Personalised You are here', 'Localised', 'Default only']);
    assert.equal(await page.$$eval('.av-rung.here', (r) => r.length), 1);
    const labels = await page.$$eval('.av-block-lbl', (l) => l.map((x) => x.textContent));
    assert.deepEqual(labels, ['Variables you use', 'Scheduling', 'Other variables available to use']);
    const target = await page.innerText('.av-target');
    assert.match(target, /Purchase Intent · Identified visitor/);
    assert.match(target, /Dayparted · 3 of 4 campaigns · 5 schedules/);
    assert.deepEqual(await page.$$eval('.av-lvl', (l) => l.map((x) => x.textContent.trim())), ['Localised', 'Personalised']);
    const cols = await page.$eval('.av-target', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
    assert.equal(cols, 2);
    // Audience: full width card, hero number and caption, area under the line.
    const [aw, dw] = await page.evaluate(() => [...document.querySelectorAll('.av-panel')].filter((p) => /Audience|Delivery/.test(p.querySelector('h2').textContent)).map((p) => p.getBoundingClientRect().width));
    assert.ok(Math.abs(aw - dw) < 1, 'Audience is as wide as Delivery');
    assert.match(await page.innerText('.av-metric-lbl'), /^Assumed views \(VAC-d\) delivered, 12 Sep – 11 Oct$/);
    assert.equal(await page.$eval('.av-metric-val', (e) => getComputedStyle(e).fontSize + getComputedStyle(e).fontWeight), '32px700');
    assert.equal(await page.$eval('.av-spark', (e) => e.getBoundingClientRect().height), 56);
    assert.equal(await page.$$eval('.av-spark path', (p) => p.length), 2);
    const aud = await tipText(page, '.av-panel:has(h2:text("Audience")) .av-info');
    assert.match(aud, /the peak was \d+(\.\d)?k on \d+ \w{3}\./);
    assert.match(aud, /Example: 4,000 footfall/);
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('your deals by display type: share, deal, slots and display type hovers', async () => {
  const { page, context, problems } = await open(1163);
  try {
    assert.match(await page.innerText('.av-deal:nth-of-type(2) td:last-child'), /\d+% of deal plays/);
    const share = await tipText(page, '.av-deal td:last-child .av-name-in');
    assert.match(share, /^.+ · Window Portrait\n/);
    assert.match(share, /Plays you won/);
    assert.match(share, /Advertisers on the deal/);
    const deal = await tipText(page, '.av-deal .av-name .av-name-in');
    assert.match(deal, /Deal ID\s+Google DSP \(DV360\): PH-[A-Z0-9]{10}/);
    const slots = await tipText(page, '.av-deal td.hov');
    assert.match(slots, /^Assigned slots/);
    assert.match(slots, /Window Portrait \(Portrait screen in the store window at the entrance\)/);
    assert.match(slots, /Window loop · Store front/);
    assert.match(slots, /IAB zone: Entrance & out of category/);
    assert.match(slots, /Advertiser slot 1 \(slot 1 of/);
    const type = await tipText(page, '.av-type .av-name .av-name-in');
    for (const k of ['Connected displays', '10 across 5 stores', 'IAB store zone', 'Operating hours', 'Touch Point', 'Display canvas size (resolution)', 'Display orientation', 'Creative formats', 'Share of loop time', 'Averages across all 10 connected Window Portrait displays in 5 stores, 12 Sep – 11 Oct.']) assert.ok(type.includes(k), k);
    assert.ok(!/Description|10 displays in/.test(type));
    const typeRow = await page.innerText('.av-type');
    assert.match(typeRow, /\d+ deals?\s+\d+ slots?/);
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('delivery: deal select, orange Spend, day hover, pacing view', async () => {
  const { page, context, problems } = await open(1163);
  try {
    const options = await page.$$eval('select[aria-label="Deal"] option', (o) => o.map((x) => x.textContent));
    assert.deepEqual(options, ['All deals', 'Open auction', 'Immune — winter launch (Programmatic guaranteed)']);
    assert.equal(await page.$$eval('.av-svg path[stroke="#eb6834"]', (p) => p.length), 1);
    assert.equal(await page.$eval('.av-tile:nth-child(2)', (e) => getComputedStyle(e.querySelector('.av-tile-bar')).backgroundColor), 'rgb(235, 104, 52)');
    const day = await tipText(page, '.av-hit', 10);
    assert.match(day, /Plays won vs previous day\s+(▲|▼) \d+%|Plays won vs previous day\s+0%/);
    await page.selectOption('select[aria-label="Deal"]', 'd1');
    await page.click('.av-seg-btn:text("Pacing")');
    assert.deepEqual(await page.$$eval('.av-kpi .av-tile-lbl', (l) => l.map((x) => x.textContent)), ['Delivered', 'Guaranteed to date', 'Guaranteed whole flight', 'Pacing']);
    assert.match(await page.innerText('.av-legend'), /Delivered assumed views \(VAC-d\)\s+Guaranteed/);
    assert.equal(await page.$$eval('.av-today', (l) => l.length), 1);
    assert.ok(await page.$$eval('.av-svg text', (t) => t.some((x) => x.textContent === 'Today')));
    const info = await tipText(page, '.av-panel:has(h2:text("Delivery")) .av-info');
    assert.match(info, /Click the Plays won or Spend total/);
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('security: no other advertiser, no downtime; names stay text', async () => {
  const patch = `;(function(){var H=${JSON.stringify(HOSTILE)};var g=LocalApi.get;LocalApi.get=function(p,a,b){return g(p,a,b).then(function(r){
    var s=JSON.stringify(r);
    ['Window Portrait','Immune — winter launch','Blackmores'].forEach(function(n){s=s.split(n).join(H);});
    return JSON.parse(s);});};})();`;
  const { page, context, problems } = await open(1163, patch);
  try {
    await page.waitForTimeout(400);
    assert.equal(await page.$$eval('img', (i) => i.length), 0, 'no <img> was created');
    assert.ok((await page.innerText('.av-root')).includes(HOSTILE), 'the hostile name is shown as text');
    for (const sel of ['.av-type .av-name-in', '.av-deal td:last-child .av-name-in', '.av-deal td.hov']) await tipText(page, sel);
    assert.equal(await page.$$eval('img', (i) => i.length), 0);
    assert.deepEqual(problems.filter((p) => !p.startsWith('console: Failed to load resource')), []);
  } finally { await context.close(); }
  const real = await open(1163);
  try {
    const all = [await real.page.innerText('.av-root')];
    for (const sel of ['.av-hit', '.av-type .av-name-in', '.av-deal td:last-child .av-name-in', '.av-deal td.hov']) all.push(await tipText(real.page, sel, sel === '.av-hit' ? 3 : 0));
    const text = all.join('\n');
    for (const other of ['Haleon', 'Unilever', 'Bayer', 'Advertiser A']) assert.ok(!text.includes(other), `shows ${other}`);
    assert.ok(!/downtime|offline|lost revenue/i.test(text));
  } finally { await real.context.close(); }
});

test('390px: stacked, no sideways scroll, hover stays on screen', async () => {
  const { page, context, problems } = await open(390);
  try {
    assert.ok(await noHorizontalScroll(page));
    assert.equal(await page.$eval('.av-target', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length), 1);
    await page.locator('.av-hit').nth(10).scrollIntoViewIfNeeded();
    await page.locator('.av-hit').nth(10).hover();
    await page.waitForSelector('.av-tip:not([hidden])');
    const box = await page.$eval('.av-tip', (e) => { const r = e.getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom, innerWidth, innerHeight]; });
    assert.ok(box[0] >= 0 && box[1] <= box[4] && box[2] >= 0 && box[3] <= box[5], `hover on screen: ${box}`);
    assert.ok(await noHorizontalScroll(page));
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});
