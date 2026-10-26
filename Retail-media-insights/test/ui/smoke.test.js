'use strict';
// Browser smoke test (npm run test:ui): loads index.html as a retailer and as an advertiser at desktop and phone widths
// and checks the page end to end. Chromium comes from ./browser.js (the sandbox's /opt/pw-browsers build when Playwright's own is missing);
// Google Fonts are stubbed so the run needs no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchChromium } = require('./browser');

const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const HOSTILE = '<img src=x onerror=alert(1)>';
const SECTIONS = ['Revenue', 'Deals', 'Slot value', 'Slot allocation', 'Missed revenue & fill', 'Yield', 'Fill and effective CPM by hour', 'Demand health', 'Advertisers', 'Targeting & scheduling maturity'];

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

async function open(url, width, { patchApi } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => { problems.push(`dialog: ${d.message()}`); d.dismiss(); });
  await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => { (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`); }); });
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ status: 200, body: '' }));
  if (patchApi) {
    await page.route('**/frontend/local-api.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'frontend', 'local-api.js'), 'utf8') + patchApi }));
  }
  await page.goto(base + url);
  return { page, context, problems };
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const money = (text) => Number(/\$([\d,]+(?:\.\d+)?)/.exec(text)[1].replace(/,/g, ''));
// The summary tile shows $10,000 and over as one-decimal thousands; compare it with the full figure the same way.
const asTile = (n) => (n < 10000 ? '$' + Math.round(n).toLocaleString('en-US') : '$' + (Math.round(n / 100) / 10).toFixed(1) + 'k');
async function settle(page, ctx) {
  await page.waitForSelector('.rd-total');
  await page.waitForSelector('.rd-table');
  await page.waitForSelector('.sc-table');
  await page.waitForSelector('.sc-row[data-fill]');
  await page.waitForSelector('.dc-adv');
  await page.waitForSelector('.dc-mat');
  await page.waitForSelector('[data-tile="sold"]');
  // Once a slot chart panel has rendered (data, empty or error) a screen reader must not hear "busy" any more.
  await page.waitForFunction(() => [...document.querySelectorAll('.sc-body')].every((b) => b.getAttribute('aria-busy') !== 'true'));
  assert.deepEqual(await page.$$eval('.sc-body', (b) => b.map((x) => x.getAttribute('aria-busy'))), ['false', 'false', 'false', 'false', 'false'], `${ctx}: slot chart panels aria-busy`);
  assert.deepEqual(await page.evaluate(() => window.__csp || []), [], `${ctx}: CSP violations`);
}

for (const width of [1163, 390]) {
  test(`retailer page at ${width}px: order, reconciliation, amber, no scroll`, async () => {
    const { page, context, problems } = await open('/index.html', width);
    try {
      await settle(page, 'retailer');
      const headings = await page.$$eval('.rd-title h2, .sc-title h2, .dc-h2, .dc-panel h3', (hs) => hs.map((x) => x.textContent));
      const order = SECTIONS.map((s) => headings.indexOf(s));
      assert.ok(order.every((i) => i >= 0), `all sections present: ${headings}`);
      assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections in README order');
      assert.deepEqual(await page.$$eval('.tab', (t) => t.map((x) => x.textContent)), ['Retail Media Performance', 'Campaign Performance', 'Visitor Insights', 'Store Insights', 'Upcoming Appointments', 'Downloads']);
      assert.ok(await noHorizontalScroll(page), 'no horizontal scroll');

      // earned (summary) = Revenue chart total with every DSP on = Advertisers table total, as displayed
      for (const name of ['The Trade Desk', 'Amazon DSP', 'Direct']) await page.click(`.rd-chip:has-text("${name}")`);
      await page.waitForFunction(() => document.querySelectorAll('.rd-chip.on').length === 4);
      await page.waitForFunction(() => /Total earned/.test((document.querySelector('.rd-total') || {}).textContent || ''));
      const earned = Number(await page.getAttribute('[data-tile="earned"] .val', 'data-value'));
      assert.equal((await page.textContent('[data-tile="earned"] .val')).trim(), asTile(earned), 'tile money format');
      const chart = money(await page.textContent('.rd-total'));
      assert.match(await page.textContent('.dc-total th'), /^Total \(top 10\)$/, 'ten of the eleven advertisers by default');
      await page.click('.dc-btn:has-text("Show all")');
      await page.waitForFunction(() => /^Total$/.test((document.querySelector('.dc-total th') || {}).textContent || ''));
      const adv = money(await page.textContent('.dc-total td:nth-child(3)'));
      assert.equal(Math.round(chart), Math.round(earned), 'Revenue chart total = summary earned');
      assert.equal(Math.round(adv), Math.round(earned), 'Advertisers total = summary earned');

      // Inventory sold % = Missed revenue "All display types" fill
      const sold = /^(\d+)%/.exec(await page.textContent('[data-tile="sold"] .val'))[1];
      const fill = /(\d+)% fill/.exec(await page.textContent('.sc-row.sc-total'))[1];
      assert.equal(sold, fill);
      assert.match(await page.textContent('[data-tile="sold"] .val'), /^\d+%$/);
      assert.match(await page.textContent('[data-tile="sold"] .sub'), /^[\d,]+ sold · [\d,]+ available$/);

      // at least one amber Slot allocation row, and it is Queue Screen
      const amber = await page.$$eval('.sc-table tr[data-amber="true"] .sc-name', (r) => r.map((x) => x.textContent));
      assert.deepEqual(amber.slice().sort(), ['Queue Screen', 'Window Portrait'], `amber rows: ${amber}`);

      // hovers stay on screen
      for (const sel of ['.sc-row[data-fill]:not(.sc-total) .sc-label', '.sc-row[data-fill] .sc-value', '.sc-heat-label[role=rowheader]', '.sc-heat-cell[data-hour]', '.sc-info', '.dc-adv td[tabindex]', '.pg-info']) {
        const el = (await page.$$(sel))[0];
        if (!el) continue;
        await el.scrollIntoViewIfNeeded();
        await el.hover();
        const tip = await page.evaluate(() => [...document.querySelectorAll('.sc-tip,.dc-tip,.rd-tip,.pg-tip')].filter((t) => !t.hidden).map((t) => { const r = t.getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; })[0]);
        assert.ok(tip, `${sel}: a hover card shows`);
        assert.ok(tip[0] >= 0 && tip[1] <= width + 0.5 && tip[2] >= 0 && tip[3] <= 900 + 0.5, `${sel}: hover card on screen ${tip}`);
      }
      assert.deepEqual(await page.evaluate(() => window.__csp || []), []);
      assert.deepEqual(problems, []);
    } finally { await context.close(); }
  });

  test(`advertiser page at ${width}px: only the advertiser view, no other advertiser`, async () => {
    const { page, context, problems } = await open('/index.html?role=advertiser', width);
    try {
      await page.waitForSelector('.av-table');
      await page.waitForSelector('.av-metric');
      assert.equal(await page.isVisible('#rd'), false);
      assert.equal(await page.isVisible('#sc'), false);
      assert.equal(await page.isVisible('#dc'), false);
      assert.equal(await page.isVisible('#strip'), false);
      assert.equal(await page.$('.sc-root .sc-panel') !== null && await page.isVisible('.sc-panel'), false);
      const titles = await page.$$eval('.av-title h2', (h) => h.map((x) => x.textContent));
      assert.deepEqual(titles, ['Delivery', 'Your deals by display type', 'Audience', 'Your targeting & scheduling']);
      assert.match(await page.textContent('#adv-chip'), /^\s*lock\s*Blackmores\s*$/);
      assert.equal(await page.$('#f-adv'), null);
      const text = await page.innerText('body');
      for (const other of ['Haleon', 'Unilever', 'Advertiser A']) assert.ok(!text.includes(other), `shows ${other}`);
      const types = await page.$$eval('#f-display option', (o) => o.map((x) => x.textContent));
      assert.ok(types[0].startsWith('All Display Types (') && types.length < 5, `only its own display types: ${types}`);
      assert.ok(await noHorizontalScroll(page));
      assert.deepEqual(await page.evaluate(() => window.__csp || []), []);
      assert.deepEqual(problems, []);
    } finally { await context.close(); }
  });
}

test('changing the Store and applying updates every module; resetting hides Reset Filters', async () => {
  const { page, context, problems } = await open('/index.html', 1163);
  try {
    await settle(page, 'filters');
    assert.equal(await page.isVisible('#reset'), false);
    assert.equal(await page.isVisible('#apply'), false);
    const before = await page.getAttribute('[data-tile="earned"] .val', 'data-value');
    const beforeAdv = await page.textContent('.dc-total td:nth-child(3)');
    await page.selectOption('#f-store', 'store-1');
    assert.equal(await page.isVisible('#apply'), true);
    assert.equal(await page.isVisible('#reset'), false, 'Reset only once a non-default filter is applied');
    await page.click('#cancel');
    assert.equal(await page.inputValue('#f-store'), 'all');
    await page.selectOption('#f-store', 'store-1');
    await page.click('#apply');
    await page.waitForFunction((b) => (document.querySelector('[data-tile="earned"] .val') || { getAttribute() {} }).getAttribute('data-value') !== b, before);
    await page.waitForFunction((b) => (document.querySelector('.dc-total td:nth-child(3)') || {}).textContent !== b, beforeAdv);
    await page.waitForSelector('.rd-total');
    assert.equal(await page.isVisible('#reset'), true);
    assert.equal(await page.isVisible('#apply'), false);
    const rev = money(await page.textContent('.rd-total'));
    assert.ok(rev > 0);
    assert.match(await page.textContent('.sc-row.sc-total .sc-label'), /\(\d+\)/);
    // re-selecting the defaults and applying hides Reset Filters
    await page.selectOption('#f-store', 'all');
    await page.click('#apply');
    await page.waitForFunction(() => document.querySelector('#reset').hidden);
    // Variables in use shows only Shared Targeting Variables
    const banned = ['Weather', 'Loyalty Tier', 'Face Attributes', 'Daypart'];
    const vars = await page.$$eval('.dc-panel:has(h3:text-is("Variables in use")) .dc-label', (l) => l.map((x) => x.textContent));
    assert.ok(vars.length > 0 && vars.every((v) => !banned.includes(v)), vars.join());
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test('filter options come from the back end, with no placeholder names', async () => {
  const { page, context } = await open('/index.html', 1163);
  try {
    await settle(page, 'options');
    assert.deepEqual(await page.$$eval('#f-store option', (o) => o.map((x) => x.textContent)), ['All Stores (5)', 'Bristol Cabot Circus', 'Glasgow Buchanan St', 'Leeds Trinity', 'London Oxford St', 'Manchester Arndale']);
    assert.deepEqual(await page.$$eval('#f-adv option', (o) => o.map((x) => x.textContent)), ['All Advertisers (11)', 'Bayer Consumer Health', 'Blackmores', 'Haleon', 'Kenvue', "L'Oréal Paris", 'Nestlé Health Science', 'Perrigo', 'Procter & Gamble', 'Reckitt', 'Unilever', 'Vitabiotics']);
    assert.equal((await page.$$eval('#f-display option', (o) => o.map((x) => x.textContent)))[0], 'All Display Types (4)');
    const body = await page.innerText('body');
    for (const bad of ['Menu board', 'Kiosk', 'Advertiser A', 'QuickSight', 'Engagement']) assert.ok(!body.includes(bad), bad);
    // the breadcrumb follows the selected tab
    await page.click('.tab:has-text("Visitor Insights")');
    assert.match(await page.textContent('#crumb'), /Insights \/ Analytics\s*>\s*Visitor Insights/);
  } finally { await context.close(); }
});

test('names from the data are text, never markup (display type, deal, advertiser, store)', async () => {
  // The hostile name has no quote or backslash, so it can replace a name inside the JSON text and still parse.
  const patch = `;(function(){var H=${JSON.stringify(HOSTILE)};var g=LocalApi.get;LocalApi.get=function(p,a,b){return g(p,a,b).then(function(r){
    var s=JSON.stringify(r);
    ['Queue Screen','Wellness PG','Blackmores','Store 2'].forEach(function(n){s=s.split(n).join(H);});
    return JSON.parse(s);});};})();`;
  for (const url of ['/index.html', '/index.html?role=advertiser']) {
    const { page, context, problems } = await open(url, 1163, { patchApi: patch });
    try {
      await page.waitForSelector(url.includes('advertiser') ? '.av-table' : '.dc-adv');
      await page.waitForTimeout(600);
      assert.equal(await page.$$eval('img', (i) => i.length), 0, `${url}: no <img> was created`);
      assert.ok((await page.innerText('body')).includes(HOSTILE), `${url}: the name is shown as text`);
      assert.deepEqual(problems.filter((p) => !p.startsWith('console: Failed to load resource')), []);
    } finally { await context.close(); }
  }
});
