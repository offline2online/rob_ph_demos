'use strict';
// A deal's term totals per assigned slot (plays, VAC-d, value), shared by the retailer Deals table and the advertiser's deal hover.
const calc = require('./calc');
const { loopOf } = require('./display-types');
const { dayDiff, cents } = require('./dealing');

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
// Plays a slot gives over a deal's term (as DSP Integration's Details hover totals them): plays per window x connected displays
// x hours a day it runs x days in the term. A display counts in every store the page filter allows; null when no display is connected.
const termDays = (flight) => (flight ? dayDiff(flight.start, flight.end) + 1 : null);
function termPlaysOf(store, filters, slot, days) {
  if (days == null || slot.playsPerWindow == null) return null;
  const type = (store.catalog.displayTypes || {})[slot.displayTypeId];
  const stores = filters.storeIds ? new Set(filters.storeIds) : null;
  let hours = 0; let any = false;
  for (const d of store.catalog.displays || []) {
    if (d.displayTypeId !== slot.displayTypeId || (stores && !stores.has(d.storeId))) continue;
    const w = calc.operatingWindow(type || {}, (store.catalog.stores || {})[d.storeId]);
    hours += w.close - w.open; any = true;
  }
  return any ? Math.round(slot.playsPerWindow * hours * days) : null;
}
// VAC-d (assumed views) those plays deliver, display by display: plays x the VAC-d one play delivers there (the display's views per
// slot per day spread over its plays a day). Value is priced on this, never on plays: plays x VAC-d / 1,000 x CPM, as billing does.
// Null when a connected display has no footfall or visibility on record, or the type has no loop.
function termViewsOf(store, filters, slot, days) {
  if (days == null || slot.playsPerWindow == null) return null;
  const type = (store.catalog.displayTypes || {})[slot.displayTypeId];
  const loop = type && loopOf(type.slots);
  if (!loop) return null;
  const stores = filters.storeIds ? new Set(filters.storeIds) : null;
  let views = 0; let any = false;
  for (const d of store.catalog.displays || []) {
    if (d.displayTypeId !== slot.displayTypeId || (stores && !stores.has(d.storeId))) continue;
    if (d.footfall == null || d.visibility == null) return null;
    const w = calc.operatingWindow(type, (store.catalog.stores || {})[d.storeId]);
    const plays = slot.playsPerWindow * (w.close - w.open) * days;
    const daily = calc.assumedViewsPerSlotPerDay(d.footfall, d.visibility, loop.advertiser.avgSeconds, loop.loopSeconds);
    views += calc.playsVacd(plays, calc.vacdPerPlay(daily, slot.playsPerWindow * (w.close - w.open)));
    any = true;
  }
  return any ? views : null;
}
const loopSlotCountOf = (slots) => { const l = loopOf(slots); return l ? l.slotsPerLoop : null; };

/**
 * A deal's rate and term totals for the hover: per assigned slot (display type filter applied by the caller) its term plays, VAC-d and
 * value, and the deal total when every slot can be totalled. `slots` are catalog slots; `types` the catalog display types.
 */
function termOf(store, filters, deal, slots) {
  const days = termDays(deal.flight);
  const rate = deal.dealType === 'Private auction' ? deal.floorCpm : deal.cpm;
  const raw = slots.map((s) => termViewsOf(store, filters, s, days));
  const per = slots.map((s, i) => {
    const plays = termPlaysOf(store, filters, s, days);
    return { plays, vacd: raw[i] == null ? null : Math.round(raw[i]), value: raw[i] == null || rate == null ? null : cents(calc.revenueAtCpm(rate, raw[i])) };
  });
  const countedIx = per.map((p, i) => i).filter((i) => per[i].plays != null && raw[i] != null);
  const term = days == null ? null : {
    start: deal.flight.start, end: deal.flight.end, days,
    total: slots.length && countedIx.length === slots.length ? { plays: sum(countedIx.map((i) => per[i].plays)), vacd: Math.round(sum(countedIx.map((i) => raw[i]))), value: rate == null ? null : cents(calc.revenueAtCpm(rate, sum(countedIx.map((i) => raw[i])))) } : null,
  };
  return { rate, per, term };
}

module.exports = { termDays, termPlaysOf, termViewsOf, termOf, loopSlotCountOf };
