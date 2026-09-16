/* ------------------------------------------------------------------
   Sample data. Every record is built through the factories in schema.js /
   sellside.js so it has exactly the shape the platform record does.
------------------------------------------------------------------- */

import { displayType, playlist, playlistItem, scene, textElement, textVariant, slot, elementConfig, blankFeatures, UNLIMITED } from "./schema.js";
import { partner, DIRECT_PARTNER, ANY_PARTNER, RTB, DEFAULT_EXCHANGE } from "./sellside.js";

/* --------------------------------------------------------- campaigns */
/* The HQ campaign catalogue playlist items reference. Playback strategy
   values are the platform's own: LOCALISED | TRIGGERED. */
export const CAMPAIGNS = [
  { id: "c_zinger", name: "Zinger Box — hero", strategy: "LOCALISED", owner: "hq", thumb: "#c62828" },
  { id: "c_wings", name: "Wicked Wings 6pk", strategy: "LOCALISED", owner: "hq", thumb: "#ef6c00" },
  { id: "c_family", name: "Family Feast", strategy: "LOCALISED", owner: "hq", thumb: "#6a1b9a" },
  { id: "c_breakfast", name: "Breakfast till 11", strategy: "TRIGGERED", owner: "hq", thumb: "#00838f" },
  { id: "c_pepsi", name: "Pepsi Max 600ml", strategy: "LOCALISED", owner: "advertiser", thumb: "#1565c0" },
  { id: "c_notice", name: "Store notice — allergens", strategy: "LOCALISED", owner: "hq", thumb: "#455a64", locked: true },
  { id: "c_queue", name: "Join the queue from your phone", strategy: "TRIGGERED", owner: "hq", thumb: "#2e7d32" },
  { id: "c_menu_l", name: "Menu — left panel", strategy: "LOCALISED", owner: "hq", thumb: "#37474f", locked: true },
  { id: "c_menu_c", name: "Menu — centre panel", strategy: "LOCALISED", owner: "hq", thumb: "#37474f", locked: true },
  { id: "c_menu_r", name: "Menu — right panel", strategy: "LOCALISED", owner: "hq", thumb: "#37474f", locked: true },
  { id: "c_loyalty", name: "Gold member double points", strategy: "TRIGGERED", owner: "hq", thumb: "#f9a825" },
];
export const campaignById = (id) => CAMPAIGNS.find((c) => c.id === id) || null;

/* ------------------------------------------------------------ scenes */
export const SCENES = [
  scene({ id: "sc_zinger_default", name: "Zinger — default", background: { type: "image", value: "#c62828", assetId: "as_zinger_bg" },
    text: [
      textElement({ id: "t1", content: "Zinger Box", x: 6, y: 10, width: 60, height: 14, font: { family: "Roboto", size: 96, weight: 700, colour: "#ffffff", align: "left" }, animation: { entrance: "Slide up", exit: "Fade out", delayMs: 0, durationMs: 400 },
        variants: [textVariant({ id: "v1", when: { attr: "visitor.loyalty_tier", op: "eq", value: "Gold" }, content: "Zinger Box — Gold members first" })] }),
      textElement({ id: "t2", content: "Now with extra crunch", x: 6, y: 28, width: 60, height: 8, font: { family: "Roboto", size: 40, weight: 400, colour: "#ffffff", align: "left" }, animation: { entrance: "Fade in", exit: "Fade out", delayMs: 300, durationMs: 400 } }),
      textElement({ id: "t3", content: "£12.95", x: 6, y: 80, width: 30, height: 12, trustZone: "ph_locked", font: { family: "Roboto", size: 72, weight: 700, colour: "#ffffff", align: "left" }, animation: { entrance: "None", exit: "None", delayMs: 0, durationMs: 0 } }),
    ] }),
  scene({ id: "sc_zinger_selected", name: "Zinger — selected (paired)", background: { type: "image", value: "#8e0000", assetId: "as_zinger_bg" },
    text: [
      textElement({ id: "t1", content: "Added to your order, ${FirstName}", x: 6, y: 10, width: 70, height: 14, font: { family: "Roboto", size: 80, weight: 700, colour: "#ffffff", align: "left" }, animation: { entrance: "Zoom in", exit: "Fade out", delayMs: 0, durationMs: 300 } }),
      textElement({ id: "t3", content: "£12.95", x: 6, y: 80, width: 30, height: 12, trustZone: "ph_locked", font: { family: "Roboto", size: 72, weight: 700, colour: "#ffffff", align: "left" } }),
    ] }),
  scene({ id: "sc_zinger_unselected", name: "Zinger — unselected (paired, other item)", background: { type: "colour", value: "#3e0a0a", assetId: null },
    text: [textElement({ id: "t1", content: "Zinger Box", x: 6, y: 40, width: 60, height: 14, font: { family: "Roboto", size: 64, weight: 500, colour: "rgba(255,255,255,0.6)", align: "left" } })] }),
  scene({ id: "sc_wings", name: "Wings — default", background: { type: "video", value: "#ef6c00", assetId: "as_wings_v" }, text: [textElement({ id: "t1", content: "Wicked Wings 6 for £5", x: 6, y: 70, width: 70, height: 14, trustZone: "ph_locked", font: { family: "Roboto", size: 72, weight: 700, colour: "#ffffff", align: "left" } })] }),
  scene({ id: "sc_pepsi", name: "Pepsi — default", background: { type: "image", value: "#1565c0", assetId: "as_pepsi" }, text: [] }),
  scene({ id: "sc_notice", name: "Allergen notice", background: { type: "colour", value: "#455a64", assetId: null }, text: [textElement({ id: "t1", content: "Allergen information available at the counter", x: 5, y: 40, width: 90, height: 20, trustZone: "ph_locked", font: { family: "Roboto", size: 56, weight: 500, colour: "#ffffff", align: "center" } })] }),
];
export const sceneById = (id) => SCENES.find((s) => s.id === id) || null;

/* --------------------------------------------------------- playlists */
const item = (id, campaignId, priority, playbackDuration, campaignType, scenes = {}) => playlistItem({
  id, campaignId, priority, playbackDuration, campaignType,
  campaignCreativeSettings: { default: { sceneId: scenes.d || null }, selected: { sceneId: scenes.s || null }, unselected: { sceneId: scenes.u || null } },
});

export const INITIAL_PLAYLISTS = [
  playlist({ id: "pl_landscape", name: "Menu Board - Landscape Playlist", autoCreatedFor: "landscape", items: [
    item("pi_1", "c_zinger", 1, 10, ["LOCALISED", "ON_ROTATION"], { d: "sc_zinger_default", s: "sc_zinger_selected", u: "sc_zinger_unselected" }),
    item("pi_2", "c_wings", 2, 8, ["LOCALISED", "ON_ROTATION"], { d: "sc_wings" }),
    item("pi_3", "c_pepsi", 3, 8, ["LOCALISED", "ON_ROTATION"], { d: "sc_pepsi" }),
    item("pi_4", "c_family", 4, 12, ["LOCALISED", "ON_ROTATION"]),
    item("pi_5", "c_loyalty", 5, 8, ["TRIGGERED", "TARGETED"]),
  ] }),
  playlist({ id: "pl_portrait", name: "Portrait Playlist", autoCreatedFor: "portrait", items: [
    item("pi_6", "c_queue", 1, 12, ["TRIGGERED"]),
    item("pi_7", "c_wings", 2, 8, ["LOCALISED", "ON_ROTATION"], { d: "sc_wings" }),
  ] }),
  playlist({ id: "pl_menu", name: "Menu Board Playlist", autoCreatedFor: "menu_board", items: [
    item("pi_8", "c_notice", 1, 15, ["LOCALISED", "ON_ROTATION"], { d: "sc_notice" }),
  ] }),
  playlist({ id: "pl_zone_menu_board_1", name: "Menu Board — Long Format / Zone 1", autoCreatedFor: "menu_board", items: [item("pi_9", "c_menu_l", 1, 30, ["LOCALISED", "ON_ROTATION"])] }),
  playlist({ id: "pl_zone_menu_board_2", name: "Menu Board — Long Format / Zone 2", autoCreatedFor: "menu_board", items: [item("pi_10", "c_menu_c", 1, 30, ["LOCALISED", "ON_ROTATION"])] }),
  playlist({ id: "pl_zone_menu_board_3", name: "Menu Board — Long Format / Zone 3", autoCreatedFor: "menu_board", items: [item("pi_11", "c_zinger", 1, 10, ["LOCALISED", "ON_ROTATION"], { d: "sc_zinger_default", s: "sc_zinger_selected", u: "sc_zinger_unselected" }), item("pi_12", "c_pepsi", 2, 8, ["LOCALISED", "ON_ROTATION"], { d: "sc_pepsi" }), item("pi_13", "c_menu_r", 3, 20, ["LOCALISED", "ON_ROTATION"])] }),
  playlist({ id: "pl_web_hero", name: "Web Hero Playlist", autoCreatedFor: "web_hero", items: [item("pi_14", "c_zinger", 1, 8, ["LOCALISED"], { d: "sc_zinger_default" })] }),
  playlist({ id: "pl_mss_default", name: "Default Mobile Store Site Playlist", items: [item("pi_15", "c_wings", 1, 6, ["LOCALISED"]), item("pi_16", "c_family", 2, 6, ["LOCALISED"])] }),
  playlist({ id: "pl_promo", name: "Promo Rotation", items: [item("pi_17", "c_wings", 1, 8, ["LOCALISED", "ON_ROTATION"]), item("pi_18", "c_family", 2, 8, ["LOCALISED", "ON_ROTATION"]), item("pi_19", "c_pepsi", 3, 8, ["LOCALISED", "ON_ROTATION"]), item("pi_20", "c_breakfast", 4, 8, ["TRIGGERED"])] }),
  playlist({ id: "pl_notices", name: "Store Notices", schedule: { mode: "always", from: null, to: null }, items: [item("pi_21", "c_notice", 1, 15, ["LOCALISED", "ON_ROTATION"], { d: "sc_notice" })] }),
  playlist({ id: "pl_seasonal", name: "Seasonal Overflow", items: [] }),
  playlist({ id: "pl_archive", name: "Archived Q1 Campaigns", items: [] }),
];

/* ------------------------------------------------------ display types */
const feat = (over) => ({ ...blankFeatures(), ...over });

export const INITIAL_TYPES = [
  displayType({ id: "landscape", name: "Menu Board - Landscape", touchPoint: "Digital Signage", description: "Standard 16:9 landscape board above the counter.",
    displayCanvasSize: { width: 1920, height: 1080 }, backgroundColor: "#333333", defaultPlaylistId: "pl_landscape",
    qrControl: { enabled: true }, enabledFeatures: feat({ visionAi: { ...blankFeatures().visionAi, enabled: true } }),
    updatedAt: "2026-09-12T09:14:00Z" }),
  displayType({ id: "portrait", name: "Portrait", touchPoint: "Digital Signage", description: "Freestanding portrait totem near the entrance.",
    displayCanvasSize: { width: 1080, height: 1920 }, backgroundColor: "#000000", defaultPlaylistId: "pl_portrait",
    qrControl: { enabled: true, phantomArea: { width: 220, height: 220 }, mobileSiteTemplate: "Mobile Store Site" },
    enabledFeatures: feat({ proximityMist: { enabled: true, mode: "zone", zone: "Front of Store" } }),
    updatedAt: "2026-09-10T16:40:00Z" }),
  displayType({ id: "menu_board", name: "Menu Board — Long Format", touchPoint: "Digital Signage", description: "Three-panel ultra-wide menu board. Left and centre panels are PH-locked menu content; the right panel is the sellable rotation.",
    displayCanvasSize: { width: 5760, height: 1080 }, backgroundColor: "#111111", defaultPlaylistId: "pl_menu",
    playlistSettings: { maximumCampaignsPlayedInRotation: 3 },
    qrControl: { enabled: true, mobileSiteTemplate: "Order & Pay" },
    enabledFeatures: feat({ visionAi: { ...blankFeatures().visionAi, enabled: true } }),
    multiZone: { enabled: true, zones: [
      { id: "z1", name: "Zone 1", x: 0, y: 0, width: 33.3, height: 100, playlistId: "pl_zone_menu_board_1", trustZone: "ph_locked" },
      { id: "z2", name: "Zone 2", x: 33.3, y: 0, width: 33.4, height: 100, playlistId: "pl_zone_menu_board_2", trustZone: "ph_locked" },
      { id: "z3", name: "Zone 3", x: 66.7, y: 0, width: 33.3, height: 100, playlistId: "pl_zone_menu_board_3", trustZone: "agent_addressable" },
    ] },
    phExtensions: { slots: [
      slot({ label: "Priority 1", owner: "internal" }),
      slot({ label: "Supplier slot", owner: "advertiser", partnerId: "p_google", advertiser: RTB }),
      slot({ label: "Store choice", owner: "retail", storeScope: "Store staff", quota: { mode: "count", value: 1 } }),
    ] },
    updatedAt: "2026-09-15T11:02:00Z" }),
  displayType({ id: "kiosk", name: "Order Kiosk", touchPoint: "Kiosk", description: "Self-service ordering kiosk; attract loop plays until touched.",
    displayCanvasSize: { width: 1080, height: 1920 }, backgroundColor: "#ffffff", defaultPlaylistId: "pl_promo",
    playlistSettings: { maximumCampaignsPlayedInRotation: 2, campaignAutoPlay: "Manual Play" },
    phExtensions: { slots: [slot({ label: "Attract loop", owner: "internal" }), slot({ label: "Supplier slot", owner: "advertiser", partnerId: DIRECT_PARTNER, advertiser: "Blackmores" })] },
    updatedAt: "2026-09-02T08:00:00Z" }),
  displayType({ id: "web_hero", name: "Hero Banner", touchPoint: "Responsive Web", element: elementConfig("hero"), defaultPlaylistId: "pl_web_hero",
    playlistSettings: { maximumCampaignsPlayedInRotation: 1 }, phExtensions: { slots: [slot({ label: "Featured offer", owner: "internal" })], nameAuto: true },
    updatedAt: "2026-09-08T12:00:00Z" }),
  displayType({ id: "web_carousel", name: "Carousel", touchPoint: "Responsive Web", element: elementConfig("carousel"), defaultPlaylistId: "pl_promo",
    playlistSettings: { maximumCampaignsPlayedInRotation: 4 },
    phExtensions: { slots: [
      slot({ label: "Priority 1", owner: "internal" }),
      slot({ label: "Supplier slot", owner: "advertiser", partnerId: ANY_PARTNER, advertiser: RTB }),
      slot({ label: "Supplier slot", owner: "advertiser", partnerId: DIRECT_PARTNER, advertiser: "Blackmores" }),
      slot({ label: "Store choice", owner: "retail", storeScope: "Store staff" }),
    ], nameAuto: true }, updatedAt: "2026-09-08T12:00:00Z" }),
  displayType({ id: "web_grid", name: "Grid", touchPoint: "Responsive Web", element: elementConfig("grid"), defaultPlaylistId: "pl_promo",
    playlistSettings: { maximumCampaignsPlayedInRotation: 6 }, phExtensions: { slots: Array.from({ length: 6 }, (_, i) => slot({ label: `Tile ${i + 1}` })), nameAuto: true }, updatedAt: "2026-09-08T12:00:00Z" }),
  displayType({ id: "web_product", name: "Product Tiles", touchPoint: "Responsive Web", element: elementConfig("product"), defaultPlaylistId: "pl_web_hero",
    playlistSettings: { maximumCampaignsPlayedInRotation: 1 }, phExtensions: { slots: [slot({ label: "PH authoritative", owner: "internal", trustZone: "ph_locked" })], nameAuto: true }, updatedAt: "2026-09-08T12:00:00Z" }),
  displayType({ id: "web_qr", name: "QR Control", touchPoint: "Responsive Web", element: elementConfig("qr_control"), defaultPlaylistId: null, phExtensions: { nameAuto: true }, updatedAt: "2026-09-08T12:00:00Z" }),
  displayType({ id: "web_ctas", name: "CTAs", touchPoint: "Responsive Web", element: elementConfig("ctas"), defaultPlaylistId: "pl_notices",
    playlistSettings: { maximumCampaignsPlayedInRotation: 3 }, phExtensions: { slots: Array.from({ length: 3 }, (_, i) => slot({ label: `Action ${i + 1}` })), nameAuto: true }, updatedAt: "2026-09-08T12:00:00Z" }),
];

/* ----------------------------------------------------- mobile sites */
export const CONNECTION_STATES = [
  { key: "connected_store", label: "Connected Store State", hint: "Paired and physically in store." },
  { key: "connected_display", label: "Connected Display State", hint: "Paired to a specific display via QR." },
  { key: "connected_website", label: "Connected Store Website State", hint: "Connected through the store's website." },
  { key: "away", label: "Away From Store State", hint: "No store or display connection." },
];
export const SITE_TOKENS = ["${BrandName}", "${StoreName}", "${StoreCode}", "${FirstName}", "${QueuePosition}"];
export const PRECONFIGURED_ITEMS = [
  { key: "custom", label: "Custom", icon: "link" },
  { key: "queue", label: "Join the queue", icon: "groups" },
  { key: "appointment", label: "Book an Appointment", icon: "calendar_month" },
  { key: "store", label: "Store Details", icon: "map" },
  { key: "mobile_display", label: "Mobile<>Display Experience", icon: "cast" },
];
export const CTA_ATTRS = ["loyalty_tier", "visitor_type_id", "reason_for_visit_id", "visitor_segments", "product_holdings", "purchase_intent", "SKUs", "Age", "gender", "device_type"];
export const MENU_ICONS = ["link", "groups", "calendar_month", "map", "cast", "shopping_cart", "person", "support_agent", "local_offer", "receipt_long", "hub", "storefront"];
export const MOBILE_TEMPLATE_DEFS = [
  { name: "Mobile App", isDefault: true, header: "${BrandName} ${StoreName}", qrScanner: true, items: [
    { icon: "shopping_cart", name: "Order now", pre: "custom", url: "{YourDomain}/order?store={$StoreCode}", newTab: false, states: ["connected_store", "connected_display"], hours: "24" },
    { icon: "map", name: "Store Details", pre: "store", url: "", newTab: false, states: ["connected_store", "away"], hours: "24" }] },
  { name: "Mobile Store Site", isDefault: false, header: "${BrandName} ${StoreName}", qrScanner: true, items: [
    { icon: "groups", name: "Join the Queue", pre: "queue", url: "", newTab: false, states: ["connected_display", "connected_store"], hours: "opening" },
    { icon: "map", name: "Store Details", pre: "store", url: "", newTab: false, states: ["connected_store", "away"], hours: "24" }] },
  { name: "Order & Pay", isDefault: false, header: "${BrandName} — Order & Pay", qrScanner: true, items: [
    { icon: "shopping_cart", name: "Order now", pre: "custom", url: "{YourDomain}/order?store={$StoreCode}", newTab: false, states: ["connected_display", "connected_store"], hours: "opening" },
    { icon: "cast", name: "Continue on Display", pre: "mobile_display", url: "", newTab: false, states: ["connected_display"], hours: "24" }] },
  { name: "Pharmacy - Store Connect", isDefault: false, header: "${BrandName} ${StoreName}", qrScanner: true, items: [
    { icon: "calendar_month", name: "Book an Appointment", pre: "appointment", url: "", newTab: false, states: ["connected_store", "connected_website"], hours: "opening" },
    { icon: "groups", name: "Join the Queue", pre: "queue", url: "", newTab: false, states: ["connected_display", "connected_store"], hours: "opening" },
    { icon: "map", name: "Store Details", pre: "store", url: "", newTab: false, states: ["connected_store", "away"], hours: "24" }] },
];
export const MOBILE_TEMPLATES = MOBILE_TEMPLATE_DEFS.map((m) => m.name);
export const PAIRED_DEVICES = [
  { key: "phone", label: "Phone", icon: "smartphone" },
  { key: "glasses", label: "Glasses", icon: "eyeglasses" },
  { key: "watch", label: "Watch", icon: "watch" },
];

/* ---------------------------------------------- partners & lists */
export const ADVERTISERS = ["Blackmores", "L'Oréal", "Cetaphil", "Swisse", "Nestlé"];
export const INITIAL_COMPANY_LISTS = {
  allowList: [{ id: "cal1", name: "Nestlé" }, { id: "cal2", name: "Swisse" }, { id: "cal3", name: "Arnott’s" }],
  blockList: [{ id: "cbl1", name: "Red Bull" }, { id: "cbl2", name: "Monster Energy" }],
};

const ENV_ATTRS = ["env.daypart", "env.store_segments", "env.store_hours_state", "display.touch_point", "display.display_tags"];

export const INITIAL_PARTNERS = [
  partner({ id: DIRECT_PARTNER, provider: null, name: "Direct / house", status: "connected", system: true,
    seats: ADVERTISERS.map((a) => ({ id: a, name: a, approvalRequired: a === "Blackmores" })), auctionType: "Preferred deal", listsLinked: false,
    targeting: { enabledAttributes: [...ENV_ATTRS, "visitor.loyalty_tier"] } }),
  partner({ id: "p_google", provider: "google_dsp", name: "Google DSP", status: "connected",
    creds: { partnerId: "884512", advertiserId: "2201984", authMode: "Service account (JSON key)", saEmail: "ph-retail-media@ph-demo.iam.gserviceaccount.com", saKey: "•".repeat(24), networkCode: "" },
    bidder: { bidderEndpoint: "https://rtb.doubleclick.net/openrtb2/bid", seatIds: "884512, 884513", qps: "500", timeoutMs: "300" },
    floorCpm: 4.5, auctionType: "Open RTB", categories: ["Food & Drink", "Health & Fitness"], exclusions: ["Finance"],
    seats: [{ id: "g1", name: "Nestlé", approvalRequired: false }, { id: "g2", name: "Swisse", approvalRequired: true }],
    targeting: { enabledAttributes: ENV_ATTRS }, deals: [{ id: "d1", dealId: "PH-DV360-PG-0012", kind: "Programmatic guaranteed", cpm: 6.0 }],
    lastSync: "Today, 07:12" }),
  partner({ id: "p_amazon", provider: "amazon_dsp", name: "Amazon Ads DSP", status: "error",
    creds: { region: "Europe (EU)", clientId: "amzn1.application-oa2-client.7f3c", clientSecret: "•".repeat(16), refreshToken: "•".repeat(16), profileId: "3390127745", advertiserId: "ENTITY4K2M9P", entityId: "ENTITY8Q1R5T" },
    floorCpm: 5.2, auctionType: "Open RTB", categories: ["Beauty", "Retail"],
    seats: [{ id: "a1", name: "L'Oréal", approvalRequired: false }],
    listsLinked: false, allowList: [{ id: "bl4", name: "L'Oréal" }], blockList: [{ id: "bl1", name: "Red Bull" }, { id: "bl3", name: "Chemist Warehouse" }],
    targeting: { enabledAttributes: ENV_ATTRS }, lastSync: "Refresh token rejected — 3 days ago" }),
  partner({ id: "p_ph_blackmores", provider: "ph_native", name: "Blackmores (PH-native)", status: "connected",
    creds: { orgName: "Blackmores", apiKeyId: "phk_blk_2201", apiSecret: "•".repeat(20), webhook: "https://ads.blackmores.example/ph/delivery" },
    floorCpm: null, auctionType: "Preferred deal", categories: ["Health & Fitness"],
    seats: [{ id: "b1", name: "Blackmores", approvalRequired: true }],
    targeting: { enabledAttributes: [...ENV_ATTRS, "env.temp_c", "env.condition", "env.store_stock", "visitor.visitor_segments"] },
    lastSync: "Today, 06:55" }),
];

/* ---------------------------------------------------- stores & displays */
export const STORES = [
  { id: "s_001", code: "LON-001", name: "London Oxford St", region: "London", venue: { openOoh: "Retail → Grocery", lat: 51.5154, lng: -0.1419 }, hours: { open: 7, close: 22 }, segments: ["metro"] },
  { id: "s_002", code: "LON-014", name: "London Stratford", region: "London", venue: { openOoh: "Retail → Malls", lat: 51.5432, lng: -0.0067 }, hours: { open: 8, close: 22 }, segments: ["metro"] },
  { id: "s_003", code: "MAN-003", name: "Manchester Arndale", region: "North", venue: { openOoh: "Retail → Malls", lat: 53.4839, lng: -2.2384 }, hours: { open: 8, close: 20 }, segments: ["metro"] },
  { id: "s_004", code: "BHX-002", name: "Birmingham Bullring", region: "Midlands", venue: { openOoh: "Retail → Malls", lat: 52.4779, lng: -1.8944 }, hours: { open: 9, close: 21 }, segments: ["metro"] },
  { id: "s_005", code: "LHR-T5", name: "Heathrow T5", region: "London", venue: { openOoh: "Transit → Airports", lat: 51.4723, lng: -0.4886 }, hours: { open: 5, close: 23 }, segments: ["airport", "24h"] },
  { id: "s_006", code: "EDI-001", name: "Edinburgh Princes St", region: "Scotland", venue: { openOoh: "Retail → Grocery", lat: 55.9521, lng: -3.1965 }, hours: { open: 8, close: 20 }, segments: ["regional"] },
];

const disp = (id, storeId, displayTypeId, name, orientation, status, sensors, tags) => ({ id, storeId, displayTypeId, name, orientation, status, sensors, tags, lastSeen: status === "online" ? "2 min ago" : "3 days ago" });
export const DISPLAYS = [
  disp("d_101", "s_001", "menu_board", "Counter board", "landscape", "online", { vision: true, mist: false }, ["checkout"]),
  disp("d_102", "s_001", "landscape", "Entrance screen", "landscape", "online", { vision: true, mist: false }, ["entrance"]),
  disp("d_103", "s_001", "portrait", "Entrance totem", "portrait", "online", { vision: false, mist: true }, ["entrance"]),
  disp("d_104", "s_002", "menu_board", "Counter board", "landscape", "online", { vision: true, mist: false }, ["checkout"]),
  disp("d_105", "s_002", "landscape", "Queue screen", "landscape", "offline", { vision: true, mist: false }, ["checkout"]),
  disp("d_106", "s_003", "menu_board", "Counter board", "landscape", "online", { vision: false, mist: false }, ["checkout"]),
  disp("d_107", "s_003", "kiosk", "Kiosk 1", "portrait", "online", { vision: false, mist: false }, ["aisle"]),
  disp("d_108", "s_004", "menu_board", "Counter board", "landscape", "online", { vision: true, mist: true }, ["checkout"]),
  disp("d_109", "s_004", "landscape", "Window screen", "landscape", "online", { vision: true, mist: false }, ["window"]),
  disp("d_110", "s_005", "landscape", "Gate-side screen", "landscape", "online", { vision: true, mist: false }, ["entrance"]),
  disp("d_111", "s_005", "portrait", "Departures totem", "portrait", "online", { vision: false, mist: true }, ["entrance"]),
  disp("d_112", "s_006", "menu_board", "Counter board", "landscape", "online", { vision: false, mist: false }, ["checkout"]),
];

export const INITIAL_EXCHANGE = { ...DEFAULT_EXCHANGE };

/* --------------------------------------------- templates (gated) */
export const TEMPLATE_KINDS = [
  { key: "web_page", label: "Responsive Web Page", icon: "devices", frame: "browser" },
  { key: "store_site", label: "Mobile Store Site", icon: "smartphone", frame: "phone" },
  { key: "pwa", label: "PWA", icon: "install_mobile", frame: "phone" },
];
export const MOBILE_MODULES = [
  { key: "header", label: "Site Header", icon: "title", desc: "Brand and store name, with token substitution." },
  { key: "carousel", label: "Carousel", icon: "view_carousel", desc: "Campaign carousel at the top of the site." },
  { key: "ctas", label: "CTAs", icon: "ads_click", desc: "The menu of actions offered on this site." },
  { key: "content", label: "Content", icon: "article", desc: "Static copy block." },
  { key: "footer", label: "Site Footer", icon: "bottom_navigation", desc: "Persistent footer — legal, contact and secondary links." },
];
export const INITIAL_TEMPLATES = [
  { id: "tpl_kfc", name: "KFC — Order Surface", kind: "web_page", background: "#ffffff", maxWidth: 1200, widthMode: "contained",
    pairing: { on: true, elementId: "web_qr", anchor: "Bottom Right", offsetX: 24, offsetY: 24, mobileTemplate: "Mobile App" },
    rows: [{ rid: "r1", typeId: "web_hero" }, { rid: "r2", typeId: "web_product" }, { rid: "r3", typeId: "web_carousel" }, { rid: "r4", typeId: "web_ctas" }] },
  { id: "tpl_mobile_default", name: "Mobile App", kind: "store_site", isDefault: true, header: "${BrandName} ${StoreName}", qrScanner: true,
    modules: [{ mid: "m1", type: "header" }, { mid: "m2", type: "carousel" }, { mid: "m3", type: "ctas" }], carouselPlaylist: "pl_mss_default", items: MOBILE_TEMPLATE_DEFS[0].items },
  { id: "tpl_pharmacy", name: "Pharmacy — Store Connect", kind: "store_site", header: "${BrandName} ${StoreName}", qrScanner: true,
    modules: [{ mid: "p1", type: "header" }, { mid: "p2", type: "carousel" }, { mid: "p3", type: "ctas" }], carouselPlaylist: "pl_mss_default", items: MOBILE_TEMPLATE_DEFS[3].items },
];
export const MOCK = {
  web_hero: ["Zinger Box — £12.95"],
  web_carousel: ["Wicked Wings 6pk", "Popcorn Chicken", "Pepsi Max 600ml", "Chips — Large"],
  web_grid: ["Family Feast", "Twister Combo", "Snack Deal", "Sides Bundle", "Dessert", "Drinks"],
  web_ctas: ["Order now", "Find a store", "Track my order"],
  web_product: ["Zinger Box £12.95", "Wicked Wings £9.95", "Twister Combo £11.45", "Popcorn £6.95", "Chips £4.50", "Pepsi Max £3.95"],
};
