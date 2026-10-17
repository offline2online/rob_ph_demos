'use strict';
const calc = require('../calc');
const { displayTypeFacts, hoverCard } = require('../display-types');
const { dealIdsFor, slotKey, slotsWonComplete, RETENTION_DAYS } = require('../dealing');
const { MIN_OTHER_BUYERS_FOR_WINNING_CPM } = require('../constants');
const { ownAdvertiser, isOpenAuction, dealsInScope, cents } = require('../advertiser-view');

// Advertiser "Your deals by display type": one group per display type the advertiser's deals are on (shopper-journey
// order), one row per deal beneath it. Open auction plays are not on a deal and are not included. A deal row's Share is
// the advertiser's plays won of all plays on that deal there (other buyers only as a count, never named); a group's
// Share is its share of the advertiser's deal spend (whole numbers adding to 100). Parts are rounded first. Settled (earned) rows only, like every retailer figure.
module.exports = {
  path: '/deals-by-display-type',
  advertiserAccess: true,
  handler({ store, filters }) {
    const me = ownAdvertiser(filters);
    // Dense tables over (deal x display type), filled in row order so every sum is the same float as a keyed map would give.
    const nD = store.dealIds.length; const nT = store.typeIds.length; const nA = store.advIds.length;
    const meIx = store.advCode.get(me);
    const all = new Float64Array(nD * nT); const minePlays = new Float64Array(nD * nT); const mineViews = new Float64Array(nD * nT); const mineRev = new Float64Array(nD * nT);
    const mineSeen = new Uint8Array(nD * nT);
    const otherFlag = new Uint8Array(nD * nT * nA); const otherCount = new Int32Array(nD * nT); // distinct other advertisers with plays won
    const ownRows = [];
    store.scanDelivery({ ...filters, advertiserIds: null }, (r) => {
      if (isOpenAuction(r)) return;
      const k = r.dealIx * nT + r.typeIx;
      all[k] += r.earnedSlots;
      if (r.advIx !== meIx) {
        if (r.earnedSlots > 0) { const f = k * nA + r.advIx; if (!otherFlag[f]) { otherFlag[f] = 1; otherCount[k] += 1; } }
        return;
      }
      mineSeen[k] = 1; minePlays[k] += r.earnedSlots; mineViews[k] += r.earnedViews; mineRev[k] += r.earned;
      ownRows.push(r);
    });
    const cell = (dealId, typeId) => { const d = store.dealCode.get(dealId); const t = store.typeCode.get(typeId); return d === undefined || t === undefined ? -1 : d * nT + t; };
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
      const tf = facts.get(typeId);
      const loopSlotCount = tf && tf.loop ? tf.loop.slotsPerLoop : null; // a display type fact, safe for an advertiser
      const rows = [];
      for (const deal of deals) {
        const slots = (deal.slots || []).filter((s) => s.displayTypeId === typeId);
        const k = cell(deal.id, typeId);
        const m = k >= 0 && mineSeen[k] ? { plays: minePlays[k], views: mineViews[k], rev: mineRev[k] } : undefined;
        if (!slots.length && !m) continue;
        for (const s of slots) slotsHere.add(slotKey(s));
        const own = m || { plays: 0, views: 0, rev: 0 };
        const allPlays = k >= 0 ? all[k] : 0;
        const buyers = (deal.buyers || []).filter((b) => b.advertiserId === me);
        const advertisersOnDeal = new Set([me, ...(deal.buyers || []).map((b) => b.advertiserId)]).size;
        const row = {
          id: deal.id, name: deal.name, description: deal.description, dealType: deal.dealType,
          dealIds: dealIdsFor(deal, buyers), // only the advertiser's own DSP
          slots: {
            count: new Set(slots.map(slotKey)).size,
            assigned: slots.map((s) => ({
              playlist: s.playlist, zone: s.zone, playlistZone: `${s.playlist} · ${s.zone}`,
              advertiserSlot: s.position, loopSlot: s.loopSlot, loopSlotCount, label: `Advertiser slot ${s.position} (loop slot ${s.loopSlot})`, playsPerWindow: s.playsPerWindow,
            })),
          },
          playsWon: own.plays, assumedViews: Math.round(own.views), spend: cents(own.rev),
          share: { playsWon: own.plays, advertisersOnDeal },
        };
        // One other buyer winning here would make allPlays minus playsWon that buyer's plays: omit allPlays and the percent.
        const winners = k >= 0 ? otherCount[k] : 0;
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
