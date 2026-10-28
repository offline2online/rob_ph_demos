'use strict';
const calc = require('../calc');
const { displayTypeFacts, hoverCard } = require('../display-types');
const { termOf } = require('../deal-terms');
const { dealIdsFor, slotKey, slotsWonComplete, RETENTION_DAYS } = require('../dealing');
const { MIN_OTHER_BUYERS_FOR_WINNING_CPM, DIRECT } = require('../constants');
const { OPEN_AUCTION, ownAdvertiser, isOpenAuction, dealsInScope, cents, winningRange } = require('../advertiser-view');

// Advertiser "Your deals by display type": one group per display type the advertiser's deals are on (shopper-journey
// order), one row per deal beneath it, then an Open auction row on each display type the advertiser's campaigns run on (or has won
// open auction plays on). A row of an auction (private or open) also carries the winning CPM range (p25 / median / p75 of every
// winning buyer's cleared CPM there, in aggregate only, and only with at least MIN_OTHER_BUYERS_FOR_WINNING_CPM other winners);
// Programmatic guaranteed and Preferred deal rows are fixed price and carry none. A deal row's Share is
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
    // Revenue and views per winning buyer (advertiser x deal x display type; the open auction's are per display type), from which each
    // buyer's cleared CPM and so the winning CPM range is read, only for a range that is actually shown. Never keyed out of the service.
    const buyerRev = new Float64Array(nD * nT * nA); const buyerViews = new Float64Array(nD * nT * nA);
    const openRev = new Float64Array(nT * nA); const openViews = new Float64Array(nT * nA);
    const openAll = new Float64Array(nT); const openMine = new Map(); const openOthers = Array.from({ length: nT }, () => new Set());
    const cpmsAt = (rev, views, base) => { const out = []; for (let a = 0; a < nA; a += 1) if (views[base + a] > 0) out.push(calc.effectiveCpm(rev[base + a], views[base + a])); return out; };
    store.scanDelivery({ ...filters, advertiserIds: null }, (r) => {
      if (isOpenAuction(r)) {
        openAll[r.typeIx] += r.earnedSlots;
        if (r.earnedSlots > 0 && r.earnedViews > 0) { openRev[r.typeIx * nA + r.advIx] += r.earned; openViews[r.typeIx * nA + r.advIx] += r.earnedViews; }
        if (r.advIx !== meIx) { if (r.earnedSlots > 0) openOthers[r.typeIx].add(r.advIx); return; }
        let m = openMine.get(r.typeIx); if (!m) { m = { plays: 0, views: 0, rev: 0 }; openMine.set(r.typeIx, m); }
        m.plays += r.earnedSlots; m.views += r.earnedViews; m.rev += r.earned;
        return;
      }
      const k = r.dealIx * nT + r.typeIx;
      all[k] += r.earnedSlots;
      if (r.earnedSlots > 0 && r.earnedViews > 0) { buyerRev[k * nA + r.advIx] += r.earned; buyerViews[k * nA + r.advIx] += r.earnedViews; }
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
    // Open auction: the display types the advertiser's campaigns run on (within its scope), plus any it has won open plays on.
    const openTypeIds = new Set();
    // A direct advertiser buys its slots from the retailer, not through a DSP, so it never takes part in the open auction.
    if (((store.advertisers || {})[me] || {}).dsp !== DIRECT) store.scanCampaigns(filters, (c) => { for (const t of c.displayTypeIds || []) openTypeIds.add(t); });
    for (const t of openMine.keys()) openTypeIds.add(store.typeIds[t]);
    for (const t of [...openTypeIds]) if ((inScope && !inScope.has(t)) || !known[t]) openTypeIds.delete(t); else typeIds.add(t);
    for (const t of [...typeIds]) if ((inScope && !inScope.has(t)) || !known[t]) typeIds.delete(t);

    const facts = new Map(displayTypeFacts(store, { ...filters, displayTypeIds: [...typeIds] }).map((t) => [t.id, t]));
    const ordered = [...facts.keys(), ...[...typeIds].filter((t) => !facts.has(t)).sort((a, b) => String(known[a].name).localeCompare(String(known[b].name)))];

    // The deal hover: the deal's rate, flight and, per assigned slot (within the display type filter), plays, VAC-d and value over the
    // term, then the deal total. The deal's own facts only; no other advertiser appears.
    const termCache = new Map(); const types2 = known;
    const termsOf = (deal) => {
      if (termCache.has(deal.id)) return termCache.get(deal.id);
      const assigned = (deal.slots || []).filter((s) => !inScope || inScope.has(s.displayTypeId));
      const t = termOf(store, filters, deal, assigned);
      const out = {
        rate: t.rate == null ? null : { value: cents(t.rate), kind: deal.dealType === 'Private auction' ? 'floor' : 'fixed' }, term: t.term,
        slots: assigned.map((s, i) => ({ displayType: (types2[s.displayTypeId] || {}).name || s.displayTypeId, advertiserSlot: s.position, termPlays: t.per[i].plays, termVacd: t.per[i].vacd, termValue: t.per[i].value })),
      };
      termCache.set(deal.id, out);
      return out;
    };

    // The advertiser slot positions of a display type that no deal assigns: the open auction plays on these. Positions only (no deal
    // or buyer is named); playlist, zone and plays per window are the display type's, read from any slot assigned on it.
    const catalogDeals = Object.values((store.catalog && store.catalog.deals) || {});
    const unassignedSlots = (typeId, loopSlotCount) => {
      const adv = ((known[typeId] || {}).slots || {}).advertiser;
      const onType = catalogDeals.flatMap((d) => (d.slots || []).filter((s) => s.displayTypeId === typeId));
      const taken = new Set(onType.map((s) => s.position));
      const like = onType[0] || {};
      const out = [];
      for (let position = 1; adv && position <= adv.count; position += 1) {
        if (taken.has(position)) continue;
        out.push(slotDetail({ playlist: like.playlist, zone: like.zone, position, loopSlot: position, playsPerWindow: like.playsPerWindow }, loopSlotCount));
      }
      return out;
    };
    const slotDetail = (s, loopSlotCount) => ({
      playlist: s.playlist, zone: s.zone, playlistZone: s.playlist ? `${s.playlist} \u00b7 ${s.zone}` : undefined,
      advertiserSlot: s.position, loopSlot: s.loopSlot, loopSlotCount, label: `Advertiser slot ${s.position} (loop slot ${s.loopSlot})`, playsPerWindow: s.playsPerWindow,
    });

    const groups = ordered.map((typeId) => {
      const slotsHere = new Set();
      const slotsHereList = new Map();
      const tf = facts.get(typeId);
      const loopSlotCount = tf && tf.loop ? tf.loop.slotsPerLoop : null; // a display type fact, safe for an advertiser
      const rows = [];
      for (const deal of deals) {
        const slots = (deal.slots || []).filter((s) => s.displayTypeId === typeId);
        const k = cell(deal.id, typeId);
        const m = k >= 0 && mineSeen[k] ? { plays: minePlays[k], views: mineViews[k], rev: mineRev[k] } : undefined;
        if (!slots.length && !m) continue;
        for (const s of slots) { slotsHere.add(slotKey(s)); if (!slotsHereList.has(slotKey(s))) slotsHereList.set(slotKey(s), s); }
        const own = m || { plays: 0, views: 0, rev: 0 };
        const allPlays = k >= 0 ? all[k] : 0;
        const buyers = (deal.buyers || []).filter((b) => b.advertiserId === me);
        const advertisersOnDeal = new Set([me, ...(deal.buyers || []).map((b) => b.advertiserId)]).size;
        const row = {
          id: deal.id, name: deal.name, description: deal.description, dealType: deal.dealType,
          dealIds: dealIdsFor(deal, buyers), // only the advertiser's own DSP
          slots: {
            count: new Set(slots.map(slotKey)).size,
            assigned: slots.map((s) => slotDetail(s, loopSlotCount)),
          },
          playsWon: own.plays, assumedViews: Math.round(own.views), spend: cents(own.rev),
          share: { playsWon: own.plays, advertisersOnDeal },
          terms: termsOf(deal),
        };
        // One other buyer winning here would make allPlays minus playsWon that buyer's plays: omit allPlays and the percent.
        const winners = k >= 0 ? otherCount[k] : 0;
        const hideShare = winners >= 1 && winners < MIN_OTHER_BUYERS_FOR_WINNING_CPM;
        if (!hideShare) row.share.allPlays = allPlays;
        if (own.views > 0) row.effectiveCpm = cents(calc.effectiveCpm(own.rev, own.views));
        if (!hideShare && allPlays > 0) row.share.percent = calc.wholePercent(own.plays, allPlays);
        // Fixed-price deals have no auction and so no range; an auction's range needs enough other winners (see the header).
        if (deal.dealType === 'Private auction' && winners >= MIN_OTHER_BUYERS_FOR_WINNING_CPM) {
          const range = winningRange(cpmsAt(buyerRev, buyerViews, k * nA));
          if (range) row.winningCpm = range;
        }
        rows.push(row);
      }
      // The open auction on this display type, listed last: its slots are the advertiser slots no deal assigns, plays won of all open auction plays there. Like
      // Delivery's open auction block it is kept out of the group's own totals (which stay the deals', so deals + open auction = Delivery).
      let openRow = null;
      const tIx = store.typeCode.get(typeId);
      if (openTypeIds.has(typeId)) {
        const m = (tIx !== undefined && openMine.get(tIx)) || { plays: 0, views: 0, rev: 0 };
        const winners = tIx !== undefined ? openOthers[tIx].size : 0;
        const hideShare = winners >= 1 && winners < MIN_OTHER_BUYERS_FOR_WINNING_CPM;
        // Open auction plays run on the advertiser slots no deal assigns: those are the slots shown, once the advertiser has won plays there.
        const openSlots = m.plays > 0 ? unassignedSlots(typeId, loopSlotCount) : [];
        const row = {
          id: OPEN_AUCTION, name: 'Open auction', description: 'Any buyer bids per slot against the display type\u2019s floor.', dealType: 'Open auction',
          dealIds: [], slots: { count: openSlots.length, assigned: openSlots }, terms: null,
          playsWon: m.plays, assumedViews: Math.round(m.views), spend: cents(m.rev),
          share: { playsWon: m.plays },
        };
        if (!hideShare && tIx !== undefined) row.share.allPlays = openAll[tIx];
        if (m.views > 0) row.effectiveCpm = cents(calc.effectiveCpm(m.rev, m.views));
        if (!hideShare && tIx !== undefined && openAll[tIx] > 0) row.share.percent = calc.wholePercent(m.plays, openAll[tIx]);
        if (tIx !== undefined && winners >= MIN_OTHER_BUYERS_FOR_WINNING_CPM) {
          const range = winningRange(cpmsAt(openRev, openViews, tIx * nA));
          if (range) row.winningCpm = range;
        }
        openRow = row;
      }
      rows.sort((a, b) => calc.compareDealTypes(a.dealType, b.dealType) || a.name.localeCompare(b.name));
      const spend = cents(rows.reduce((s, r) => s + r.spend, 0));
      const views = rows.reduce((s, r) => s + r.assumedViews, 0);
      const t = facts.get(typeId);
      const group = {
        displayType: t ? hoverCard(t) : { id: typeId, name: known[typeId].name },
        dealCount: rows.length, slots: slotsHere.size,
        slotsAssigned: [...slotsHereList.values()].sort((a, b) => a.position - b.position).map((x) => slotDetail(x, loopSlotCount)),
        playsWon: rows.reduce((s, r) => s + r.playsWon, 0), assumedViews: views, spend, deals: openRow ? [...rows, openRow] : rows,
      };
      if (views > 0) group.effectiveCpm = cents(calc.effectiveCpm(spend, views));
      // The display type's own range: every winning buyer's cleared CPM on its private auction deals and the open auction here,
      // when at least MIN_OTHER_BUYERS_FOR_WINNING_CPM distinct other buyers won across them.
      const pooled = []; const others = new Set();
      const tIx2 = store.typeCode.get(typeId);
      for (const deal of deals) {
        if (deal.dealType !== 'Private auction' || !rows.some((r) => r.id === deal.id)) continue;
        const k = cell(deal.id, typeId);
        if (k < 0) continue;
        for (let a = 0; a < nA; a += 1) if (a !== meIx && otherFlag[k * nA + a]) others.add(a);
      }
      if (tIx2 !== undefined && openTypeIds.has(typeId)) for (const a of openOthers[tIx2]) others.add(a);
      if (others.size >= MIN_OTHER_BUYERS_FOR_WINNING_CPM) {
        for (const deal of deals) {
          if (deal.dealType !== 'Private auction' || !rows.some((r) => r.id === deal.id)) continue;
          const k = cell(deal.id, typeId);
          if (k >= 0) pooled.push(...cpmsAt(buyerRev, buyerViews, k * nA));
        }
        if (tIx2 !== undefined && openTypeIds.has(typeId)) pooled.push(...cpmsAt(openRev, openViews, tIx2 * nA));
        const range = winningRange(pooled); if (range) group.winningCpm = range;
      }
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
