'use strict';
const calc = require('../calc');
const { chartFilter, cents } = require('./params');
const { addDays } = require('../dealing');

// Estimated revenue is Programmatic guaranteed reservations booked ahead: the next 30 days after the last played day.
const ESTIMATED_DAYS = 30;

// Earned revenue, estimated revenue and Inventory sold (% + slots sold + available + offline; the three sum to all advertiser slots). The optional
// dsps[] / dealTypes[] filters narrow the money figures to match the Revenue chart (README open
// question: inventory is not split by DSP or deal type, so it is unaffected). Money is rounded to
// cents, as in /revenue, so the two reconcile. Earned revenue follows the date range; estimated revenue is the reservations
// for the 30 days after the last played day (`estimatedWindow`), whatever the range, under the same store, display type,
// advertiser and chart filters. `effectiveCpm` is earned revenue / earned views x 1,000 (null with no views); `connectedDsps`
// counts the DSPs with a connected seat.
module.exports = {
  path: '/summary',
  handler({ store, filters, params }) {
    const keep = chartFilter(params);
    let earned = 0; let earnedViews = 0;
    store.scanDelivery(filters, (r) => {
      if (keep && !keep(r)) return;
      earned += r.earned; earnedViews += r.earnedViews;
    });
    const last = store.lastPlayedDay;
    const estimatedWindow = last ? { dateFrom: addDays(last, 1), dateTo: addDays(last, ESTIMATED_DAYS) } : { dateFrom: null, dateTo: null };
    let estimated = 0;
    if (last) {
      store.scanDelivery({ ...filters, dateFrom: estimatedWindow.dateFrom, dateTo: estimatedWindow.dateTo }, (r) => {
        if (keep && !keep(r)) return;
        estimated += r.estimated;
      });
    }
    let sold = 0; let unsold = 0; let offline = 0;
    store.scanInventory(filters, (r) => { sold += r.sold; unsold += r.unsold; offline += r.offline; });
    return {
      earnedRevenue: cents(earned),
      estimatedRevenue: cents(estimated),
      estimatedWindow,
      effectiveCpm: earnedViews > 0 ? cents(calc.effectiveCpm(earned, earnedViews)) : null,
      connectedDsps: ((store.catalog && store.catalog.connectedDsps) || []).length,
      inventorySold: { percent: calc.fillPercent(sold, unsold, offline), slotsSold: sold, slotsAvailable: unsold, slotsOffline: offline },
    };
  },
};
