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

// Per type: PH Core / DSP Integration facts (description, Touch Point, canvas, orientation, creative formats),
// slot configuration (counts and average durations, so loop length = sum of count x duration) and the
// average VAC-d inputs (footfall x visibility x share of loop = viewsPerSlot).
const DISPLAY_TYPES = {
  window: {
    name: 'Window Portrait', zone: 'Entrance & out of category', is24Hour: true, floorCpm: 12, displaysPerStore: 2, viewsPerSlot: 200,
    description: 'Portrait screen in the shop window, visible from outside the store.',
    touchPoint: 'Digital Signage', canvas: { width: 1080, height: 1920 }, orientation: '90°',
    creativeFormats: ['Image + video, 1080×1920, max play 6s'],
    slots: { advertiser: { count: 8, avgSeconds: 6 }, ownContent: { count: 4, avgSeconds: 3 } },
    footfall: 4000, visibility: 0.5,
  },
  endcap: {
    name: 'Endcap Shelf-edge', zone: 'Entrance & out of category', is24Hour: false, floorCpm: 8, displaysPerStore: 4, viewsPerSlot: 120,
    description: 'Shelf-edge strip screen on a gondola end.',
    touchPoint: 'Digital Signage', canvas: { width: 1920, height: 360 }, orientation: 'Not set',
    creativeFormats: ['Image + video, 1920×360, max play 6s'],
    slots: { advertiser: { count: 5, avgSeconds: 6 }, ownContent: { count: 5, avgSeconds: 6 } },
    footfall: 3000, visibility: 0.4,
  },
  queue: {
    name: 'Queue Screen', zone: 'Checkout', is24Hour: false, floorCpm: 10, displaysPerStore: 3, viewsPerSlot: 90,
    description: 'Shopper-facing screen in the checkout queue.',
    touchPoint: 'Digital Signage', canvas: { width: 1920, height: 1080 }, orientation: 'Not set',
    creativeFormats: ['Image + video, 1920×1080, max play 10s'],
    slots: { advertiser: { count: 6, avgSeconds: 10 }, ownContent: { count: 2, avgSeconds: 15 } },
    footfall: 1800, visibility: 0.45,
  },
  dispensary: {
    name: 'Dispensary Screen', zone: 'Other & connected store', is24Hour: false, floorCpm: 6, displaysPerStore: 1, viewsPerSlot: 60,
    description: 'Screen at the pharmacy dispensary.',
    touchPoint: 'Digital Signage', canvas: { width: 1920, height: 1080 }, orientation: 'Not set',
    creativeFormats: ['Image + video, 1920×1080, max play 15s'],
    slots: { advertiser: { count: 4, avgSeconds: 15 }, ownContent: { count: 2, avgSeconds: 15 } },
    footfall: 900, visibility: 0.4,
  },
};
// Per-store footfall factor; averages to 1 over the default 5 stores.
const FOOTFALL_FACTORS = [0.9, 1.1, 1.0, 0.8, 1.2];
const DEALS = {
  d1: { dealType: 'Programmatic guaranteed', cpm: 22 },
  d2: { dealType: 'Preferred deal', cpm: 18 },
  d3: { dealType: 'Private auction', cpm: 15 },
  d4: { dealType: 'Open auction', cpm: 11 },
};
const DEAL_DSP = { d1: 'DV360', d2: 'The Trade Desk', d3: 'Amazon DSP', d4: 'DV360' };
// Deal reference data as DSP Integration will serve it (Deals & buyers lists, slot assignments).
const DEAL_CATALOG = {
  d1: {
    name: 'Wellness PG', description: 'Guaranteed wellness reach on windows and queue screens.', dealType: 'Programmatic guaranteed', phId: 'PH-D1', cpm: 22,
    buyers: [{ advertiserId: 'adv-blackmores', dsp: 'DV360' }, { advertiserId: 'adv-acme', dsp: 'The Trade Desk' }],
    slots: [
      { displayTypeId: 'window', playlist: 'Window loop', zone: 'Zone A', position: 1, loopSlot: 2, playsPerWindow: 12 },
      { displayTypeId: 'queue', playlist: 'Queue loop', zone: 'Zone A', position: 1, loopSlot: 1, playsPerWindow: 10 },
    ],
    flight: { start: '2026-09-20', end: '2026-11-20' }, forecast: 4000000, buffer: 0.1,
  },
  d2: {
    name: 'Everyday Preferred', description: 'Preferred access to endcap and queue slots at a fixed rate.', dealType: 'Preferred deal', phId: 'PH-D2', cpm: 18,
    buyers: [{ advertiserId: 'adv-acme', dsp: 'The Trade Desk' }],
    slots: [
      { displayTypeId: 'endcap', playlist: 'Endcap loop', zone: 'Zone A', position: 2, loopSlot: 3, playsPerWindow: 8 },
      { displayTypeId: 'queue', playlist: 'Queue loop', zone: 'Zone A', position: 2, loopSlot: 3, playsPerWindow: 10 },
    ],
  },
  d3: {
    name: 'Pharmacy Private', description: 'Invited private auction on dispensary and window screens.', dealType: 'Private auction', phId: 'PH-D3', cpm: 15, floorCpm: 14,
    buyers: [{ advertiserId: 'adv-nova', dsp: 'Amazon DSP' }, { advertiserId: 'adv-blackmores', dsp: 'DV360' }],
    slots: [
      { displayTypeId: 'dispensary', playlist: 'Dispensary loop', zone: 'Zone B', position: 1, loopSlot: 1, playsPerWindow: 6 },
      { displayTypeId: 'window', playlist: 'Window loop', zone: 'Zone A', position: 3, loopSlot: 5, playsPerWindow: 12 },
    ],
  },
  d4: { name: 'Open auction', description: 'The open exchange.', dealType: 'Open auction', phId: 'PH-D4', cpm: 11, buyers: [], slots: [] },
};
const ADVERTISERS = ['adv-blackmores', 'adv-acme', 'adv-nova'];
const SLOTS_PER_HOUR = 6;
const ADVERTISER_META = {
  'adv-blackmores': { name: 'Blackmores', dsp: 'DV360' },
  'adv-acme': { name: 'Acme', dsp: 'The Trade Desk' },
  'adv-nova': { name: 'Nova', dsp: 'Amazon DSP' },
};

// Campaign submissions, as day offsets back from endDate (start, end; null = still live).
// Blackmores is Personalised (a Daypart entry is scheduling, not a variable and is dropped);
// Acme is Localised; Nova has only default targeting and no scheduling.
const CAMPAIGNS = [
  { id: 'c1', advertiserId: 'adv-blackmores', startAgo: 80, endAgo: null, variables: ['Visitor Segments', 'State', 'Daypart'], scheduled: true, schedules: 2, targetedVersions: 3 },
  { id: 'c2', advertiserId: 'adv-blackmores', startAgo: 30, endAgo: null, variables: ['State'], scheduled: false, targetedVersions: 1 },
  { id: 'c3', advertiserId: 'adv-acme', startAgo: 60, endAgo: null, variables: ['State', 'Postcode', 'Suburb'], scheduled: true, schedules: 1, targetedVersions: 2 },
  { id: 'c4', advertiserId: 'adv-acme', startAgo: 20, endAgo: null, variables: [], scheduled: false, targetedVersions: 0 },
  { id: 'c5', advertiserId: 'adv-nova', startAgo: 45, endAgo: null, variables: [], scheduled: false, targetedVersions: 0 },
];

function generateTestRetailer({ days = 90, endDate = '2026-10-11', stores = 5, seed = 7, settledThroughDaysAgo = 3 } = {}) {
  const rand = rng(seed);
  const storeIds = Array.from({ length: stores }, (_, i) => `store-${i + 1}`);
  const ctx = {
    displayTypes: DISPLAY_TYPES,
    stores: Object.fromEntries(storeIds.map((id) => [id, { open: 8, close: 20 }])),
    deals: DEALS,
    dealCatalog: DEAL_CATALOG,
    displays: storeIds.flatMap((storeId, i) => Object.entries(DISPLAY_TYPES).flatMap(([displayTypeId, type]) => (
      Array.from({ length: type.displaysPerStore }, (_, k) => ({
        id: `${displayTypeId}-${storeId}-${k + 1}`, displayTypeId, storeId,
        footfall: Math.round(type.footfall * FOOTFALL_FACTORS[i % FOOTFALL_FACTORS.length]), visibility: type.visibility,
      }))
    ))),
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
            if (count <= 0) continue;
            const rec = { date, storeId, displayTypeId: typeId, hour, status, count, views: type.viewsPerSlot };
            // Lost-revenue report: an offline slot loses what it would have earned at the average deal CPM.
            if (status === 'offline') rec.lostRevenue = calc.revenueAtCpm(15, type.viewsPerSlot) * count;
            slotRecords.push(rec);
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
  const dayOf = (ago) => (ago === null ? null : new Date(Date.parse(`${endDate}T00:00:00Z`) - ago * 86400000).toISOString().slice(0, 10));
  const campaigns = CAMPAIGNS.map(({ startAgo, endAgo, ...c }) => ({ ...c, start: dayOf(startAgo), end: dayOf(endAgo) }));
  ctx.advertisers = ADVERTISER_META;
  return { raw: { billing, slotRecords, campaigns }, ctx };
}

module.exports = { generateTestRetailer, rng, DISPLAY_TYPES, DEALS, ADVERTISERS, SLOTS_PER_HOUR };
