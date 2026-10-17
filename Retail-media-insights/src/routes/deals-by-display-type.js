'use strict';
const calc = require('../calc');
const { displayTypeFacts, hoverCard } = require('../display-types');
const { dealIdsFor, slotKey, slotsWonComplete, RETENTION_DAYS } = require('../dealing');
const { MIN_OTHER_BUYERS_FOR_WINNING_CPM } = require('../constants');
const { ownAdvertiser, isOpenAuction, dealsInScope, cents } = require('../advertiser-view');

// Advertiser "Your deals by display type": one group per display type the advertiser's deals are on (shopper-journey
// order), one row per deal beneath it. Open auction plays are not on a deal and are not included. A deal row's Share is
// the advertiser's plays won of all plays on that deal there (other buyers only as a count, never named); a group's
// Share is its share of the advertiser's deal spend (whole numbers adding to 100). Parts are rounded first.
module.exports = {
  path: '/deals-by-display-type',
  advertiserAccess: true,
  handler({ store, filters }) {
    const me = ownAdvertiser(filters);
    const all = new Map(); const others = new Map(); const mine = new Map(); const ownRows = [];
    store.scanDelivery({ ...filters, advertiserIds: null }, (r) => {
      if (isOpenAuction(r)) return;
      const k = `${r.dealId}#${r.displayTypeId}`;
      all.set(k, (all.get(k) || 0) + r.slots);
      if (r.advertiserId !== me) { if (r.slots > 0) (others.get(k) || others.set(k, new Set()).get(k)).add(r.advertiserId); return; }
      const m = mine.get(k) || mine.set(k, { plays: 0, views: 0, rev: 0 }).get(k);
      m.plays += r.slots; m.views += r.views; m.rev += r.revenue;
      ownRows.push(r);
    });
    const deals = dealsInScope(store, me, ownRows);
    const inScope = filters.displayTypeIds ? new Set(filters.displayTypeIds) : null;
    const known = store.catalog.displayTypes || {};
    const typeIds = new Set();
    for (const d of deals) for (const s of d.slots || []) typeIds.add(s.displayTypeId);
    for (const r of ownRows) typeIds.add(r.displayTypeId);
    for (const t of [...typeIds]) if ((inScope && !inScope.has(t)) || !known[t]) typeIds.delete(t);

    const facts = new Map(displayTypeFacts(store, { ...filters, displayTypeIds: [...typeIds] }).map((t) => [t.id, t]));
    const ordered = [...facts.keys(), ...[...typeIds].filter((t) => !facts.has(t)).sort((a, b) => String(known[a].name).localeCompare(String(known[b].name)))];

    const groups = ordered.map((typeId) => {
      const slotsHere = new Set();
      const rows = [];
      for (const deal of deals) {
        const slots = (deal.slots || []).filter((s) => s.displayTypeId === typeId);
        const key = `${deal.id}#${typeId}`;
        const m = mine.get(key);
        if (!slots.length && !m) continue;
        for (const s of slots) slotsHere.add(slotKey(s));
        const own = m || { plays: 0, views: 0, rev: 0 };
        const allPlays = all.get(key) || 0;
        const buyers = (deal.buyers || []).filter((b) => b.advertiserId === me);
        const advertisersOnDeal = new Set([me, ...(deal.buyers || []).map((b) => b.advertiserId)]).size;
        const row = {
          id: deal.id, name: deal.name, description: deal.description, dealType: deal.dealType,
          dealIds: dealIdsFor(deal, buyers), // only the advertiser's own DSP
          slots: {
            count: new Set(slots.map(slotKey)).size,
            assigned: slots.map((s) => ({
              playlist: s.playlist, zone: s.zone, playlistZone: `${s.playlist} · ${s.zone}`,
              advertiserSlot: s.position, loopSlot: s.loopSlot, label: `Advertiser slot ${s.position} (loop slot ${s.loopSlot})`, playsPerWindow: s.playsPerWindow,
            })),
          },
          playsWon: own.plays, assumedViews: Math.round(own.views), spend: cents(own.rev),
          share: { playsWon: own.plays, advertisersOnDeal },
        };
        // One other buyer winning here would make allPlays minus playsWon that buyer's plays: omit allPlays and the percent.
        const winners = (others.get(key) || { size: 0 }).size;
        const hideShare = winners >= 1 && winners < MIN_OTHER_BUYERS_FOR_WINNING_CPM;
        if (!hideShare) row.share.allPlays = allPlays;
        if (own.views > 0) row.effectiveCpm = cents(calc.effectiveCpm(own.rev, own.views));
        if (!hideShare && allPlays > 0) row.share.percent = calc.wholePercent(own.plays, allPlays);
        rows.push(row);
      }
      rows.sort((a, b) => calc.compareDealTypes(a.dealType, b.dealType) || a.name.localeCompare(b.name));
      const spend = cents(rows.reduce((s, r) => s + r.spend, 0));
      const views = rows.reduce((s, r) => s + r.assumedViews, 0);
      const t = facts.get(typeId);
      const group = {
        displayType: t ? hoverCard(t) : { id: typeId, name: known[typeId].name },
        dealCount: rows.length, slots: slotsHere.size,
        playsWon: rows.reduce((s, r) => s + r.playsWon, 0), assumedViews: views, spend, deals: rows,
      };
      if (views > 0) group.effectiveCpm = cents(calc.effectiveCpm(spend, views));
      return group;
    }).filter((g) => g.deals.length);

    const split = calc.percentSplit(groups.map((g) => g.spend));
    groups.forEach((g, i) => { g.sharePercent = split[i]; });
    return {
      slotsWon: { complete: slotsWonComplete(filters), retentionDays: RETENTION_DAYS },
      totals: { playsWon: groups.reduce((s, g) => s + g.playsWon, 0), assumedViews: groups.reduce((s, g) => s + g.assumedViews, 0), spend: cents(groups.reduce((s, g) => s + g.spend, 0)) },
      groups,
    };
  },
};
