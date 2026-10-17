'use strict';
// A deterministic 5-store test retailer, the approved artifact's example retailer (README "Store zones" sample data):
// Window Portrait (24h, 2 displays per store), Endcap Shelf-edge (4), Queue Screen (3), Dispensary Screen (1). Stores
// open 08:00-20:00. Each slot record counts advertiser slot plays in one hour of one day. 120 played days end on
// 11 Oct 2026, every one of them earned (settled); the estimated figures are Programmatic guaranteed reservations booked
// ahead of the last played day (README "Deal types"), which add no inventory or slot records.
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
// `footfall` is the type's base per display; the store factors below average 1.1, so the average over the estate is footfall x 1.1.
const DISPLAY_TYPES = {
  window: {
    name: 'Window Portrait', zone: 'Entrance & out of category', is24Hour: true, floorCpm: 7.5, displaysPerStore: 2,
    description: 'Portrait screen in the store window at the entrance.',
    touchPoint: 'Digital Signage', canvas: { width: 1080, height: 1920 }, orientation: '90°',
    creativeFormats: ['Image + video, 1080×1920, max play 6s'],
    slots: { advertiser: { count: 8, avgSeconds: 6 }, ownContent: { count: 4, avgSeconds: 3 } },
    footfall: 5590, visibility: 0.55,
  },
  endcap: {
    name: 'Endcap Shelf-edge', zone: 'Entrance & out of category', is24Hour: false, floorCpm: 6, displaysPerStore: 4,
    description: 'Strip screen on the shelf edge of gondola ends.',
    touchPoint: 'Digital Signage', canvas: { width: 1920, height: 360 }, orientation: 'Not set',
    creativeFormats: ['Image + video, 1920×360, max play 5s'],
    slots: { advertiser: { count: 6, avgSeconds: 5 }, ownContent: { count: 2, avgSeconds: 5 } },
    footfall: 690, visibility: 0.35,
  },
  queue: {
    name: 'Queue Screen', zone: 'Checkout', is24Hour: false, floorCpm: 5.5, displaysPerStore: 3,
    description: 'In-queue screen beside the checkout.',
    touchPoint: 'Digital Signage', canvas: { width: 1920, height: 1080 }, orientation: 'Not set',
    creativeFormats: ['Image + video, 1920×1080, max play 6s'],
    slots: { advertiser: { count: 3, avgSeconds: 6 }, ownContent: { count: 3, avgSeconds: 4 } },
    footfall: 1690, visibility: 0.7,
  },
  dispensary: {
    name: 'Dispensary Screen', zone: 'Other & connected store', is24Hour: false, floorCpm: 7, displaysPerStore: 1,
    description: 'Screen above the pharmacy dispensary counter.',
    touchPoint: 'Digital Signage', canvas: { width: 1920, height: 1080 }, orientation: 'Not set',
    creativeFormats: ['Image + video, 1920×1080, max play 5s'],
    slots: { advertiser: { count: 6, avgSeconds: 5 }, ownContent: { count: 4, avgSeconds: 5 } },
    footfall: 5090, visibility: 0.6,
  },
};
const DSPS_ORDER = ['DV360', 'The Trade Desk', 'Amazon DSP'];
const AVERAGE_CPM = 8; // the lost-revenue report values an offline slot at the average deal CPM
const STORE_NAMES = ['London Oxford St', 'Manchester Arndale', 'Bristol Cabot Circus', 'Leeds Trinity', 'Glasgow Buchanan St'];
// Per-store footfall factor; averages 1.1 over the default 5 stores.
const FOOTFALL_FACTORS = [1.6, 1.2, 0.9, 0.8, 1.0];
const loopSecondsOf = (type) => type.slots.advertiser.count * type.slots.advertiser.avgSeconds + type.slots.ownContent.count * type.slots.ownContent.avgSeconds;
const loopsPerHourOf = (type) => Math.round(3600 / loopSecondsOf(type));

// The retailer's advertisers: the DSP each buys through, its share of revenue on a deal (weight) and how readily it bids in the open auction.
const ADVERTISER_PROFILES = [
  { id: 'adv-blackmores', name: 'Blackmores', dsp: 'DV360', weight: 0.15, open: 0.20 },
  { id: 'adv-haleon', name: 'Haleon', dsp: 'The Trade Desk', weight: 0.14, open: 0.45 },
  { id: 'adv-loreal-paris', name: "L'Oréal Paris", dsp: 'DV360', weight: 0.12, open: 0.40 },
  { id: 'adv-vitabiotics', name: 'Vitabiotics', dsp: 'The Trade Desk', weight: 0.10, open: 0.30 },
  { id: 'adv-bayer-consumer-health', name: 'Bayer Consumer Health', dsp: 'Amazon DSP', weight: 0.09, open: 0.40 },
  { id: 'adv-reckitt', name: 'Reckitt', dsp: 'Amazon DSP', weight: 0.08, open: 0.70 },
  { id: 'adv-kenvue', name: 'Kenvue', dsp: 'DV360', weight: 0.08, open: 0.50 },
  { id: 'adv-procter-gamble', name: 'Procter & Gamble', dsp: 'The Trade Desk', weight: 0.07, open: 0.60 },
  { id: 'adv-unilever', name: 'Unilever', dsp: 'Amazon DSP', weight: 0.06, open: 0.80 },
  { id: 'adv-nestle-health-science', name: 'Nestlé Health Science', dsp: 'DV360', weight: 0.06, open: 0.05 },
  { id: 'adv-perrigo', name: 'Perrigo', dsp: 'The Trade Desk', weight: 0.05, open: 0.80 },
];
const ADVERTISERS = ADVERTISER_PROFILES.map((a) => a.id);
const ADVERTISER_META = Object.fromEntries(ADVERTISER_PROFILES.map((a) => [a.id, { name: a.name, dsp: a.dsp }]));
const PROFILE = Object.fromEntries(ADVERTISER_PROFILES.map((a) => [a.id, a]));
const OPEN_AUCTION_DEAL = 'd10';

const PLAYLISTS = { window: ['Window loop', 'Store front'], endcap: ['Endcap loop', 'Aisle ends'], queue: ['Checkout loop', 'Tills'], dispensary: ['Pharmacy loop', 'Dispensary'] };
const slotsOf = (typeId, positions) => positions.map((position) => ({
  displayTypeId: typeId, playlist: PLAYLISTS[typeId][0], zone: PLAYLISTS[typeId][1], position, loopSlot: position, playsPerWindow: loopsPerHourOf(DISPLAY_TYPES[typeId]),
}));

// Deal reference data as DSP Integration will serve it (Deals & buyers lists, slot assignments). `fill` is the share of the
// deal's slot opportunities that sell; positions no deal assigns belong to the open auction (OPEN_FILL).
const DEAL_SPECS = [
  ['d1', 'Immune — winter launch', 'Programmatic guaranteed', 9.5, ['adv-blackmores'], slotsOf('window', [1, 2]), 0.95,
    'Guaranteed Window Portrait plays for the Blackmores Immune winter launch, 15 Sep – 15 Nov.'],
  ['d2', 'Sensodyne always-on', 'Programmatic guaranteed', 8, ['adv-haleon'], slotsOf('queue', [1]), 0.95,
    'Always-on guaranteed Queue Screen plays for Haleon Sensodyne at the checkout.'],
  ['d3', 'Revitalift first look', 'Preferred deal', 8.8, ['adv-loreal-paris'], slotsOf('endcap', [1, 2]), 0.72,
    "First look for L'Oréal Paris on Endcap Shelf-edge slots at a fixed CPM."],
  ['d4', 'Dispensary first look', 'Preferred deal', 8.2, ['adv-kenvue'], slotsOf('dispensary', [1]), 0.55,
    'First look for Kenvue on Dispensary Screen slots at a fixed CPM.'],
  ['d5', 'Health & wellness windows', 'Private auction', 7.5, ['adv-blackmores', 'adv-haleon', 'adv-vitabiotics', 'adv-bayer-consumer-health', 'adv-nestle-health-science'], slotsOf('window', [3, 4, 5]), 0.92,
    'Health & wellness brands bidding on Window Portrait slots against the deal floor.'],
  ['d6', 'Dispensary screens', 'Private auction', 7, ['adv-blackmores', 'adv-haleon', 'adv-bayer-consumer-health', 'adv-reckitt'], slotsOf('dispensary', [2, 3, 4]), 0.84,
    'Health brands bidding on Dispensary Screen slots beside the pharmacy counter.'],
  ['d7', 'Beauty endcaps', 'Private auction', 6, ['adv-loreal-paris', 'adv-kenvue'], slotsOf('endcap', [3, 4]), 0.52,
    'Beauty brands bidding on Endcap Shelf-edge slots at the gondola ends.'],
  ['d8', 'Queue screens', 'Private auction', 5.5, ['adv-haleon', 'adv-procter-gamble', 'adv-unilever', 'adv-perrigo'], slotsOf('queue', [2]), 0.9,
    'Everyday brands bidding on Queue Screen slots at the checkout.'],
  ['d9', 'Store-wide wellness', 'Private auction', 6.5, ['adv-vitabiotics', 'adv-nestle-health-science', 'adv-perrigo'], [...slotsOf('dispensary', [5]), ...slotsOf('endcap', [5])], 0.56,
    'Wellness brands bidding across Dispensary Screen and Endcap Shelf-edge slots.'],
];
// Fill of the positions no deal assigns (the open auction), set so each type's overall sell-through lands on its target:
// Window and Queue about 89% (amber), Dispensary about 61%, Endcap about 56%.
const OPEN_FILL = { window: 0.82, queue: 0.82, dispensary: 0.05, endcap: 0.32 };
const FLIGHTS = { d1: { start: '2026-09-15', end: '2026-11-15', pacing: 0.93 }, d2: { start: '2026-08-01', end: '2026-12-31', pacing: 1.01 } };
const RESERVE_UNTIL = '2026-12-31';

// One deal ID per DSP with an invited buyer: PH- plus 10 characters (A-Z, 0-9), minted deterministically.
function mintDealIds(dsps, rand) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  return Object.fromEntries(dsps.map((dsp) => [dsp, `PH-${Array.from({ length: 10 }, () => chars[Math.floor(rand() * chars.length)]).join('')}`]));
}
const mintRand = rng(2026);
const DEAL_CATALOG = Object.fromEntries(DEAL_SPECS.map(([id, name, dealType, cpm, buyers, slots, , description], i) => {
  const buyerList = buyers.map((advertiserId) => ({ advertiserId, dsp: PROFILE[advertiserId].dsp }));
  const dspsInOrder = DSPS_ORDER.filter((d) => buyerList.some((b) => b.dsp === d));
  const deal = { name, description, dealType, phId: `PH-D${i + 1}`, cpm, dealIds: mintDealIds(dspsInOrder, mintRand), buyers: buyerList, slots };
  if (dealType === 'Private auction') deal.floorCpm = cpm;
  if (FLIGHTS[id]) { deal.flight = { start: FLIGHTS[id].start, end: FLIGHTS[id].end }; deal.forecast = 100000; deal.buffer = 0.1; }
  return [id, deal];
}));
DEAL_CATALOG[OPEN_AUCTION_DEAL] = { name: 'Open auction', description: 'The open exchange.', dealType: 'Open auction', phId: 'PH-D10', cpm: 6.5, buyers: [], slots: [] };
const DEALS = Object.fromEntries(Object.entries(DEAL_CATALOG).map(([id, d]) => [id, { dealType: d.dealType, cpm: d.cpm, ...(d.floorCpm != null ? { floorCpm: d.floorCpm } : {}) }]));
const FILL = Object.fromEntries(DEAL_SPECS.map((d) => [d[0], d[6]]));

// Shared Targeting Variables shared with each DSP (README: the mockup's assumption).
const SHARED_VARIABLES = Object.fromEntries(DSPS_ORDER.map((dsp) => [dsp, [
  'Store Open / Closed', 'Fixed Store Segments', 'Variable Store Segments', 'Display Tag(s)', 'Suburb', 'State',
  'Gender (Computer Vision)', 'Estimated Age (Computer Vision)', 'Reason for Visit (Aggregate)', 'Device Type (Aggregate)',
  'Purchase Intent', 'Purchase History', 'SKUs', 'Events', 'Visitor Segments',
]]));

// Campaign submissions. Each advertiser launches one about every `cadence` days (anchorAgo = days before the last played day
// of the newest), each live CAMPAIGN_LIVE_DAYS. Maturity grows: a campaign is Default only before the advertiser's localAgo,
// Localised from there and Personalised from persAgo (days before the last played day), up to its final level.
// `types` is where its campaigns run; `schedules` are the schedules of its newest campaigns (newest first; absent = none).
const CAMPAIGN_LIVE_DAYS = 35;
const HISTORY_DAYS = 120;
const LOCALISED_VARIABLES = ['Store Open / Closed', 'Fixed Store Segments', 'Variable Store Segments', 'Display Tag(s)'];
const CAMPAIGN_PLAN = {
  'adv-blackmores': { cadence: 14, anchorAgo: 8, final: 'Personalised', localAgo: 115, persAgo: 80, types: ['window', 'dispensary', 'queue'], pers: ['Gender (Computer Vision)', 'Reason for Visit (Aggregate)'], schedules: [2, 1, 0, 2] },
  'adv-haleon': { cadence: 14, anchorAgo: 9, final: 'Personalised', localAgo: 100, persAgo: 60, types: ['window', 'queue', 'dispensary'], pers: ['Estimated Age (Computer Vision)', 'Gender (Computer Vision)'], schedules: [3, 2, 0, 2] },
  'adv-loreal-paris': { cadence: 28, anchorAgo: 10, final: 'Personalised', localAgo: 95, persAgo: 40, types: ['window', 'endcap', 'queue'], pers: ['Gender (Computer Vision)', 'Purchase History'], schedules: [1] },
  'adv-vitabiotics': { cadence: 14, anchorAgo: 10, final: 'Localised', localAgo: 100, types: ['window', 'dispensary', 'endcap'] },
  'adv-bayer-consumer-health': { cadence: 14, anchorAgo: 11, final: 'Localised', localAgo: 85, types: ['window', 'dispensary', 'queue'] },
  'adv-reckitt': { cadence: 14, anchorAgo: 12, final: 'Localised', localAgo: 70, types: ['queue', 'dispensary', 'endcap'] },
  'adv-kenvue': { cadence: 14, anchorAgo: 13, final: 'Personalised', localAgo: 90, persAgo: 50, types: ['endcap', 'dispensary', 'queue', 'window'], pers: ['Gender (Computer Vision)'] },
  'adv-procter-gamble': { cadence: 28, anchorAgo: 12, final: 'Personalised', localAgo: 95, persAgo: 45, types: ['queue', 'endcap', 'window'], pers: ['Estimated Age (Computer Vision)'], schedules: [3, 0] },
  'adv-unilever': { cadence: 14, anchorAgo: 9, final: 'Default only', types: ['queue', 'endcap', 'window'] },
  'adv-nestle-health-science': { cadence: 14, anchorAgo: 12, final: 'Localised', localAgo: 90, types: ['window', 'dispensary', 'endcap'], schedules: [3, 0, 2, 0] },
  'adv-perrigo': { cadence: 14, anchorAgo: 11, final: 'Default only', types: ['window', 'endcap', 'queue', 'dispensary'] },
};

function buildCampaigns(endDate) {
  const dayOf = (ago) => new Date(Date.parse(`${endDate}T00:00:00Z`) - ago * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const advertiserId of ADVERTISERS) {
    const plan = CAMPAIGN_PLAN[advertiserId];
    const slug = advertiserId.slice(4);
    for (let j = 0, ago = plan.anchorAgo; ago < HISTORY_DAYS; j += 1, ago += plan.cadence) {
      const personalised = plan.final === 'Personalised' && ago <= plan.persAgo;
      const localised = plan.final !== 'Default only' && ago <= plan.localAgo;
      const variables = [];
      if (personalised) variables.push(plan.pers[j % plan.pers.length], LOCALISED_VARIABLES[(j + 1) % LOCALISED_VARIABLES.length]);
      else if (localised) variables.push(LOCALISED_VARIABLES[j % LOCALISED_VARIABLES.length], ...(j % 2 ? [LOCALISED_VARIABLES[(j + 2) % LOCALISED_VARIABLES.length]] : []));
      const schedules = (plan.schedules || [])[j] || 0;
      out.push({
        id: `c-${slug}-${j + 1}`, advertiserId, startAgo: ago, endAgo: ago - (CAMPAIGN_LIVE_DAYS - 1) > 0 ? ago - (CAMPAIGN_LIVE_DAYS - 1) : null,
        displayTypeIds: plan.types, variables, scheduled: schedules > 0, schedules, targetedVersions: personalised ? 2 + (j % 2) : localised ? 1 : 0,
        start: dayOf(ago), end: ago - (CAMPAIGN_LIVE_DAYS - 1) > 0 ? dayOf(ago - (CAMPAIGN_LIVE_DAYS - 1)) : null,
      });
    }
  }
  return out.map(({ startAgo, endAgo, ...c }) => c);
}

function generateTestRetailer({ days = HISTORY_DAYS, endDate = '2026-10-11', stores = 5, seed = 7, reservations = true } = {}) {
  const rand = rng(seed);
  const storeIds = Array.from({ length: stores }, (_, i) => `store-${i + 1}`);
  const dealCatalog = structuredClone(DEAL_CATALOG);
  const campaignList = buildCampaigns(endDate);
  const ctx = {
    displayTypes: DISPLAY_TYPES,
    stores: Object.fromEntries(storeIds.map((id, i) => [id, { name: STORE_NAMES[i] || `Store ${i + 1}`, open: 8, close: 20 }])),
    deals: DEALS,
    dealCatalog,
    sharedVariables: SHARED_VARIABLES,
    connectedDsps: DSPS_ORDER,
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
  const ownerOf = (typeId, position) => (Object.entries(dealCatalog).find(([, d]) => d.slots.some((x) => x.displayTypeId === typeId && x.position === position)) || [OPEN_AUCTION_DEAL])[0];
  // Billed buyers of a deal (its buyers list, each on its own DSP seat) with the weight each carries; the open auction is open to
  // everyone, but bills an advertiser only on the display types its campaigns target, in proportion to how readily it bids there.
  const buyersOf = (dealId, typeId) => (dealId === OPEN_AUCTION_DEAL
    ? ADVERTISERS.filter((advertiserId) => CAMPAIGN_PLAN[advertiserId].types.includes(typeId))
      .map((advertiserId) => ({ advertiserId, dsp: PROFILE[advertiserId].dsp, weight: PROFILE[advertiserId].open + 0.05 }))
    : dealCatalog[dealId].buyers.map((b) => ({ ...b, weight: PROFILE[b.advertiserId].weight })));
  // Cleared price: fixed deals bill their CPM; auctions clear above their floor (strictly, so rounding never lands below it).
  const clearedCpm = (dealId, type) => {
    const deal = dealCatalog[dealId];
    if (deal.dealType === 'Open auction') return Math.round(type.floorCpm * (1.02 + rand() * 0.35) * 100) / 100;
    if (deal.dealType === 'Private auction') return Math.round(deal.floorCpm * (1.02 + rand() * 0.3) * 100) / 100;
    return deal.cpm;
  };
  // Share of a position's non-offline slots that sell: its deal's fill (or the open auction's for the type), +/-0.4 point by store,
  // +/-0.6 point by day-of-week, plus a little noise; deterministic by deal, type, store and day.
  const fillOf = (dealId, typeId, storeIndex, dayIndex, noise) => (
    (dealId === OPEN_AUCTION_DEAL ? OPEN_FILL[typeId] : FILL[dealId]) + (storeIndex - 2) * 0.004 + ((dayIndex % 7) - 3) * 0.002 + (noise - 0.5) * 0.01
  );
  // The assumed views one play of an advertiser slot delivers, per store and type.
  const viewsPerPlayOf = (type, storeIndex, window) => {
    const { advertiser } = type.slots;
    const hoursOpen = window.close - window.open;
    const footfall = Math.round(type.footfall * FOOTFALL_FACTORS[storeIndex % FOOTFALL_FACTORS.length]);
    return hoursOpen > 0 ? calc.assumedViewsPerSlotPerDay(footfall, type.visibility, advertiser.avgSeconds, loopSecondsOf(type)) / (loopsPerHourOf(type) * hoursOpen) : 0;
  };
  for (let d = 0; d < days; d += 1) {
    const date = new Date(Date.parse(`${endDate}T00:00:00Z`) - d * 86400000).toISOString().slice(0, 10);
    storeIds.forEach((storeId, storeIndex) => {
      for (const [typeId, type] of Object.entries(DISPLAY_TYPES)) {
        const { advertiser } = type.slots;
        const loopsPerHour = loopsPerHourOf(type);
        const window = calc.operatingWindow(type, ctx.stores[storeId]);
        // Plays one advertiser slot position makes per hour, across the type's displays in this store.
        const capacity = type.displaysPerStore * loopsPerHour;
        // One sold slot-day (one position, one display, all operating hours) delivers the average assumed views.
        const viewsPerPlay = viewsPerPlayOf(type, storeIndex, window);
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
            const dealId = ownerOf(typeId, position);
            const sold = Math.round((capacity - offline) * fillOf(dealId, typeId, storeIndex, d, rand()));
            totals.sold += sold; totals.offline += offline; totals.unsold += capacity - offline - sold;
            const buyers = buyersOf(dealId, typeId);
            const weights = buyers.map((b) => b.weight * (0.5 + rand()));
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
            if (status === 'offline') rec.lostRevenue = calc.revenueAtCpm(AVERAGE_CPM, viewsPerPlay) * rec.count;
            slotRecords.push(rec);
          }
        }
        for (const [key, slots] of soldBy) {
          if (slots <= 0) continue;
          const [dealId, advertiserId] = key.split('|');
          const buyer = buyersOf(dealId, typeId).find((b) => b.advertiserId === advertiserId);
          const views = Math.round(slots * viewsPerPlay); // VAC-d views are whole numbers
          billing.push({
            date, storeId, displayTypeId: typeId, dealId, dsp: buyer.dsp, advertiserId,
            revenue: calc.revenueAtCpm(clearedCpm(dealId, type), views), views, slots, settled: true,
          });
        }
      }
    });
  }
  // Each Programmatic guaranteed deal's forecast is set so its pacing at the last played day is the deal's target.
  for (const [dealId, deal] of Object.entries(dealCatalog)) {
    if (!deal.flight) continue;
    const delivered = billing.reduce((s, b) => (b.dealId === dealId && b.date >= deal.flight.start ? s + b.views : s), 0);
    const flightDays = Math.round((Date.parse(`${deal.flight.end}T00:00:00Z`) - Date.parse(`${deal.flight.start}T00:00:00Z`)) / 86400000) + 1;
    const elapsed = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${deal.flight.start}T00:00:00Z`)) / 86400000) + 1;
    if (delivered > 0 && elapsed > 0) deal.forecast = Math.round(delivered / (FLIGHTS[dealId].pacing * (1 - deal.buffer) * Math.min(elapsed / flightDays, 1)));
  }
  // Reservations: for every day after the last played day until the flight ends (up to 31 Dec), a Programmatic guaranteed deal
  // books its expected daily delivery (the deal's fill of its positions' plays) at its fixed CPM. They are rows of estimated
  // revenue only (not settled): no views, slots, inventory or slot records.
  if (reservations) {
    for (const [dealId, deal] of Object.entries(dealCatalog)) {
      if (!deal.flight) continue;
      const last = deal.flight.end < RESERVE_UNTIL ? deal.flight.end : RESERVE_UNTIL;
      const buyer = deal.buyers[0];
      for (let at = Date.parse(`${endDate}T00:00:00Z`) + 86400000; ; at += 86400000) {
        const date = new Date(at).toISOString().slice(0, 10);
        if (date > last) break;
        if (date < deal.flight.start) continue;
        storeIds.forEach((storeId, storeIndex) => {
          for (const typeId of new Set(deal.slots.map((s) => s.displayTypeId))) {
            const type = DISPLAY_TYPES[typeId];
            const window = calc.operatingWindow(type, ctx.stores[storeId]);
            const positions = deal.slots.filter((s) => s.displayTypeId === typeId).length;
            const plays = positions * type.displaysPerStore * loopsPerHourOf(type) * (window.close - window.open) * FILL[dealId];
            const views = plays * viewsPerPlayOf(type, storeIndex, window);
            billing.push({
              date, storeId, displayTypeId: typeId, dealId, dsp: buyer.dsp, advertiserId: buyer.advertiserId,
              revenue: calc.revenueAtCpm(deal.cpm, views), views: 0, slots: 0, settled: false, reservation: true,
            });
          }
        });
      }
    }
  }
  ctx.advertisers = ADVERTISER_META;
  return { raw: { billing, slotRecords, campaigns: campaignList }, ctx };
}

module.exports = { generateTestRetailer, rng, DISPLAY_TYPES, DEALS, DEAL_CATALOG, ADVERTISERS, ADVERTISER_META, ADVERTISER_PROFILES, CAMPAIGN_PLAN, OPEN_AUCTION_DEAL, STORE_NAMES, HISTORY_DAYS };
