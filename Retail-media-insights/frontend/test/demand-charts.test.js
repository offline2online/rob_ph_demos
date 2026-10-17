// node --test Retail-media-insights/frontend/test
const test = require('node:test');
const assert = require('node:assert');
const DC = require('../demand-charts.js');
const { get } = require('./api.js');

const names = (m) => m.names.map((r) => r[0]);
const BANNED = ['Weather', 'Loyalty Tier', 'Face Attributes', 'Daypart'];

test('advertiser table: shares are whole numbers adding to 100, the total is the sum of the back end’s revenue', async () => {
  const adv = await get('/advertisers');
  assert.strictEqual(DC.advertiserRows(adv, false).length, adv.all.length);
  assert.ok(adv.all.every((a) => Number.isInteger(a.share)));
  assert.strictEqual(adv.all.reduce((n, a) => n + a.share, 0), 100);
  const r = DC.advertiserRows(adv, true)[0];
  assert.deepStrictEqual([r.label, r.dsp], [adv.all[0].name, adv.all[0].dsp]);
  assert.strictEqual(r.revenue, DC.fmtMoney(adv.all[0].revenue));
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
  assert.deepStrictEqual(m.sections[0].rows, [['Wellness PG', 'Programmatic guaranteed'], ['Pharmacy Private', 'Private auction']]);
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
  assert.match(m.title, /^Personalised · 1 advertiser$/);
  assert.deepStrictEqual(names(m), ['Blackmores (DV360)']);
  assert.strictEqual(m.names[0][1], 'Identified visitor');
  assert.ok(DC.ladderHover(mat.ladder[1]).names.every((r) => r[1] === ''), 'only Personalised shows a personalisation type');
});

test('scheduling hover shows scheduled campaigns for "uses", names only for "none"', async () => {
  const mat = await get('/maturity');
  const uses = DC.schedulingHover(mat.scheduling[0]);
  assert.deepStrictEqual(uses.names[0], ['Acme (The Trade Desk)', '1 of 2 campaigns scheduled · 1 schedule']);
  const none = DC.schedulingHover(mat.scheduling[1]);
  assert.deepStrictEqual(names(none), ['Nova (Amazon DSP)']);
  assert.ok(none.names.every((r) => r[1] === ''));
  assert.strictEqual(mat.scheduling[0].advertisers + mat.scheduling[1].advertisers, 3);
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
  assert.match(m.title, /^State · \d+ advertisers?$/);
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
  assert.strictEqual(m.title.split(' · ')[0], 'Sep 2026');
  assert.strictEqual(m.sections[0].rows.length, 3);
});

test('table filters: level, variable, scheduling combine; Personalised first, then revenue', async () => {
  const mat = await get('/maturity');
  const all = DC.tableRows(mat);
  assert.deepStrictEqual(all.map((r) => r.label), ['Blackmores (DV360)', 'Acme (The Trade Desk)', 'Nova (Amazon DSP)']);
  assert.ok((await get('/maturity', { level: 'Personalised' })).table.every((r) => r.level === 'Personalised'));
  assert.ok((await get('/maturity', { variable: 'State' })).table.every((r) => r.variables.some((v) => v.label === 'State')));
  assert.ok((await get('/maturity', { scheduling: 'none' })).table.every((r) => !r.scheduling.uses));
  assert.deepStrictEqual((await get('/maturity', { level: 'Localised', scheduling: 'uses' })).table.map((r) => r.name), ['Acme']);
  assert.strictEqual(DC.activeFilters({ level: '', variable: '', scheduling: '' }), false);
  assert.strictEqual(DC.activeFilters({ level: '', variable: 'State', scheduling: '' }), true);
});

test('table cells: scheduling reads "Dayparted · n of m campaigns" or "Not used"; chips carry the sub-type unless the label says it', async () => {
  const rows = DC.tableRows(await get('/maturity'));
  assert.strictEqual(rows[0].scheduling, 'Dayparted · 1 of 2 campaigns');
  assert.strictEqual(rows[2].scheduling, 'Not used');
  assert.ok(rows[0].chips.some((c) => c.text === 'Visitor Segments · Identified visitor'));
  assert.strictEqual(DC.chipText({ label: 'Computer Vision audience', kind: 'Personalised', personalisationType: 'Computer Vision' }), 'Computer Vision audience');
  assert.ok(!JSON.stringify(rows).match(/next step|warning/i));
});

test('ladder, scheduling and variable counts are consistent with the table', async () => {
  const mat = await get('/maturity');
  assert.strictEqual(mat.ladder.reduce((a, l) => a + l.advertisers, 0), mat.table.length);
  const state = mat.variablesInUse.find((v) => v.variable === 'State');
  assert.strictEqual(state.advertisers, (await get('/maturity', { variable: 'State' })).table.length);
});
