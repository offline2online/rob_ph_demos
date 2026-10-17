'use strict';
// What an advertiser principal may see, derived server-side from the store. Never from the request.

const { dealsOf } = require('./dealing');

/**
 * Display types an advertiser may filter by: those in the slot assignments of the deals it buys,
 * plus those its campaigns target. A campaign with no display types contributes nothing here (fail
 * closed: an untargeted campaign does not unlock the whole network's display types).
 */
function allowedDisplayTypeIds(store, advertiserId) {
  const known = (store.catalog && store.catalog.displayTypes) || {};
  const out = new Set();
  for (const deal of dealsOf(store)) {
    if (!(deal.buyers || []).some((b) => b.advertiserId === advertiserId)) continue;
    for (const s of deal.slots || []) out.add(s.displayTypeId);
  }
  for (const c of store.campaigns || []) {
    if (c.advertiserId === advertiserId) for (const t of c.displayTypeIds || []) out.add(t);
  }
  return [...out].filter((t) => known[t]);
}

/**
 * Server-side scoping. An advertiser principal is pinned to its own advertiser id and to the display
 * types it is allowed to see; a client-supplied advertiserIds can never widen or change that, and a
 * client displayTypeIds can only narrow it (REQUIREMENTS.md section 3.3).
 */
function scopeFilters(filters, principal, store) {
  if (!principal || principal.principalType !== 'advertiser') return filters;
  const out = { ...filters, advertiserIds: [principal.principalId] };
  if (store) {
    const allowed = allowedDisplayTypeIds(store, principal.principalId);
    out.displayTypeIds = filters.displayTypeIds ? filters.displayTypeIds.filter((t) => allowed.includes(t)) : allowed;
  }
  return out;
}

module.exports = { allowedDisplayTypeIds, scopeFilters };
