// Captures every real prototype screen for the retail media click-through and animation (four convenience screen types).
const { chromium } = require('playwright');
const fs = require('fs');
const W = 1600, H = 950;
const OUT = 'steps5';
fs.mkdirSync(OUT, { recursive: true });
const HOT = {};
const ONLY = process.argv.slice(2);
const want = id => !ONLY.length || ONLY.some(o => id.startsWith(o));
const users = { items: [
  { email: 'maya.chen@retailer.example', firstName: 'Maya', lastName: 'Chen', role: 'Admin', lastLoginAt: '2026-11-04T08:12:00Z' },
  { email: 'ava.patel@retailer.example', firstName: 'Ava', lastName: 'Patel', role: 'Marketing', lastLoginAt: '2026-11-04T01:05:00Z' },
  { email: 'noah.kim@retailer.example', firstName: 'Noah', lastName: 'Kim', role: 'Help Desk', lastLoginAt: '2026-11-02T03:30:00Z' },
] };
async function openShell(b, { nav, crumb, src, snap }) {
  const p = await b.newPage({ viewport: { width: W, height: H } });
  const snapBody = fs.readFileSync(snap, 'utf8');
  const snapJson = JSON.parse(snapBody);
  await p.route('**/*.cloudfunctions.net/**', r => r.abort());
  await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync('proto/fonts/fonts.css', 'utf8') }));
  await p.route('**/demo/api-snapshot.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapBody }));
  await p.route('http://localhost:8790/fx/api/admin/v1/**', r => {
    const u = r.request().url();
    if (u.endsWith('/session')) return r.fulfill({ json: snapJson.routes['/admin/v1/session'] });
    if (u.includes('/users')) return r.fulfill({ json: users });
    if (u.includes('/advertisers')) return r.fulfill({ json: snapJson.routes['/admin/v1/advertisers'] });
    return r.abort();
  });
  await p.goto(`http://localhost:8790/shell.html?nav=${nav}&crumb=${encodeURIComponent(crumb)}&src=${encodeURIComponent(src)}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  return { p, f: p.frame({ name: 'app' }) };
}
async function box(loc) {
  try { await loc.scrollIntoViewIfNeeded({ timeout: 4000 }); } catch (e) {}
  const bb = await loc.boundingBox();
  return bb ? [Math.round(bb.x), Math.round(bb.y), Math.round(bb.width), Math.round(bb.height)] : null;
}
async function ubox(locs) {
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const l of locs) { const b = await l.boundingBox().catch(() => null); if (!b) continue; x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height); }
  return x1 < 1e9 ? [Math.round(x1), Math.round(y1), Math.round(x2 - x1), Math.round(y2 - y1)] : null;
}
async function extra(id, name, locs) { HOT[`${id}#${name}`] = await ubox(locs); console.log('extra', id, name, JSON.stringify(HOT[`${id}#${name}`])); }
async function shot(p, id, loc) {
  const hot = loc ? await box(loc) : null;
  await p.waitForTimeout(350);
  await p.screenshot({ path: `${OUT}/${id}.png` });
  HOT[id] = hot; console.log('shot', id, JSON.stringify(hot));
}
async function antSelect(f, scope, label, option) {
  await scope.locator(`input[aria-label="${label}"]`).locator("xpath=ancestor::div[contains(concat(' ',normalize-space(@class),' '),' ant-select ')][1]").click();
  await f.waitForTimeout(400);
  await f.locator(`.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option:has-text("${option}")`).first().click();
  await f.waitForTimeout(300);
  if (await f.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').count()) { await f.press('body', 'Escape').catch(() => {}); await f.waitForTimeout(300); }
}
const hideBroken = f => f.evaluate(() => { document.querySelectorAll('.ant-alert,[role=alert]').forEach(e => { if (/couldn.t be loaded/i.test(e.textContent)) { e.style.display = 'none'; const prev = e.previousElementSibling; if (prev && /plays per day/i.test(prev.textContent) && prev.textContent.length < 40) prev.style.display = 'none'; } }); [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /^plays per day/i.test((e.textContent || '').trim())).forEach(e => { (e.closest('div') || e).style.display = 'none'; }); });
const PA = 'Platform Admin';
const PLAYLISTS = [
  ['Forecourt Playlist', ['Brand partner', 'Fuel and car wash', 'Coffee and food']],
  ['Shop Front Playlist', ['Brand partner', "Today's deals", 'Store services']],
  ['Cooler Doors Playlist', ['Brand partner', 'Cold drink deals', 'Meal deals']],
  ['POS Playlist', ['Brand partner', 'Add-on offers', 'Loyalty app']],
];
(async () => {
  const b = await chromium.launch();
  let s;
  if (want('P1')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Display Types`, src: '/#/display-types', snap: 'snap4-pre.json' });
    await shot(s.p, 'P1-display-types', s.f.getByText('Playlist Management', { exact: true }).first());
    await extra('P1-display-types', 'list', ['Forecourt', 'Shop Front', 'Cooler Doors', 'POS'].map(n => s.f.getByText(n, { exact: true }).first()));
    await s.p.close();
  }
  if (want('P2') || want('P3') || want('P4') || want('P5') || want('P6') || want('P7') || want('P8')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Playlist Management`, src: '/#/playlists', snap: 'snap4-pre.json' });
    const f = s.f;
    await f.evaluate(() => { document.body.style.paddingBottom = '520px'; });  // room to scroll each playlist's slot table to mid-screen
    const rowOf = name => f.locator('tr, .ag-row').filter({ hasText: name }).first();
    const chev = name => rowOf(name).getByText(/chevron_right|expand_more|keyboard_arrow_down/).first();
    await shot(s.p, 'P2-playlists', chev('Forecourt Playlist'));
    for (let n = 0; n < PLAYLISTS.length; n++) {
      const [name, labels] = PLAYLISTS[n];
      if (n > 0) { await chev(PLAYLISTS[n - 1][0]).click(); await f.waitForTimeout(600); }
      await chev(name).click(); await f.waitForTimeout(900);
      const mx = f.locator('.ant-select').filter({ hasText: 'Default (Unlimited)' }).first();
      await mx.scrollIntoViewIfNeeded(); await f.waitForTimeout(300);
      if (n === 0) await shot(s.p, 'P2b-expanded', mx);
      await mx.click(); await f.waitForTimeout(500);
      const three = f.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /^3$/ }).first();
      if (n === 0) await shot(s.p, 'P3-three-slots', three);
      await three.click(); await f.waitForTimeout(800);
      const hq = f.locator('.ant-select').filter({ hasText: 'Headquarters' }).first();
      await hq.evaluate(e => e.scrollIntoView({ block: 'center' })); await f.waitForTimeout(400);  // keep the slot table mid-screen
      if (n === 0) { await shot(s.p, 'P4a-slots', hq); await extra('P4a-slots', 'table', [f.locator('input[value="Slot 1"]').first(), f.locator('input[value="Slot 3"]').first(), f.locator('.ant-select').filter({ hasText: 'Headquarters' }).last()]); }
      await hq.click(); await f.waitForTimeout(500);
      const adv = f.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: 'Advertiser' }).first();
      if (n === 0) await shot(s.p, 'P4-owner', adv);
      await adv.click(); await f.waitForTimeout(500);
      for (let k = 0; k < 3; k++) { await f.locator(`input[value="Slot ${k + 1}"]`).first().fill(labels[k]); await f.waitForTimeout(150); }
      await f.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {}); await f.waitForTimeout(300);
      const next = n < PLAYLISTS.length - 1 ? chev(PLAYLISTS[n + 1][0]) : f.getByRole('button', { name: 'Save changes' });
      const sid = `P${5 + n}-${['forecourt', 'shopfront', 'coolers', 'pos'][n]}`;
      await f.locator('.ant-select').filter({ hasText: 'Advertiser' }).last().evaluate(e => e.scrollIntoView({ block: 'center' })); await f.waitForTimeout(400);
      await shot(s.p, sid, next);
      await extra(sid, 'slots', [f.locator(`input[value="${labels[0]}"]`).first(), f.locator(`input[value="${labels[2]}"]`).first(), f.locator('.ant-select').filter({ hasText: 'Advertiser' }).last()]);
    }
    await s.p.close();
  }
  if (want('P9')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Playlist Management`, src: '/#/playlists', snap: 'snap4-predeal.json' });
    await shot(s.p, 'P9-saved', s.f.getByText('Advertisers / Inventory', { exact: true }).first());
    await extra('P9-saved', 'badges', [s.f.getByText('1 Advertiser').first(), s.f.getByText('1 Advertiser').last(), s.f.getByText('2 Headquarters').first()]);
    await s.p.close();
  }
  if (want('01')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertisers / Inventory`, src: '/#/advertisers', snap: 'snap4-predeal.json' });
    const r = s.f.locator('.ag-row').filter({ hasText: 'Frostline Cold Drinks' }).first();
    await r.scrollIntoViewIfNeeded(); await s.f.evaluate(() => window.scrollBy(0, 220));
    await shot(s.p, '01-advertiser', r.getByText('Frostline Cold Drinks').first());
    await extra('01-advertiser', 'row', [r]);
    await s.p.close();
  }
  if (want('03') || want('04')) {
    s = await openShell(b, { nav: 'company', crumb: 'Company Settings|Add Users / Advertisers', src: '/mockups/platform-users.html?api=http://localhost:8790/fx', snap: 'snap4-live.json' });
    await shot(s.p, '03-users', s.f.locator('#addBtn'));
    await s.f.click('#addBtn'); await s.f.waitForTimeout(500);
    await s.f.fill('#fn', 'Alex'); await s.f.fill('#ln', 'Morgan'); await s.f.fill('#em', 'alex@frostline-drinks.example');
    await s.f.selectOption('#role', 'Advertiser'); await s.f.waitForTimeout(300);
    await s.f.selectOption('#adv', 'red-bull'); await s.f.waitForTimeout(300);
    if (!(await s.f.isChecked('#invite'))) await s.f.check('#invite');
    await shot(s.p, '04-add-user', s.f.locator('#submitBtn'));
    await extra('04-add-user', 'form', [s.f.locator('#em'), s.f.locator('#role'), s.f.locator('#adv')]);
    await s.p.close();
  }
  if (want('05') || want('06')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertisers / Inventory`, src: '/#/advertisers', snap: 'snap4-predeal.json' });
    const nd = s.f.getByRole('button', { name: /New deal and buyers list/i });
    await shot(s.p, '05-deals', nd);
    await nd.click(); await s.f.waitForTimeout(700);
    const dlg = s.f.locator('[role=dialog]').last();
    await dlg.locator('input[placeholder="e.g. Q4 FMCG private auction"]').fill('Frostline direct');
    await dlg.locator('textarea').fill('Frostline Cold Drinks books the retailer directly, with no DSP: brand partner slots on all four screen types at a fixed CPM.');
    await antSelect(s.f, dlg, 'Deal type', 'Direct advertiser');
    await antSelect(s.f, dlg, 'Buyers', 'Frostline Cold Drinks');
    await dlg.getByText('New deal and buyers list').click();
    for (const [lab, val] of [['Flight start', '1 Dec 2026 00:00'], ['Flight end', '31 Dec 2026 23:59']]) {
      const i = dlg.locator(`input[aria-label="${lab}"]`);
      await i.click(); await s.f.waitForTimeout(300); await i.fill(val); await i.press('Enter'); await s.f.waitForTimeout(400);
    }
    await dlg.getByText('New deal and buyers list').click(); await s.f.waitForTimeout(200);
    await dlg.locator('input[role=spinbutton]').first().fill('150'); await s.f.waitForTimeout(300);
    await dlg.getByText('New deal and buyers list').click(); await s.f.waitForTimeout(200);
    await shot(s.p, '06-new-deal', dlg.getByRole('button', { name: 'Save as draft' }));
    await extra('06-new-deal', 'terms', [dlg.locator('input[aria-label="Deal type"]').locator("xpath=ancestor::div[contains(concat(' ',normalize-space(@class),' '),' ant-select ')][1]"), dlg.locator('input[role=spinbutton]').first()]);
    await s.p.close();
  }
  if (want('07')) {
    // the four brand partner slots start blank; each is assigned to the new Frostline deal in turn
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertisers / Inventory`, src: '/#/advertisers', snap: 'snap4-draft.json' });
    const names = ['Forecourt', 'Shop Front', 'Cooler Doors', 'POS'];
    const rowN = n => s.f.locator('.ag-row').filter({ hasText: `${names[n]} Playlist` }).first();
    const sel = n => rowN(n).locator('[col-id="assignedTo"] .ant-select').first();
    await s.f.evaluate(() => window.scrollBy(0, 110)); await s.f.waitForTimeout(400);  // the four slot rows sit mid-screen
    await shot(s.p, '07a-blank', sel(0));
    await extra('07a-blank', 'cells', names.map((_, n) => rowN(n).locator('[col-id="assignedTo"]').first()));
    await extra('07a-blank', 'deal', [s.f.locator('.ag-row').filter({ hasText: 'Frostline direct' }).first()]);
    for (let n = 0; n < 4; n++) {
      await sel(n).click(); await s.f.waitForTimeout(700);
      const opt = s.f.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: 'Frostline direct' }).first();
      const did = n === 0 ? '07-assign-slot' : `07d${n + 1}`;
      await shot(s.p, did, opt);
      if (n === 0) await extra(did, 'menu', [s.f.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').first()]);
      await opt.click(); await s.f.waitForTimeout(400);
      await s.f.press('body', 'Escape').catch(() => {}); await s.f.waitForTimeout(400);
      await s.p.mouse.move(5, 500); await s.f.waitForTimeout(300);
      if (n < 3) await shot(s.p, `07c${n + 1}`, sel(n + 1));
    }
    const save = s.f.getByRole('button', { name: 'Save changes' });
    await shot(s.p, '07b-assigned-all', save);
    await extra('07b-assigned-all', 'cells', names.map(n => s.f.locator('.ag-row').filter({ hasText: `${n} Playlist` }).first().locator('[col-id="assignedTo"]').first()));
    await s.p.close();
  }
  if (want('08')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertisers / Inventory`, src: '/#/advertisers', snap: 'snap4-assigned.json' });
    await s.f.getByText('Frostline direct', { exact: true }).first().click(); await s.f.waitForTimeout(900);
    await shot(s.p, '08-deal-finalise', s.f.locator('[role=dialog]').last().getByRole('button', { name: /Finalise/ }));
    await extra('08-deal-finalise', 'plays', [s.f.locator('[role=dialog]').last().getByText('Committed plays').first(), s.f.locator('[role=dialog]').last().getByText(/Forecast plays for/).first()]);
    await s.p.close();
  }
  if (want('09')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertisers / Inventory`, src: '/#/advertisers', snap: 'snap4-live.json' });
    await shot(s.p, '09-deal-live', s.f.getByText('Frostline direct', { exact: true }).first());
    await extra('09-deal-live', 'row', [s.f.locator('.ag-row').filter({ hasText: 'Frostline direct' }).first()]);
    await s.p.close();
  }
  if (want('13')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertiser Bookings|Campaign Approval|Campaign detail`, src: '/#/campaign-status/c_demo_redbull_edition', snap: 'snap4-live.json' });
    await shot(s.p, '13-campaign-brief', s.f.getByText('Campaign Brief', { exact: true }).first());
    await s.p.close();
  }
  if (want('14') || want('15')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertiser Bookings`, src: '/#/booking-schedule?tab=campaign-status', snap: 'snap4-live.json' });
    const r = s.f.locator('.ag-row').filter({ hasText: 'Awaiting approval' }).filter({ hasText: 'Frostline' }).first();
    await shot(s.p, '14-approval-table', r.locator('input[type=checkbox]').first());
    await extra('14-approval-table', 'row', [r]);
    await r.locator('input[type=checkbox]').first().check({ force: true }); await s.f.waitForTimeout(700);
    await shot(s.p, '15-approve', s.f.getByRole('button', { name: 'Approve Selected' }));
    await s.p.close();
  }
  if (want('16') || want('21')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertiser Bookings`, src: '/#/booking-schedule', snap: 'snap4-dec.json' });
    await hideBroken(s.f);
    await shot(s.p, '16a-booking-overview', s.f.locator('.ag-row').filter({ hasText: 'Cooler Doors' }).first().getByText('Cooler Doors').first());
    await extra('16a-booking-overview', 'rows', ['Forecourt', 'POS'].map(n => s.f.locator('.ag-row').filter({ hasText: n }).first()));
    const row = s.f.locator('.ag-row').filter({ hasText: 'Cooler Doors' }).first();
    const idx = await row.getAttribute('row-index');
    const center = s.f.locator(`.ag-center-cols-container .ag-row[row-index="${idx}"], .ag-center-cols-viewport .ag-row[row-index="${idx}"]`).first();
    const tile = center.getByText('Frostline Cold Drinks (Direct)').nth(1);
    await tile.hover().catch(() => {}); await s.f.waitForTimeout(900); await hideBroken(s.f);
    await shot(s.p, '16-booking-schedule', tile);
    for (const sel of ['.ant-popover:not(.ant-popover-hidden)', '.ant-tooltip:not(.ant-tooltip-hidden)', '[role=tooltip]']) { const c = await s.f.locator(sel).count(); console.log('sel', sel, c); }
    await extra('16-booking-schedule', 'pop', [s.f.locator('.ant-popover:not(.ant-popover-hidden) .ant-popover-inner, .ant-tooltip:not(.ant-tooltip-hidden) .ant-tooltip-inner').last()]);
    await s.p.mouse.move(700, 905); await s.f.waitForTimeout(600); await hideBroken(s.f);
    await shot(s.p, '16b-booking-flight', s.f.locator('.ag-row').filter({ hasText: 'Cooler Doors' }).first().getByText('Cooler Doors').first());
    { const g = s.f.locator('.ag-root-wrapper').first();
      await extra('16b-booking-flight', 'rows', ['Forecourt', 'POS'].map(n => g.locator('.ag-row').filter({ hasText: n }).first()).concat([g.locator('.ag-center-cols-container .ag-row').last()])); }
    await s.f.evaluate(() => window.scrollBy(0, 220)); await s.f.waitForTimeout(600); await hideBroken(s.f);
    { const g2 = s.f.locator('.ag-root-wrapper').nth(1);
      await shot(s.p, '22-booking-revenue', g2.locator('.ag-header-cell').filter({ hasText: /Estimated revenue/ }).first());
      await extra('22-booking-revenue', 'table', [s.f.getByText(/^Booking revenue/).first(), g2]);
      await extra('22-booking-revenue', 'total', [g2.locator('.ag-floating-bottom .ag-row, .ag-row-pinned').last()]);
      await extra('22-booking-revenue', 'rev', [g2.locator('[col-id]').filter({ hasText: /Estimated revenue/ }).first(), g2.locator('.ag-row').last()]); }
    await s.p.close();
  }
  if (want('18') || want('20')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertisers / Inventory`, src: '/#/advertisers', snap: 'snap4-live.json' });
    await s.f.getByText(/Northwind Foods guara/).first().click(); await s.f.waitForTimeout(900);
    await shot(s.p, '18-pg-deal', s.f.locator('[role=dialog]').last().getByText(/Committed plays/).first());
    await s.f.press('body', 'Escape').catch(() => {}); await s.f.waitForTimeout(600);
    await s.p.mouse.move(1590, 990); await s.f.waitForTimeout(500);
    const oa = s.f.locator('.ag-row').filter({ hasText: 'Shop Front Playlist' }).first();
    await oa.scrollIntoViewIfNeeded(); await s.f.evaluate(() => window.scrollBy(0, 160));
    await shot(s.p, '20-floor-cpm', oa.locator('[col-id="assignedTo"]').first());
    await s.p.close();
  }
  if (want('19')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertiser Settings`, src: '/#/dsp-integration', snap: 'snap4-live.json' });
    await shot(s.p, '19-exchange', s.f.getByText(/PARTNER DSPS/i).first());
    await s.p.close();
  }
  const prev = fs.existsSync(`${OUT}/hot.json`) ? JSON.parse(fs.readFileSync(`${OUT}/hot.json`, 'utf8')) : {};
  fs.writeFileSync(`${OUT}/hot.json`, JSON.stringify(Object.assign(prev, HOT), null, 1));
  await b.close();
})();
