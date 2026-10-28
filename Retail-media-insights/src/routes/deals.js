'use strict';
const calc = require('../calc');
const { FilterError } = require('../filters');
const { DEAL_TYPES, normaliseDealType } = require('../constants');
const { listParam } = require('./params');
const { termDays, termPlaysOf, termViewsOf, loopSlotCountOf } = require('../deal-terms');
const { dealIdsFor, dealsOf, slotKey, rollUp, opportunities, deliveredByDeal, pacingOf, cents } = require('../dealing');

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// One row per named deal (Open auction is not a deal). An advertiser login sees only the deals it is
// invited to, with only its own buyer and the deal ID for its own DSP. The display type page filter applies to
// every part of a row (slots list, Slots, Fill), and a deal with no slot on the filtered types drops out.
// Revenue is earned revenue. Pacing is deal-wide: the store and display type filters do not change it.
module.exports = {
  path: '/deals',
  handler({ store, filters, params }) {
    const types = listParam(params, 'dealType');
    if (types && types.size > 1) throw new FilterError('dealType takes a single deal type');
    const dealType = types ? normaliseDealType([...types][0]) : null;
    if (dealType && !DEAL_TYPES.includes(dealType)) throw new FilterError(`dealType must be one of ${DEAL_TYPES.join(', ')}`);
    const scope = filters.advertiserIds ? new Set(filters.advertiserIds) : null;
    const advertisers = store.advertisers || {};
    const roll = rollUp(store, filters);
    const opp = opportunities(store, filters);
    const types2 = store.catalog.displayTypes || {};
    const wantedTypes = filters.displayTypeIds ? new Set(filters.displayTypeIds) : null;
    const rows = [];
    const included = [];
    for (const deal of dealsOf(store)) {
      if (deal.dealType === 'Open auction' || (dealType && deal.dealType !== dealType)) continue;
      const buyers = (deal.buyers || []).filter((b) => !scope || scope.has(b.advertiserId));
      if (scope && !buyers.length) continue;
      const dealIds = dealIdsFor(deal, buyers);
      const assigned = (deal.slots || []).filter((s) => !wantedTypes || wantedTypes.has(s.displayTypeId));
      if (wantedTypes && !assigned.length) continue;
      included.push(deal);
      const days = termDays(deal.flight);
      const rate = deal.dealType === 'Private auction' ? deal.floorCpm : deal.cpm;
      const slots = assigned.map((s) => ({
        displayTypeId: s.displayTypeId, displayType: (types2[s.displayTypeId] || {}).name || s.displayTypeId,
        playlist: s.playlist, zone: s.zone, playlistZone: `${s.playlist} · ${s.zone}`,
        displayTypeDescription: (types2[s.displayTypeId] || {}).description || null,
        iabZone: (types2[s.displayTypeId] || {}).zone || null,
        advertiserSlot: s.position, loopSlot: s.loopSlot, loopSlotCount: loopSlotCountOf((types2[s.displayTypeId] || {}).slots), label: `Advertiser slot ${s.position} (loop slot ${s.loopSlot})`,
        playsPerWindow: s.playsPerWindow,
        termPlays: termPlaysOf(store, filters, s, days),
      }));
      const rawVacd = assigned.map((s) => termViewsOf(store, filters, s, days));
      slots.forEach((s, i) => { s.termVacd = rawVacd[i] == null ? null : Math.round(rawVacd[i]); s.termValue = rawVacd[i] == null || rate == null ? null : cents(calc.revenueAtCpm(rate, rawVacd[i])); });
      const counted = slots.filter((s, i) => s.termPlays != null && rawVacd[i] != null);
      const countedVacd = rawVacd.filter((v, i) => slots[i].termPlays != null && v != null);
      const term = days == null ? null : {
        start: deal.flight.start, end: deal.flight.end, days,
        // The deal total only when every slot can be totalled and a rate prices it.
        total: slots.length && counted.length === slots.length ? { plays: counted.reduce((n, s) => n + s.termPlays, 0), vacd: Math.round(sum(countedVacd)), value: rate == null ? null : cents(calc.revenueAtCpm(rate, sum(countedVacd))) } : null,
      };
      // Fill: slots won on the deal / slot opportunities inside operating hours (sold + unsold + offline records).
      let opportunity = 0; const seen = new Set();
      for (const s of assigned) { if (!seen.has(slotKey(s))) { seen.add(slotKey(s)); opportunity += opp.perPosition(s.displayTypeId); } }
      let won = 0;
      for (const t of new Set(assigned.map((s) => s.displayTypeId))) won += roll.slotsOnDealType(deal.id, t);
      const d = roll.byDeal.get(deal.id) || { revenue: 0, earned: 0, earnedViews: 0 };
      const cpm = deal.dealType === 'Private auction'
        ? { value: deal.floorCpm, kind: 'floor' }
        : { value: deal.cpm, kind: 'fixed' };
      rows.push({
        id: deal.id, name: deal.name, description: deal.description, dealType: deal.dealType, dealIds, slots, term,
        advertisers: buyers.map((b) => ({ advertiserId: b.advertiserId, name: (advertisers[b.advertiserId] || {}).name || b.advertiserId, dsp: b.dsp }))
          .sort((x, y) => calc.compareDsps(x.dsp, y.dsp) || x.name.localeCompare(y.name)),
        fill: { percent: opportunity > 0 ? calc.wholePercent(won, opportunity) : null, slotsWon: won, slotsAvailable: Math.round(opportunity) },
        pacing: null,
        revenue: cents(d.earned), cpm: { value: cpm.value == null ? null : cents(cpm.value), kind: cpm.kind },
      });
    }
    const pg = included.filter((d) => d.dealType === 'Programmatic guaranteed' && d.flight);
    const delivered = deliveredByDeal(store, filters, pg);
    const pgById = new Map(pg.map((d) => [d.id, d]));
    for (const row of rows) {
      const deal = pgById.get(row.id);
      if (deal) row.pacing = pacingOf(deal, delivered.get(deal.id), filters);
    }
    rows.sort((a, b) => calc.compareDealTypes(a.dealType, b.dealType) || a.name.localeCompare(b.name));
    return { dealType, rows };
  },
};
