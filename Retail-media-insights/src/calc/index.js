'use strict';
// The one shared calculation library: every rule in REQUIREMENTS.md section 3.2.
// Pure functions, no I/O. Money is USD; percentages are whole numbers.

const { DEAL_TYPES, DSPS, ZONES, MATURITY_LEVELS, ALWAYS_OPEN, NEVER_OPEN, LOCALISATION_VARIABLES, PERSONALISATION_VARIABLES } = require('../constants');

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// ---- VAC-d / assumed views -------------------------------------------------

/** footfall x visibility x (slot seconds / loop seconds). Worked example: 4000 x 0.5 x 1/10 = 200. */
function assumedViewsPerSlotPerDay(footfall, visibility, slotSeconds, loopSeconds) {
  if (!(loopSeconds > 0)) return 0;
  return footfall * visibility * (slotSeconds / loopSeconds);
}

/**
 * Average across connected displays of a type. Each display:
 * {storeId, footfall, visibility, slotSeconds, loopSeconds}. Returns the display and store
 * counts alongside the average so the caller can label what it averages over.
 */
function averageAssumedViews(displays) {
  const n = displays.length;
  if (!n) return { value: 0, displayCount: 0, storeCount: 0 };
  const values = displays.map((d) => assumedViewsPerSlotPerDay(d.footfall, d.visibility, d.slotSeconds, d.loopSeconds));
  return {
    value: sum(values) / n,
    displayCount: n,
    storeCount: new Set(displays.map((d) => d.storeId)).size,
  };
}

/** Share of loop time = slot length / loop length. */
function shareOfLoop(slotSeconds, loopSeconds) {
  return loopSeconds > 0 ? slotSeconds / loopSeconds : 0;
}

// ---- CPM ------------------------------------------------------------------

/** Revenue earned by delivering `views` assumed views at `cpm` (cost per thousand VAC-d). */
function revenueAtCpm(cpm, views) {
  return (cpm * views) / 1000;
}

/** Effective CPM = revenue / (VAC-d / 1000). */
function effectiveCpm(revenue, views) {
  return views > 0 ? revenue / (views / 1000) : 0;
}

/** Revenue / (advertiser slots x connected displays x days). */
function perSlotPerDayPerDisplay(revenue, slots, displays, days) {
  const denom = slots * displays * days;
  return denom > 0 ? revenue / denom : 0;
}

/** Revenue / (advertiser slots x days), for a figure that is not per display. */
function perSlotPerDay(revenue, slots, days) {
  const denom = slots * days;
  return denom > 0 ? revenue / denom : 0;
}

// ---- Operating hours --------------------------------------------------------

/**
 * Operating hours are held per display type, defaulted from the zone: an explicit `is24Hour` wins (window
 * screens visible from outside are true); with no flag an Exterior type runs 24 hours; everything else
 * follows store opening hours. A store with no opening hours on record fails closed (NEVER_OPEN), so an
 * in-store type's inventory there is not counted. `storeHours` is {open, close}. The window is for internal
 * use only: the API never exposes specific opening times.
 */
function operatingWindow(displayType, storeHours) {
  if (runsAllDay(displayType)) return ALWAYS_OPEN;
  return storeHours || NEVER_OPEN;
}

/** True when the type runs 24 hours: its flag if set, else the zone default (Exterior). */
function runsAllDay(displayType) {
  if (displayType.is24Hour === true) return true;
  if (displayType.is24Hour === false) return false;
  return displayType.zone === 'Exterior';
}

/** True when `hour` (0-23) falls inside [open, close). A close of 24 means end of day. */
function insideOperatingHours(hour, window) {
  return hour >= window.open && hour < window.close;
}

// ---- Inventory, fill, missed revenue ------------------------------------------

/** Classify one slot record. Slots outside operating hours are never inventory. */
function classifySlot(record, window) {
  if (!insideOperatingHours(record.hour, window)) return 'outsideHours';
  if (record.status === 'sold') return 'sold';
  if (record.status === 'offline') return 'offline';
  return 'unsold';
}

/** Whole-number fill: sold / (sold + unsold + offline), every advertiser slot inside operating hours. */
function fillPercent(sold, unsold, offline = 0) {
  const total = sold + unsold + offline;
  return total > 0 ? Math.round((sold / total) * 100) : 0;
}

/** Unsold slots valued at the floor CPM over the views they would have delivered. */
function unsoldValueAtFloor(unsoldViews, floorCpm) {
  return revenueAtCpm(floorCpm, unsoldViews);
}

function missedRevenue(unsoldViews, floorCpm, downtimeLostRevenue = 0) {
  const unsold = unsoldValueAtFloor(unsoldViews, floorCpm);
  return { unsold, downtime: downtimeLostRevenue, total: unsold + downtimeLostRevenue };
}

// ---- Programmatic Guaranteed pacing ----------------------------------------------

/** guaranteed = forecast x (1 - buffer). */
function guaranteedVolume(forecast, buffer) {
  return forecast * (1 - buffer);
}

/** Delivered VAC-d / guaranteed to date. `daysElapsed` / `totalDays` prorate the guarantee. */
function pgPacing({ delivered, forecast, buffer, daysElapsed, totalDays }) {
  const toDate = guaranteedVolume(forecast, buffer) * (totalDays > 0 ? Math.min(daysElapsed / totalDays, 1) : 0);
  return {
    guaranteedToDate: toDate,
    pacing: toDate > 0 ? delivered / toDate : 0,
  };
}

// ---- Maturity ------------------------------------------------------------------

/** Highest of Default only / Localised / Personalised across an advertiser's campaigns. */
function maturityLevel(levels) {
  let best = -1;
  for (const l of levels) best = Math.max(best, MATURITY_LEVELS.indexOf(l));
  return best < 0 ? null : MATURITY_LEVELS[best];
}

/**
 * Keep only Shared Targeting Variable labels, each tagged with its group. Anything else
 * (Daypart, a free-form label) is dropped: scheduling is never a variable.
 */
function sharedVariables(labels) {
  const out = [];
  for (const label of new Set(labels || [])) {
    if (LOCALISATION_VARIABLES.includes(label)) out.push({ label, kind: 'Localised', personalisationType: null });
    else if (Object.hasOwn(PERSONALISATION_VARIABLES, label)) out.push({ label, kind: 'Personalised', personalisationType: PERSONALISATION_VARIABLES[label] });
  }
  return out;
}

/** One campaign's level from its variables: any personalisation variable, else any localisation, else default. */
function campaignLevel(labels) {
  const vars = sharedVariables(labels);
  if (vars.some((v) => v.kind === 'Personalised')) return 'Personalised';
  return vars.length ? 'Localised' : 'Default only';
}

// ---- Rounding and formatting -------------------------------------------------------

/** Whole-number percentage of part / whole. */
function wholePercent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Round the parts first; the total is their sum, so parts always add to the total returned. */
function roundParts(parts) {
  const rounded = parts.map((p) => Math.round(p));
  return { parts: rounded, total: sum(rounded) };
}

/**
 * Round each value to `decimals` places so the rounded values add to the rounded sum (largest remainder).
 * Used where parts are shown beside a total that is a figure of its own (hourly revenue against the Revenue chart).
 */
function roundToTotal(values, decimals = 0) {
  const scale = 10 ** decimals;
  const total = Math.round(sum(values) * scale);
  const raw = values.map((v) => v * scale);
  const out = raw.map(Math.floor);
  let left = total - sum(out);
  const order = raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0 && k < order.length; k += 1, left -= 1) out[order[k][1]] += 1;
  return out.map((v) => v / scale);
}

/** Whole-number percentages that add to 100 (largest remainder). */
function percentSplit(values) {
  const total = sum(values);
  if (!(total > 0)) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - sum(out);
  const order = raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k += 1, left -= 1) out[order[k][1]] += 1;
  return out;
}

function formatUsd(amount, fractionDigits = 0) {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}`;
}

// ---- Orderings -------------------------------------------------------------------------

const orderBy = (list) => (a, b) => {
  const ia = list.indexOf(a);
  const ib = list.indexOf(b);
  return (ia < 0 ? list.length : ia) - (ib < 0 ? list.length : ib) || String(a).localeCompare(String(b));
};
const compareDealTypes = orderBy(DEAL_TYPES);
const compareDsps = orderBy(DSPS);
const compareZones = orderBy(ZONES);

module.exports = {
  assumedViewsPerSlotPerDay, averageAssumedViews, shareOfLoop,
  revenueAtCpm, effectiveCpm, perSlotPerDay, perSlotPerDayPerDisplay,
  operatingWindow, runsAllDay, insideOperatingHours, classifySlot, fillPercent,
  unsoldValueAtFloor, missedRevenue,
  guaranteedVolume, pgPacing, maturityLevel, sharedVariables, campaignLevel,
  wholePercent, roundParts, roundToTotal, percentSplit, formatUsd,
  compareDealTypes, compareDsps, compareZones,
};
