'use strict';
const calc = require('../calc');

// Earned revenue, estimated revenue and Inventory sold (% + slots sold + available).
module.exports = {
  path: '/summary',
  handler({ store, filters }) {
    let earned = 0; let estimated = 0;
    store.scanDelivery(filters, (r) => { earned += r.earned; estimated += r.estimated; });
    let sold = 0; let unsold = 0;
    store.scanInventory(filters, (r) => { sold += r.sold; unsold += r.unsold; });
    return {
      earnedRevenue: Math.round(earned),
      estimatedRevenue: Math.round(estimated),
      inventorySold: { percent: calc.fillPercent(sold, unsold), slotsSold: sold, slotsAvailable: unsold },
    };
  },
};
