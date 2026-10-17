'use strict';
const calc = require('../calc');
const { FilterError } = require('../filters');
const { listParam, cents, DSPS } = require('./params');
const { DEAL_TYPES, normaliseDealType } = require('../constants');

// Effective CPM per connected DSP: earned revenue / (assumed views / 1000), from settled billing
// only, so it reconciles to what advertisers were charged. Optional single `dealType` filter.
// Every connected DSP is returned, in the standard order, with a null CPM when it has no delivery.
module.exports = {
  path: '/yield',
  handler({ store, filters, params }) {
    const types = listParam(params, 'dealType');
    if (types && types.size > 1) throw new FilterError('dealType takes a single deal type');
    const dealType = types ? normaliseDealType([...types][0]) : null;
    if (dealType && !DEAL_TYPES.includes(dealType)) throw new FilterError(`dealType must be one of ${DEAL_TYPES.join(', ')}`);
    const byDsp = new Map(DSPS.map((d) => [d, { dsp: d, earned: 0, views: 0 }]));
    store.scanDelivery(filters, (r) => {
      if (dealType && r.dealType !== dealType) return;
      let b = byDsp.get(r.dsp);
      if (!b) { b = { dsp: r.dsp, earned: 0, views: 0 }; byDsp.set(r.dsp, b); }
      b.earned += r.earned; b.views += r.earnedViews;
    });
    const rows = [...byDsp.values()].sort((a, b) => calc.compareDsps(a.dsp, b.dsp)).map((b) => ({
      dsp: b.dsp,
      effectiveCpm: b.views > 0 ? cents(calc.effectiveCpm(b.earned, b.views)) : null,
      earnedRevenue: cents(b.earned),
      assumedViews: b.views,
    }));
    return { dealType, rows };
  },
};
