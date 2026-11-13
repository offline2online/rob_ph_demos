// Captures every real prototype screen for the Run Your Own RMN (golf club) walkthrough: six screen types, Corvane Golf.
// Same approach as tools/retail-media-tour/cap5.js, made self-contained:
//   node cap_golf.js --snap <dir with golf-*.json from slots_golf.py> --fonts <dir with fonts.css + woff2> --out <img dir> [ids...]
// It serves dsp-integration/prototype and dsp-integration/mockups on localhost:8790, frames them in shell.html (the HQ Admin
// chrome), answers the prototype's API from the snapshot (the hosted API is blocked), and writes <id>.jpg (1600x950, q85)
// plus hot.json (click target and tip regions, in screenshot pixels).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SNAP = arg('--snap', 'snap'), FONTS = arg('--fonts', 'fonts'), OUT = arg('--out', 'img'), HOTF = arg('--hot', path.join(__dirname, 'hot.json'));
const ONLY = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--'));
const REPO = path.resolve(__dirname, '../../..');
const PROTO = path.join(REPO, 'dsp-integration/prototype'), MOCK = path.join(REPO, 'dsp-integration/mockups');
const W = 1600, H = 950;
fs.mkdirSync(OUT, { recursive: true });
const HOT = {};
const want = id => !ONLY.length || ONLY.some(o => id.startsWith(o));
const users = { items: [
  { email: 'claire.whitlock@fernhollow-golf.example', firstName: 'Claire', lastName: 'Whitlock', role: 'Admin', lastLoginAt: '2026-11-04T08:12:00Z' },
  { email: 'tom.ashby@fernhollow-golf.example', firstName: 'Tom', lastName: 'Ashby', role: 'Marketing', lastLoginAt: '2026-11-04T01:05:00Z' },
  { email: 'priya.nair@fernhollow-golf.example', firstName: 'Priya', lastName: 'Nair', role: 'Help Desk', lastLoginAt: '2026-11-02T03:30:00Z' },
] };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  let f;
  if (p === '/shell.html') f = path.join(__dirname, 'shell.html');
  else if (p.startsWith('/mockups/')) f = path.join(MOCK, p.slice(9));
  else if (p.startsWith('/fonts/')) f = path.join(FONTS, p.slice(7));
  else f = path.join(PROTO, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'access-control-allow-origin': '*' });
  fs.createReadStream(f).pipe(r);
}).listen(8790);
const fontsCss = fs.readFileSync(path.join(FONTS, 'fonts.css'), 'utf8').replace(/url\(\/fonts\//g, 'url(http://localhost:8790/fonts/');

async function openShell(b, { nav, crumb, src, snap }) {
  const p = await b.newPage({ viewport: { width: W, height: H } });
  const snapBody = fs.readFileSync(path.join(SNAP, `golf-${snap}.json`), 'utf8');
  const snapJson = JSON.parse(snapBody);
  await p.route('**/*.cloudfunctions.net/**', r => r.abort());
  await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: fontsCss }));
  await p.route('**/fonts.gstatic.com/**', r => r.abort());
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
  await p.screenshot({ path: path.join(OUT, `${id}.jpg`), type: 'jpeg', quality: 85 });
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
const NAMES = ['Pro Shop', 'Driving Range', 'First Tee', 'Halfway House', 'Locker Room', 'Clubhouse Bar'];
const PLAYLISTS = [
  ['Pro Shop Playlist', ['Brand partner', 'Lessons and fittings', 'Member offers'], 'proshop'],
  ['Driving Range Playlist', ['Brand partner', 'Range tokens', 'Coaching'], 'range'],
  ['First Tee Playlist', ['Brand partner', 'Course updates', 'Competitions'], 'tee'],
  ['Halfway House Playlist', ['Brand partner', 'Food and drink', 'Snack deals'], 'halfway'],
  ['Locker Room Playlist', ['Brand partner', 'Club news', 'Events'], 'locker'],
  ['Clubhouse Bar Playlist', ['Brand partner', 'Bar menu', 'Functions'], 'bar'],
];
(async () => {
  const b = await chromium.launch();
  let s;
  if (want('P1-')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Display Types`, src: '/#/display-types', snap: 'pre' });
    await shot(s.p, 'P1-display-types', s.f.getByText('Playlist Management', { exact: true }).first());
    await extra('P1-display-types', 'list', NAMES.map(n => s.f.getByText(n, { exact: true }).first()));
    await s.p.close();
  }
  if (['P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'].some(want)) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Playlist Management`, src: '/#/playlists', snap: 'pre' });
    const f = s.f;
    await f.evaluate(() => { document.body.style.paddingBottom = '520px'; });  // room to scroll each playlist's slot table to mid-screen
    const rowOf = name => f.locator('tr, .ag-row').filter({ hasText: name }).first();
    const chev = name => rowOf(name).getByText(/chevron_right|expand_more|keyboard_arrow_down/).first();
    await shot(s.p, 'P2-playlists', chev('Pro Shop Playlist'));
    for (let n = 0; n < PLAYLISTS.length; n++) {
      const [name, labels, key] = PLAYLISTS[n];
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
      const sid = `P${5 + n}-${key}`;
      await f.locator('.ant-select').filter({ hasText: 'Advertiser' }).last().evaluate(e => e.scrollIntoView({ block: 'center' })); await f.waitForTimeout(400);
      await shot(s.p, sid, next);
      await extra(sid, 'slots', [f.locator(`input[value="${labels[0]}"]`).first(), f.locator(`input[value="${labels[2]}"]`).first(), f.locator('.ant-select').filter({ hasText: 'Advertiser' }).last()]);
    }
    await s.p.close();
  }
  if (want('P11')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Playlist Management`, src: '/#/playlists', snap: 'predeal' });
    await shot(s.p, 'P11-saved', s.f.getByText('Advertisers / Inventory', { exact: true }).first());
    await extra('P11-saved', 'badges', [s.f.getByText('1 Advertiser').first(), s.f.getByText('1 Advertiser').last(), s.f.getByText('2 Headquarters').first()]);
    await s.p.close();
  }
  if (want('01')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertisers / Inventory`, src: '/#/advertisers', snap: 'predeal' });
    const r = s.f.locator('.ag-row').filter({ hasText: 'Corvane Golf' }).first();
    await r.scrollIntoViewIfNeeded(); await s.f.evaluate(() => window.scrollBy(0, 400));
    await shot(s.p, '01-advertiser', r.getByText('Corvane Golf').first());
    await extra('01-advertiser', 'row', [r]);
    await s.p.close();
  }
  if (want('03') || want('04')) {
    s = await openShell(b, { nav: 'company', crumb: 'Company Settings|Add Users / Advertisers', src: '/mockups/platform-users.html?api=http://localhost:8790/fx', snap: 'live' });
    await shot(s.p, '03-users', s.f.locator('#addBtn'));
    await s.f.click('#addBtn'); await s.f.waitForTimeout(500);
    await s.f.fill('#fn', 'Jamie'); await s.f.fill('#ln', 'Hart'); await s.f.fill('#em', 'jamie@corvane-golf.example');
    await s.f.selectOption('#role', 'Advertiser'); await s.f.waitForTimeout(300);
    await s.f.selectOption('#adv', 'red-bull'); await s.f.waitForTimeout(300);
    if (!(await s.f.isChecked('#invite'))) await s.f.check('#invite');
    await shot(s.p, '04-add-user', s.f.locator('#submitBtn'));
    await extra('04-add-user', 'form', [s.f.locator('#em'), s.f.locator('#role'), s.f.locator('#adv')]);
    await s.p.close();
  }
  if (want('05') || want('06')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertisers / Inventory`, src: '/#/advertisers', snap: 'predeal' });
    const nd = s.f.getByRole('button', { name: /New deal and buyers list/i });
    await shot(s.p, '05-deals', nd);
    await nd.click(); await s.f.waitForTimeout(700);
    const dlg = s.f.locator('[role=dialog]').last();
    await dlg.locator('input[placeholder="e.g. Q4 FMCG private auction"]').fill('Corvane direct');
    await dlg.locator('textarea').fill('Corvane Golf books the club directly, with no DSP: brand partner slots on all six screen types at a fixed CPM.');
    await antSelect(s.f, dlg, 'Deal type', 'Direct advertiser');
    await antSelect(s.f, dlg, 'Buyers', 'Corvane Golf');
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
    // the six brand partner slots start blank; each is assigned to the new Corvane deal in turn
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertisers / Inventory`, src: '/#/advertisers', snap: 'draft' });
    const rowN = n => s.f.locator('.ag-row').filter({ hasText: `${NAMES[n]} Playlist` }).first();
    const sel = n => rowN(n).locator('[col-id="assignedTo"] .ant-select').first();
    await s.f.evaluate(() => window.scrollBy(0, 110)); await s.f.waitForTimeout(400);  // the six slot rows sit mid-screen
    await shot(s.p, '07a-blank', sel(0));
    await extra('07a-blank', 'cells', NAMES.map((_, n) => rowN(n).locator('[col-id="assignedTo"]').first()));
    await extra('07a-blank', 'deal', [s.f.locator('.ag-row').filter({ hasText: 'Corvane direct' }).first()]);
    for (let n = 0; n < 6; n++) {
      await sel(n).click(); await s.f.waitForTimeout(700);
      const opt = s.f.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: 'Corvane direct' }).first();
      const did = n === 0 ? '07-assign-slot' : `07d${n + 1}`;
      await shot(s.p, did, opt);
      if (n === 0) await extra(did, 'menu', [s.f.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').first()]);
      await opt.click(); await s.f.waitForTimeout(400);
      await s.f.press('body', 'Escape').catch(() => {}); await s.f.waitForTimeout(400);
      await s.p.mouse.move(5, 500); await s.f.waitForTimeout(300);
      if (n < 5) await shot(s.p, `07c${n + 1}`, sel(n + 1));
    }
    const save = s.f.getByRole('button', { name: 'Save changes' });
    await shot(s.p, '07b-assigned-all', save);
    await extra('07b-assigned-all', 'cells', NAMES.map(n => s.f.locator('.ag-row').filter({ hasText: `${n} Playlist` }).first().locator('[col-id="assignedTo"]').first()));
    await s.p.close();
  }
  if (want('08')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertisers / Inventory`, src: '/#/advertisers', snap: 'assigned' });
    await s.f.getByText('Corvane direct', { exact: true }).first().click(); await s.f.waitForTimeout(900);
    await shot(s.p, '08-deal-finalise', s.f.locator('[role=dialog]').last().getByRole('button', { name: /Finalise/ }));
    await extra('08-deal-finalise', 'plays', [s.f.locator('[role=dialog]').last().getByText('Committed plays').first(), s.f.locator('[role=dialog]').last().getByText(/Forecast plays for/).first()]);
    await s.p.close();
  }
  if (want('09')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertisers / Inventory`, src: '/#/advertisers', snap: 'live' });
    await shot(s.p, '09-deal-live', s.f.getByText('Corvane direct', { exact: true }).first());
    await extra('09-deal-live', 'row', [s.f.locator('.ag-row').filter({ hasText: 'Corvane direct' }).first()]);
    await s.p.close();
  }
  if (want('14') || want('15')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertiser Bookings`, src: '/#/booking-schedule?tab=campaign-status', snap: 'live' });
    const r = s.f.locator('.ag-row').filter({ hasText: 'Awaiting approval' }).filter({ hasText: 'Corvane' }).first();
    await shot(s.p, '14-approval-table', r.locator('input[type=checkbox]').first());
    await extra('14-approval-table', 'row', [r]);
    await r.locator('input[type=checkbox]').first().check({ force: true }); await s.f.waitForTimeout(700);
    await shot(s.p, '15-approve', s.f.getByRole('button', { name: 'Approve Selected' }));
    await s.p.close();
  }
  if (want('16') || want('22')) {
    s = await openShell(b, { nav: 'platform', crumb: `${PA}|Advertiser Bookings`, src: '/#/booking-schedule', snap: 'dec' });
    await hideBroken(s.f);
    const row = s.f.locator('.ag-row').filter({ hasText: 'Clubhouse Bar' }).first();  // the bottom row: its popover opens upwards, all on screen
    const idx = await row.getAttribute('row-index');
    const center = s.f.locator(`.ag-center-cols-container .ag-row[row-index="${idx}"], .ag-center-cols-viewport .ag-row[row-index="${idx}"]`).first();
    const tile = center.getByText('Corvane Golf (Direct)').nth(1);
    await tile.hover().catch(() => {}); await s.f.waitForTimeout(900); await hideBroken(s.f);
    await shot(s.p, '16-booking-schedule', tile);
    await extra('16-booking-schedule', 'pop', [s.f.locator('.ant-popover:not(.ant-popover-hidden) .ant-popover-inner, .ant-tooltip:not(.ant-tooltip-hidden) .ant-tooltip-inner').last()]);
    { const pp = HOT['16-booking-schedule#pop']; if (pp) HOT['16-booking-schedule#top'] = [pp[0], pp[1], pp[2], 140]; }  // the booking's own lines, above the deal detail
    await s.p.mouse.move(700, 905); await s.f.waitForTimeout(600); await hideBroken(s.f);
    await shot(s.p, '16b-booking-flight', s.f.locator('.ag-row').filter({ hasText: 'First Tee' }).first().getByText('First Tee').first());
    { const g = s.f.locator('.ag-root-wrapper').first();
      await extra('16b-booking-flight', 'rows', ['Pro Shop', 'Clubhouse Bar'].map(n => g.locator('.ag-row').filter({ hasText: n }).first()).concat([g.locator('.ag-center-cols-container .ag-row').last()])); }
    await s.f.evaluate(() => window.scrollBy(0, 470)); await s.f.waitForTimeout(600); await hideBroken(s.f);
    { const g2 = s.f.locator('.ag-root-wrapper').nth(1);
      await shot(s.p, '22-booking-revenue', g2.locator('.ag-header-cell').filter({ hasText: /Estimated revenue/ }).first());
      await extra('22-booking-revenue', 'table', [s.f.getByText(/^Booking revenue/).first(), g2]);
      await extra('22-booking-revenue', 'total', [g2.locator('.ag-floating-bottom .ag-row, .ag-row-pinned').last()]);
      await extra('22-booking-revenue', 'rev', [g2.locator('[col-id]').filter({ hasText: /Estimated revenue/ }).first(), g2.locator('.ag-row').last()]); }
    await s.p.close();
  }
  const prev = fs.existsSync(HOTF) ? JSON.parse(fs.readFileSync(HOTF, 'utf8')) : {};
  fs.writeFileSync(HOTF, JSON.stringify(Object.assign(prev, HOT), null, 1) + '\n');
  await b.close(); server.close();
})();
