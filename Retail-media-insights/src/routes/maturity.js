'use strict';
const calc = require('../calc');
const { FilterError } = require('../filters');
const { MATURITY_LEVELS } = require('../constants');

const GRANULARITIES = ['week', 'month'];
const SCHEDULING = ['uses', 'none'];
const KINDS = ['Localised', 'Personalised'];

function periodStart(date, granularity) {
  if (granularity === 'month') return `${date.slice(0, 7)}-01`;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
  return d.toISOString().slice(0, 10);
}

function nextPeriod(start, granularity) {
  const d = new Date(`${start}T00:00:00Z`);
  if (granularity === 'month') d.setUTCMonth(d.getUTCMonth() + 1); else d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

const enumParam = (params, name, allowed) => {
  const v = params.get(name);
  if (v && !allowed.includes(v)) throw new FilterError(`${name} must be one of ${allowed.join(', ')}`);
  return v || null;
};

// Targeting & scheduling maturity: the ladder, scheduling, share by level over time, variables in
// use and the advertiser table. Page filters scope every block; `level`, `variable` and
// `scheduling` filter the table only; `kind` filters the variables ranking only.
module.exports = {
  path: '/maturity',
  handler({ store, filters, params }) {
    const granularity = enumParam(params, 'granularity', GRANULARITIES) || 'month';
    const level = enumParam(params, 'level', MATURITY_LEVELS);
    const scheduling = enumParam(params, 'scheduling', SCHEDULING);
    const kind = enumParam(params, 'kind', KINDS);
    const variable = params.get('variable') || null;

    const campaigns = [];
    store.scanCampaigns(filters, (c) => campaigns.push(c));
    const revenue = new Map();
    store.scanDelivery(filters, (r) => revenue.set(r.advertiserId, (revenue.get(r.advertiserId) || 0) + r.revenue));

    // One record per advertiser: highest campaign level, variables, scheduling.
    const advs = new Map();
    for (const c of campaigns) {
      let a = advs.get(c.advertiserId);
      if (!a) {
        const meta = store.advertisers[c.advertiserId] || {};
        a = {
          advertiserId: c.advertiserId, name: meta.name || c.advertiserId, dsp: meta.dsp || null,
          levels: [], variables: new Map(), campaigns: 0, scheduledCampaigns: 0, schedules: 0, targetedVersions: 0,
        };
        advs.set(c.advertiserId, a);
      }
      a.levels.push(c.level);
      a.campaigns += 1;
      a.targetedVersions += c.targetedVersions;
      if (c.scheduled) { a.scheduledCampaigns += 1; a.schedules += c.schedules; }
      for (const v of c.variables) a.variables.set(v.label, v);
    }
    const rows = [...advs.values()].map((a) => {
      const vars = [...a.variables.values()].sort((x, y) => (x.kind === y.kind ? x.label.localeCompare(y.label) : x.kind === 'Personalised' ? -1 : 1));
      return {
        advertiserId: a.advertiserId,
        name: a.name,
        dsp: a.dsp,
        level: calc.maturityLevel(a.levels),
        variables: vars,
        personalisationTypes: [...new Set(vars.map((v) => v.personalisationType).filter(Boolean))].sort(),
        scheduling: { uses: a.scheduledCampaigns > 0, scheduledCampaigns: a.scheduledCampaigns, campaigns: a.campaigns, schedules: a.schedules },
        targetedVersions: a.targetedVersions,
        revenue: Math.round(revenue.get(a.advertiserId) || 0),
      };
    });
    const who = (r, extra = {}) => ({ advertiserId: r.advertiserId, name: r.name, dsp: r.dsp, ...extra });
    const byName = (a, b) => a.name.localeCompare(b.name);

    const ladder = MATURITY_LEVELS.map((l) => {
      const at = rows.filter((r) => r.level === l).sort(byName);
      return {
        level: l,
        advertisers: at.length,
        list: at.map((r) => who(r, l === 'Personalised' ? { personalisationTypes: r.personalisationTypes } : {})),
      };
    });

    const using = rows.filter((r) => r.scheduling.uses).sort(byName);
    const not = rows.filter((r) => !r.scheduling.uses).sort(byName);
    const schedulingBlock = [
      { key: 'uses', label: 'Uses scheduling', advertisers: using.length, list: using.map((r) => who(r, { scheduledCampaigns: r.scheduling.scheduledCampaigns, campaigns: r.scheduling.campaigns, schedules: r.scheduling.schedules })) },
      { key: 'none', label: 'No scheduling', advertisers: not.length, list: not.map((r) => who(r)) },
    ];

    // Share of campaigns at each level per period: a campaign counts in every period it is live in.
    const counts = new Map();
    for (const c of campaigns) {
      const from = c.start > filters.dateFrom ? c.start : filters.dateFrom;
      const to = c.end && c.end < filters.dateTo ? c.end : filters.dateTo;
      for (let p = periodStart(from, granularity); p <= to; p = nextPeriod(p, granularity)) {
        const row = counts.get(p) || { period: p, counts: [0, 0, 0] };
        row.counts[MATURITY_LEVELS.indexOf(c.level)] += 1;
        counts.set(p, row);
      }
    }
    const overTime = [...counts.values()].sort((a, b) => (a.period < b.period ? -1 : 1)).map((r) => {
      const pct = calc.percentSplit(r.counts);
      return {
        period: r.period,
        campaigns: r.counts.reduce((x, y) => x + y, 0),
        levels: MATURITY_LEVELS.map((l, i) => ({ level: l, campaigns: r.counts[i], percent: pct[i] })),
      };
    });

    // Variables in use: Shared Targeting Variables only (Daypart never reaches here), ranked by advertisers.
    const byVar = new Map();
    for (const r of rows) {
      for (const v of r.variables) {
        const e = byVar.get(v.label) || { variable: v.label, kind: v.kind, personalisationType: v.personalisationType, list: [] };
        e.list.push(r);
        byVar.set(v.label, e);
      }
    }
    const variablesInUse = [...byVar.values()]
      .filter((e) => !kind || e.kind === kind)
      .sort((a, b) => b.list.length - a.list.length || a.variable.localeCompare(b.variable))
      .map((e) => ({
        variable: e.variable, kind: e.kind, personalisationType: e.personalisationType,
        advertisers: e.list.length, list: e.list.sort(byName).map((r) => who(r)),
      }));

    const table = rows
      .filter((r) => !level || r.level === level)
      .filter((r) => !variable || r.variables.some((v) => v.label === variable))
      .filter((r) => !scheduling || (scheduling === 'uses') === r.scheduling.uses)
      .sort((a, b) => MATURITY_LEVELS.indexOf(b.level) - MATURITY_LEVELS.indexOf(a.level) || b.revenue - a.revenue || a.name.localeCompare(b.name))
      .map((r) => ({
        advertiserId: r.advertiserId, name: r.name, dsp: r.dsp, level: r.level,
        variables: r.variables.map((v) => ({ label: v.label, kind: v.kind, personalisationType: v.personalisationType })),
        scheduling: r.scheduling, targetedVersions: r.targetedVersions, revenue: r.revenue,
      }));

    return { granularity, ladder, scheduling: schedulingBlock, overTime, variablesInUse, table };
  },
};
