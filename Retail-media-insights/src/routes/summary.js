'use strict';
const calc = require('../calc');
const { chartFilter, cents } = require('./params');
const { addDays } = require('../dealing');
const { DIRECT } = require('../constants');

// Estimated revenue is Programmatic guaranteed reservations booked ahead: the next 30 days after the last played day.
const ESTIMATED_DAYS = 30;

// Earned revenue, estimated revenue and Inventory sold (% + slots sold + available + offline; the three sum to all advertiser slots). The optional
// dsps[] / dealTypes[] filters narrow the money figures to match the Revenue chart (README open
// question: inventory is not split by DSP or deal type, so it is unaffected). Money is rounded to
// cents, as in /revenue, so the two reconcile. Earned revenue follows the date range; estimated revenue is the reservations
// for the 30 days after the last played day (`estimatedWindow`), whatever the range, under the same store, display type,
// advertiser and chart filters. `effectiveCpm` is earned revenue / earned views x 1,000 (null with no views); `connectedDsps`
// counts the DSPs with a connected seat; `direct` is the part of earned revenue from direct advertisers.
//
// `previous` carries the same four figures for the period before, so the page can show up/down: earned revenue, effective CPM and
// inventory sold over the equal-length period ending the day before the range starts; estimated revenue is the revenue
// (earned + booked) for the 30 days ending on the last played day, the 30 days before the estimated window.
const DAY_MS = 86400000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS) + 1;

module.exports = {
  path: '/summary',
  handler({ store, filters, params }) {
    const keep = chartFilter(params);
    let earned = 0; let earnedViews = 0;
    let directEarned = 0; const directAdvertisers = new Set();
    store.scanDelivery(filters, (r) => {
      if (keep && !keep(r)) return;
      earned += r.earned; earnedViews += r.earnedViews;
      if (r.dsp === DIRECT) { directEarned += r.earned; if (r.earned > 0) directAdvertisers.add(r.advertiserId); }
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
    const length = days(filters.dateFrom, filters.dateTo);
    const prevFilters = { ...filters, dateFrom: addDays(filters.dateFrom, -length), dateTo: addDays(filters.dateFrom, -1) };
    let pEarned = 0; let pViews = 0; let pSold = 0; let pUnsold = 0; let pOffline = 0;
    store.scanDelivery(prevFilters, (r) => {
      if (keep && !keep(r)) return;
      pEarned += r.earned; pViews += r.earnedViews;
    });
    store.scanInventory(prevFilters, (r) => { pSold += r.sold; pUnsold += r.unsold; pOffline += r.offline; });
    let pBooked = 0;
    if (last) {
      store.scanDelivery({ ...filters, dateFrom: addDays(last, 1 - ESTIMATED_DAYS), dateTo: last }, (r) => {
        if (keep && !keep(r)) return;
        pBooked += r.revenue;
      });
    }
    const hasInventory = pSold + pUnsold + pOffline > 0;
    const previous = {
      dateFrom: prevFilters.dateFrom,
      dateTo: prevFilters.dateTo,
      earnedRevenue: cents(pEarned),
      estimatedRevenue: cents(pBooked),
      effectiveCpm: pViews > 0 ? cents(calc.effectiveCpm(pEarned, pViews)) : null,
      inventorySoldPercent: hasInventory ? calc.fillPercent(pSold, pUnsold, pOffline) : null,
    };
    return {
      previous,
      earnedRevenue: cents(earned),
      estimatedRevenue: cents(estimated),
      estimatedWindow,
      effectiveCpm: earnedViews > 0 ? cents(calc.effectiveCpm(earned, earnedViews)) : null,
      // The direct advertisers' share of earned revenue (the retailer's own direct sales, no DSP), part of earnedRevenue and not on top of it.
      direct: { earnedRevenue: cents(directEarned), sharePercent: earned > 0 ? Math.round((directEarned / earned) * 100) : null, advertisers: directAdvertisers.size },
      connectedDsps: ((store.catalog && store.catalog.connectedDsps) || []).length,
      inventorySold: { percent: calc.fillPercent(sold, unsold, offline), slotsSold: sold, slotsAvailable: unsold, slotsOffline: offline },
    };
  },
};
