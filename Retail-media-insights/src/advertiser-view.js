'use strict';
// Shared by the advertiser view endpoints (delivery, deals-by-display-type, audience, my-targeting).
// Every query stays pinned to one advertiser: an advertiser login is pinned by scopeFilters; a retailer
// user must name exactly one advertiser.

const { FilterError } = require('./filters');
const { dealsOf } = require('./dealing');

const OPEN_AUCTION = 'open-auction';

function ownAdvertiser(filters) {
  const ids = filters.advertiserIds;
  if (!ids || ids.length !== 1) throw new FilterError('this endpoint is per advertiser: pass exactly one advertiserIds value');
  return ids[0];
}

const isOpenAuction = (r) => r.dealType === 'Open auction';
// Rounded to the cent after settling float noise (1e-6), so the order a sum was added in never decides a half cent.
const cents = (n) => Math.round(Math.round(n * 1e6) / 1e4) / 100;

/** The p-th percentile (0..1) of an ascending list, linearly interpolated between neighbours. */
function percentile(sorted, p) {
  const at = (sorted.length - 1) * p; const lo = Math.floor(at); const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/**
 * The winning CPM range of a set of cleared CPMs (one per billing line): p25, median and p75, to the cent. Only these aggregates
 * leave the service; the caller has already checked that enough other buyers won (MIN_OTHER_BUYERS_FOR_WINNING_CPM).
 */
function winningRange(cpms) {
  if (!cpms.length) return null;
  const sorted = Float64Array.from(cpms).sort();
  return { p25: cents(percentile(sorted, 0.25)), median: cents(percentile(sorted, 0.5)), p75: cents(percentile(sorted, 0.75)) };
}

/** Deals (not the open auction) the advertiser buys, or has delivery on (`delivered`: a Set of deal ids). Catalog objects, never serialised as is. */
function dealsDelivered(store, advertiserId, delivered) {
  return dealsOf(store).filter((d) => d.dealType !== 'Open auction'
    && (delivered.has(d.id) || (d.buyers || []).some((b) => b.advertiserId === advertiserId)));
}

/** dealsDelivered for the deals that `ownRows` (the advertiser's delivery rows) are on. */
function dealsInScope(store, advertiserId, ownRows) {
  const delivered = new Set(); const seen = new Uint8Array(store.dealIds.length);
  for (const r of ownRows) if (!seen[r.dealIx] && !isOpenAuction(r)) { seen[r.dealIx] = 1; delivered.add(r.dealId); }
  return dealsDelivered(store, advertiserId, delivered);
}

module.exports = { OPEN_AUCTION, ownAdvertiser, isOpenAuction, dealsInScope, dealsDelivered, cents, winningRange };
