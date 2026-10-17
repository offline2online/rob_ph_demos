'use strict';
const { eachDay } = require('../dealing');
const { ownAdvertiser } = require('../advertiser-view');

// Advertiser Audience: assumed views (VAC-d) delivered to this advertiser, with a daily trend. Days are
// rounded first and the total is their sum, so the trend always adds to the headline.
module.exports = {
  path: '/audience',
  advertiserAccess: true,
  handler({ store, filters }) {
    ownAdvertiser(filters);
    const byDay = new Map();
    store.scanDelivery(filters, (r) => byDay.set(r.date, (byDay.get(r.date) || 0) + r.views));
    const trend = eachDay(filters.dateFrom, filters.dateTo).map((date) => ({ date, assumedViews: Math.round(byDay.get(date) || 0) }));
    return { assumedViews: trend.reduce((s, x) => s + x.assumedViews, 0), trend };
  },
};
