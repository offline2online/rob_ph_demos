// Fixture responses for the Demand health and Targeting & scheduling maturity
// panels, in the shapes the `advertisers` and `maturity` endpoints return
// (src/routes/advertisers.js, src/routes/maturity.js). Twelve advertisers so the
// top-10 / show-all behaviour is exercised. Everything is derived from ADV so the
// ladder, scheduling, variables and table agree with each other.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DemandChartsFixtures = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LEVELS = ['Default only', 'Localised', 'Personalised'];
  var VARS = {
    'Visitor Segments': { label: 'Visitor Segments', kind: 'Personalised', personalisationType: 'Aggregate' },
    'Face Attributes': { label: 'Face Attributes', kind: 'Personalised', personalisationType: 'Computer Vision' },
    'Loyalty Tier': { label: 'Loyalty Tier', kind: 'Personalised', personalisationType: 'Identified visitor' },
    State: { label: 'State', kind: 'Localised' },
    Postcode: { label: 'Postcode', kind: 'Localised' },
    Suburb: { label: 'Suburb', kind: 'Localised' },
    Weather: { label: 'Weather', kind: 'Localised' }
  };
  function v() { return Array.prototype.map.call(arguments, function (k) { return VARS[k]; }); }

  // name, dsp, revenue, level, variables, campaigns, scheduled campaigns, schedules, targeted versions, deals
  var ADV = [
    { id: 'a1', name: 'Blackmores', dsp: 'DV360', revenue: 18200, level: 'Personalised', vars: v('Visitor Segments', 'State', 'Loyalty Tier'), campaigns: 4, scheduled: 3, schedules: 5, versions: 6,
      deals: [['Wellness PG', 'Programmatic guaranteed'], ['Pharmacy PD', 'Preferred deal']], slots: 6, won: 72, cpm: 18.4 },
    { id: 'a2', name: 'Acme', dsp: 'The Trade Desk', revenue: 12400, level: 'Localised', vars: v('State', 'Postcode', 'Suburb'), campaigns: 3, scheduled: 1, schedules: 1, versions: 2,
      deals: [['Wellness PG', 'Programmatic guaranteed']], slots: 4, won: 58, cpm: 15.1 },
    { id: 'a3', name: 'Perrigo', dsp: 'The Trade Desk', revenue: 9800, level: 'Personalised', vars: v('Face Attributes', 'State'), campaigns: 2, scheduled: 2, schedules: 3, versions: 3,
      deals: [['Pharmacy PD', 'Preferred deal'], ['Private seats', 'Private auction']], slots: 5, won: 64, cpm: 16.9 },
    { id: 'a4', name: 'Nova', dsp: 'Amazon DSP', revenue: 7600, level: 'Default only', vars: [], campaigns: 2, scheduled: 0, schedules: 0, versions: 0,
      deals: [['Private seats', 'Private auction']], slots: 2, won: 41, cpm: 11.2 },
    { id: 'a5', name: 'Haleon', dsp: 'DV360', revenue: 6900, level: 'Localised', vars: v('State', 'Weather'), campaigns: 2, scheduled: 2, schedules: 2, versions: 2,
      deals: [['Wellness PG', 'Programmatic guaranteed']], slots: 3, won: 66, cpm: 14.8 },
    { id: 'a6', name: 'Swisse', dsp: 'DV360', revenue: 5400, level: 'Personalised', vars: v('Visitor Segments'), campaigns: 1, scheduled: 0, schedules: 0, versions: 2,
      deals: [['Pharmacy PD', 'Preferred deal']], slots: 2, won: 52, cpm: 17.3 },
    { id: 'a7', name: 'Berocca', dsp: 'Amazon DSP', revenue: 4300, level: 'Default only', vars: [], campaigns: 1, scheduled: 0, schedules: 0, versions: 0,
      deals: [], slots: 0, won: null, cpm: 10.4 },
    { id: 'a8', name: 'Cenovis', dsp: 'The Trade Desk', revenue: 3500, level: 'Localised', vars: v('Postcode'), campaigns: 1, scheduled: 1, schedules: 1, versions: 1,
      deals: [['Wellness PG', 'Programmatic guaranteed']], slots: 2, won: 47, cpm: 13.2 },
    { id: 'a9', name: 'Nurofen', dsp: 'DV360', revenue: 2800, level: 'Default only', vars: [], campaigns: 1, scheduled: 0, schedules: 0, versions: 0,
      deals: [], slots: 0, won: null, cpm: 9.9 },
    { id: 'a10', name: 'Panadol', dsp: 'Amazon DSP', revenue: 2100, level: 'Localised', vars: v('State'), campaigns: 1, scheduled: 0, schedules: 0, versions: 1,
      deals: [['Private seats', 'Private auction']], slots: 1, won: 38, cpm: 12.6 },
    { id: 'a11', name: 'Betadine', dsp: 'The Trade Desk', revenue: 1500, level: 'Default only', vars: [], campaigns: 1, scheduled: 0, schedules: 0, versions: 0,
      deals: [], slots: 0, won: null, cpm: 8.7 },
    { id: 'a12', name: 'Fess', dsp: 'DV360', revenue: 900, level: 'Default only', vars: [], campaigns: 1, scheduled: 0, schedules: 0, versions: 0,
      deals: [], slots: 0, won: null, cpm: null }
  ];

  var META = { dateFrom: '2026-09-12', dateTo: '2026-10-11', days: 30, storeCount: 5 };

  function who(a, extra) {
    var o = { advertiserId: a.id, name: a.name, dsp: a.dsp };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  function percentSplit(counts) {
    var total = counts.reduce(function (a, b) { return a + b; }, 0);
    if (!total) return counts.map(function () { return 0; });
    var raw = counts.map(function (c) { return 100 * c / total; });
    var out = raw.map(Math.floor);
    var left = 100 - out.reduce(function (a, b) { return a + b; }, 0);
    raw.map(function (r, i) { return { i: i, f: r - Math.floor(r) }; })
      .sort(function (x, y) { return y.f - x.f || x.i - y.i; })
      .slice(0, left).forEach(function (x) { out[x.i] += 1; });
    return out;
  }

  var total = ADV.reduce(function (s, a) { return s + a.revenue; }, 0);
  var shares = percentSplit(ADV.map(function (a) { return a.revenue; }));
  var allAdvertisers = ADV.map(function (a, i) {
    return {
      advertiserId: a.id, name: a.name, dsp: a.dsp, revenue: a.revenue, share: shares[i],
      dealsOn: a.deals.map(function (d, j) { return { id: a.id + '-d' + j, name: d[0], dealType: d[1] }; }),
      slotsCovered: a.slots, slotsWonPercent: a.won, effectiveCpm: a.cpm
    };
  });
  var advertisers = {
    meta: META,
    slotsWon: { complete: true, retentionDays: 90 },
    top: allAdvertisers.slice(0, 10),
    all: allAdvertisers
  };

  function tableRow(a) {
    return {
      advertiserId: a.id, name: a.name, dsp: a.dsp, level: a.level,
      variables: a.vars.map(function (x) { return { label: x.label, kind: x.kind, personalisationType: x.personalisationType }; }),
      scheduling: { uses: a.scheduled > 0, scheduledCampaigns: a.scheduled, campaigns: a.campaigns, schedules: a.schedules },
      targetedVersions: a.versions, revenue: a.revenue
    };
  }

  // Same filtering and ordering as src/routes/maturity.js.
  function maturity(params) {
    params = params || {};
    var gran = params.granularity === 'week' ? 'week' : 'month';
    var rows = ADV.map(tableRow);
    var ladder = LEVELS.map(function (l) {
      var at = rows.filter(function (r) { return r.level === l; });
      return { level: l, advertisers: at.length, list: at.map(function (r) {
        var types = [];
        r.variables.forEach(function (x) { if (x.personalisationType && types.indexOf(x.personalisationType) < 0) types.push(x.personalisationType); });
        return who(r, l === 'Personalised' ? { personalisationTypes: types.sort() } : {});
      }) };
    });
    var using = rows.filter(function (r) { return r.scheduling.uses; });
    var not = rows.filter(function (r) { return !r.scheduling.uses; });
    var scheduling = [
      { key: 'uses', label: 'Uses scheduling', advertisers: using.length, list: using.map(function (r) {
        return who(r, { scheduledCampaigns: r.scheduling.scheduledCampaigns, campaigns: r.scheduling.campaigns, schedules: r.scheduling.schedules });
      }) },
      { key: 'none', label: 'No scheduling', advertisers: not.length, list: not.map(function (r) { return who(r); }) }
    ];
    var byVar = {};
    rows.forEach(function (r) { r.variables.forEach(function (x) {
      var e = byVar[x.label] || (byVar[x.label] = { variable: x.label, kind: x.kind, personalisationType: x.personalisationType, list: [] });
      e.list.push(r);
    }); });
    var variablesInUse = Object.keys(byVar).map(function (k) { return byVar[k]; })
      .filter(function (e) { return !params.kind || e.kind === params.kind; })
      .sort(function (a, b) { return b.list.length - a.list.length || a.variable.localeCompare(b.variable); })
      .map(function (e) { return { variable: e.variable, kind: e.kind, personalisationType: e.personalisationType, advertisers: e.list.length,
        list: e.list.map(function (r) { return who(r); }) }; });

    var periods = gran === 'week'
      ? ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']
      : ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'];
    var overTime = periods.map(function (p, i) {
      var n = periods.length - 1;
      var counts = [Math.max(2, 12 - i * 2), 3 + i, 1 + i * 2];
      var pct = percentSplit(counts);
      return { period: p, campaigns: counts[0] + counts[1] + counts[2],
        levels: LEVELS.map(function (l, k) { return { level: l, campaigns: counts[k], percent: pct[k] }; }), _n: n };
    }).map(function (r) { delete r._n; return r; });

    var table = rows
      .filter(function (r) { return !params.level || r.level === params.level; })
      .filter(function (r) { return !params.variable || r.variables.some(function (x) { return x.label === params.variable; }); })
      .filter(function (r) { return !params.scheduling || (params.scheduling === 'uses') === r.scheduling.uses; })
      .sort(function (a, b) { return LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || b.revenue - a.revenue || a.name.localeCompare(b.name); });
    return { meta: META, granularity: gran, ladder: ladder, scheduling: scheduling, overTime: overTime, variablesInUse: variablesInUse, table: table };
  }

  // fetchJson(endpoint, params) → Promise, as the tab shell supplies it.
  function fetchJson(endpoint, params, opts) {
    opts = opts || {};
    var delay = opts.delay == null ? 120 : opts.delay;
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (opts.state === 'error') return reject(new Error('Fixture error'));
        var empty = opts.state === 'empty';
        switch (endpoint) {
          case 'advertisers': return resolve(empty ? { meta: META, slotsWon: { complete: true, retentionDays: 90 }, top: [], all: [] } : advertisers);
          case 'maturity': return resolve(empty ? { meta: META, granularity: 'month', ladder: [], scheduling: [], overTime: [], variablesInUse: [], table: [] } : maturity(params));
          default: return reject(new Error('Unknown endpoint ' + endpoint));
        }
      }, delay);
    });
  }

  return { META: META, advertisers: advertisers, maturity: maturity, fetchJson: fetchJson, totalRevenue: total };
});
