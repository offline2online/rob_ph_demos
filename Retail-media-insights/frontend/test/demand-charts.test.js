// node --test Retail-media-insights/frontend/test
const test = require('node:test');
const assert = require('node:assert');
const DC = require('../demand-charts.js');
const { get } = require('./api.js');

const names = (m) => m.names.map((r) => r[0]);
const BANNED = ['Weather', 'Loyalty Tier', 'Face Attributes', 'Daypart'];

test('advertiser table: shares are whole numbers adding to 100, the total is the sum of the back end’s revenue', async () => {
  const adv = await get('/advertisers');
  assert.strictEqual(DC.advertiserRows(adv, false).length, adv.top.length, 'ten of eleven by default');
  assert.strictEqual(DC.advertiserRows(adv, true).length, adv.all.length);
  assert.ok(adv.all.every((a) => Number.isInteger(a.share)));
  assert.strictEqual(adv.all.reduce((n, a) => n + a.share, 0), 100);
  const r = DC.advertiserRows(adv, true)[0];
  assert.deepStrictEqual([r.label, r.dsp], [adv.all[0].name, adv.all[0].dsp]);
  assert.strictEqual(r.revenue, DC.fmtMoney(adv.all[0].revenue));
  assert.match(r.dealsText, /^\d+ deals?$/);
  const summary = await get('/summary');
  assert.strictEqual(Math.round(DC.revenueTotal(adv.all)), Math.round(summary.earnedRevenue));
});

test('missing CPM shows a dash, never zero', () => {
  const r = DC.advertiserRows({ all: [{ advertiserId: 'x', name: 'Fess', dsp: 'DV360', revenue: 0, share: 0, dealsOn: [], slotsCovered: 0, slotsWonPercent: null, effectiveCpm: null }] }, true)[0];
  assert.strictEqual(r.effectiveCpm, '–');
});

test('deals on hover is headed "Name (DSP): deals on" and lists deal name with type', async () => {
  const a = (await get('/advertisers')).all.find((x) => x.name === 'Blackmores');
  const m = DC.dealsOnHover(a);
  assert.strictEqual(m.title, 'Blackmores (DV360): deals on');
  assert.deepStrictEqual(m.sections[0].rows, [['Immune — winter launch', 'Programmatic guaranteed']]);
});

test('deals on reads "n deal(s)", "0 deals" has no hover model rows', () => {
  const rows = DC.advertiserRows({ all: [
    { advertiserId: 'a', name: 'A', dsp: 'X', revenue: 1, share: 50, dealsOn: [{ name: 'd', dealType: 'Preferred deal' }] },
    { advertiserId: 'b', name: 'B', dsp: 'X', revenue: 1, share: 50, dealsOn: [] }] }, true);
  assert.deepStrictEqual(rows.map((r) => r.dealsText), ['1 deal', '0 deals']);
  assert.deepStrictEqual(rows.map((r) => r.label), ['A', 'B'], 'the cell is the name only; the DSP is in the hover');
});

test('maturity ladder data: three levels, counts match lists', async () => {
  const mat = await get('/maturity');
  assert.deepStrictEqual(mat.ladder.map((l) => l.level), DC.LEVELS);
  mat.ladder.forEach((l) => assert.strictEqual(l.advertisers, l.list.length));
  assert.strictEqual(mat.scheduling[0].advertisers + mat.scheduling[1].advertisers, 11);
});

test('Variables in use are only Shared Targeting Variables; Daypart is never one even if sent', async () => {
  const mat = await get('/maturity');
  const labels = DC.variableBars(mat).map((v) => v.variable);
  assert.ok(labels.length > 0 && labels.every((l) => !BANNED.includes(l)), labels.join());
  assert.deepStrictEqual(DC.variableOptions(mat).filter((v) => BANNED.includes(v)), []);
  const dirty = { variablesInUse: [{ variable: 'Daypart', kind: 'Localised', advertisers: 9, list: [] }],
    table: [{ advertiserId: 'x', name: 'X', dsp: 'DV360', level: 'Localised', variables: [{ label: 'Daypart', kind: 'Localised' }, { label: 'State', kind: 'Localised' }], scheduling: { uses: true, scheduledCampaigns: 1, campaigns: 1, schedules: 1 }, targetedVersions: 0, revenue: 1 }] };
  assert.deepStrictEqual(DC.variableBars(dirty), []);
  assert.deepStrictEqual(DC.tableRows(dirty)[0].chips.map((c) => c.text), ['State']);
  assert.ok(!JSON.stringify(DC.tableRows(mat).map((r) => r.chips)).match(/daypart|weather|loyalty|face attr/i));
});

test('variables ranked by advertisers; Localised / Personalised kind filter; every count hovers names with DSP', async () => {
  const mat = await get('/maturity');
  const counts = mat.variablesInUse.map((v) => v.advertisers);
  assert.deepStrictEqual(counts, counts.slice().sort((a, b) => b - a));
  assert.ok((await get('/maturity', { kind: 'Personalised' })).variablesInUse.every((v) => v.kind === 'Personalised'));
  assert.ok((await get('/maturity', { kind: 'Localised' })).variablesInUse.every((v) => v.kind === 'Localised'));
  const m = DC.variableHover(mat.variablesInUse[0]);
  assert.match(m.title, /^Fixed Store Segments · \d+ advertisers?$/);
  assert.ok(names(m).every((n) => /\(.+\)$/.test(n)));
});

test('progress over time: three bands that add to 100 per period, week and month', async () => {
  for (const g of ['week', 'month']) {
    const d = await get('/maturity', { granularity: g });
    assert.strictEqual(d.granularity, g);
    d.overTime.forEach((r) => {
      assert.strictEqual(r.levels.length, 3);
      assert.strictEqual(r.levels.reduce((a, b) => a + b.percent, 0), 100);
    });
  }
  const m = DC.progressHover((await get('/maturity')).overTime[0], 'month');
  assert.strictEqual(m.title.split(' · ')[0], 'Jun 2026', 'Progress over time starts at the first campaign, whatever the date range');
  assert.deepStrictEqual(m.sections[0].rows.map((r) => r[0]), DC.LEVELS);
  assert.ok(m.sections[0].rows.every((r) => /^\d+%$/.test(r[1])), 'the period, then each level’s %');
  assert.strictEqual(m.title, 'Jun 2026');
  const ot = (await get('/maturity')).overTime;
  const txt = DC.progressPeriodText(ot, 'month');
  assert.ok(/^Jun 2026 – \w{3} 2026 · by month · whole history$/.test(txt), txt);
  assert.ok(/by week \(week starting\)/.test(DC.progressPeriodText(ot, 'week')));
  assert.strictEqual(DC.progressPeriodText([], 'month'), '');
});

test('table filters: level, variable, scheduling combine; Personalised first, then revenue', async () => {
  const mat = await get('/maturity');
  const all = DC.tableRows(mat);
  assert.deepStrictEqual(all.map((r) => r.label), ['Blackmores (DV360)', 'Haleon (The Trade Desk)', 'Kenvue (DV360)', 'Procter & Gamble (Direct)', "L'Oréal Paris (Direct)", 'Vitabiotics (Direct)', 'Bayer Consumer Health (Amazon DSP)', 'Reckitt (Amazon DSP)', 'Nestlé Health Science (Direct)', 'Perrigo (Direct)', 'Unilever (Amazon DSP)']);
  assert.ok((await get('/maturity', { level: 'Personalised' })).table.every((r) => r.level === 'Personalised'));
  assert.ok((await get('/maturity', { variable: 'Fixed Store Segments' })).table.every((r) => r.variables.some((v) => v.label === 'Fixed Store Segments')));
  assert.ok((await get('/maturity', { scheduling: 'none' })).table.every((r) => !r.scheduling.uses));
  assert.deepStrictEqual((await get('/maturity', { level: 'Localised', scheduling: 'uses' })).table.map((r) => r.name), ['Nestlé Health Science']);
  assert.strictEqual(DC.activeFilters({ level: '', variable: '', scheduling: '' }), false);
  assert.strictEqual(DC.activeFilters({ level: '', variable: 'State', scheduling: '' }), true);
});

test('table cells: scheduling reads "Scheduled" or "Not used"; chips carry the sub-type unless the label says it', async () => {
  const rows = DC.tableRows(await get('/maturity'));
  assert.strictEqual(rows[0].scheduling, 'Scheduled');
  assert.strictEqual(rows[2].scheduling, 'Not used');
  assert.strictEqual(rows[0].name, 'Blackmores', 'the Advertiser cell is the name only');
  assert.ok(rows.find((r) => r.label.startsWith('L')).chips.some((c) => c.text === 'Purchase History · Identified visitor'));
  assert.ok(rows[0].chips.some((c) => c.text === 'Gender (Computer Vision)'));
  assert.strictEqual(DC.chipText({ label: 'Computer Vision audience', kind: 'Personalised', personalisationType: 'Computer Vision' }), 'Computer Vision audience');
  assert.ok(!JSON.stringify(rows).match(/next step|warning/i));
});

test('ladder, scheduling and variable counts are consistent with the table', async () => {
  const mat = await get('/maturity');
  assert.strictEqual(mat.ladder.reduce((a, l) => a + l.advertisers, 0), mat.table.length);
  const seg = mat.variablesInUse.find((v) => v.variable === 'Fixed Store Segments');
  assert.strictEqual(seg.advertisers, (await get('/maturity', { variable: 'Fixed Store Segments' })).table.length);
});

test('advertiser table: every column sorts both ways, blanks last, no key keeps the back end order', async () => {
  const rows = DC.advertiserRows(await get('/advertisers'), true);
  const names = (rs) => rs.map((r) => r.name);
  assert.deepStrictEqual(names(DC.sortAdvertiserRows(rows, '', 'asc')), names(rows));
  for (const c of DC.ADV_COLS) {
    for (const dir of ['asc', 'desc']) {
      const out = DC.sortAdvertiserRows(rows, c.key, dir);
      assert.strictEqual(out.length, rows.length);
      const vals = out.map(c.value).filter((v) => v !== null && v !== undefined);
      for (let i = 1; i < vals.length; i++) {
        const cmp = typeof vals[i] === 'string' ? vals[i - 1].localeCompare(vals[i]) : vals[i - 1] - vals[i];
        assert.ok(dir === 'asc' ? cmp <= 0 : cmp >= 0, c.key + ' ' + dir);
      }
      const blanks = out.map(c.value).map((v) => v === null || v === undefined);
      assert.deepStrictEqual(blanks, blanks.slice().sort((a, b) => a - b), c.key + ': blanks last');
    }
  }
});

test('Advertisers table: Maturity level and scheduling join by advertiser, filter across all advertisers, sort with blanks last, hover lists variables and scheduled campaigns', async () => {
  const adv = await get('/advertisers');
  const mat = DC.tableRows(await get('/maturity'));
  const rows = DC.advertiserRows(adv, true, mat);
  assert.ok(rows.every((r) => r.mat && r.level), 'every advertiser has a maturity record');
  const blackmores = rows.find((r) => r.name === 'Blackmores');
  assert.strictEqual(blackmores.mat.scheduling, 'Scheduled');
  assert.strictEqual(DC.schedulingCellHover(blackmores).names.length, 3, 'one name per scheduled campaign');
  assert.ok(DC.levelCellHover(blackmores).sections[0].rows[0][1].includes('Gender (Computer Vision)'));
  const unscheduled = rows.find((r) => r.mat.scheduling === 'Not used');
  assert.match(DC.schedulingCellHover(unscheduled).text, /No campaigns use scheduling/);
  assert.strictEqual(DC.advertiserRows(adv, false, mat).length, adv.top.length, 'no filter: the top 10');
  const none = { level: '', variable: '', scheduling: '' };
  assert.strictEqual(DC.advertiserRows(adv, true, mat, none).length, rows.length);
  const loc = DC.advertiserRows(adv, true, mat, { ...none, level: 'Localised' });
  assert.ok(loc.length && loc.every((r) => r.level === 'Localised'));
  assert.ok(DC.advertiserRows(adv, true, mat, { ...none, scheduling: 'none' }).every((r) => r.scheduled === 0));
  assert.deepStrictEqual(DC.advertiserRows(adv, true, mat, { level: 'Localised', variable: '', scheduling: 'uses' }).map((r) => r.name), ['Nestlé Health Science']);
  assert.strictEqual(DC.advertiserRows(adv, true, null, { ...none, level: 'Localised' }).length, 0, 'no maturity data matches no filter');
  ['level', 'effectiveCpm'].forEach((key) => {
    ['asc', 'desc'].forEach((dir) => assert.strictEqual(DC.sortAdvertiserRows(rows, key, dir).length, rows.length));
  });
  assert.ok(!DC.ADV_COLS.some((c) => c.key === 'pacing'), 'pacing lives on the Deals table only');
  assert.ok(rows.every((r) => !('pacing' in r)));
  const multi = rows.find((r) => r.src.dealRates.length > 1);
  assert.ok(multi, 'an advertiser is on more than one deal');
  const hv = DC.cpmCellHover(multi);
  assert.strictEqual(hv.sections[0].rows.length, multi.src.dealRates.length, 'one row per deal');
  assert.match(hv.title, /effective CPM by deal/);
  const single = rows.find((r) => r.src.dealRates.length === 1);
  assert.strictEqual(single.src.dealRates[0].effectiveCpm, single.src.effectiveCpm, 'a single-deal advertiser blends to its one deal');
  const byLevel = DC.sortAdvertiserRows(rows, 'level', 'desc').map((r) => DC.LEVELS.indexOf(r.level));
  assert.deepStrictEqual(byLevel, byLevel.slice().sort((a, b) => b - a));
});

test('Advertisers table has no iROAS column (Sales uplift is future work)', async () => {
  const adv = await get('/advertisers');
  assert.ok(!DC.ADV_COLS.some((c) => c.key === 'iroas'));
  assert.deepStrictEqual(DC.ADV_COLS.slice(-2).map((c) => c.key), ['effectiveCpm', 'level']);
  for (const r of adv.all) assert.ok(!('iroas' in r));
  assert.ok(!('posData' in adv));
});

test('advertiser rows: no Seats column and no per-seat sub-rows (agencies are not supported, advertiser level only)', () => {
  const rows = DC.advertiserRows({ top: [
    { advertiserId: 'a', name: 'A', dsp: 'DV360', revenue: 100, share: 100, seatCount: 2, direct: false, dealsOn: [],
      seats: [{ seatId: 's1', name: 'GroupM AU', dsp: 'The Trade Desk', synced: true, revenue: 100, share: 100 }] }
  ] }, false);
  assert.equal(rows[0].seats, undefined);
  assert.ok(!DC.ADV_COLS.some((c) => c.key === 'seats'));
});
