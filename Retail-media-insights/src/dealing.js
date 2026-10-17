'use strict';
// Shared by the deals and advertisers endpoints: delivery roll-ups, slot opportunities and PG pacing.
// Reference data (deals, slot assignments, buyers) is read from store.catalog.deals, which the source
// adapter will fill from DSP Integration; today it comes from the test catalog.

const calc = require('./calc');
const { DSPS } = require('./constants');
const { days } = require('./filters');

const RETENTION_DAYS = 90; // settled-bid retention (README open question 3)
const DAY = 86400000;
const toMs = (d) => Date.parse(`${d}T00:00:00Z`);
const dayDiff = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY);
const cents = (n) => Math.round(n * 100) / 100;

const addDays = (d, n) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);
const eachDay = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

/** One PH- deal ID per DSP that has one of the given buyers, in the standard DSP order. */
const dealIdsFor = (deal, buyers) => DSPS.filter((d) => buyers.some((b) => b.dsp === d))
  .map((d) => ({ dsp: d, dealId: `${deal.phId}-${d.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}` }));

const dealsOf = (store) => Object.entries((store.catalog && store.catalog.deals) || {}).map(([id, d]) => ({ id, ...d }));
const slotKey = (s) => `${s.displayTypeId}#${s.position}`;

/** Delivery grouped by deal and by advertiser, plus slots delivered by deal x display type. */
function rollUp(store, filters) {
  const byDeal = new Map(); const byAdv = new Map(); const slotsByDealType = new Map(); const slotsByAdvType = new Map();
  const add = (m, k, r) => {
    const b = m.get(k) || { revenue: 0, earned: 0, earnedViews: 0, views: 0, slots: 0 };
    b.revenue += r.revenue; b.earned += r.earned; b.earnedViews += r.earnedViews; b.views += r.views; b.slots += r.slots;
    m.set(k, b);
  };
  store.scanDelivery(filters, (r) => {
    add(byDeal, r.dealId, r); add(byAdv, r.advertiserId, r);
    slotsByDealType.set(`${r.dealId}#${r.displayTypeId}`, (slotsByDealType.get(`${r.dealId}#${r.displayTypeId}`) || 0) + r.slots);
    slotsByAdvType.set(`${r.advertiserId}#${r.displayTypeId}`, (slotsByAdvType.get(`${r.advertiserId}#${r.displayTypeId}`) || 0) + r.slots);
  });
  return { byDeal, byAdv, slotsByDealType, slotsByAdvType };
}

/**
 * Slot opportunities per display type inside operating hours: sold + unsold slot records. Records carry
 * no position, so they are split equally across the type's advertiser positions (SERVICE.md).
 */
function opportunities(store, filters) {
  const perType = new Map();
  store.scanInventory(filters, (r) => perType.set(r.displayTypeId, (perType.get(r.displayTypeId) || 0) + r.sold + r.unsold));
  const perPosition = (typeId) => {
    const adv = (((store.catalog.displayTypes || {})[typeId] || {}).slots || {}).advertiser;
    return (perType.get(typeId) || 0) / Math.max((adv && adv.count) || 1, 1);
  };
  return { perPosition };
}

/** PG pacing as at dateTo: before, during or after the flight. `delivered` is VAC-d views from flight start to then. */
function pacingOf(deal, store, filters) {
  const { flight } = deal;
  const flightDays = dayDiff(flight.start, flight.end) + 1;
  const started = filters.dateTo >= flight.start;
  const daysElapsed = started ? Math.min(dayDiff(flight.start, filters.dateTo) + 1, flightDays) : 0;
  let delivered = 0;
  if (started) {
    const upTo = filters.dateTo < flight.end ? filters.dateTo : flight.end;
    store.scanDelivery({ ...filters, dateFrom: flight.start, dateTo: upTo, advertiserIds: null }, (r) => { if (r.dealId === deal.id) delivered += r.views; });
  }
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
  };
}

/** Slots won comes from settled bids, kept for 90 days only: a longer range is flagged incomplete. */
const slotsWonComplete = (filters) => days(filters) <= RETENTION_DAYS;

module.exports = { addDays, eachDay, dayDiff, dealIdsFor, dealsOf, slotKey, rollUp, opportunities, pacingOf, slotsWonComplete, RETENTION_DAYS, cents };
