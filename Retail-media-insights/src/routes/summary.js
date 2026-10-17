'use strict';
const calc = require('../calc');
const { chartFilter, cents } = require('./params');

// Earned revenue, estimated revenue and Inventory sold (% + slots sold + available). The optional
// dsps[] / dealTypes[] filters narrow the money figures to match the Revenue chart (README open
// question: inventory is not split by DSP or deal type, so it is unaffected). Money is rounded to
// cents, as in /revenue, so the two reconcile.
module.exports = {
  path: '/summary',
  handler({ store, filters, params }) {
    const keep = chartFilter(params);
    let earned = 0; let estimated = 0;
    store.scanDelivery(filters, (r) => {
      if (keep && !keep(r)) return;
      earned += r.earned; estimated += r.estimated;
    });
    let sold = 0; let unsold = 0;
    store.scanInventory(filters, (r) => { sold += r.sold; unsold += r.unsold; });
    return {
      earnedRevenue: cents(earned),
      estimatedRevenue: cents(estimated),
      inventorySold: { percent: calc.fillPercent(sold, unsold), slotsSold: sold, slotsAvailable: unsold },
    };
  },
};
