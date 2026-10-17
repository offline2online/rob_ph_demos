'use strict';
// QuickSight datasets (REQUIREMENTS section 2 and 7 step 4): the same API figures as flat, typed tables.
// Each dataset is one route's answer through runRoute (so the role check, page filters and advertiser
// scoping are the API's own, not a copy), reshaped to one row per grain with scalar columns only.
// Retailer datasets are admin only; the advertiser datasets are the advertiser view routes, pinned to the
// caller's own advertiser id. Other buyers never appear by name, and no dataset carries downtime to an
// advertiser, because the underlying route would not answer.

const { FilterError } = require('./filters');
const { runRoute } = require('./query');

/** Flatten nested objects to `a_b` columns; arrays of scalars join with "; "; arrays of objects are left to the dataset. */
function flat(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined) continue;
    const key = prefix ? `${prefix}_${k}` : k;
    if (Array.isArray(v)) {
      if (v.every((x) => x === null || typeof x !== 'object')) out[key] = v.join('; ');
    } else if (v && typeof v === 'object') flat(v, key, out);
    else out[key] = v;
  }
  return out;
}

const names = (list) => (list || []).map((x) => (x.dsp ? `${x.name} (${x.dsp})` : x.name)).join('; ');
const rowsOf = (key) => (r) => r[key].map((x) => flat(x));

const DATASETS = [
  { name: 'summary', route: 'summary', grain: 'one row for the filtered range', description: 'Earned and estimated revenue and Inventory sold.',
    rows: (r) => [flat(r)] },
  { name: 'revenue', route: 'revenue', grain: 'period x DSP x deal type', description: 'Earned and estimated revenue; granularity day, week or month.',
    rows: rowsOf('rows') },
  { name: 'yield', route: 'yield', grain: 'DSP', description: 'Effective CPM, earned revenue and assumed views (VAC-d) per DSP.',
    rows: rowsOf('rows') },
  { name: 'display-types', route: 'display-types', grain: 'display type', description: 'Display type facts and VAC-d averages.',
    rows: rowsOf('rows') },
  { name: 'slot-value', route: 'slot-value', grain: 'display type', description: 'Floor and effective CPM, value per slot per day and totals.',
    rows: rowsOf('rows') },
  { name: 'slot-allocation', route: 'slot-allocation', grain: 'display type', description: 'Advertiser and own-content slots per loop.',
    rows: rowsOf('rows') },
  { name: 'missed-revenue', route: 'missed-revenue', grain: 'display type', description: 'Fill, unsold value at floor and downtime lost revenue.',
    rows: rowsOf('rows') },
  { name: 'deals', route: 'deals', grain: 'deal', description: 'Deal fill, pacing (Programmatic guaranteed), revenue and CPM; advertisers with their DSP.',
    rows: (r) => r.rows.map((d) => ({ ...flat({ ...d, dealIds: undefined, slots: undefined, advertisers: undefined }),
      dealIds: d.dealIds.map((x) => `${x.dsp}: ${x.dealId}`).join('; '), slotCount: d.slots.length, advertisers: names(d.advertisers) })) },
  { name: 'advertisers', route: 'advertisers', grain: 'advertiser', description: 'Revenue, share, deals, slots covered and effective CPM per advertiser.',
    rows: (r) => r.all.map((a) => ({ ...flat({ ...a, dealsOn: undefined }), dealsOn: (a.dealsOn || []).map((d) => d.name).join('; '), slotsWonComplete: r.slotsWon.complete })) },
  { name: 'maturity-ladder', route: 'maturity', grain: 'maturity level', description: 'Advertisers per targeting maturity level.',
    rows: (r) => r.ladder.map((l) => ({ level: l.level, advertisers: l.advertisers, advertiserNames: names(l.list) })) },
  { name: 'maturity-advertisers', route: 'maturity', grain: 'advertiser', description: 'Targeting level, variables and scheduling per advertiser.',
    rows: (r) => r.table.map((t) => ({ ...flat({ ...t, variables: undefined }), variables: (t.variables || []).map((v) => v.label).join('; ') })) },
  { name: 'maturity-variables', route: 'maturity', grain: 'targeting variable', description: 'Advertisers using each Shared Targeting Variable.',
    rows: (r) => r.variablesInUse.map((v) => ({ variable: v.variable, kind: v.kind, personalisationType: v.personalisationType || null, advertisers: v.advertisers, advertiserNames: names(v.list) })) },

  { name: 'delivery', route: 'delivery', grain: 'day', description: "The advertiser's plays won and spend per day, with day-on-day change.",
    rows: (r) => r.days.map((d) => ({ date: d.date, playsWon: d.playsWon, spend: d.spend,
      playsWonChange: d.vsPreviousDay.playsWon.change, playsWonChangePercent: d.vsPreviousDay.playsWon.percent ?? null,
      spendChange: d.vsPreviousDay.spend.change, spendChangePercent: d.vsPreviousDay.spend.percent ?? null })) },
  { name: 'delivery-deals', route: 'delivery', grain: 'day x deal', description: "The advertiser's per-deal block for each day (Open auction as its own block).",
    rows: (r) => r.days.flatMap((d) => d.deals.map((b) => ({ date: d.date, ...flat(b) }))) },
  { name: 'deals-by-display-type', route: 'deals-by-display-type', grain: 'display type x deal', description: "The advertiser's deals by display type.",
    rows: (r) => r.groups.flatMap((g) => g.deals.map((d) => ({ displayTypeId: g.displayType.id, displayType: g.displayType.name, ...flat({ ...d, dealIds: undefined, slots: undefined }),
      dealIds: d.dealIds.map((x) => x.dealId || x).join('; '), slotCount: d.slots && typeof d.slots === 'object' ? d.slots.count : d.slots }))) },
  { name: 'audience', route: 'audience', grain: 'day', description: 'Assumed views (VAC-d) delivered per day.',
    rows: (r) => r.trend.map((t) => ({ date: t.date, assumedViews: t.assumedViews })) },
  { name: 'my-targeting', route: 'my-targeting', grain: 'one row for the advertiser', description: "The advertiser's targeting level, variables used and scheduling.",
    rows: (r) => [{ level: r.level || null, variablesUsed: r.variablesUsed.map((v) => v.label).join('; '), ...flat({ scheduling: r.scheduling }),
      usesEverySharedVariable: r.usesEverySharedVariable }] },
];

const byName = new Map(DATASETS.map((d) => [d.name, d]));

/** Datasets the principal may read. A dataset is advertiser-readable exactly when its route is. */
function availableDatasets(principal, routes) {
  return DATASETS.filter((d) => {
    const route = routes.get(`/${d.route}`);
    return route && (principal.principalType !== 'advertiser' || route.advertiserAccess);
  });
}

function columnType(values) {
  const v = values.filter((x) => x !== null && x !== undefined);
  if (v.length && v.every((x) => typeof x === 'boolean')) return 'BOOLEAN';
  if (v.length && v.every((x) => typeof x === 'number')) return v.every(Number.isInteger) ? 'INTEGER' : 'DECIMAL';
  if (v.length && v.every((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x))) return 'DATE';
  return 'STRING';
}

function buildDataset(name, { routes, store, principal, params, today }) {
  const def = byName.get(name);
  if (!def) throw new FilterError('unknown dataset');
  const route = routes.get(`/${def.route}`);
  const result = runRoute(route, { store, principal, params, today }); // throws Forbidden for an advertiser on a retailer route
  const rows = def.rows(result);
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const columns = keys.map((k) => ({ name: k, type: columnType(rows.map((r) => r[k])) }));
  return { name: def.name, description: def.description, grain: def.grain, columns, rows: rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null]))) };
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s; // no spreadsheet formula injection from names
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const toCsv = (ds) => [ds.columns.map((c) => csvCell(c.name)).join(','), ...ds.rows.map((r) => ds.columns.map((c) => csvCell(r[c.name])).join(','))].join('\n');

module.exports = { DATASETS, availableDatasets, buildDataset, toCsv, flat };
