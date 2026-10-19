'use strict';
// Sales uplift vs control stores: the sample campaign products, the stand-in for PH Core's Transaction API and the
// uplift calculation. The route (routes/sales-uplift.js) is the only caller.
//
// Until the source adapter exists, what PH Core will hold is generated here, deterministically from the campaigns:
//  - campaign -> product: each campaign carries a SKU, or only a product name (every fourth campaign);
//  - campaign playback analytics: a campaign plays in every store except the Control stores segment when it excludes it
//    (all but every fifth campaign), so its "campaign stores" are the stores it played in;
//  - Transaction API: store x day x product sales in USD from a custom POS integration (one advertiser has none);
//  - tier mix: the campaign's share of plays by targeting tier follows its maturity level.
// Sales in the stores a campaign played in lift during its flight and fade after it, by maturity level; the control
// stores never see that lift, so uplift is measurable.

const { addDays, eachDay, dayDiff } = require('./dealing');

const PRE_DAYS = 30;
const POST_DAYS = 30;
const CONTROL_SEGMENT = 'Control stores';
const PRODUCT_NAMES = ['Daily Essentials 60 pack', 'Sensitive Care 30 pack', 'Family Value Bundle'];
const LIFT = { 'Default only': 0.04, Localised: 0.08, Personalised: 0.12 };
const TIER_MIX = {
  'Default only': { default: 100 },
  Localised: { default: 75, localised: 25 },
  Personalised: { default: 70, localised: 25, personalised: 5 },
};
const WEEKDAY = [1.1, 0.9, 0.92, 0.95, 1.05, 1.3, 1.25]; // Sunday first
const NO_POS_ADVERTISERS = new Set(['adv-perrigo']);

const cents = (n) => Math.round(Math.round(n * 1e6) / 1e4) / 100;
function hash(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/** The Control stores segment: the last 40% of the stores (at least one, never all of them). */
function controlStoreIds(storeIds) {
  const ids = [...storeIds].sort();
  return ids.slice(ids.length - Math.min(Math.max(1, Math.round(ids.length * 0.4)), ids.length - 1));
}

/** One campaign with its product, store groups and tier mix. `lastDay` clips an ongoing flight. */
function describeCampaign(c, store, lastDay) {
  const n = Number(String(c.id).split('-').pop()) || 1;
  const adv = (store.advertisers || {})[c.advertiserId] || {};
  const slug = c.advertiserId.replace(/^adv-/, '');
  const index = n - 1; // each campaign promotes its own product, so no other campaign's lift reaches its before window
  const hasSku = n % 4 !== 0;
  const allStores = Object.keys(store.catalog.stores || {}).sort();
  const control = controlStoreIds(allStores);
  const excludesControl = n % 5 !== 0;
  const campaignStores = excludesControl ? allStores.filter((s) => !control.includes(s)) : allStores;
  const flightEnd = c.end && c.end < lastDay ? c.end : lastDay;
  return {
    id: c.id, advertiserId: c.advertiserId, advertiserName: adv.name || c.advertiserId, level: c.level,
    displayTypeIds: c.displayTypeIds, start: c.start, end: c.end, flightEnd, flightEnded: Boolean(c.end && c.end <= lastDay),
    product: { name: `${adv.name || slug} ${PRODUCT_NAMES[index % PRODUCT_NAMES.length]}${index >= PRODUCT_NAMES.length ? ` (${Math.floor(index / PRODUCT_NAMES.length) + 1})` : ''}`, ...(hasSku ? { sku: `${slug.slice(0, 3).toUpperCase()}-${1001 + index}` } : {}), index },
    matchedOn: hasSku ? 'sku' : 'product name',
    hasPos: !NO_POS_ADVERTISERS.has(c.advertiserId),
    excludesControl, campaignStores, controlStores: excludesControl ? control : [],
  };
}

/**
 * The Transaction API stand-in: USD sales of one product in one store on one day. A product's sales lift in a store on
 * the days one of its campaigns played there, and fade for the 30 days after.
 */
function makeTransactions(store, lastDay) {
  const storeIx = Object.fromEntries(Object.keys(store.catalog.stores || {}).sort().map((id, i) => [id, i]));
  const byAdvProduct = new Map();
  for (const c of store.campaigns) {
    const d = describeCampaign(c, store, lastDay);
    const key = `${d.advertiserId}|${d.product.index}`;
    if (!byAdvProduct.has(key)) byAdvProduct.set(key, []);
    byAdvProduct.get(key).push(d);
  }
  return function sales(d, storeId, date) {
    if (!d.hasPos || date > lastDay) return 0;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    let lift = 0;
    for (const o of byAdvProduct.get(`${d.advertiserId}|${d.product.index}`) || []) {
      if (!o.campaignStores.includes(storeId) || o.start > date) continue;
      const end = o.end || lastDay;
      if (date <= end) lift = Math.max(lift, LIFT[o.level] || 0);
      else if (dayDiff(end, date) <= POST_DAYS) lift = Math.max(lift, (LIFT[o.level] || 0) * 0.4);
    }
    const base = (220 + (storeIx[storeId] || 0) * 45 + hash(d.advertiserId, d.product.index) * 90) * WEEKDAY[dow];
    return Math.round(base * (1 + lift) * (0.93 + hash(storeId, d.advertiserId, d.product.index, date) * 0.14));
  };
}

const memo = new WeakMap();
const transactionsFor = (store) => {
  if (!memo.has(store)) memo.set(store, makeTransactions(store, store.lastPlayedDay));
  return memo.get(store);
};

/** Campaign spend from billing: the advertiser's earned revenue in the campaign's stores and display types during the flight, shared equally by its campaigns running that day. */
function campaignSpend(store, d, all) {
  const rivals = all.filter((o) => o.advertiserId === d.advertiserId);
  const covers = (o, date, type) => o.start <= date && date <= o.flightEnd && (!o.displayTypeIds || o.displayTypeIds.includes(type));
  let total = 0;
  store.scanDelivery({ dateFrom: d.start, dateTo: d.flightEnd, storeIds: d.campaignStores, displayTypeIds: d.displayTypeIds, advertiserIds: [d.advertiserId] }, (r) => {
    if (!covers(d, r.date, r.displayTypeId)) return;
    total += r.earned / rivals.filter((o) => covers(o, r.date, r.displayTypeId)).length;
  });
  return cents(total);
}

function upliftFor(store, d, all) {
  const sales = transactionsFor(store);
  const dates = eachDay(addDays(d.start, -PRE_DAYS), (() => { const e = addDays(d.flightEnd, POST_DAYS); return e > store.lastPlayedDay ? store.lastPlayedDay : e; })());
  const sum = (stores, date) => stores.reduce((n, s) => n + sales(d, s, date), 0);
  const rows = dates.map((date) => ({
    date, phase: date < d.start ? 'before' : date <= d.flightEnd ? 'during' : 'after',
    campaignSales: sum(d.campaignStores, date), controlSales: sum(d.controlStores, date),
  }));
  if (!rows.some((r) => r.campaignSales > 0)) return { transactions: false };
  const mean = (phase, key) => { const xs = rows.filter((r) => r.phase === phase); return xs.length ? xs.reduce((n, r) => n + r[key], 0) / xs.length : 0; };
  const preC = mean('before', 'campaignSales'); const preX = mean('before', 'controlSales');
  const nC = d.campaignStores.length; const nX = d.controlStores.length;
  const series = rows.map((r) => ({
    ...r,
    campaignPerStore: cents(r.campaignSales / nC), controlPerStore: cents(r.controlSales / nX),
    difference: cents(r.campaignSales / nC - r.controlSales / nX),
    campaignIndex: preC ? Math.round((r.campaignSales / preC) * 1000) / 10 : null,
    controlIndex: preX ? Math.round((r.controlSales / preX) * 1000) / 10 : null,
  }));
  const during = rows.filter((r) => r.phase === 'during');
  const flightC = during.reduce((n, r) => n + r.campaignSales, 0);
  const flightX = during.reduce((n, r) => n + r.controlSales, 0);
  // What the campaign stores would have sold had they moved like the control stores from the 30 days before.
  const expected = preC * during.length * (preX && during.length ? flightX / during.length / preX : 0);
  const incremental = cents(flightC - expected);
  const spend = campaignSpend(store, d, all);
  return {
    transactions: true, series,
    uplift: expected > 0 ? Math.round((incremental / expected) * 100) : null,
    incremental, spend, iroas: spend > 0 ? Math.round((incremental / spend) * 100) / 100 : null,
  };
}

const tierMix = (level) => Object.entries(TIER_MIX[level] || TIER_MIX['Default only']).map(([tier, percent]) => ({ tier, percent }));

module.exports = { describeCampaign, upliftFor, tierMix, transactionsFor, controlStoreIds, CONTROL_SEGMENT, PRE_DAYS, POST_DAYS };
