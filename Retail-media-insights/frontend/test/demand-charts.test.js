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

test('missing slots won and CPM show a dash, never zero', () => {
  const r = DC.advertiserRows({ all: [{ advertiserId: 'x', name: 'Fess', dsp: 'DV360', revenue: 0, share: 0, dealsOn: [], slotsCovered: 0, slotsWonPercent: null, effectiveCpm: null }] }, true)[0];
  assert.strictEqual(r.slotsWon, '–');
  assert.strictEqual(r.effectiveCpm, '–');
});

test('deals on hover is headed "Name (DSP): deals on" and lists deal name with type', async () => {
  const a = (await get('/advertisers')).all.find((x) => x.name === 'Blackmores');
  const m = DC.dealsOnHover(a);
  assert.strictEqual(m.title, 'Blackmores (DV360): deals on');
  assert.deepStrictEqual(m.sections[0].rows, [['Immune — winter launch', 'Programmatic guaranteed'], ['Dispensary screens', 'Private auction'], ['Health & wellness windows', 'Private auction']]);
});

test('deals on reads "n deal(s)", "0 deals" has no hover model rows', () => {
  const rows = DC.advertiserRows({ all: [
    { advertiserId: 'a', name: 'A', dsp: 'X', revenue: 1, share: 50, dealsOn: [{ name: 'd', dealType: 'Preferred deal' }] },
    { advertiserId: 'b', name: 'B', dsp: 'X', revenue: 1, share: 50, dealsOn: [] }] }, true);
  assert.deepStrictEqual(rows.map((r) => r.dealsText), ['1 deal', '0 deals']);
  assert.deepStrictEqual(rows.map((r) => r.label), ['A', 'B'], 'the cell is the name only; the DSP is in the hover');
});

test('slots won hover notes the retention only when the range is longer', async () => {
  const adv = await get('/advertisers');
  const a = adv.all[0];
  assert.strictEqual(DC.slotsWonHover(a, adv.slotsWon).sections[0].note, null);
  assert.match(DC.slotsWonHover(a, { complete: false, retentionDays: 90 }).sections[0].note, /90 days/);
});

test('maturity ladder: three levels, counts match lists, every hover name carries the DSP', async () => {
  const mat = await get('/maturity');
  assert.deepStrictEqual(mat.ladder.map((l) => l.level), DC.LEVELS);
  mat.ladder.forEach((l) => assert.strictEqual(l.advertisers, l.list.length));
  const m = DC.ladderHover(mat.ladder[2]);
  assert.match(m.title, /^Personalised · 5 advertisers$/);
  assert.deepStrictEqual(names(m), ['Blackmores (DV360)', 'Haleon (The Trade Desk)', 'Kenvue (DV360)', "L'Oréal Paris (DV360)", 'Procter & Gamble (The Trade Desk)']);
  assert.strictEqual(m.names[0][1], 'Aggregate, Computer Vision');
  assert.ok(DC.ladderHover(mat.ladder[1]).names.every((r) => r[1] === ''), 'only Personalised shows a personalisation type');
});

test('scheduling hover shows scheduled campaigns for "uses", names only for "none"', async () => {
  const mat = await get('/maturity');
  const uses = DC.schedulingHover(mat.scheduling[0]);
  assert.deepStrictEqual(uses.names[0], ['Blackmores (DV360)', '3 of 4 campaigns, 5 schedules']);
  const none = DC.schedulingHover(mat.scheduling[1]);
  assert.deepStrictEqual(names(none), ['Bayer Consumer Health (Amazon DSP)', 'Kenvue (DV360)', 'Perrigo (The Trade Desk)', 'Reckitt (Amazon DSP)', 'Unilever (Amazon DSP)', 'Vitabiotics (The Trade Desk)']);
  assert.ok(none.names.every((r) => r[1] === ''));
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
  assert.deepStrictEqual(all.map((r) => r.label), ['Blackmores (DV360)', 'Haleon (The Trade Desk)', 'Kenvue (DV360)', "L'Oréal Paris (DV360)", 'Procter & Gamble (The Trade Desk)', 'Bayer Consumer Health (Amazon DSP)', 'Vitabiotics (The Trade Desk)', 'Nestlé Health Science (DV360)', 'Reckitt (Amazon DSP)', 'Perrigo (The Trade Desk)', 'Unilever (Amazon DSP)']);
  assert.ok((await get('/maturity', { level: 'Personalised' })).table.every((r) => r.level === 'Personalised'));
  assert.ok((await get('/maturity', { variable: 'Fixed Store Segments' })).table.every((r) => r.variables.some((v) => v.label === 'Fixed Store Segments')));
  assert.ok((await get('/maturity', { scheduling: 'none' })).table.every((r) => !r.scheduling.uses));
  assert.deepStrictEqual((await get('/maturity', { level: 'Localised', scheduling: 'uses' })).table.map((r) => r.name), ['Nestlé Health Science']);
  assert.strictEqual(DC.activeFilters({ level: '', variable: '', scheduling: '' }), false);
  assert.strictEqual(DC.activeFilters({ level: '', variable: 'State', scheduling: '' }), true);
});

test('table cells: scheduling reads "Dayparted · n of m campaigns" or "Not used"; chips carry the sub-type unless the label says it', async () => {
  const rows = DC.tableRows(await get('/maturity'));
  assert.strictEqual(rows[0].scheduling, 'Dayparted · 3 of 4 campaigns');
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
