'use strict';
// A deterministic 5-store test retailer (README "Store zones" sample data): Window Portrait (24h,
// 2 displays per store), Endcap Shelf-edge (4), Queue Screen (3), Dispensary Screen (1). Stores
// open 08:00-20:00. Each slot record counts advertiser slot plays in one hour of one day.
//
// The data follows its own configuration (README sample-data rules):
//  - inventory scales with the estate: plays per hour = connected displays x advertiser slots x loops per hour;
//  - one sold slot-day (one advertiser slot on one display for a day) delivers the type's average assumed
//    views per slot per day (footfall x visibility x slot seconds / loop seconds), spread over its plays;
//  - an advertiser slot position belongs to the deal that assigns it, else to the open auction; only that
//    deal's buyers are billed there, through their own DSP seat, so sold plays never exceed a deal's opportunities;
//  - auctions clear at or above the floor (deal floor for a private auction, display type floor for open).

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
// VAC-d inputs (footfall x visibility; views per slot per day = footfall x visibility x share of loop).
const DISPLAY_TYPES = {
  window: {
    name: 'Window Portrait', zone: 'Entrance & out of category', is24Hour: true, floorCpm: 12, displaysPerStore: 2,
    description: 'Portrait screen in the shop window, visible from outside the store.',
    touchPoint: 'Digital Signage', canvas: { width: 1080, height: 1920 }, orientation: '90°',
    creativeFormats: ['Image + video, 1080×1920, max play 6s'],
    slots: { advertiser: { count: 8, avgSeconds: 6 }, ownContent: { count: 4, avgSeconds: 3 } },
    footfall: 4000, visibility: 0.5,
  },
  endcap: {
    name: 'Endcap Shelf-edge', zone: 'Entrance & out of category', is24Hour: false, floorCpm: 8, displaysPerStore: 4,
    description: 'Shelf-edge strip screen on a gondola end.',
    touchPoint: 'Digital Signage', canvas: { width: 1920, height: 360 }, orientation: 'Not set',
    creativeFormats: ['Image + video, 1920×360, max play 6s'],
    slots: { advertiser: { count: 5, avgSeconds: 6 }, ownContent: { count: 5, avgSeconds: 6 } },
    footfall: 3000, visibility: 0.4,
  },
  queue: {
    name: 'Queue Screen', zone: 'Checkout', is24Hour: false, floorCpm: 10, displaysPerStore: 3,
    description: 'Shopper-facing screen in the checkout queue.',
    touchPoint: 'Digital Signage', canvas: { width: 1920, height: 1080 }, orientation: 'Not set',
    creativeFormats: ['Image + video, 1920×1080, max play 10s'],
    slots: { advertiser: { count: 6, avgSeconds: 10 }, ownContent: { count: 2, avgSeconds: 15 } },
    footfall: 1800, visibility: 0.45,
  },
  dispensary: {
    name: 'Dispensary Screen', zone: 'Other & connected store', is24Hour: false, floorCpm: 6, displaysPerStore: 1,
    description: 'Screen at the pharmacy dispensary.',
    touchPoint: 'Digital Signage', canvas: { width: 1920, height: 1080 }, orientation: 'Not set',
    creativeFormats: ['Image + video, 1920×1080, max play 15s'],
    slots: { advertiser: { count: 4, avgSeconds: 15 }, ownContent: { count: 2, avgSeconds: 15 } },
    footfall: 900, visibility: 0.4,
  },
};
// Per-store footfall factor; averages to 1 over the default 5 stores.
const FOOTFALL_FACTORS = [0.9, 1.1, 1.0, 0.8, 1.2];
// Sell-through (share of non-offline slots sold) is deterministic by display type, store and day, so the page has a
// spread to read: Queue Screen sells out (amber at 85%+), Dispensary Screen sits half empty. Type base, +/-1 point by
// store, +/-0.8 point by day-of-week, plus a little noise; every figure stays inside the type's stated band.
const SELL_THROUGH = { queue: 0.9, endcap: 0.8, window: 0.7, dispensary: 0.585 };
const sellThrough = (typeId, storeIndex, dayIndex, noise) => (
  (SELL_THROUGH[typeId] || 0.67) + (storeIndex - 2) * 0.005 + ((dayIndex % 7) - 3) * 0.0025 + (noise - 0.5) * 0.01
);
const DEALS = {
  d1: { dealType: 'Programmatic guaranteed', cpm: 22 },
  d2: { dealType: 'Preferred deal', cpm: 18 },
  d3: { dealType: 'Private auction', cpm: 15, floorCpm: 14 },
  d4: { dealType: 'Open auction', cpm: 11 },
};
// Deal reference data as DSP Integration will serve it (Deals & buyers lists, slot assignments).
const DEAL_CATALOG = {
  d1: {
    name: 'Wellness PG', description: 'Guaranteed wellness reach on windows and queue screens.', dealType: 'Programmatic guaranteed', phId: 'PH-D1', cpm: 22,
    dealIds: { DV360: 'PH-A595WKW5P3' },
    buyers: [{ advertiserId: 'adv-blackmores', dsp: 'DV360' }], // Programmatic guaranteed: exactly one buyer
    slots: [
      { displayTypeId: 'window', playlist: 'Window loop', zone: 'Zone A', position: 1, loopSlot: 2, playsPerWindow: 12 },
      { displayTypeId: 'queue', playlist: 'Queue loop', zone: 'Zone A', position: 1, loopSlot: 1, playsPerWindow: 10 },
    ],
    flight: { start: '2026-09-20', end: '2026-11-20' }, forecast: 130000, buffer: 0.1,
  },
  d2: {
    name: 'Everyday Preferred', description: 'Preferred access to endcap and queue slots at a fixed rate.', dealType: 'Preferred deal', phId: 'PH-D2', cpm: 18,
    dealIds: { 'The Trade Desk': 'PH-9ANQZ5XWMD' },
    buyers: [{ advertiserId: 'adv-acme', dsp: 'The Trade Desk' }], // Preferred deal: exactly one buyer
    slots: [
      { displayTypeId: 'endcap', playlist: 'Endcap loop', zone: 'Zone A', position: 2, loopSlot: 3, playsPerWindow: 8 },
      { displayTypeId: 'queue', playlist: 'Queue loop', zone: 'Zone A', position: 2, loopSlot: 3, playsPerWindow: 10 },
    ],
  },
  d3: {
    name: 'Pharmacy Private', description: 'Invited private auction on dispensary and window screens.', dealType: 'Private auction', phId: 'PH-D3', cpm: 15, floorCpm: 14,
    dealIds: { 'Amazon DSP': 'PH-WPCHN2JC8Q', DV360: 'PH-6KT3B8QD2F' },
    buyers: [{ advertiserId: 'adv-nova', dsp: 'Amazon DSP' }, { advertiserId: 'adv-blackmores', dsp: 'DV360' }],
    slots: [
      { displayTypeId: 'dispensary', playlist: 'Dispensary loop', zone: 'Zone B', position: 1, loopSlot: 1, playsPerWindow: 6 },
      { displayTypeId: 'window', playlist: 'Window loop', zone: 'Zone A', position: 3, loopSlot: 5, playsPerWindow: 12 },
    ],
  },
  d4: { name: 'Open auction', description: 'The open exchange.', dealType: 'Open auction', phId: 'PH-D4', cpm: 11, buyers: [], slots: [] },
};
// Shared Targeting Variables shared with each DSP (README: the mockup's assumption).
const SHARED_VARIABLES = Object.fromEntries(['DV360', 'The Trade Desk', 'Amazon DSP'].map((dsp) => [dsp, [
  'Store Open / Closed', 'Fixed Store Segments', 'Variable Store Segments', 'Display Tag(s)', 'Suburb', 'State',
  'Gender (Computer Vision)', 'Estimated Age (Computer Vision)', 'Reason for Visit (Aggregate)', 'Device Type (Aggregate)',
  'Purchase Intent', 'Purchase History', 'SKUs', 'Events', 'Visitor Segments',
]]));
const ADVERTISERS = ['adv-blackmores', 'adv-acme', 'adv-nova'];
const OPEN_AUCTION_DEAL = 'd4';
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
    stores: Object.fromEntries(storeIds.map((id, i) => [id, { name: `Store ${i + 1}`, open: 8, close: 20 }])),
    deals: DEALS,
    dealCatalog: DEAL_CATALOG,
    sharedVariables: SHARED_VARIABLES,
    displays: storeIds.flatMap((storeId, i) => Object.entries(DISPLAY_TYPES).flatMap(([displayTypeId, type]) => (
      Array.from({ length: type.displaysPerStore }, (_, k) => ({
        id: `${displayTypeId}-${storeId}-${k + 1}`, displayTypeId, storeId,
        footfall: Math.round(type.footfall * FOOTFALL_FACTORS[i % FOOTFALL_FACTORS.length]), visibility: type.visibility,
      }))
    ))),
  };
  const billing = [];
  const slotRecords = [];
  // Who owns each advertiser slot position: the deal that assigns it, else the open auction.
  const ownerOf = (typeId, position) => (Object.entries(DEAL_CATALOG).find(([, d]) => d.slots.some((x) => x.displayTypeId === typeId && x.position === position)) || [OPEN_AUCTION_DEAL])[0];
  // Billed buyers of a deal (its buyers list, each on its own DSP seat); the open auction is open to everyone.
  const buyersOf = (dealId) => (dealId === OPEN_AUCTION_DEAL
    ? ADVERTISERS.map((advertiserId) => ({ advertiserId, dsp: ADVERTISER_META[advertiserId].dsp }))
    : DEAL_CATALOG[dealId].buyers);
  // Cleared price: fixed deals bill their CPM; auctions clear above their floor (strictly, so rounding never lands below it).
  const clearedCpm = (dealId, type) => {
    const deal = DEAL_CATALOG[dealId];
    if (deal.dealType === 'Open auction') return Math.round(type.floorCpm * (1.02 + rand() * 0.35) * 100) / 100;
    if (deal.dealType === 'Private auction') return Math.round(deal.floorCpm * (1.02 + rand() * 0.3) * 100) / 100;
    return deal.cpm;
  };
  for (let d = 0; d < days; d += 1) {
    const date = new Date(Date.parse(`${endDate}T00:00:00Z`) - d * 86400000).toISOString().slice(0, 10);
    const settled = d >= settledThroughDaysAgo;
    storeIds.forEach((storeId, storeIndex) => {
      for (const [typeId, type] of Object.entries(DISPLAY_TYPES)) {
        const { advertiser, ownContent } = type.slots;
        const loopSeconds = advertiser.count * advertiser.avgSeconds + ownContent.count * ownContent.avgSeconds;
        const loopsPerHour = Math.round(3600 / loopSeconds);
        const window = calc.operatingWindow(type, ctx.stores[storeId]);
        const hoursOpen = window.close - window.open;
        // Plays one advertiser slot position makes per hour, across the type's displays in this store.
        const capacity = type.displaysPerStore * loopsPerHour;
        // One sold slot-day (one position, one display, all operating hours) delivers the average assumed views.
        const footfall = Math.round(type.footfall * FOOTFALL_FACTORS[storeIndex % FOOTFALL_FACTORS.length]);
        const viewsPerPlay = hoursOpen > 0 ? calc.assumedViewsPerSlotPerDay(footfall, type.visibility, advertiser.avgSeconds, loopSeconds) / (loopsPerHour * hoursOpen) : 0;
        const soldBy = new Map(); // `${dealId}|${advertiserId}` -> plays
        for (let hour = 0; hour < 24; hour += 1) {
          if (!calc.insideOperatingHours(hour, window)) {
            // Raw records exist for every hour, so outside-hours slots must be excluded downstream.
            slotRecords.push({ date, storeId, displayTypeId: typeId, hour, status: 'unsold', count: capacity * advertiser.count, views: viewsPerPlay });
            continue;
          }
          const totals = { sold: 0, unsold: 0, offline: 0 };
          for (let position = 1; position <= advertiser.count; position += 1) {
            const offline = rand() < 0.03 ? Math.round(capacity * 0.15) : 0;
            const sold = Math.round((capacity - offline) * sellThrough(typeId, storeIndex, d, rand()));
            totals.sold += sold; totals.offline += offline; totals.unsold += capacity - offline - sold;
            const dealId = ownerOf(typeId, position);
            const buyers = buyersOf(dealId);
            const weights = buyers.map(() => 0.5 + rand());
            const weightSum = weights.reduce((a, b) => a + b, 0);
            let left = sold;
            buyers.forEach((b, i) => {
              const n = i === buyers.length - 1 ? left : Math.min(left, Math.floor((sold * weights[i]) / weightSum));
              left -= n;
              soldBy.set(`${dealId}|${b.advertiserId}`, (soldBy.get(`${dealId}|${b.advertiserId}`) || 0) + n);
            });
          }
          for (const status of ['sold', 'unsold', 'offline']) {
            if (totals[status] <= 0) continue;
            const rec = { date, storeId, displayTypeId: typeId, hour, status, count: totals[status], views: viewsPerPlay };
            // Lost-revenue report: an offline slot loses what it would have earned at the average deal CPM.
            if (status === 'offline') rec.lostRevenue = calc.revenueAtCpm(15, viewsPerPlay) * rec.count;
            slotRecords.push(rec);
          }
        }
        for (const [key, slots] of soldBy) {
          if (slots <= 0) continue;
          const [dealId, advertiserId] = key.split('|');
          const buyer = buyersOf(dealId).find((b) => b.advertiserId === advertiserId);
          const views = Math.round(slots * viewsPerPlay); // VAC-d views are whole numbers
          billing.push({
            date, storeId, displayTypeId: typeId, dealId, dsp: buyer.dsp, advertiserId,
            revenue: calc.revenueAtCpm(clearedCpm(dealId, type), views), views, slots, settled,
          });
        }
      }
    });
  }
  const dayOf = (ago) => (ago === null ? null : new Date(Date.parse(`${endDate}T00:00:00Z`) - ago * 86400000).toISOString().slice(0, 10));
  const campaigns = CAMPAIGNS.map(({ startAgo, endAgo, ...c }) => ({ ...c, start: dayOf(startAgo), end: dayOf(endAgo) }));
  ctx.advertisers = ADVERTISER_META;
  return { raw: { billing, slotRecords, campaigns }, ctx };
}

module.exports = { generateTestRetailer, rng, DISPLAY_TYPES, DEALS, DEAL_CATALOG, ADVERTISERS, ADVERTISER_META, OPEN_AUCTION_DEAL };
