'use strict';
// Shared by the deals and advertisers endpoints: delivery roll-ups, slot opportunities and PG pacing.
// Reference data (deals, slot assignments, buyers) is read from store.catalog.deals, which the source
// adapter will fill from DSP Integration; today it comes from the test catalog.

const calc = require('./calc');
const { DSPS, DSP_LABELS } = require('./constants');
const { days } = require('./filters');

const RETENTION_DAYS = 90; // settled-bid retention (README open question 3)
const DAY = 86400000;
// Date arithmetic runs thousands of times per request (a day loop per deal): memoised, cleared if it ever grows large.
const msCache = new Map(); const isoCache = new Map();
const toMs = (d) => { let ms = msCache.get(d); if (ms === undefined) { if (msCache.size > 50000) msCache.clear(); ms = Date.parse(`${d}T00:00:00Z`); msCache.set(d, ms); } return ms; };
const isoOf = (ms) => { let d = isoCache.get(ms); if (d === undefined) { if (isoCache.size > 50000) isoCache.clear(); d = new Date(ms).toISOString().slice(0, 10); isoCache.set(ms, d); } return d; };
const dayNumber = (d) => Math.round(toMs(d) / DAY);
const dayDiff = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY);
// Rounded to the cent after settling float noise (1e-6), so the order a sum was added in never decides a half cent.
const cents = (n) => Math.round(Math.round(n * 1e6) / 1e4) / 100;

const addDays = (d, n) => isoOf(toMs(d) + n * DAY);
const eachDay = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

/**
 * The deal's IDs, one per DSP that has one of the given buyers, in the standard DSP order. Read from the
 * catalog deal's per-DSP map (`deal.dealIds`, PH- plus 10 characters); a DSP with no ID on record is left out.
 */
const dealIdsFor = (deal, buyers) => DSPS.filter((d) => buyers.some((b) => b.dsp === d) && (deal.dealIds || {})[d])
  .map((d) => ({ dsp: d, dspLabel: DSP_LABELS[d], dealId: deal.dealIds[d] }));

const dealsOf = (store) => Object.entries((store.catalog && store.catalog.deals) || {}).map(([id, d]) => ({ id, ...d }));
const slotKey = (s) => `${s.displayTypeId}#${s.position}`;

/**
 * Delivery grouped by deal and by advertiser, plus slots won by deal x display type and, for an advertiser,
 * by deal x display type (`slotsOnAdvDealType`, so wins can be limited to the positions of the deals it is on).
 */
function rollUp(store, filters) {
  const nD = store.dealIds.length; const nT = store.typeIds.length; const nA = store.advIds.length;
  // Dense accumulators indexed by the store's integer codes; rows arrive in the same order as before, so every sum is the same float.
  const deal = { revenue: new Float64Array(nD), earned: new Float64Array(nD), earnedViews: new Float64Array(nD), views: new Float64Array(nD), slots: new Float64Array(nD) };
  const adv = { revenue: new Float64Array(nA), earned: new Float64Array(nA), earnedViews: new Float64Array(nA), views: new Float64Array(nA), slots: new Float64Array(nA) };
  const dealSeen = new Uint8Array(nD); const advSeen = new Uint8Array(nA);
  const dealOrder = []; const advOrder = [];
  const dealType = new Float64Array(nD * nT);
  // adv x deal x type is dense up to 4M cells (32 MB); an estate bigger than that falls back to a sparse map on the same numeric key.
  const adSize = nA * nD * nT;
  const advDealType = adSize <= 4194304 ? new Float64Array(adSize) : new Map();
  const dense = advDealType instanceof Float64Array;
  store.scanDelivery(filters, (r) => {
    const d = r.dealIx; const a = r.advIx;
    if (!dealSeen[d]) { dealSeen[d] = 1; dealOrder.push(d); }
    if (!advSeen[a]) { advSeen[a] = 1; advOrder.push(a); }
    deal.revenue[d] += r.revenue; deal.earned[d] += r.earned; deal.earnedViews[d] += r.earnedViews; deal.views[d] += r.views; deal.slots[d] += r.slots;
    adv.revenue[a] += r.revenue; adv.earned[a] += r.earned; adv.earnedViews[a] += r.earnedViews; adv.views[a] += r.views; adv.slots[a] += r.slots;
    const dk = d * nT + r.typeIx;
    dealType[dk] += r.slots;
    const ak = a * nD * nT + dk;
    if (dense) advDealType[ak] += r.slots; else advDealType.set(ak, (advDealType.get(ak) || 0) + r.slots);
  });
  const bucket = (g, i) => ({ revenue: g.revenue[i], earned: g.earned[i], earnedViews: g.earnedViews[i], views: g.views[i], slots: g.slots[i] });
  const byDeal = new Map(dealOrder.map((d) => [store.dealIds[d], bucket(deal, d)]));
  const byAdv = new Map(advOrder.map((a) => [store.advIds[a], bucket(adv, a)]));
  // Slots won by deal x display type and by advertiser x deal x display type, read by id (0 when there are none).
  const slotsOnDealType = (dealId, typeId) => {
    const d = store.dealCode.get(dealId); const t = store.typeCode.get(typeId);
    return d === undefined || t === undefined ? 0 : dealType[d * nT + t];
  };
  const slotsOnAdvDealType = (advId, dealId, typeId) => {
    const a = store.advCode.get(advId); const d = store.dealCode.get(dealId); const t = store.typeCode.get(typeId);
    return a === undefined || d === undefined || t === undefined ? 0 : (dense ? advDealType[a * nD * nT + d * nT + t] : advDealType.get(a * nD * nT + d * nT + t) || 0);
  };
  return { byDeal, byAdv, slotsOnDealType, slotsOnAdvDealType };
}

/**
 * Slot opportunities per display type inside operating hours: sold + unsold + offline slot records (the
 * same denominator as calc.fillPercent). Records carry no position, so they are split equally across the
 * type's advertiser positions (SERVICE.md).
 */
function opportunities(store, filters) {
  const perType = new Map();
  store.scanInventory(filters, (r) => perType.set(r.displayTypeId, (perType.get(r.displayTypeId) || 0) + r.sold + r.unsold + r.offline));
  const perPosition = (typeId) => {
    const adv = (((store.catalog.displayTypes || {})[typeId] || {}).slots || {}).advertiser;
    return (perType.get(typeId) || 0) / Math.max((adv && adv.count) || 1, 1);
  };
  return { perPosition };
}

/**
 * Delivered (settled) VAC-d per Programmatic guaranteed deal, from flight start to dateTo (or flight end), in ONE
 * pass over the delivery rows grouped by deal. Pacing is a deal-level fact, so the store, display type and
 * advertiser page filters are deliberately ignored: the guarantee and what was delivered cover the same scope.
 */
function deliveredByDeal(store, filters, pgDeals) {
  const delivered = new Map();
  const nD = store.dealIds.length;
  const start = new Float64Array(nD).fill(Infinity); const end = new Float64Array(nD).fill(-Infinity); const total = new Float64Array(nD);
  let from = null;
  for (const d of pgDeals) {
    if (!d.flight || filters.dateTo < d.flight.start || d.flight.end < filters.dateFrom) continue; // not started by dateTo, or ended before the range: cost must not grow with history
    delivered.set(d.id, 0);
    const ix = store.dealCode.get(d.id);
    if (ix !== undefined) { start[ix] = dayNumber(d.flight.start); end[ix] = dayNumber(filters.dateTo < d.flight.end ? filters.dateTo : d.flight.end); }
    if (from === null || d.flight.start < from) from = d.flight.start;
  }
  if (from === null) return delivered;
  store.scanDelivery({ dateFrom: from, dateTo: filters.dateTo, storeIds: null, displayTypeIds: null, advertiserIds: null }, (r) => {
    const x = r.dealIx;
    if (r.dayIx >= start[x] && r.dayIx <= end[x]) total[x] += r.earnedViews;
  });
  for (const d of pgDeals) {
    const ix = store.dealCode.get(d.id);
    // `delivered` starts at 0 and adds in row order, as before; a deal with no rows in the store keeps 0.
    if (delivered.has(d.id) && ix !== undefined) delivered.set(d.id, total[ix]);
  }
  return delivered;
}

/** PG pacing as at dateTo: before, during or after the flight. `delivered` is settled VAC-d from flight start to then, deal-wide. */
function pacingOf(deal, deliveredViews, filters) {
  const { flight } = deal;
  const flightDays = dayDiff(flight.start, flight.end) + 1;
  const started = filters.dateTo >= flight.start;
  const daysElapsed = started ? Math.min(dayDiff(flight.start, filters.dateTo) + 1, flightDays) : 0;
  const delivered = started ? deliveredViews || 0 : 0;
  const unknown = started && deliveredViews === undefined; // flight ended before the range: delivered is not scanned
  const p = calc.pgPacing({ delivered, forecast: deal.forecast, buffer: deal.buffer, daysElapsed, totalDays: flightDays });
  return {
    flightStart: flight.start, flightEnd: flight.end, flightDays, daysElapsed,
    daysRemaining: flightDays - daysElapsed,
    startsInDays: started ? null : dayDiff(filters.dateTo, flight.start),
    flightEnded: filters.dateTo > flight.end,
    forecast: deal.forecast, buffer: deal.buffer,
    guaranteedForFlight: Math.round(calc.guaranteedVolume(deal.forecast, deal.buffer)),
    guaranteedToDate: Math.round(p.guaranteedToDate),
    delivered: unknown ? null : Math.round(delivered),
    percent: started && !unknown && p.guaranteedToDate > 0 ? Math.round(p.pacing * 100) : null,
    scope: 'deal',
  };
}

/** Slots won comes from settled bids, kept for 90 days only: a longer range is flagged incomplete. */
const slotsWonComplete = (filters) => days(filters) <= RETENTION_DAYS;

module.exports = { addDays, eachDay, dayDiff, dayNumber, dealIdsFor, dealsOf, slotKey, rollUp, opportunities, deliveredByDeal, pacingOf, slotsWonComplete, RETENTION_DAYS, cents };
