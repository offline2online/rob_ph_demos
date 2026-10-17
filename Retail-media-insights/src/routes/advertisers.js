'use strict';
const calc = require('../calc');
const { dealsOf, slotKey, rollUp, opportunities, slotsWonComplete, RETENTION_DAYS, cents } = require('../dealing');

// Demand health: earned revenue, share of total earned (whole numbers adding to 100), deals on, slots covered,
// slots won %, effective CPM (settled billing only) and DSP. `top` is the ten highest by revenue, `all` is everyone.
// Slots covered and Slots won count only the advertiser's deal positions on the filtered display types, and
// Slots won only its own wins on those deals (not wins there from other deals or the open auction). With no
// opportunity, Slots won is null. There is no cap: a figure above 100 would be a data error to fix, not hide.
module.exports = {
  path: '/advertisers',
  handler({ store, filters }) {
    const scope = filters.advertiserIds ? new Set(filters.advertiserIds) : null;
    const meta = store.advertisers || {};
    const roll = rollUp(store, filters);
    const opp = opportunities(store, filters);
    const deals = dealsOf(store);
    const wantedTypes = filters.displayTypeIds ? new Set(filters.displayTypeIds) : null;
    const ids = new Set(roll.byAdv.keys());
    for (const d of deals) for (const b of d.buyers || []) if (!scope || scope.has(b.advertiserId)) ids.add(b.advertiserId);
    const list = [...ids].map((id) => {
      const mine = deals.filter((d) => d.dealType !== 'Open auction' && (d.buyers || []).some((b) => b.advertiserId === id));
      const slots = new Map();
      let won = 0;
      for (const d of mine) {
        const assigned = (d.slots || []).filter((s) => !wantedTypes || wantedTypes.has(s.displayTypeId));
        for (const s of assigned) slots.set(slotKey(s), s.displayTypeId);
        for (const t of new Set(assigned.map((s) => s.displayTypeId))) won += roll.slotsByAdvDealType.get(`${id}#${d.id}#${t}`) || 0;
      }
      let opportunity = 0; for (const k of slots.keys()) opportunity += opp.perPosition(slots.get(k));
      const a = roll.byAdv.get(id) || { revenue: 0, earned: 0, earnedViews: 0 };
      const buyer = mine.flatMap((d) => d.buyers).find((b) => b.advertiserId === id);
      return {
        advertiserId: id, name: (meta[id] || {}).name || id, dsp: (meta[id] || {}).dsp || (buyer && buyer.dsp) || null,
        revenue: cents(a.earned), revenueRaw: a.earned,
        dealsOn: mine.map((d) => ({ id: d.id, name: d.name, dealType: d.dealType })).sort((x, y) => calc.compareDealTypes(x.dealType, y.dealType)),
        slotsCovered: slots.size,
        slotsWonPercent: opportunity > 0 ? calc.wholePercent(won, opportunity) : null,
        slotsWonCount: won, slotsOpportunity: Math.round(opportunity),
        effectiveCpm: a.earnedViews > 0 ? cents(calc.effectiveCpm(a.earned, a.earnedViews)) : null,
      };
    }).sort((x, y) => y.revenueRaw - x.revenueRaw || x.name.localeCompare(y.name));
    const shares = calc.percentSplit(list.map((x) => x.revenueRaw));
    const all = list.map(({ revenueRaw, ...x }, i) => ({ ...x, share: shares[i] }));
    return { slotsWon: { complete: slotsWonComplete(filters), retentionDays: RETENTION_DAYS }, top: all.slice(0, 10), all };
  },
};
