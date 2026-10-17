'use strict';
const calc = require('../calc');
const { FilterError } = require('../filters');
const { DEAL_TYPES, DSPS } = require('../constants');
const { listParam } = require('./params');
const { dealsOf, slotKey, rollUp, opportunities, pacingOf, cents } = require('../dealing');

// One row per named deal (Open auction is not a deal). An advertiser login sees only the deals it is
// invited to, with only its own buyer and the deal ID for its own DSP.
module.exports = {
  path: '/deals',
  handler({ store, filters, params }) {
    const types = listParam(params, 'dealType');
    if (types && types.size > 1) throw new FilterError('dealType takes a single deal type');
    const dealType = types ? [...types][0] : null;
    if (dealType && !DEAL_TYPES.includes(dealType)) throw new FilterError(`dealType must be one of ${DEAL_TYPES.join(', ')}`);
    const scope = filters.advertiserIds ? new Set(filters.advertiserIds) : null;
    const advertisers = store.advertisers || {};
    const roll = rollUp(store, filters);
    const opp = opportunities(store, filters);
    const types2 = store.catalog.displayTypes || {};
    const rows = [];
    for (const deal of dealsOf(store)) {
      if (deal.dealType === 'Open auction' || (dealType && deal.dealType !== dealType)) continue;
      const buyers = (deal.buyers || []).filter((b) => !scope || scope.has(b.advertiserId));
      if (scope && !buyers.length) continue;
      const dealIds = DSPS.filter((d) => buyers.some((b) => b.dsp === d)).map((d) => ({ dsp: d, dealId: `${deal.phId}-${d.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}` }));
      const slots = (deal.slots || []).map((s) => ({
        displayTypeId: s.displayTypeId, displayType: (types2[s.displayTypeId] || {}).name || s.displayTypeId,
        playlist: s.playlist, zone: s.zone, playlistZone: `${s.playlist} · ${s.zone}`,
        iabZone: (types2[s.displayTypeId] || {}).zone || null,
        advertiserSlot: s.position, loopSlot: s.loopSlot, label: `Advertiser slot ${s.position} (loop slot ${s.loopSlot})`,
        playsPerWindow: s.playsPerWindow,
      }));
      // Fill: slots delivered on the deal / slot opportunities inside operating hours (sold + unsold records).
      let opportunity = 0; const seen = new Set();
      for (const s of deal.slots || []) { if (!seen.has(slotKey(s))) { seen.add(slotKey(s)); opportunity += opp.perPosition(s.displayTypeId); } }
      let won = 0;
      for (const t of new Set((deal.slots || []).map((s) => s.displayTypeId))) won += roll.slotsByDealType.get(`${deal.id}#${t}`) || 0;
      const d = roll.byDeal.get(deal.id) || { revenue: 0, earned: 0, earnedViews: 0 };
      const cpm = deal.dealType === 'Private auction'
        ? { value: deal.floorCpm, kind: 'floor' }
        : { value: deal.cpm, kind: 'fixed' };
      rows.push({
        id: deal.id, name: deal.name, description: deal.description, dealType: deal.dealType, dealIds, slots,
        advertisers: buyers.map((b) => ({ advertiserId: b.advertiserId, name: (advertisers[b.advertiserId] || {}).name || b.advertiserId, dsp: b.dsp })),
        fill: { percent: opportunity > 0 ? Math.min(calc.wholePercent(won, opportunity), 100) : 0, slotsWon: won, slotsAvailable: Math.round(opportunity) },
        pacing: deal.dealType === 'Programmatic Guaranteed' && deal.flight ? pacingOf(deal, store, filters) : null,
        revenue: cents(d.revenue), cpm: { value: cpm.value == null ? null : cents(cpm.value), kind: cpm.kind },
      });
    }
    rows.sort((a, b) => calc.compareDealTypes(a.dealType, b.dealType) || a.name.localeCompare(b.name));
    return { dealType, rows };
  },
};
