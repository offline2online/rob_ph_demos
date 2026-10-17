// node --test Retail-media-insights/frontend/test
const test = require('node:test');
const assert = require('node:assert');
const DC = require('../demand-charts.js');
const F = require('../demand-fixtures.js');

const mat = F.maturity();
const names = (m) => m.names.map((r) => r[0]);

test('advertiser table: top 10 by default, show all expands, shares are whole numbers adding to 100', () => {
  assert.strictEqual(DC.advertiserRows(F.advertisers, false).length, 10);
  assert.strictEqual(DC.advertiserRows(F.advertisers, true).length, 12);
  const shares = F.advertisers.all.map((a) => a.share);
  assert.ok(shares.every(Number.isInteger));
  assert.strictEqual(shares.reduce((a, b) => a + b, 0), 100);
  const r = DC.advertiserRows(F.advertisers, false)[0];
  assert.deepStrictEqual([r.label, r.revenue, r.share, r.dealsOn, r.slotsCovered, r.slotsWon, r.effectiveCpm], ['Blackmores', '$18,200', '24%', 2, '6', '72%', '$18.40']);
});

test('missing slots won and CPM show a dash, never zero', () => {
  const r = DC.advertiserRows(F.advertisers, true).filter((x) => x.label === 'Fess')[0];
  assert.strictEqual(r.slotsWon, '–');
  assert.strictEqual(r.effectiveCpm, '–');
});

test('deals on hover is headed "Name (DSP): deals on" and lists deal name with type', () => {
  const m = DC.dealsOnHover(F.advertisers.all[0]);
  assert.strictEqual(m.title, 'Blackmores (DV360): deals on');
  assert.deepStrictEqual(m.sections[0].rows, [['Wellness PG', 'Programmatic guaranteed'], ['Pharmacy PD', 'Preferred deal']]);
});

test('slots won hover notes the 90-day retention only when the range is longer', () => {
  const a = F.advertisers.all[0];
  assert.strictEqual(DC.slotsWonHover(a, { complete: true, retentionDays: 90 }).sections[0].note, null);
  assert.match(DC.slotsWonHover(a, { complete: false, retentionDays: 90 }).sections[0].note, /90 days/);
});

test('maturity ladder: three levels, counts match lists, hover names carry the DSP', () => {
  assert.deepStrictEqual(mat.ladder.map((l) => l.level), DC.LEVELS);
  mat.ladder.forEach((l) => assert.strictEqual(l.advertisers, l.list.length));
  const m = DC.ladderHover(mat.ladder[2]);
  assert.match(m.title, /^Personalised · 3 advertisers$/);
  assert.ok(names(m).includes('Perrigo (The Trade Desk)'));
  const perrigo = m.names.filter((r) => r[0].startsWith('Perrigo'))[0];
  assert.strictEqual(perrigo[1], 'Computer Vision');
  assert.ok(DC.ladderHover(mat.ladder[1]).names.every((r) => r[1] === ''), 'only Personalised shows a personalisation type');
});

test('scheduling hover shows scheduled campaigns and schedules for "uses", names only for "none"', () => {
  const uses = DC.schedulingHover(mat.scheduling[0]);
  assert.deepStrictEqual(uses.names[0], ['Blackmores (DV360)', '3 of 4 campaigns scheduled · 5 schedules']);
  const none = DC.schedulingHover(mat.scheduling[1]);
  assert.ok(none.names.every((r) => r[1] === ''));
  assert.strictEqual(mat.scheduling[0].advertisers + mat.scheduling[1].advertisers, 12);
});

test('Daypart never appears as a variable, even if the back end sends it', () => {
  const dirty = { variablesInUse: [{ variable: 'Daypart', kind: 'Localised', advertisers: 9, list: [] }].concat(mat.variablesInUse),
    table: [{ advertiserId: 'x', name: 'X', dsp: 'DV360', level: 'Localised', variables: [{ label: 'Daypart', kind: 'Localised' }, { label: 'State', kind: 'Localised' }], scheduling: { uses: true, scheduledCampaigns: 1, campaigns: 1, schedules: 1 }, targetedVersions: 0, revenue: 1 }] };
  assert.ok(!DC.variableBars(dirty).some((v) => /daypart/i.test(v.variable)));
  assert.ok(!DC.variableOptions(dirty).some((v) => /daypart/i.test(v)));
  assert.deepStrictEqual(DC.tableRows(dirty)[0].chips.map((c) => c.text), ['State']);
  assert.ok(!JSON.stringify(DC.tableRows({ table: mat.table })).match(/daypart/i));
});

test('variables ranked by advertisers; Localised / Personalised kind filter', () => {
  const counts = mat.variablesInUse.map((v) => v.advertisers);
  assert.deepStrictEqual(counts, counts.slice().sort((a, b) => b - a));
  assert.ok(F.maturity({ kind: 'Personalised' }).variablesInUse.every((v) => v.kind === 'Personalised'));
  assert.ok(F.maturity({ kind: 'Localised' }).variablesInUse.every((v) => v.kind === 'Localised'));
  const m = DC.variableHover(mat.variablesInUse[0]);
  assert.match(m.title, /^State · \d+ advertisers$/);
  assert.ok(names(m).every((n) => /\(.+\)$/.test(n)));
});

test('progress over time: three bands that add to 100 per period, week and month', () => {
  ['week', 'month'].forEach((g) => {
    const d = F.maturity({ granularity: g });
    assert.strictEqual(d.granularity, g);
    d.overTime.forEach((r) => {
      assert.strictEqual(r.levels.length, 3);
      assert.strictEqual(r.levels.reduce((a, b) => a + b.percent, 0), 100);
    });
  });
  const m = DC.progressHover(F.maturity().overTime[0], 'month');
  assert.strictEqual(m.title.split(' · ')[0], 'Jun 2026');
  assert.strictEqual(m.sections[0].rows.length, 3);
});

test('table filters: level, variable, scheduling combine and order is Personalised first, then revenue', () => {
  const all = DC.tableRows(mat);
  assert.strictEqual(all.length, 12);
  assert.deepStrictEqual(all.slice(0, 3).map((r) => r.label), ['Blackmores (DV360)', 'Perrigo (The Trade Desk)', 'Swisse (DV360)']);
  assert.ok(F.maturity({ level: 'Personalised' }).table.every((r) => r.level === 'Personalised'));
  assert.ok(F.maturity({ variable: 'State' }).table.every((r) => r.variables.some((v) => v.label === 'State')));
  assert.ok(F.maturity({ scheduling: 'none' }).table.every((r) => !r.scheduling.uses));
  assert.deepStrictEqual(F.maturity({ level: 'Localised', scheduling: 'uses' }).table.map((r) => r.name), ['Acme', 'Haleon', 'Cenovis']);
  assert.strictEqual(DC.activeFilters({ level: '', variable: '', scheduling: '' }), false);
  assert.strictEqual(DC.activeFilters({ level: '', variable: 'State', scheduling: '' }), true);
});

test('table cells: no Next step, scheduling text, chips carry the sub-type unless the label says it', () => {
  const row = DC.tableRows(mat)[0];
  assert.strictEqual(row.scheduling, 'Scheduled · 3 of 4 campaigns');
  assert.ok(row.chips.some((c) => c.text === 'Visitor Segments · Aggregate'));
  assert.strictEqual(DC.chipText({ label: 'Computer Vision audience', kind: 'Personalised', personalisationType: 'Computer Vision' }), 'Computer Vision audience');
  assert.strictEqual(DC.schedulingText({ uses: false }), 'Not used');
  assert.ok(!JSON.stringify(row).match(/next step|warning/i));
});

test('ladder, scheduling and variable counts are consistent with the table', () => {
  assert.strictEqual(mat.ladder.reduce((a, l) => a + l.advertisers, 0), mat.table.length);
  const state = mat.variablesInUse.filter((v) => v.variable === 'State')[0];
  assert.strictEqual(state.advertisers, F.maturity({ variable: 'State' }).table.length);
});
