'use strict';
const { FilterError } = require('../filters');
const { describeCampaign, upliftFor, tierMix, CONTROL_SEGMENT, PRE_DAYS, POST_DAYS } = require('../uplift');
const { addDays } = require('../dealing');

// Sales uplift vs control stores: one outcome chart for one campaign. Sales of the campaign's product in the stores it
// played in versus the Control stores segment, 30 days before, during its flight and 30 days after, with uplift %,
// incremental sales and iROAS. Page filters other than Advertiser do not apply (the windows are the campaign's own).
// `campaigns` is the drop-down: the campaigns of the advertiser(s) in scope, newest first. An advertiser login is pinned
// to its own advertiser by scopeFilters, so a campaign of another advertiser is simply not found. `state` says why a chart
// is empty (`bySku` lists each campaign SKU's contribution to the incremental sales tile): `no-pos` (no transactions for the product), `no-control` (no Control stores exclusion on the campaign).
module.exports = {
  path: '/sales-uplift',
  advertiserAccess: true,
  handler({ store, filters, params }) {
    const lastDay = store.lastPlayedDay;
    const advs = filters.advertiserIds ? new Set(filters.advertiserIds) : null;
    const all = store.campaigns.filter((c) => c.start <= lastDay).map((c) => describeCampaign(c, store, lastDay));
    const mine = all.filter((c) => !advs || advs.has(c.advertiserId)).sort((a, b) => b.start.localeCompare(a.start) || a.id.localeCompare(b.id));
    const requested = params.get('campaignId');
    if (requested && !mine.some((c) => c.id === requested)) throw new FilterError('unknown campaignId');
    const pick = requested ? mine.find((c) => c.id === requested)
      : mine.find((c) => c.hasPos && c.excludesControl && c.flightEnded) || mine[0] || null;
    const names = (ids) => ids.map((id) => store.catalog.stores[id].name || id);
    const out = {
      campaigns: mine.map((c) => ({ id: c.id, advertiserId: c.advertiserId, advertiserName: c.advertiserName, productName: c.product.name, ...(c.product.sku ? { sku: c.product.sku } : {}), start: c.start, end: c.end })),
      campaignId: pick ? pick.id : null, controlSegment: CONTROL_SEGMENT, state: pick ? 'ok' : 'no-campaign',
    };
    if (!pick) return out;
    Object.assign(out, {
      product: pick.product.sku ? { name: pick.product.name, sku: pick.product.sku } : { name: pick.product.name },
      matchedOn: pick.matchedOn,
      windows: { before: { from: addDays(pick.start, -PRE_DAYS), to: addDays(pick.start, -1) }, during: { from: pick.start, to: pick.flightEnd }, afterDays: POST_DAYS },
      campaignStores: { count: pick.campaignStores.length, names: names(pick.campaignStores) },
      controlStores: { count: pick.controlStores.length, names: names(pick.controlStores) },
      tierMix: tierMix(pick.level),
    });
    const result = upliftFor(store, pick, all.filter((c) => c.advertiserId === pick.advertiserId));
    if (!result.transactions) return { ...out, state: 'no-pos' };
    if (!pick.excludesControl) return { ...out, state: 'no-control' };
    return { ...out, tiles: { upliftPercent: result.uplift, incrementalSales: result.incremental, spend: result.spend, iroas: result.iroas }, series: result.series, bySku: result.bySku };
  },
};
