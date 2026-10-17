'use strict';
// A deterministic 5-store test retailer (README "Store zones" sample data): Window Portrait (24h,
// 2 displays per store), Endcap Shelf-edge (4), Queue Screen (3), Dispensary Screen (1). Stores
// open 08:00-20:00. Each slot record is one advertiser slot in one hour of one day.

const calc = require('./calc');

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

const DISPLAY_TYPES = {
  window: { name: 'Window Portrait', zone: 'Entrance & out of category', is24Hour: true, floorCpm: 12, displaysPerStore: 2, viewsPerSlot: 200 },
  endcap: { name: 'Endcap Shelf-edge', zone: 'Entrance & out of category', is24Hour: false, floorCpm: 8, displaysPerStore: 4, viewsPerSlot: 120 },
  queue: { name: 'Queue Screen', zone: 'Checkout', is24Hour: false, floorCpm: 10, displaysPerStore: 3, viewsPerSlot: 90 },
  dispensary: { name: 'Dispensary Screen', zone: 'Other & connected store', is24Hour: false, floorCpm: 6, displaysPerStore: 1, viewsPerSlot: 60 },
};
const DEALS = {
  d1: { dealType: 'Programmatic Guaranteed', cpm: 22 },
  d2: { dealType: 'Preferred deal', cpm: 18 },
  d3: { dealType: 'Private auction', cpm: 15 },
  d4: { dealType: 'Open auction', cpm: 11 },
};
const DEAL_DSP = { d1: 'DV360', d2: 'The Trade Desk', d3: 'Amazon DSP', d4: 'DV360' };
const ADVERTISERS = ['adv-blackmores', 'adv-acme', 'adv-nova'];
const SLOTS_PER_HOUR = 6;

function generateTestRetailer({ days = 90, endDate = '2026-10-11', stores = 5, seed = 7, settledThroughDaysAgo = 3 } = {}) {
  const rand = rng(seed);
  const storeIds = Array.from({ length: stores }, (_, i) => `store-${i + 1}`);
  const ctx = {
    displayTypes: DISPLAY_TYPES,
    stores: Object.fromEntries(storeIds.map((id) => [id, { open: 8, close: 20 }])),
    deals: DEALS,
  };
  const billing = [];
  const slotRecords = [];
  const dealIds = Object.keys(DEALS);
  for (let d = 0; d < days; d += 1) {
    const date = new Date(Date.parse(`${endDate}T00:00:00Z`) - d * 86400000).toISOString().slice(0, 10);
    const settled = d >= settledThroughDaysAgo;
    for (const storeId of storeIds) {
      for (const [typeId, type] of Object.entries(DISPLAY_TYPES)) {
        const soldByDeal = {};
        for (let hour = 0; hour < 24; hour += 1) {
          const inside = calc.insideOperatingHours(hour, calc.operatingWindow(type, ctx.stores[storeId]));
          // Raw records exist for every hour, so outside-hours slots must be excluded downstream.
          const offline = rand() < 0.03 ? 1 : 0;
          const sold = inside ? Math.min(SLOTS_PER_HOUR - offline, Math.round(SLOTS_PER_HOUR * (0.45 + rand() * 0.45))) : 0;
          const unsold = SLOTS_PER_HOUR - offline - sold;
          for (const [status, count] of [['sold', sold], ['unsold', unsold], ['offline', offline]]) {
            if (count > 0) slotRecords.push({ date, storeId, displayTypeId: typeId, hour, status, count, views: type.viewsPerSlot });
          }
          for (let s = 0; s < sold; s += 1) {
            const dealId = dealIds[Math.floor(rand() * dealIds.length)];
            soldByDeal[dealId] = (soldByDeal[dealId] || 0) + 1;
          }
        }
        for (const [dealId, slots] of Object.entries(soldByDeal)) {
          const views = slots * type.viewsPerSlot;
          billing.push({
            date, storeId, displayTypeId: typeId, dealId, dsp: DEAL_DSP[dealId],
            advertiserId: ADVERTISERS[(dealIds.indexOf(dealId) + storeIds.indexOf(storeId)) % ADVERTISERS.length],
            revenue: calc.revenueAtCpm(DEALS[dealId].cpm, views), views, slots, settled,
          });
        }
      }
    }
  }
  return { raw: { billing, slotRecords }, ctx };
}

module.exports = { generateTestRetailer, rng, DISPLAY_TYPES, DEALS, ADVERTISERS, SLOTS_PER_HOUR };
