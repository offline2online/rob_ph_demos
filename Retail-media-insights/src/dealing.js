'use strict';
// Shared by the deals and advertisers endpoints: delivery roll-ups, slot opportunities and PG pacing.
// Reference data (deals, slot assignments, buyers) is read from store.catalog.deals, which the source
// adapter will fill from DSP Integration; today it comes from the test catalog.

const calc = require('./calc');
const { DSPS, DSP_LABELS } = require('./constants');
const { days } = require('./filters');

const RETENTION_DAYS = 90; // settled-bid retention (README open question 3)
const DAY = 86400000;
const toMs = (d) => Date.parse(`${d}T00:00:00Z`);
const dayDiff = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY);
const cents = (n) => Math.round(n * 100) / 100;

const addDays = (d, n) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);
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
 * by deal x display type (`slotsByAdvDealType`, so wins can be limited to the positions of the deals it is on).
 */
function rollUp(store, filters) {
  const byDeal = new Map(); const byAdv = new Map(); const slotsByDealType = new Map(); const slotsByAdvDealType = new Map();
  const add = (m, k, r) => {
    const b = m.get(k) || { revenue: 0, earned: 0, earnedViews: 0, views: 0, slots: 0 };
    b.revenue += r.revenue; b.earned += r.earned; b.earnedViews += r.earnedViews; b.views += r.views; b.slots += r.slots;
    m.set(k, b);
  };
  store.scanDelivery(filters, (r) => {
    add(byDeal, r.dealId, r); add(byAdv, r.advertiserId, r);
    const dk = `${r.dealId}#${r.displayTypeId}`; const ak = `${r.advertiserId}#${dk}`;
    slotsByDealType.set(dk, (slotsByDealType.get(dk) || 0) + r.slots);
    slotsByAdvDealType.set(ak, (slotsByAdvDealType.get(ak) || 0) + r.slots);
  });
  return { byDeal, byAdv, slotsByDealType, slotsByAdvDealType };
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
  const windows = new Map();
  let from = null;
  for (const d of pgDeals) {
    if (!d.flight || filters.dateTo < d.flight.start) continue;
    windows.set(d.id, { start: d.flight.start, end: filters.dateTo < d.flight.end ? filters.dateTo : d.flight.end });
    delivered.set(d.id, 0);
    if (from === null || d.flight.start < from) from = d.flight.start;
  }
  if (from === null) return delivered;
  store.scanDelivery({ dateFrom: from, dateTo: filters.dateTo, storeIds: null, displayTypeIds: null, advertiserIds: null }, (r) => {
    const w = windows.get(r.dealId);
    if (w && r.date >= w.start && r.date <= w.end) delivered.set(r.dealId, delivered.get(r.dealId) + r.earnedViews);
  });
  return delivered;
}

/** PG pacing as at dateTo: before, during or after the flight. `delivered` is settled VAC-d from flight start to then, deal-wide. */
function pacingOf(deal, deliveredViews, filters) {
  const { flight } = deal;
  const flightDays = dayDiff(flight.start, flight.end) + 1;
  const started = filters.dateTo >= flight.start;
  const daysElapsed = started ? Math.min(dayDiff(flight.start, filters.dateTo) + 1, flightDays) : 0;
  const delivered = started ? deliveredViews || 0 : 0;
  const p = calc.pgPacing({ delivered, forecast: deal.forecast, buffer: deal.buffer, daysElapsed, totalDays: flightDays });
  return {
    flightStart: flight.start, flightEnd: flight.end, flightDays, daysElapsed,
    daysRemaining: flightDays - daysElapsed,
    startsInDays: started ? null : dayDiff(filters.dateTo, flight.start),
    flightEnded: filters.dateTo > flight.end,
    forecast: deal.forecast, buffer: deal.buffer,
    guaranteedForFlight: Math.round(calc.guaranteedVolume(deal.forecast, deal.buffer)),
    guaranteedToDate: Math.round(p.guaranteedToDate),
    delivered: Math.round(delivered),
    percent: started && p.guaranteedToDate > 0 ? Math.round(p.pacing * 100) : null,
    scope: 'deal',
  };
}

/** Slots won comes from settled bids, kept for 90 days only: a longer range is flagged incomplete. */
const slotsWonComplete = (filters) => days(filters) <= RETENTION_DAYS;

module.exports = { addDays, eachDay, dayDiff, dealIdsFor, dealsOf, slotKey, rollUp, opportunities, deliveredByDeal, pacingOf, slotsWonComplete, RETENTION_DAYS, cents };
