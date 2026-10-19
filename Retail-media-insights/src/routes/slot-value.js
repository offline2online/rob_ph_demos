'use strict';
const calc = require('../calc');
const { displayTypeFacts, hoverCard, days, round } = require('../display-types');

// Slot value per display type: effective CPM, floor CPM, revenue per available slot and the network totals behind them.
// All revenue is earned revenue, to the cent. The hover's identity holds on real numbers, with fill applied:
//   perSlotPerDay = effectiveCpm x averageAssumedViewsPerSlotPerDay / 1,000 x advertiserSlotsSoldShare
// where the sold share is the settled (earned) assumed views delivered as a share of what every advertiser slot
// on every connected display would deliver over the range (slots x displays x days x average views per slot per
// day). Each factor is returned in the row.
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
      totalRevenue += round(e.revenue, 2); totalViews += Math.round(e.views); rawRevenue += e.revenue; rawViews += e.views;
      const displays = t.displays.length;
      const slots = t.loop ? t.loop.advertiser.count : 0;
      const perSlot = calc.perSlotPerDayPerDisplay(e.revenue, slots, displays, nDays);
      const capacityViews = (t.averageViewsRaw || 0) * slots * displays * nDays;
      const row = {
        ...hoverCard(t),
        floorCpm: t.def.floorCpm,
        effectiveCpm: round(calc.effectiveCpm(e.revenue, e.views), 2),
        perSlotPerDay: round(perSlot, 2),
        totals: {
          earnedRevenue: round(e.revenue, 2), assumedViews: Math.round(e.views), days: nDays,
          perDay: Math.round(perSlot * slots * displays), advertiserSlots: slots * displays,
        },
      };
      if (t.averageViewsRaw !== null) {
        row.averageAssumedViewsPerSlotPerDay = round(t.averageViewsRaw, 1);
        row.advertiserSlotsSoldShare = capacityViews > 0 ? round(e.views / capacityViews, 4) : 0;
      }
      return row;
    });
    return {
      rows,
      network: {
        earnedRevenue: round(totalRevenue, 2), assumedViews: totalViews, // parts rounded first, so rows add to these
        effectiveCpm: round(calc.effectiveCpm(rawRevenue, rawViews), 2),
        connectedDisplays: rows.reduce((n, r) => n + r.connectedDisplays.displays, 0),
      },
    };
  },
};
