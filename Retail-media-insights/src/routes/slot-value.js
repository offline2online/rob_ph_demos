'use strict';
const calc = require('../calc');
const { displayTypeFacts, hoverCard, days, round } = require('../display-types');

// Slot value per display type: effective CPM, floor CPM, per slot per day and the network totals behind them.
module.exports = {
  path: '/slot-value',
  handler({ store, filters }) {
    const facts = displayTypeFacts(store, filters);
    const earned = new Map();
    store.scanDelivery(filters, (r) => {
      const a = earned.get(r.displayTypeId) || { revenue: 0, views: 0 };
      a.revenue += r.earned; a.views += r.earnedViews;
      earned.set(r.displayTypeId, a);
    });
    const nDays = days(filters);
    let totalRevenue = 0; let totalViews = 0; let rawRevenue = 0; let rawViews = 0;
    const rows = facts.map((t) => {
      const e = earned.get(t.id) || { revenue: 0, views: 0 };
      totalRevenue += Math.round(e.revenue); totalViews += Math.round(e.views); rawRevenue += e.revenue; rawViews += e.views;
      const displays = t.displays.length;
      const slots = t.loop ? t.loop.advertiser.count : 0;
      const perSlot = calc.perSlotPerDayPerDisplay(e.revenue, slots, displays, nDays);
      return {
        ...hoverCard(t),
        floorCpm: t.def.floorCpm,
        effectiveCpm: round(calc.effectiveCpm(e.revenue, e.views), 2),
        perSlotPerDay: round(perSlot, 2),
        totals: {
          earnedRevenue: Math.round(e.revenue), assumedViews: Math.round(e.views), days: nDays,
          perDay: Math.round(perSlot * slots * displays), advertiserSlots: slots * displays,
        },
      };
    });
    return {
      rows,
      network: {
        earnedRevenue: totalRevenue, assumedViews: totalViews, // parts rounded first, so rows add to these
        effectiveCpm: round(calc.effectiveCpm(rawRevenue, rawViews), 2),
        connectedDisplays: rows.reduce((n, r) => n + r.connectedDisplays.displays, 0),
      },
    };
  },
};
