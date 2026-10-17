'use strict';
const calc = require('../calc');
const { dealsOf, slotKey, rollUp, opportunities, slotsWonComplete, RETENTION_DAYS, cents } = require('../dealing');

// Demand health: revenue, share of total (whole numbers adding to 100), deals on, slots covered, slots won %,
// effective CPM (settled billing only) and DSP. `top` is the ten highest by revenue, `all` is everyone.
module.exports = {
  path: '/advertisers',
  handler({ store, filters }) {
    const scope = filters.advertiserIds ? new Set(filters.advertiserIds) : null;
    const meta = store.advertisers || {};
    const roll = rollUp(store, filters);
    const opp = opportunities(store, filters);
    const deals = dealsOf(store);
    const ids = new Set(roll.byAdv.keys());
    for (const d of deals) for (const b of d.buyers || []) if (!scope || scope.has(b.advertiserId)) ids.add(b.advertiserId);
    const list = [...ids].map((id) => {
      const mine = deals.filter((d) => d.dealType !== 'Open auction' && (d.buyers || []).some((b) => b.advertiserId === id));
      const slots = new Map();
      for (const d of mine) for (const s of d.slots || []) slots.set(slotKey(s), s.displayTypeId);
      let opportunity = 0; for (const k of slots.keys()) opportunity += opp.perPosition(slots.get(k));
      let won = 0; for (const t of new Set(slots.values())) won += roll.slotsByAdvType.get(`${id}#${t}`) || 0;
      const a = roll.byAdv.get(id) || { revenue: 0, earned: 0, earnedViews: 0 };
      const buyer = mine.flatMap((d) => d.buyers).find((b) => b.advertiserId === id);
      return {
        advertiserId: id, name: (meta[id] || {}).name || id, dsp: (meta[id] || {}).dsp || (buyer && buyer.dsp) || null,
        revenue: cents(a.revenue), revenueRaw: a.revenue,
        dealsOn: mine.map((d) => ({ id: d.id, name: d.name, dealType: d.dealType })).sort((x, y) => calc.compareDealTypes(x.dealType, y.dealType)),
        slotsCovered: slots.size,
        slotsWonPercent: opportunity > 0 ? Math.min(calc.wholePercent(won, opportunity), 100) : null,
        effectiveCpm: a.earnedViews > 0 ? cents(calc.effectiveCpm(a.earned, a.earnedViews)) : null,
      };
    }).sort((x, y) => y.revenueRaw - x.revenueRaw || x.name.localeCompare(y.name));
    const shares = calc.percentSplit(list.map((x) => x.revenueRaw));
    const all = list.map(({ revenueRaw, ...x }, i) => ({ ...x, share: shares[i] }));
    return { slotsWon: { complete: slotsWonComplete(filters), retentionDays: RETENTION_DAYS }, top: all.slice(0, 10), all };
  },
};
