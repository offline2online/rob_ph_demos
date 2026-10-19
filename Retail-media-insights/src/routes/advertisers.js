'use strict';
const calc = require('../calc');
const { dealsOf, slotKey, rollUp, opportunities, slotsWonComplete, RETENTION_DAYS, cents } = require('../dealing');
const { describeCampaign, upliftFor } = require('../uplift');

// iROAS per advertiser: the Sales uplift calculation (src/uplift.js) rolled up over the advertiser's campaigns that ran in
// the applied range (and on the filtered stores and display types). Only campaigns that excluded the Control stores segment
// and have POS sales are measured; their spend, not the others', is the denominator. `value` is null when nothing was measured.
function iroasOf(store, filters) {
  const lastDay = store.lastPlayedDay;
  const wantedTypes = filters.displayTypeIds ? new Set(filters.displayTypeIds) : null;
  const wantedStores = filters.storeIds ? new Set(filters.storeIds) : null;
  const all = store.campaigns.filter((c) => c.start <= lastDay).map((c) => describeCampaign(c, store, lastDay));
  const inRange = all.filter((c) => c.start <= filters.dateTo && c.flightEnd >= filters.dateFrom
    && (!wantedTypes || !c.displayTypeIds || c.displayTypeIds.some((t) => wantedTypes.has(t)))
    && (!wantedStores || c.campaignStores.some((s) => wantedStores.has(s))));
  const byAdv = new Map();
  let anyPos = false;
  for (const c of inRange) {
    if (!byAdv.has(c.advertiserId)) byAdv.set(c.advertiserId, { incrementalSales: 0, measuredSpend: 0, measured: [], notMeasured: [], flagged: [], from: null, to: null, stores: new Set(), control: new Set() });
    const a = byAdv.get(c.advertiserId);
    const label = { campaignId: c.id, product: c.product.name };
    if (!c.excludesControl) { a.notMeasured.push({ ...label, reason: 'No control stores set' }); continue; }
    const r = upliftFor(store, c, all);
    if (!r.transactions) { a.notMeasured.push({ ...label, reason: 'No sales data' }); continue; }
    anyPos = true;
    a.incrementalSales += r.incremental; a.measuredSpend += r.spend; a.measured.push(c.id);
    if (c.matchedOn !== 'sku') a.flagged.push({ ...label, reason: 'Matched on product name' });
    const from = c.start > filters.dateFrom ? c.start : filters.dateFrom; const to = c.flightEnd < filters.dateTo ? c.flightEnd : filters.dateTo;
    if (!a.from || from < a.from) a.from = from; if (!a.to || to > a.to) a.to = to;
    c.campaignStores.forEach((s) => a.stores.add(s)); c.controlStores.forEach((s) => a.control.add(s));
  }
  const out = new Map();
  for (const [id, a] of byAdv) {
    out.set(id, {
      value: a.measured.length && a.measuredSpend > 0 ? Math.round((a.incrementalSales / a.measuredSpend) * 100) / 100 : null,
      incrementalSales: cents(a.incrementalSales), measuredSpend: cents(a.measuredSpend),
      measuredCampaigns: a.measured.length, totalCampaigns: a.measured.length + a.notMeasured.length,
      notMeasured: a.notMeasured, flagged: a.flagged,
      campaignStores: a.stores.size, controlStores: a.control.size, dateFrom: a.from, dateTo: a.to,
    });
  }
  return { byAdv: out, anyPos };
}

// Demand by DSP seat, one level below advertiser and DSP: the seat that won each play (the buying account inside a DSP, usually held by
// the advertiser's agency or trading desk), read from the seat on every settled billing row. Spend, plays and CPM are exact; the
// seats of an advertiser add up to its row (the cent left by rounding goes to its largest seat). A seat missing from the DSP's latest
// sync keeps its history (`synced: false`). Direct advertisers have no seat. Retailer view only: advertiser logins never reach this route.
function seatsOf(store, filters, scope) {
  const catalog = (store.catalog && store.catalog.seats) || {};
  const names = store.advertisers || {};
  const deals = (store.catalog && store.catalog.deals) || {};
  const bySeat = new Map(); // seatId -> { advertiserId -> { earned, views, plays, dealIds, first, last } }
  const advertisersOnSeat = new Map();
  store.scanDelivery({ ...filters, advertiserIds: null }, (r) => {
    if (!r.seatId || (r.earned <= 0 && r.earnedSlots <= 0)) return;
    if (!advertisersOnSeat.has(r.seatId)) advertisersOnSeat.set(r.seatId, new Set());
    advertisersOnSeat.get(r.seatId).add(r.advertiserId);
    if (scope && !scope.has(r.advertiserId)) return;
    if (!bySeat.has(r.seatId)) bySeat.set(r.seatId, new Map());
    const m = bySeat.get(r.seatId);
    let a = m.get(r.advertiserId);
    if (!a) { a = { earned: 0, earnedViews: 0, plays: 0, dealIds: new Set(), first: r.date, last: r.date }; m.set(r.advertiserId, a); }
    a.earned += r.earned; a.earnedViews += r.earnedViews; a.plays += r.slots;
    if (r.dealType !== 'Open auction') a.dealIds.add(r.dealId);
    if (r.date < a.first) a.first = r.date; if (r.date > a.last) a.last = r.date;
  });
  const byAdv = new Map();
  for (const [seatId, m] of bySeat) {
    const seat = catalog[seatId] || {};
    const seatAdvertisers = [...(advertisersOnSeat.get(seatId) || [])].map((id) => (names[id] || {}).name || id).sort((x, y) => x.localeCompare(y));
    for (const [advertiserId, a] of m) {
      if (!byAdv.has(advertiserId)) byAdv.set(advertiserId, []);
      byAdv.get(advertiserId).push({
        seatId, name: seat.name || seatId, dsp: seat.dsp || null, synced: seat.synced !== false,
        revenue: cents(a.earned), revenueRaw: a.earned, plays: Math.round(a.plays),
        dealsOn: [...a.dealIds].map((id) => ({ id, name: (deals[id] || {}).name || id, dealType: (deals[id] || {}).dealType || null })),
        effectiveCpm: a.earnedViews > 0 ? cents(calc.effectiveCpm(a.earned, a.earnedViews)) : null,
        firstWin: a.first, lastWin: a.last, advertisersBought: seatAdvertisers.length, advertiserNames: seatAdvertisers,
      });
    }
  }
  return byAdv;
}

// Demand health: earned revenue, share of total earned (whole numbers adding to 100), deals on, slots covered,
// slots won %, effective CPM (settled billing only) and DSP. `top` is the ten highest by revenue, `all` is everyone.
// Slots covered and Slots won count only the advertiser's deal positions on the filtered display types, and
// Slots won only its own wins on those deals (not wins there from other deals or the open auction). With no
// opportunity, Slots won is null. `iroas` is the incremental return on ad spend (see iroasOf); `posData` is false when no
// campaign in the range had any POS sales to measure. There is no cap: a figure above 100 would be a data error to fix, not hide.
module.exports = {
  path: '/advertisers',
  handler({ store, filters, principal }) {
    const scope = filters.advertiserIds ? new Set(filters.advertiserIds) : null;
    const meta = store.advertisers || {};
    const roll = rollUp(store, filters);
    const opp = opportunities(store, filters);
    const deals = dealsOf(store);
    const wantedTypes = filters.displayTypeIds ? new Set(filters.displayTypeIds) : null;
    const iroas = iroasOf(store, filters);
    const retailer = !principal || principal.principalType !== 'advertiser'; // seat data names other advertisers: never in an advertiser's response
    const seatRows = retailer ? seatsOf(store, filters, scope) : new Map();
    const advertiserSeats = (store.catalog && store.catalog.advertiserSeats) || {};
    const ids = new Set(roll.byAdv.keys());
    for (const d of deals) for (const b of d.buyers || []) if (!scope || scope.has(b.advertiserId)) ids.add(b.advertiserId);
    const list = [...ids].map((id) => {
      const mine = deals.filter((d) => d.dealType !== 'Open auction' && (d.buyers || []).some((b) => b.advertiserId === id));
      const slots = new Map();
      let won = 0;
      for (const d of mine) {
        const assigned = (d.slots || []).filter((s) => !wantedTypes || wantedTypes.has(s.displayTypeId));
        for (const s of assigned) slots.set(slotKey(s), s.displayTypeId);
        for (const t of new Set(assigned.map((s) => s.displayTypeId))) won += roll.slotsOnAdvDealType(id, d.id, t);
      }
      let opportunity = 0; for (const k of slots.keys()) opportunity += opp.perPosition(slots.get(k));
      const a = roll.byAdv.get(id) || { revenue: 0, earned: 0, earnedViews: 0 };
      const buyer = mine.flatMap((d) => d.buyers).find((b) => b.advertiserId === id);
      const seats = (seatRows.get(id) || []).sort((x, y) => y.revenueRaw - x.revenueRaw || x.name.localeCompare(y.name));
      // The seats add up to the advertiser's row: a rounding cent goes to the largest seat; each seat's share of the advertiser's spend is a whole percent.
      if (seats.length) seats[0].revenue = cents(seats[0].revenue + (cents(a.earned) - seats.reduce((n, x) => n + x.revenue, 0)));
      const seatShares = calc.percentSplit(seats.map((x) => x.revenueRaw));
      return {
        advertiserId: id, name: (meta[id] || {}).name || id, dsp: (meta[id] || {}).dsp || (buyer && buyer.dsp) || null,
        revenue: cents(a.earned), revenueRaw: a.earned,
        direct: retailer && !(advertiserSeats[id] || []).length && !seats.length,
        seatCount: seats.length,
        seats: seats.map(({ revenueRaw, ...x }, i) => ({ ...x, share: seatShares[i] })),
        dealsOn: mine.map((d) => ({ id: d.id, name: d.name, dealType: d.dealType })).sort((x, y) => calc.compareDealTypes(x.dealType, y.dealType)),
        slotsCovered: slots.size,
        slotsWonPercent: opportunity > 0 ? calc.wholePercent(won, opportunity) : null,
        slotsWonCount: won, slotsOpportunity: Math.round(opportunity),
        effectiveCpm: a.earnedViews > 0 ? cents(calc.effectiveCpm(a.earned, a.earnedViews)) : null,
        iroas: iroas.byAdv.get(id) || { value: null, incrementalSales: 0, measuredSpend: 0, measuredCampaigns: 0, totalCampaigns: 0, notMeasured: [], flagged: [], campaignStores: 0, controlStores: 0, dateFrom: null, dateTo: null },
      };
    }).sort((x, y) => y.revenueRaw - x.revenueRaw || x.name.localeCompare(y.name));
    const shares = calc.percentSplit(list.map((x) => x.revenueRaw));
    const all = list.map(({ revenueRaw, ...x }, i) => ({ ...x, share: shares[i] }));
    return { posData: iroas.anyPos, slotsWon: { complete: slotsWonComplete(filters), retentionDays: RETENTION_DAYS }, top: all.slice(0, 10), all };
  },
};
