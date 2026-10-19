'use strict';
// Sales response after personalised plays: sales of a campaign's product in the minutes after a play, per 1,000 transactions
// in the same store and minutes (basket penetration), after personalised plays, after localised plays, and in Control stores
// at the same clock time.
//
// Inputs, as the production data will arrive (README "Sales response after personalised plays"):
//  - play timestamps, tier and display from campaign playback analytics (PH Core);
//  - sale timestamps, store and SKU / product name from the Transaction API (a custom POS integration per retailer);
//  - total transactions by store and minute from the Transaction API (every basket, not only the campaign's product);
//  - the Control stores Fixed Store Segment, used as exclusion targeting on the campaign.
// The test retailer has none of these as rows, so `dayEvents` stands in for them: a deterministic day of plays and sales
// per campaign and store, in which a personalised play lifts sales of the product for a few minutes (a localised play
// less so). Everything after it (the counting rules, the rates, the controls) is the real calculation and reads only
// {plays, sales, transactions}, so replacing `dayEvents` with the three feeds changes nothing downstream.

const calc = require('./calc');
const { variationsOf, pickVersion } = require('./variations');

const WINDOWS = [5, 10, 15, 30, 60];
const DEFAULT_WINDOW = 10;
const MAX_WINDOW = 120;
const STEPS = [1, 5, 15];
const VIEWS = ['step', 'running'];

const BASE_SHARE = 0.03; // share of all transactions that include the product with no recent play
const DAILY_TRANSACTIONS = 1800; // a store's transactions in a day before its size factor
const LIFT = { personalised: 4, localised: 1.2 }; // extra multiples of the baseline right after a play
const DECAY_MINUTES = 4;
const REACH_MINUTES = 30; // a play no longer lifts sales after this
const MAX_MULTIPLE = 8;
const MIN_PLAYS = 30; // a variation with fewer plays than this shows no rate

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(lambda, rand) {
  const limit = Math.exp(-lambda);
  let n = 0; let p = rand();
  while (p > limit) { n += 1; p *= rand(); }
  return n;
}

/** Share of a day's transactions in each hour: a lunchtime and an after-work peak. */
const hourShape = (h) => 0.5 + 0.9 * Math.exp(-(((h + 0.5 - 12.5) / 3) ** 2)) + 0.6 * Math.exp(-(((h + 0.5 - 17.5) / 2.2) ** 2));

/** Total transactions (all baskets) in each minute of each hour of a store's opening hours: {hour: transactions per minute}, whole numbers. */
function transactionsByHour(store, storeId) {
  const cache = store.__salesResponse.transactions;
  if (cache.has(storeId)) return cache.get(storeId);
  const hours = (store.catalog.stores || {})[storeId] || { open: 0, close: 0 };
  const daily = DAILY_TRANSACTIONS * (0.7 + 0.6 * (hashSeed(`size|${storeId}`) / 4294967296));
  const shapes = [];
  for (let h = hours.open; h < hours.close; h += 1) shapes.push([h, hourShape(h)]);
  const total = shapes.reduce((acc, [, w]) => acc + w, 0);
  const out = new Map(shapes.map(([h, w]) => [h, total > 0 ? Math.max(1, Math.round((daily * w) / total / 60)) : 0]));
  cache.set(storeId, out);
  return out;
}

/** Transactions in the `window` minutes starting at second `t`, in `step`-minute buckets (each bucket a whole number; none outside opening hours). */
function addTransactions(target, byHour, t, window, step) {
  for (let o = 0; o < window; o += 1) target[Math.floor(o / step)] += byHour.get(Math.floor((t + o * 60) / 3600)) || 0;
}

/**
 * One store-day of the campaign, in seconds from midnight: every play of the campaign (any tier, any display type) and every sale
 * of its product. `control` days have no plays: Control stores don't run the campaign.
 */
function variationsFor(store, campaign) {
  const cache = store.__salesResponse.variations;
  if (!cache.has(campaign.id)) cache.set(campaign.id, variationsOf(campaign, store));
  return cache.get(campaign.id);
}

function dayEvents(store, campaign, storeId, date, control) {
  const cache = store.__salesResponse.days;
  const key = `${campaign.id}|${storeId}|${date}|${control ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  if (cache.size > 4000) cache.clear();
  const hours = store.catalog.stores[storeId];
  const rand = rng(hashSeed(key));
  const plays = [];
  const variations = variationsFor(store, campaign);
  if (!control) {
    const types = (campaign.displayTypeIds || Object.keys(store.catalog.displayTypes)).filter((t) => store.catalog.displayTypes[t]);
    for (let hour = hours.open; hour < hours.close; hour += 1) {
      for (const displayTypeId of types) {
        if (!calc.insideOperatingHours(hour, calc.operatingWindow(store.catalog.displayTypes[displayTypeId], hours))) continue;
        const tiers = [['localised', 1 + Math.floor(rand() * 2)]];
        if (campaign.level === 'Personalised') tiers.push(['personalised', 1 + Math.floor(rand() * 2)]);
        for (const [tier, n] of tiers) {
          for (let k = 0; k < n; k += 1) {
            const t = hour * 3600 + Math.floor(rand() * 3600);
            // The version id recorded on the play; picked by a hash of the play so the stream of random numbers above is unchanged.
            const versionId = pickVersion(variations, tier, hashSeed(`${key}|${t}|${displayTypeId}|v`) / 4294967296).id;
            plays.push({ t, tier, displayTypeId, versionId });
          }
        }
      }
    }
    plays.sort((a, b) => a.t - b.t);
  }
  const txns = transactionsByHour(store, storeId);
  const minutes = (hours.close - hours.open) * 60;
  const extra = new Array(minutes).fill(0);
  for (const p of plays) {
    const from = Math.floor(p.t / 60) - hours.open * 60;
    for (let m = Math.max(from, 0); m < Math.min(from + REACH_MINUTES, minutes); m += 1) extra[m] += LIFT[p.tier] * Math.exp(-(m - from) / DECAY_MINUTES);
  }
  const sales = [];
  for (let m = 0; m < minutes; m += 1) {
    const hour = hours.open + Math.floor(m / 60);
    const lambda = (txns.get(hour) || 0) * BASE_SHARE * (1 + Math.min(extra[m], MAX_MULTIPLE - 1));
    for (let n = poisson(lambda, rand); n > 0; n -= 1) sales.push((hours.open * 60 + m) * 60 + Math.floor(rand() * 60));
  }
  sales.sort((a, b) => a - b);
  const out = { plays, sales };
  cache.set(key, out);
  return out;
}

const days = (from, to) => {
  const out = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86400000) out.push(new Date(at).toISOString().slice(0, 10));
  return out;
};
const rate = (sales, transactions) => (transactions > 0 ? Math.round((sales / transactions) * 100000) / 100 : 0); // per 1,000 transactions, two decimals
const labelOf = (from, to, step) => (step === 1 ? `Minute ${from} after play` : `Minutes ${from}–${to - 1} after play`);

/** Campaigns with personalised variants in scope: the chart's drop-down. */
function personalisedCampaigns(store, filters) {
  const out = [];
  store.scanCampaigns(filters, (c) => { if (c.level === 'Personalised') out.push(c); });
  return out.sort((a, b) => {
    const an = (store.advertisers[a.advertiserId] || {}).name || a.advertiserId; const bn = (store.advertisers[b.advertiserId] || {}).name || b.advertiserId;
    return an.localeCompare(bn) || (a.start < b.start ? 1 : a.start > b.start ? -1 : 0);
  });
}

/** The scope the chart reads: treated stores, Control stores and the display types whose plays count. */
function scopeOf(store, campaign, filters) {
  const all = Object.keys(store.catalog.stores || {});
  const control = campaign.controlStores ? ((store.catalog.controlStores || {}).storeIds || []).filter((s) => all.includes(s)) : [];
  const selected = filters.storeIds ? all.filter((s) => filters.storeIds.includes(s)) : all;
  const campaignTypes = (campaign.displayTypeIds || Object.keys(store.catalog.displayTypes)).filter((t) => store.catalog.displayTypes[t]);
  const types = filters.displayTypeIds ? campaignTypes.filter((t) => filters.displayTypeIds.includes(t)) : campaignTypes;
  return { treated: selected.filter((s) => !control.includes(s)), control, types };
}

/** Hours (0-23) in which a purchase can follow a play: the store is open and one of the display types is operating. */
function operatingHours(store, storeIds, types) {
  const out = new Set();
  for (const s of storeIds) {
    const hours = store.catalog.stores[s];
    for (let h = hours.open; h < hours.close; h += 1) {
      if (types.some((t) => calc.insideOperatingHours(h, calc.operatingWindow(store.catalog.displayTypes[t], hours)))) out.add(h);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function salesResponse(store, campaign, filters, { window, step, view, hourFrom, hourTo, hoursError }) {
  if (!store.__salesResponse) Object.defineProperty(store, '__salesResponse', { value: { days: new Map(), transactions: new Map(), variations: new Map() }, enumerable: false });
  const scope = scopeOf(store, campaign, filters);
  const hours = operatingHours(store, scope.treated.length ? scope.treated : scope.control, scope.types);
  const band = hourFrom == null ? null : { from: hourFrom, to: hourTo };
  if (band && !hours.some((h) => h >= band.from && h <= band.to)) throw hoursError('the hour band is outside the display types’ operating hours');
  const inBand = (h) => !band || (h >= band.from && h <= band.to);

  const from = [filters.dateFrom, campaign.start, store.firstPlayedDay].filter(Boolean).reduce((a, b) => (a > b ? a : b));
  const lastDay = [filters.dateTo, campaign.end, store.lastPlayedDay].filter(Boolean).reduce((a, b) => (a < b ? a : b));
  const dates = from <= lastDay ? days(from, lastDay) : [];
  const typeSet = new Set(scope.types);
  const n = Math.ceil(window / step);
  const empty = (kind) => ({ plays: 0, sales: new Array(n).fill(0), transactions: new Array(n).fill(0), kind });
  const lines = { personalised: empty('personalised'), localised: empty('localised'), control: empty('control') };
  // Personalised plays by the version they ran: the same counting as the personalised line, kept apart per variation.
  const byVersion = {};
  for (const v of variationsFor(store, campaign)) if (v.tier === 'personalised') byVersion[v.id] = { ...empty('personalised'), stores: new Set() };

  for (const date of dates) {
    for (const storeId of scope.treated) {
      const { plays, sales } = dayEvents(store, campaign, storeId, date, false);
      const counted = plays.filter((p) => typeSet.has(p.displayTypeId));
      const txns = transactionsByHour(store, storeId);
      let last = -1; // the nearest preceding play, by pointer: both lists are time-ordered
      for (const sale of sales) {
        while (last + 1 < counted.length && counted[last + 1].t <= sale) last += 1;
        if (last < 0) continue;
        const dt = sale - counted[last].t;
        if (dt >= window * 60) continue;
        const bucket = Math.floor(Math.floor(dt / 60) / step);
        const p = counted[last];
        if (inBand(Math.floor(p.t / 3600))) {
          lines[p.tier].sales[bucket] += 1;
          if (p.tier === 'personalised' && byVersion[p.versionId]) byVersion[p.versionId].sales[bucket] += 1;
        }
      }
      counted.forEach((p) => {
        const hour = Math.floor(p.t / 3600);
        if (!inBand(hour)) return;
        lines[p.tier].plays += 1; addTransactions(lines[p.tier].transactions, txns, p.t, window, step);
        const v = p.tier === 'personalised' ? byVersion[p.versionId] : null;
        if (v) {
          v.plays += 1; v.stores.add(storeId); addTransactions(v.transactions, txns, p.t, window, step);
        }
      });
      // Control stores, same clock time: each personalised play opens the same clock window in every Control store.
      if (scope.control.length) {
        const controlDays = scope.control.map((c) => ({ txns: transactionsByHour(store, c), sales: dayEvents(store, campaign, c, date, true).sales }));
        for (const p of counted) {
          if (p.tier !== 'personalised') continue;
          const hour = Math.floor(p.t / 3600);
          if (!inBand(hour)) continue;
          lines.control.plays += 1;
          for (const cd of controlDays) {
            addTransactions(lines.control.transactions, cd.txns, p.t, window, step);
            for (const sale of cd.sales) {
              if (sale < p.t) continue;
              if (sale >= p.t + window * 60) break;
              lines.control.sales[Math.floor(Math.floor((sale - p.t) / 60) / step)] += 1;
            }
          }
        }
      }
    }
  }
  return { scope, hours, band, dates, lines, n, byVersion };
}

module.exports = {
  WINDOWS, DEFAULT_WINDOW, MAX_WINDOW, STEPS, VIEWS, MIN_PLAYS, variationsFor, salesResponse, personalisedCampaigns, scopeOf, operatingHours, labelOf, rate, transactionsByHour, dayEvents,
};
