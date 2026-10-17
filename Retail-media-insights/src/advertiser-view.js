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
const cents = (n) => Math.round(n * 100) / 100;

/** Deals (not the open auction) the advertiser buys, or has delivery on in `rows`. Catalog objects, never serialised as is. */
function dealsInScope(store, advertiserId, ownRows) {
  const delivered = new Set(ownRows.filter((r) => !isOpenAuction(r)).map((r) => r.dealId));
  return dealsOf(store).filter((d) => d.dealType !== 'Open auction'
    && (delivered.has(d.id) || (d.buyers || []).some((b) => b.advertiserId === advertiserId)));
}

module.exports = { OPEN_AUCTION, ownAdvertiser, isOpenAuction, dealsInScope, cents };
