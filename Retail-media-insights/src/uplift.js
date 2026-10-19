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
// Extra SKUs on a campaign that promotes several (every third campaign with a SKU; every sixth also has a tiny one):
// each sells a share of the main product's volume and moves with the campaign by its own weight (one is cannibalised).
const EXTRA_SKUS = [
  { variant: 'Travel size', volume: 0.6, liftWeight: 0.5 },
  { variant: 'Refill pack', volume: 0.35, liftWeight: -0.6 },
  { variant: 'Sample sachet', volume: 0.002, liftWeight: 1 },
];
const MIN_SKU_TRANSACTIONS = 30; // below this in any of the four cells a SKU is "Too few sales to measure"
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
  const mainName = `${adv.name || slug} ${PRODUCT_NAMES[index % PRODUCT_NAMES.length]}${index >= PRODUCT_NAMES.length ? ` (${Math.floor(index / PRODUCT_NAMES.length) + 1})` : ''}`;
  const main = { name: mainName, ...(hasSku ? { sku: `${slug.slice(0, 3).toUpperCase()}-${1001 + index}` } : {}), index, key: String(index), volume: 1, liftWeight: 1, price: Math.round((8 + hash(slug, index, 'price') * 20) * 100) / 100 };
  const extras = hasSku && n % 3 === 0 ? EXTRA_SKUS.slice(0, n % 6 === 0 ? 3 : 2) : [];
  const products = [main, ...extras.map((e, k) => ({
    name: `${mainName} – ${e.variant}`, sku: `${slug.slice(0, 3).toUpperCase()}-${2001 + index * 10 + k}`, index, key: `${index}.${k + 1}`,
    volume: e.volume, liftWeight: e.liftWeight, price: Math.round((8 + hash(slug, index, k, 'price') * 20) * 100) / 100,
  }))];
  return {
    id: c.id, advertiserId: c.advertiserId, advertiserName: adv.name || c.advertiserId, level: c.level,
    displayTypeIds: c.displayTypeIds, start: c.start, end: c.end, flightEnd, flightEnded: Boolean(c.end && c.end <= lastDay),
    product: { name: main.name, ...(main.sku ? { sku: main.sku } : {}), index }, products,
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
    for (const p of d.products) {
      const key = `${d.advertiserId}|${p.key}`;
      if (!byAdvProduct.has(key)) byAdvProduct.set(key, []);
      byAdvProduct.get(key).push(d);
    }
  }
  // One SKU's sales, or (no `product`) all the campaign's SKUs together.
  return function sales(d, storeId, date, product) {
    if (!product) return d.products.reduce((n, p) => n + sales(d, storeId, date, p), 0);
    if (!d.hasPos || date > lastDay) return 0;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    let lift = 0;
    for (const o of byAdvProduct.get(`${d.advertiserId}|${product.key}`) || []) {
      if (!o.campaignStores.includes(storeId) || o.start > date) continue;
      const end = o.end || lastDay;
      if (date <= end) lift = Math.max(lift, LIFT[o.level] || 0);
      else if (dayDiff(end, date) <= POST_DAYS) lift = Math.max(lift, (LIFT[o.level] || 0) * 0.4);
    }
    const base = (220 + (storeIx[storeId] || 0) * 45 + hash(d.advertiserId, product.key) * 90) * WEEKDAY[dow] * product.volume;
    return Math.round(base * (1 + lift * product.liftWeight) * (0.93 + hash(storeId, d.advertiserId, product.key, date) * 0.14));
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

/** One SKU's sales and uplift against the control stores, by the same method as the chart: indexed to the 30-day pre-period. */
function skuUplift(sales, d, product, dates) {
  const day = (stores, date) => stores.reduce((n, st) => n + sales(d, st, date, product), 0);
  const rows = dates.map((date) => ({ phase: date < d.start ? 'before' : date <= d.flightEnd ? 'during' : 'after', c: day(d.campaignStores, date), x: day(d.controlStores, date) }));
  const total = (phase, k) => rows.filter((r) => r.phase === phase).reduce((n, r) => n + r[k], 0);
  const days = (phase) => rows.filter((r) => r.phase === phase).length;
  const preC = days('before') ? total('before', 'c') / days('before') : 0; const preX = days('before') ? total('before', 'x') / days('before') : 0;
  const nDuring = days('during');
  const flightC = total('during', 'c'); const flightX = total('during', 'x');
  const expected = preC * nDuring * (preX && nDuring ? flightX / nDuring / preX : 0);
  const sold = { before: { campaign: total('before', 'c'), control: total('before', 'x') }, during: { campaign: flightC, control: flightX } };
  const transactions = Math.round(Object.values(sold).reduce((n, w) => n + w.campaign + w.control, 0) / product.price);
  const cell = (v) => Math.round(v / product.price);
  const measurable = [sold.before.campaign, sold.before.control, sold.during.campaign, sold.during.control].every((v) => cell(v) >= MIN_SKU_TRANSACTIONS);
  return { product, sold, transactions, measurable, expected, incremental: cents(flightC - expected) };
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
  // The headline is the sum of the SKUs that can be measured, so the "By product" rows add up to the tile.
  const skus = d.products.map((p) => skuUplift(sales, d, p, dates));
  const measured = skus.filter((k) => k.measurable);
  const incremental = cents(measured.reduce((n, k) => n + k.incremental, 0));
  const expected = measured.reduce((n, k) => n + k.expected, 0);
  const spend = campaignSpend(store, d, all);
  return {
    transactions: true, series,
    uplift: expected > 0 ? Math.round((incremental / expected) * 100) : null,
    incremental, spend, iroas: spend > 0 ? Math.round((incremental / spend) * 100) / 100 : null,
    bySku: bySkuRows(skus, incremental),
  };
}

/** The "By product" list: highest incremental sales first; shares of positive contribution only, summing to exactly 100. */
function bySkuRows(skus, total) {
  const positive = skus.filter((k) => k.measurable && k.incremental > 0);
  const pos = positive.reduce((n, k) => n + k.incremental, 0);
  const shares = new Map(positive.map((k) => [k, Math.round((k.incremental / pos) * 1000) / 10]));
  if (positive.length) { // put the rounding remainder on the largest share
    const big = positive.reduce((a, b) => (b.incremental > a.incremental ? b : a));
    shares.set(big, Math.round((100 - [...shares].filter(([k]) => k !== big).reduce((n, [, v]) => n + v, 0)) * 10) / 10);
  }
  const rows = skus.map((k) => ({
    name: k.product.name, ...(k.product.sku ? { sku: k.product.sku } : {}), matchedOn: k.product.sku ? 'sku' : 'product name',
    measurable: k.measurable, transactions: k.transactions,
    ...(k.measurable ? {
      incrementalSales: k.incremental, sharePercent: shares.has(k) ? shares.get(k) : null,
      upliftPercent: k.expected > 0 ? Math.round((k.incremental / k.expected) * 100) : null,
    } : {}),
    sales: { before: { campaign: cents(k.sold.before.campaign), control: cents(k.sold.before.control) }, during: { campaign: cents(k.sold.during.campaign), control: cents(k.sold.during.control) } },
  }));
  return rows.sort((a, b) => (b.measurable - a.measurable) || ((b.incrementalSales || 0) - (a.incrementalSales || 0)) || a.name.localeCompare(b.name));
}

const tierMix = (level) => Object.entries(TIER_MIX[level] || TIER_MIX['Default only']).map(([tier, percent]) => ({ tier, percent }));

module.exports = { describeCampaign, upliftFor, tierMix, transactionsFor, controlStoreIds, CONTROL_SEGMENT, PRE_DAYS, POST_DAYS };
