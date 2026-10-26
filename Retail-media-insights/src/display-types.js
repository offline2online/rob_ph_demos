'use strict';
// Display type facts shared by the display-types, slot-value, slot-allocation and missed-revenue
// endpoints: connected displays in the filtered stores, slot configuration / loop, and the VAC-d averages.

const calc = require('./calc');
const { days } = require('./filters');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const rangeLabel = (f) => `${dayLabel(f.dateFrom)} – ${dayLabel(f.dateTo)}`;
const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

/**
 * Open question 5 (connected displays now vs any time in range): until decided, a display counts when it
 * was connected at any point in the date range. `connectedFrom` / `connectedTo` are optional on a display.
 */
const connectedIn = (d, f) => (!d.connectedFrom || d.connectedFrom <= f.dateTo) && (!d.connectedTo || d.connectedTo >= f.dateFrom);

/** Loop from the slot configuration: counts, average durations, seconds and whole-number shares. */
function loopOf(slots) {
  if (!slots || !slots.advertiser) return null;
  const own = slots.ownContent || { count: 0, avgSeconds: 0 };
  const adv = slots.advertiser;
  const advSeconds = adv.count * adv.avgSeconds;
  const ownSeconds = own.count * own.avgSeconds;
  const loopSeconds = advSeconds + ownSeconds;
  const [advPercent, ownPercent] = calc.percentSplit([advSeconds, ownSeconds]);
  const part = (s, seconds, percent) => ({
    count: s.count, avgSeconds: s.avgSeconds, totalSeconds: seconds, percentOfLoop: percent,
    slotShareOfLoopPercent: calc.wholePercent(s.avgSeconds, loopSeconds),
  });
  return {
    loopSeconds, slotsPerLoop: adv.count + own.count,
    advertiser: part(adv, advSeconds, advPercent), ownContent: part(own, ownSeconds, ownPercent),
  };
}

/** Average assumed views per slot per day (unrounded) across the displays, or null when any input is not stored. */
function averageViewsOf(displays, loop) {
  if (!loop || !displays.length || displays.some((d) => d.footfall == null || d.visibility == null)) return null;
  return calc.averageAssumedViews(displays.map((d) => ({
    storeId: d.storeId, footfall: d.footfall, visibility: d.visibility,
    slotSeconds: loop.advertiser.avgSeconds, loopSeconds: loop.loopSeconds,
  }))).value;
}

/** The hover-card averages. Anything not stored is left out. */
function averagesOf(def, displays, loop, f) {
  const out = {};
  const footfalls = displays.map((d) => d.footfall).filter((v) => v != null);
  const visibilities = displays.map((d) => d.visibility).filter((v) => v != null);
  if (footfalls.length) out.averageFootfallPerDay = Math.round(mean(footfalls));
  if (visibilities.length) out.averageVisibility = round(mean(visibilities), 2);
  if (loop) {
    out.shareOfLoopTime = {
      percent: calc.wholePercent(loop.advertiser.avgSeconds, loop.loopSeconds),
      advertiserSlotSeconds: loop.advertiser.avgSeconds, loopSeconds: loop.loopSeconds,
    };
    const avgViews = averageViewsOf(displays, loop);
    if (avgViews !== null) out.averageAssumedViewsPerSlotPerDay = round(avgViews, 1);
  }
  if (!Object.keys(out).length) return undefined;
  const stores = new Set(displays.map((d) => d.storeId)).size;
  out.averagesCover = {
    displays: displays.length, stores, dateFrom: f.dateFrom, dateTo: f.dateTo,
    label: `Averages across all ${displays.length} connected ${def.name} displays in ${stores} store${stores === 1 ? '' : 's'}, ${rangeLabel(f)}.`,
  };
  return out;
}

/**
 * Display types in shopper-journey (IAB zone) order, restricted by the display type and store filters,
 * each with its connected displays. Types with no connected display in the filtered stores are left out.
 */
function displayTypeFacts(store, f) {
  const { displayTypes, displays } = store.catalog;
  const stores = f.storeIds ? new Set(f.storeIds) : null;
  const wanted = f.displayTypeIds ? new Set(f.displayTypeIds) : null;
  const byType = new Map();
  for (const d of displays) {
    if ((stores && !stores.has(d.storeId)) || (wanted && !wanted.has(d.displayTypeId)) || !connectedIn(d, f)) continue;
    if (!displayTypes[d.displayTypeId]) continue;
    if (!byType.has(d.displayTypeId)) byType.set(d.displayTypeId, []);
    byType.get(d.displayTypeId).push(d);
  }
  return [...byType.entries()].map(([id, list]) => {
    const def = displayTypes[id];
    const loop = loopOf(def.slots);
    return {
      id, def, displays: list, loop, storeCount: new Set(list.map((d) => d.storeId)).size,
      averages: averagesOf(def, list, loop, f),
      averageViewsRaw: averageViewsOf(list, loop),
    };
  }).sort((a, b) => calc.compareZones(a.def.zone, b.def.zone) || String(a.def.name).localeCompare(String(b.def.name)));
}

/** Hover card: facts only, and only fields that are stored. Never specific opening times. */
function hoverCard(t) {
  const d = t.def;
  return compact({
    id: t.id, name: d.name, description: d.description,
    connectedDisplays: { displays: t.displays.length, stores: t.storeCount },
    iabZone: d.zone,
    operatingHours: calc.runsAllDay(d) ? '24 hours' : 'Store opening hours',
    touchPoint: d.touchPoint,
    canvas: d.canvas && { width: d.canvas.width, height: d.canvas.height, label: `${d.canvas.width} × ${d.canvas.height} px` },
    displayOrientation: d.orientation,
    creativeFormats: d.creativeFormats && d.creativeFormats.length ? d.creativeFormats : undefined,
    averages: t.averages,
  });
}

module.exports = { displayTypeFacts, hoverCard, loopOf, days, rangeLabel, round };
