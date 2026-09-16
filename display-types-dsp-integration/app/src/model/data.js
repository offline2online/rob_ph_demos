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
  playlist({ id: "pl_landscape", name: "Landscape Playlist", autoCreatedFor: "landscape", items: [
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
  playlist({ id: "pl_web_hero", name: "Web Hero Playlist", autoCreatedFor: "web_hero", items: [item("pi_14", "c_zinger", 1, 8, ["LOCALISED"], { d: "sc_zinger_default" })] }),
  playlist({ id: "pl_mss_default", name: "Default Mobile Store Site Playlist", items: [item("pi_15", "c_wings", 1, 6, ["LOCALISED"]), item("pi_16", "c_family", 2, 6, ["LOCALISED"])] }),
  playlist({ id: "pl_zone_menu_board_1", name: "Menu Board — Long Format / Zone 1", autoCreatedFor: "menu_board", items: [item("pi_9", "c_menu_l", 1, 30, ["LOCALISED", "ON_ROTATION"])] }),
  playlist({ id: "pl_zone_menu_board_2", name: "Menu Board — Long Format / Zone 2", autoCreatedFor: "menu_board", items: [item("pi_10", "c_menu_c", 1, 30, ["LOCALISED", "ON_ROTATION"])] }),
  playlist({ id: "pl_zone_menu_board_3", name: "Menu Board — Long Format / Zone 3", autoCreatedFor: "menu_board", items: [item("pi_11", "c_zinger", 1, 10, ["LOCALISED", "ON_ROTATION"], { d: "sc_zinger_default", s: "sc_zinger_selected", u: "sc_zinger_unselected" }), item("pi_12", "c_pepsi", 2, 8, ["LOCALISED", "ON_ROTATION"], { d: "sc_pepsi" }), item("pi_13", "c_menu_r", 3, 20, ["LOCALISED", "ON_ROTATION"])] }),
  playlist({ id: "pl_promo", name: "Promo Rotation", items: [item("pi_17", "c_wings", 1, 8, ["LOCALISED", "ON_ROTATION"]), item("pi_18", "c_family", 2, 8, ["LOCALISED", "ON_ROTATION"]), item("pi_19", "c_pepsi", 3, 8, ["LOCALISED", "ON_ROTATION"]), item("pi_20", "c_breakfast", 4, 8, ["TRIGGERED"])] }),
  playlist({ id: "pl_notices", name: "Store Notices", schedule: { mode: "always", from: null, to: null }, items: [item("pi_21", "c_notice", 1, 15, ["LOCALISED", "ON_ROTATION"], { d: "sc_notice" })] }),
  playlist({ id: "pl_seasonal", name: "Seasonal Overflow", items: [] }),
  playlist({ id: "pl_archive", name: "Archived Q1 Campaigns", items: [] }),
];

/* ------------------------------------------------------ display types */
/* The same nine display types the original prototype carries, in the
   platform-aligned shape. A phantom zone that is defined AND has QR control
   on maps to the platform's single "Enable QR Control (Phantom Zone)". */
const feat = (over) => ({ ...blankFeatures(), ...over });
const qrOn = ({ phantomArea = {}, ...over } = {}) => ({ enabled: true, ...over, phantomArea: { enabled: true, ...phantomArea } });

export const INITIAL_TYPES = [
  displayType({ id: "landscape", name: "Landscape", touchPoint: "Digital Signage",
    displayCanvasSize: { width: 1920, height: 1080 }, backgroundColor: "#000000", defaultPlaylistId: "pl_landscape",
    qrControl: qrOn(), enabledFeatures: feat({ visionAi: { ...blankFeatures().visionAi, enabled: true } }) }),
  displayType({ id: "portrait", name: "Portrait", touchPoint: "Digital Signage",
    displayCanvasSize: { width: 1080, height: 1920 }, backgroundColor: "#000000", defaultPlaylistId: "pl_portrait",
    qrControl: qrOn({ phantomArea: { width: 220, height: 220 }, mobileSiteTemplate: "Mobile Store Site" }),
    enabledFeatures: feat({ proximityMist: { enabled: true, mode: "zone", zone: "Front of Store" } }) }),
  displayType({ id: "menu_board", name: "Menu Board — Long Format", touchPoint: "Digital Signage",
    displayCanvasSize: { width: 5760, height: 1080 }, backgroundColor: "#111111", defaultPlaylistId: "pl_menu",
    playlistSettings: { maximumCampaignsPlayedInRotation: 3 },
    qrControl: qrOn({ mobileSiteTemplate: "Order & Pay" }),
    enabledFeatures: feat({ visionAi: { ...blankFeatures().visionAi, enabled: true } }),
    multiZone: { enabled: true, zones: [
      { id: "z1", name: "Zone 1", x: 0, y: 0, width: 33.3, height: 100, playlistId: "pl_zone_menu_board_1", trustZone: "agent_addressable" },
      { id: "z2", name: "Zone 2", x: 33.3, y: 0, width: 33.4, height: 100, playlistId: "pl_zone_menu_board_2", trustZone: "agent_addressable" },
      { id: "z3", name: "Zone 3", x: 66.7, y: 0, width: 33.3, height: 100, playlistId: "pl_zone_menu_board_3", trustZone: "agent_addressable" },
    ] },
    phExtensions: { slots: [
      slot({ label: "Priority 1", owner: "internal" }),
      slot({ label: "Supplier slot", owner: "advertiser", partnerId: "p_google", advertiser: RTB }),
      slot({ label: "Store choice", owner: "retail", storeScope: "Store staff" }),
    ] } }),
  displayType({ id: "web_hero", name: "Hero Banner", touchPoint: "Responsive Web", displayCanvasSize: { width: 1200, height: 520 }, backgroundColor: "#000000", element: elementConfig("hero"), defaultPlaylistId: "pl_web_hero",
    playlistSettings: { maximumCampaignsPlayedInRotation: 1 }, phExtensions: { slots: [slot({ label: "Featured offer", owner: "internal" })], nameAuto: true } }),
  displayType({ id: "web_carousel", name: "Carousel", touchPoint: "Responsive Web", displayCanvasSize: { width: 1200, height: 360 }, backgroundColor: "#000000", element: elementConfig("carousel"), defaultPlaylistId: "pl_promo",
    playlistSettings: { maximumCampaignsPlayedInRotation: 4 },
    phExtensions: { slots: [
      slot({ label: "Priority 1", owner: "internal" }),
      slot({ label: "Supplier slot", owner: "advertiser", partnerId: ANY_PARTNER, advertiser: RTB }),
      slot({ label: "Supplier slot", owner: "advertiser", partnerId: DIRECT_PARTNER, advertiser: "Blackmores" }),
      slot({ label: "Store choice", owner: "retail", storeScope: "Store staff" }),
    ], nameAuto: true } }),
  displayType({ id: "web_grid", name: "Grid", touchPoint: "Responsive Web", displayCanvasSize: { width: 1200, height: 640 }, backgroundColor: "#000000", element: elementConfig("grid"), defaultPlaylistId: "pl_promo",
    playlistSettings: { maximumCampaignsPlayedInRotation: 6 }, phExtensions: { slots: Array.from({ length: 6 }, (_, i) => slot({ label: `Tile ${i + 1}` })), nameAuto: true } }),
  displayType({ id: "web_product", name: "Product Tiles", touchPoint: "Responsive Web", displayCanvasSize: { width: 1200, height: 180 }, backgroundColor: "#000000", element: elementConfig("product"), defaultPlaylistId: "pl_web_hero",
    playlistSettings: { maximumCampaignsPlayedInRotation: 1 }, phExtensions: { slots: [slot({ label: "PH authoritative", owner: "internal" })], nameAuto: true } }),
  displayType({ id: "web_qr", name: "QR Control", touchPoint: "Responsive Web", displayCanvasSize: { width: 240, height: 240 }, backgroundColor: "#000000", element: elementConfig("qr_control"), defaultPlaylistId: "pl_web_hero",
    playlistSettings: { maximumCampaignsPlayedInRotation: 1 }, phExtensions: { nameAuto: true } }),
  displayType({ id: "web_ctas", name: "CTAs", touchPoint: "Responsive Web", displayCanvasSize: { width: 1200, height: 260 }, backgroundColor: "#000000", element: elementConfig("ctas"), defaultPlaylistId: "pl_notices",
    playlistSettings: { maximumCampaignsPlayedInRotation: 3 }, phExtensions: { slots: Array.from({ length: 3 }, (_, i) => slot({ label: `Action ${i + 1}` })), nameAuto: true } }),
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

export const INITIAL_EXCHANGE = { ...DEFAULT_EXCHANGE,
  client: { name: "Demo Retail Group", domain: "demoretail.example", contactEmail: "adops@demoretail.example" },
  sellersJson: { sellerId: "drg-4471", sellerType: "PUBLISHER", isConfidential: false, published: true },
};
