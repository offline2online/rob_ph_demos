'use strict';
const calc = require('../calc');
const { ownAdvertiser, cents } = require('../advertiser-view');
const { dealsOf } = require('../dealing');

// Advertiser summary: spend and plays won, which equal Delivery's totals for the same filters, and the number of deals the
// advertiser is a buyer on that are live in the range (a deal with a flight is live when the flight overlaps the range).
// Effective CPM is that spend / those assumed views (VAC-d) x 1,000, null with no views. Always pinned to one advertiser (an advertiser login by scopeFilters; a retailer names exactly one).
module.exports = {
  path: '/my-summary',
  advertiserAccess: true,
  handler({ store, filters }) {
    const me = ownAdvertiser(filters);
    // Delivery's totals are the sum of its per-day figures, each spend rounded to the cent first.
    const spend = new Map(); const plays = new Map(); let views = 0;
    store.scanDelivery({ ...filters, advertiserIds: [me] }, (r) => {
      if (r.earnedSlots <= 0 && r.earned <= 0) return;
      views += r.earnedViews;
      spend.set(r.date, (spend.get(r.date) || 0) + r.earned);
      plays.set(r.date, (plays.get(r.date) || 0) + r.earnedSlots);
    });
    let total = 0; let playsWon = 0;
    for (const [date, v] of spend) { total += cents(v); playsWon += plays.get(date); }
    const dealsOn = dealsOf(store).filter((d) => d.dealType !== 'Open auction'
      && (d.buyers || []).some((b) => b.advertiserId === me)
      && (!d.flight || (d.flight.start <= filters.dateTo && d.flight.end >= filters.dateFrom))).length;
    return { dateFrom: filters.dateFrom, dateTo: filters.dateTo, spend: cents(total), playsWon, dealsOn, assumedViews: Math.round(views), effectiveCpm: views > 0 ? cents(calc.effectiveCpm(total, views)) : null };
  },
};
