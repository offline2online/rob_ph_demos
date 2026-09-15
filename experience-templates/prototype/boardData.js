/**
 * Experience Templates board — demo data.
 *
 * Shapes follow `experience-templates/REQUIREMENTS.md` (Real-Time Personalised
 * Surface Architecture Specification v1.2, Systems Two & Three). Nothing here
 * talks to a backend — it is the fixture the prototype renders.
 */

export const TOUCH_POINTS = {
  signage: { label: 'Digital Signage', icon: 'tv', canvas: true, physical: true },
  kiosk: { label: 'Kiosk', icon: 'point_of_sale', canvas: true, physical: true },
  web: { label: 'Responsive Web', icon: 'desktop_windows', canvas: false, physical: false },
  mobile: { label: 'Mobile Store Site', icon: 'smartphone', canvas: false, physical: false },
};

/** Slot ownership stamps onto every render event and cannot be backfilled (§5). */
export const OWNERS = {
  hq: { label: 'HQ', colour: '#169bc2' },
  advertiser: { label: 'Advertiser', colour: '#38b0cf' },
  stores: { label: 'Stores', colour: '#9ca3af' },
};

/**
 * `plays` decides what a slot needs resolved before it can paint:
 * single = one campaign, sequential = one visible and rotating,
 * simultaneous = every visible cell by the same deadline, static = no campaigns.
 */
export const DISPLAY_TYPES = [
  {
    id: 'dt-drive-thru',
    touchPoint: 'signage',
    name: 'Drive-Thru Canopy 3×1',
    spec: '5760 × 1080',
    plays: 'sequential',
    slots: 6,
    ownership: { hq: 4, advertiser: 1, stores: 1 },
    rtbOpen: 1,
    playlists: ['Drive-Thru Day', 'Drive-Thru Late'],
    overrides: 3,
    flags: ['Multi-zone (3)', 'Phantom area', 'In-Store Radio'],
  },
  {
    id: 'dt-menu-portrait',
    touchPoint: 'signage',
    name: 'In-Store Menu Board (Portrait)',
    spec: '1080 × 1920',
    plays: 'sequential',
    slots: 8,
    ownership: { hq: 6, advertiser: 0, stores: 2 },
    rtbOpen: 0,
    playlists: ['Core Menu'],
    overrides: 11,
    flags: ['Phantom area', 'MIST proximity'],
  },
  {
    id: 'dt-window',
    touchPoint: 'signage',
    name: 'Window Display 16:9',
    spec: '1920 × 1080',
    plays: 'sequential',
    slots: -1,
    ownership: { hq: 0, advertiser: 0, stores: 0 },
    rtbOpen: 0,
    playlists: ['Window Promo'],
    overrides: 0,
    flags: ['Unlimited rotation'],
  },
  {
    id: 'dt-kiosk-attract',
    touchPoint: 'kiosk',
    name: 'Self-Order Kiosk — Attract Loop',
    spec: '1080 × 1920',
    plays: 'sequential',
    slots: 4,
    ownership: { hq: 3, advertiser: 1, stores: 0 },
    rtbOpen: 1,
    playlists: ['Kiosk Attract'],
    overrides: 2,
    flags: ['Phantom area', 'Vision / AI'],
  },
  {
    id: 'dt-hero',
    touchPoint: 'web',
    name: 'Homepage Hero',
    spec: 'Element · 1 col all breakpoints',
    plays: 'single',
    slots: 1,
    ownership: { hq: 1, advertiser: 0, stores: 0 },
    rtbOpen: 0,
    playlists: ['—'],
    overrides: 0,
    flags: ['Above fold'],
  },
  {
    id: 'dt-carousel',
    touchPoint: 'web',
    name: 'Offer Carousel',
    spec: 'Element · 1 / 1 / 1 col',
    plays: 'sequential',
    slots: 5,
    ownership: { hq: 3, advertiser: 2, stores: 0 },
    rtbOpen: 2,
    playlists: ['Web Offers'],
    overrides: 0,
    flags: ['Above fold'],
  },
  {
    id: 'dt-tiles',
    touchPoint: 'web',
    name: 'Product Tiles Grid',
    spec: 'Element · 4 / 3 / 2 col · 8 / 6 / 4 items',
    plays: 'simultaneous',
    slots: 8,
    ownership: { hq: 6, advertiser: 0, stores: 2 },
    rtbOpen: 0,
    playlists: ['—'],
    overrides: 0,
    flags: ['Below fold', 'Item count ≠ column count'],
  },
  {
    id: 'dt-site-header',
    touchPoint: 'mobile',
    name: 'Store Site Header',
    spec: 'Module · full width',
    plays: 'static',
    slots: 0,
    ownership: { hq: 0, advertiser: 0, stores: 0 },
    rtbOpen: 0,
    playlists: ['—'],
    overrides: 0,
    flags: ['Renders no campaigns'],
  },
  {
    id: 'dt-site-ctas',
    touchPoint: 'mobile',
    name: 'Store Site CTA Menu',
    spec: 'Module · 4 menu items',
    plays: 'static',
    slots: 0,
    ownership: { hq: 0, advertiser: 0, stores: 0 },
    rtbOpen: 0,
    playlists: ['—'],
    overrides: 6,
    flags: ['Connection-state gated', 'Store hours'],
  },
];

/**
 * Playlist items. `deadlineMs` is derived, not authored:
 * first_paint_budget + the playbackDuration of every preceding slot (§4).
 */
export const PLAYLIST = {
  name: 'Drive-Thru Day',
  displayType: 'Drive-Thru Canopy 3×1',
  schedule: 'Store opening hours · Mon–Sun',
  firstPaintBudget: 400,
  items: [
    { slot: 1, campaign: 'Breakfast Meal Deal', owner: 'hq', priority: 10, duration: 8000, campaignType: 'LOCALISED, ON_ROTATION', creative: 'default / selected / unselected' },
    { slot: 2, campaign: 'Barista Coffee Range', owner: 'hq', priority: 20, duration: 6000, campaignType: 'LOCALISED, ON_ROTATION', creative: 'default' },
    { slot: 3, campaign: '— open RTB —', owner: 'advertiser', priority: null, duration: 10000, campaignType: 'RTB, ON_ROTATION', creative: 'default' },
    { slot: 4, campaign: 'Loyalty Double Points', owner: 'hq', priority: 30, duration: 7000, campaignType: 'PERSONALISED, ON_ROTATION', creative: 'default / selected / unselected' },
    { slot: 5, campaign: 'Store Manager’s Pick', owner: 'stores', priority: 40, duration: 6000, campaignType: 'LOCALISED, DELEGATED', creative: 'default' },
    { slot: 6, campaign: 'Join the Queue', owner: 'hq', priority: 50, duration: 5000, campaignType: 'TRIGGERED, CONNECTED_DISPLAY', creative: 'default / selected' },
  ],
};

/** Cumulative visibility deadline for each slot (§4 — deferred visibility buys time). */
export function withDeadlines(playlist) {
  let cursor = playlist.firstPaintBudget;
  return playlist.items.map((item) => {
    const deadline = cursor;
    cursor += item.duration;
    return { ...item, deadlineMs: deadline };
  });
}

export const TEMPLATES = [
  {
    id: 'tpl-web',
    name: 'Store Landing Page',
    type: 'Responsive Web Page',
    widthMode: 'Boxed · 1280px max',
    firstPaintBudget: 400,
    foldPosition: 2,
    pairing: { anchor: 'Bottom right', offset: '24 / 24', state: 'Unpaired' },
    elements: [
      { name: 'Homepage Hero', plays: 'single', deadline: '400ms', zone: 'mixed' },
      { name: 'Offer Carousel', plays: 'sequential', deadline: '400ms → rotating', zone: 'mixed' },
      { name: 'Product Tiles Grid', plays: 'simultaneous', deadline: 'On scroll (unbounded)', zone: 'mixed' },
      { name: 'FAQ Accordion', plays: 'static', deadline: '—', zone: 'agent' },
      { name: 'Site Footer', plays: 'static', deadline: '—', zone: 'locked' },
    ],
  },
  {
    id: 'tpl-mobile',
    name: 'Connected Store Site',
    type: 'Mobile Store Site',
    widthMode: 'Fluid',
    firstPaintBudget: 300,
    foldPosition: 3,
    pairing: { anchor: 'Phantom zone', offset: 'Host display', state: 'Paired — phone' },
    elements: [
      { name: 'Site Header', plays: 'static', deadline: '—', zone: 'agent' },
      { name: 'Carousel', plays: 'sequential', deadline: '300ms → rotating', zone: 'mixed' },
      { name: 'CTA Menu', plays: 'static', deadline: 'Connection state', zone: 'agent' },
      { name: 'Content', plays: 'single', deadline: 'On scroll', zone: 'mixed' },
      { name: 'Footer', plays: 'static', deadline: '—', zone: 'locked' },
    ],
  },
];

/** The render ladder (§4) — four tiers, plus the orthogonal connection-state axis. */
export const TIERS = [
  {
    key: 'default',
    n: 1,
    name: 'Default',
    connection: 'Away From Store',
    resolved: [],
    blank: ['first_name', 'loyalty_tier', 'purchase_history'],
    deadline: 'First paint · 400ms',
    headline: 'Today’s Menu',
    sub: 'Freshly made, all day',
    priceLabel: 'RRP',
    price: '£4.95',
    terms: 'Selected items. Subject to availability.',
    cta: null,
    note: 'Nothing resolved. This is the normal case, not an error — a real attribute envelope is almost entirely blank.',
  },
  {
    key: 'localised',
    n: 2,
    name: 'Localised',
    connection: 'Connected Store',
    resolved: ['mist_site_id', 'display_name', 'touch_point'],
    blank: ['first_name', 'loyalty_tier'],
    deadline: 'First paint · 400ms',
    headline: 'Kings Cross — Today’s Menu',
    sub: 'Open until 23:00 · Collection in 4 min',
    priceLabel: 'Store price',
    price: '£4.50',
    terms: 'Kings Cross pricing. Subject to availability.',
    cta: null,
    note: 'Store context only — no identity needed. Tiers 1–2 carry most impressions.',
  },
  {
    key: 'personalised',
    n: 3,
    name: 'Personalised',
    connection: 'Connected Display',
    resolved: ['mist_site_id', 'first_name', 'loyalty_tier', 'purchase_history'],
    blank: ['plan_types'],
    deadline: 'Slot 4 · +24,400ms',
    headline: 'Morning, Rob — the usual?',
    sub: 'Flat white + almond croissant',
    priceLabel: 'Gold member',
    price: '£3.80',
    terms: 'Gold tier pricing, server-resolved. Ends 30 Sep.',
    cta: null,
    note: 'loyalty_tier arrived as a server-side resolution, so it may reach the pricing path. A tier-1 claim never could.',
  },
  {
    key: 'interactive',
    n: 4,
    name: 'Interactive',
    connection: 'Connected Display · paired',
    resolved: ['mist_site_id', 'first_name', 'loyalty_tier', 'SKUs', 'interaction_entities'],
    blank: [],
    deadline: 'Collapsed — moment of navigation',
    headline: 'Your order · 2 items',
    sub: 'Flat white · Almond croissant',
    priceLabel: 'Order total',
    price: '£6.40',
    terms: 'Gold tier pricing applied. Pay in app.',
    cta: 'Add a pastry · £2.60',
    note: 'Live socket. The agent selected the SKUs; PH validated them against the eligible set and wrote the price.',
  },
];
