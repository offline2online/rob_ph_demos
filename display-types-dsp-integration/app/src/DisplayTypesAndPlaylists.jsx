import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  displayType, playlist as mkPlaylist, elementConfig, isCapped, slotCount, resizeSlots, setIn, UNLIMITED, PLATFORM_DEFAULTS,
} from "./model/schema.js";
import { INITIAL_TYPES, INITIAL_PLAYLISTS, INITIAL_PARTNERS, INITIAL_COMPANY_LISTS, INITIAL_EXCHANGE } from "./model/data.js";
import {
  DIRECT_PARTNER, ANY_PARTNER, RTB, ALLOW_LIST, COMPANY_LISTS, isBlocked, partnerById, providerOf, partnerColour, isDsp, effectiveLists, ownerAssignment,
} from "./model/sellside.js";
import PartnersView from "./views/PartnersView.jsx";

/* ------------------------------------------------------------------
   Personalisation Hub — Display Types & Playlist Management
   PROTOTYPE (iframed into HQ Admin): content frame only.
   Built against the live HQ Admin forms.
   NEW: Phantom Zone gating, Enabled Feature defaults, Multi-Zone Layout,
        Playlist Management, ultra-wide display preview.
------------------------------------------------------------------- */

/* ---------------------------- release scope -------------------------------
   The first release is Display Types / Elements, Playlist Management and
   Partners / DSPs. Experience Layout — templates, the surface layer — is built
   and working but deliberately out of that release, so it is gated here rather
   than deleted: set this to true to bring the nav item, the route and the
   template references back with no other change.
-------------------------------------------------------------------------- */
const SHOW_EXPERIENCE_LAYOUT = false;

const T = {
  primary: "#169bc2", primaryAccent: "#38b0cf", primaryTint: "rgba(22,155,194,0.10)",
  primarySoft: "#e8fdff", aiViolet: "#9747ff", text: "#333333", muted: "rgba(0,0,0,0.45)",
  micro: "#9ca3af", border: "#d9d9d9", borderSubtle: "#f0f0f0", divider: "rgba(5,5,5,0.06)",
  surfaceAlt: "#fafafa", success: "#52c41a", warning: "#faad14", error: "#ff4d4f",
};
const FONT = 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const SectionLabel = ({ children, style }) => (
  <div style={{ textTransform: "uppercase", fontSize: 12, letterSpacing: "0.5px", color: T.muted, marginTop: 24, marginBottom: 12, ...style }}>{children}</div>
);
/* Connected-state asset as delivered: phone outline with CONNECTED and the
   Powered by Personalisation Hub lockup baked into a single transparent PNG. */
const CONNECTED_ASSET = "data:image/png;base64,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";
const CONNECTED_ASSET_NAME = "powered_by_black_bigger.png";

const ZONE_COLOURS = ["#169bc2", "#9747ff", "#52c41a", "#faad14", "#ef60a7", "#0891b2"];

const SLOT_OWNERS = {
  internal:   { label: "Headquarters", color: T.primary, bg: T.primaryTint, icon: "corporate_fare" },
  advertiser: { label: "Advertiser",   color: "#7c3aed", bg: "rgba(124,58,237,0.10)", icon: "sell" },
  retail:     { label: "Stores",       color: T.warning, bg: "rgba(250,173,20,0.14)", icon: "storefront" },
};
const ADVERTISERS = ["Blackmores", "L'Or\u00e9al", "Cetaphil", "Swisse", "Nestl\u00e9"];
const STORE_SCOPES = ["Store staff", "Store manager only", "Regional manager", "Franchisee"];

/* Slot table columns: #, Label, Owner, Assigned to. The form column this sits
   in is a fixed 400px, so the partner and the advertiser share the last cell,
   stacked. */
const SLOT_GRID = "28px 1fr 100px 144px";
const BLOCK_LIST = "__block__";

const TOUCH_POINTS = [
  { name: "Digital Signage", icon: "tv" },
  { name: "Responsive Web", icon: "devices" },
  { name: "Mobile App", icon: "smartphone" },
  { name: "Mobile Store Site", icon: "mobile_friendly" },
  { name: "Kiosk", icon: "storefront" },
];
/* ---------------------------- web element types ---------------------------
   A web surface is assembled from elements. The element type determines which
   settings are even meaningful: a carousel has dwell and rotation, a tile grid
   shows everything at once and has columns instead, a commercial block plays
   no campaigns at all. "plays" drives the whole settings schema.
     sequential   — one campaign visible at a time, rotates
     simultaneous — all campaigns visible together, no rotation
     single       — exactly one campaign
     static       — renders no campaigns (structural or PH-authored)
--------------------------------------------------------------------------- */
const WEB_ELEMENT_GROUPS = ["Showcase", "Multi-item", "Commerce", "Content", "Pairing"];
const WEB_ELEMENTS = [
  { key: "hero",     name: "Hero",          icon: "featured_video", group: "Showcase", plays: "single",
    desc: "Lead element. One item at a time, in any format — image, video or copy. Settings control the rest." },
  { key: "carousel", name: "Carousel",      icon: "view_carousel",  group: "Multi-item", plays: "sequential",
    desc: "One item visible at a time with pagination. The customer can navigate." },
  { key: "grid",     name: "Grid",          icon: "grid_view",      group: "Multi-item", plays: "simultaneous",
    desc: "All items visible at once in a responsive grid." },
  { key: "list",     name: "List",          icon: "view_agenda",    group: "Multi-item", plays: "simultaneous",
    desc: "Vertical list of items." },
  { key: "product",  name: "Product Tiles", icon: "sell",           group: "Commerce", plays: "simultaneous",
    desc: "Product tiles with imagery, detail and price. Price is supplied by Personalisation Hub." },
  { key: "order",    name: "Order Summary", icon: "receipt_long",   group: "Commerce", plays: "static",
    desc: "Basket, totals and terms for the paired session." },
  { key: "ctas",     name: "CTAs",          icon: "ads_click",      group: "Content", plays: "simultaneous",
    desc: "A set of calls to action offered on this surface." },
  { key: "faq",      name: "FAQ",           icon: "quiz",           group: "Content", plays: "simultaneous",
    desc: "Expandable question and answer items." },
  { key: "text",     name: "Rich Text",     icon: "article",        group: "Content", plays: "static",
    desc: "Headings, copy and imagery. No item rotation." },
  { key: "footer",   name: "Site Footer",   icon: "bottom_navigation", group: "Content", plays: "static",
    desc: "Persistent footer — legal, contact and secondary links." },
];

const ELEMENT_DEFAULTS = {
  hero:     { slots: 1, cols: 1, colsTablet: 1, colsMobile: 1, items: 1, itemsTablet: 1, itemsMobile: 1, itemAspect: "16:9", gap: 0,  widthMode: "full",      wD: 1200, hD: 520, wT: 834, hT: 380, wM: 390, hM: 260 },
  carousel: { slots: 4, cols: 1, colsTablet: 1, colsMobile: 1, items: 4, itemsTablet: 4, itemsMobile: 4, itemAspect: "16:9", gap: 12, widthMode: "contained", wD: 1200, hD: 360, wT: 834, hT: 300, wM: 390, hM: 240 },
  grid:     { slots: 6, cols: 3, colsTablet: 2, colsMobile: 1, items: 6, itemsTablet: 4, itemsMobile: 3, itemAspect: "4:3",  gap: 16, widthMode: "contained", wD: 1200, hD: 640, wT: 834, hT: 520, wM: 390, hM: 600 },
  list:     { slots: 4, cols: 1, colsTablet: 1, colsMobile: 1, items: 4, itemsTablet: 3, itemsMobile: 3, itemAspect: "16:9", gap: 12, widthMode: "contained", wD: 1200, hD: 480, wT: 834, hT: 420, wM: 390, hM: 400 },
  product:  { slots: 6, cols: 3, colsTablet: 2, colsMobile: 2, items: 6, itemsTablet: 4, itemsMobile: 4, itemAspect: "1:1",  gap: 12, widthMode: "contained", wD: 1200, hD: 560, wT: 834, hT: 480, wM: 390, hM: 440 },
  order:    { slots: 1, cols: 1, colsTablet: 1, colsMobile: 1, items: 1, itemsTablet: 1, itemsMobile: 1, itemAspect: "auto", gap: 8,  widthMode: "contained", wD: 1200, hD: 300, wT: 834, hT: 280, wM: 390, hM: 260 },
  ctas:     { slots: 3, cols: 3, colsTablet: 3, colsMobile: 1, items: 3, itemsTablet: 3, itemsMobile: 2, itemAspect: "auto", gap: 10, widthMode: "contained", wD: 1200, hD: 120, wT: 834, hT: 110, wM: 390, hM: 180 },
  faq:      { slots: 5, cols: 1, colsTablet: 1, colsMobile: 1, items: 5, itemsTablet: 5, itemsMobile: 4, itemAspect: "auto", gap: 6,  widthMode: "contained", wD: 1200, hD: 420, wT: 834, hT: 400, wM: 390, hM: 380 },
  footer:   { slots: 1, cols: 1, colsTablet: 1, colsMobile: 1, items: 1, itemsTablet: 1, itemsMobile: 1, itemAspect: "auto", gap: 8,  widthMode: "full",      wD: 1200, hD: 180, wT: 834, hT: 200, wM: 390, hM: 260 },
  qr_control: { slots: 1, cols: 1, colsTablet: 1, colsMobile: 1, items: 1, itemsTablet: 1, itemsMobile: 1, itemAspect: "1:1",  gap: 0,  widthMode: "contained", aboveFold: true },
  text:     { slots: 1, cols: 1, colsTablet: 1, colsMobile: 1, items: 1, itemsTablet: 1, itemsMobile: 1, itemAspect: "auto", gap: 8,  widthMode: "contained", wD: 1200, hD: 300, wT: 834, hT: 280, wM: 390, hM: 260 },
};
/* ------------------------------- templates --------------------------------
   A template is a page composed of display types. Anything belonging to the
   page rather than one element — pairing overlay, container, first-paint
   budget, where the fold sits — is configured on the template. ------------- */
const TEMPLATE_KINDS = [
  { key: "web_page",   label: "Responsive Web Page", icon: "devices",        frame: "browser" },
  { key: "store_site", label: "Mobile Store Site",   icon: "smartphone",     frame: "phone" },
  { key: "pwa",        label: "PWA",                 icon: "install_mobile", frame: "phone" },
];

/* Modules a mobile store site is assembled from. The default layout is a
   carousel at the top with a CTA menu beneath it. */
const MOBILE_MODULES = [
  { key: "header",   label: "Site Header", icon: "title",         desc: "Brand and store name, with token substitution." },
  { key: "carousel", label: "Carousel",    icon: "view_carousel", desc: "Campaign carousel at the top of the site." },
  { key: "ctas",     label: "CTAs",        icon: "ads_click",     desc: "The menu of actions offered on this site." },
  { key: "content",  label: "Content",     icon: "article",       desc: "Static copy block." },
  { key: "footer",   label: "Site Footer", icon: "bottom_navigation", desc: "Persistent footer — legal, contact and secondary links." },
];

const INITIAL_TEMPLATES = [
  { id: "tpl_kfc", name: "KFC — Order Surface", kind: "web_page", background: "#ffffff",
    maxWidth: 1200, widthMode: "contained",
    pairing: { on: true, elementId: "web_qr", anchor: "Bottom Right", offsetX: 24, offsetY: 24, mobileTemplate: "Mobile App" },
    rows: [
      { rid: "r1", typeId: "web_hero" },
      { rid: "r2", typeId: "web_product" },
      { rid: "r3", typeId: "web_carousel" },
      { rid: "r4", typeId: "web_ctas" },
    ] },
  { id: "tpl_mobile_default", name: "Mobile App", kind: "store_site", isDefault: true,
    header: "${BrandName} ${StoreName}", qrScanner: true,
    modules: [{ mid: "m1", type: "header" }, { mid: "m2", type: "carousel" }, { mid: "m3", type: "ctas" }],
    carouselPlaylist: "pl_mss_default",
    items: [
      { icon: "shopping_cart", name: "Order now", pre: "custom", url: "{YourDomain}/order?store={$StoreCode}", newTab: false, states: ["connected_store", "connected_display"], hours: "24" },
      { icon: "map", name: "Store Details", pre: "store", url: "", newTab: false, states: ["connected_store", "away"], hours: "24" },
    ] },
  { id: "tpl_pharmacy", name: "Pharmacy — Store Connect", kind: "store_site",
    header: "${BrandName} ${StoreName}", qrScanner: true,
    modules: [{ mid: "p1", type: "header" }, { mid: "p2", type: "carousel" }, { mid: "p3", type: "ctas" }],
    carouselPlaylist: "pl_mss_default",
    items: [
      { icon: "calendar_month", name: "Book an Appointment", pre: "appointment", url: "", newTab: false, states: ["connected_store", "connected_website"], hours: "opening" },
      { icon: "groups", name: "Join the Queue", pre: "queue", url: "", newTab: false, states: ["connected_display", "connected_store"], hours: "opening" },
      { icon: "map", name: "Store Details", pre: "store", url: "", newTab: false, states: ["connected_store", "away"], hours: "24" },
      { icon: "hub", name: "Personalisation Hub", pre: "custom", url: "https://personalisationhub.com", newTab: true, states: ["connected_display", "away"], hours: "24" },
    ] },
];


/* Mock content so a composed template previews as something real. */
const MOCK = {
  web_hero: ["Zinger Box — $12.95"],
  web_carousel: ["Wicked Wings 6pk", "Popcorn Chicken", "Pepsi Max 600ml", "Chips — Large"],
  web_grid: ["Family Feast", "Twister Combo", "Snack Deal", "Sides Bundle", "Dessert", "Drinks"],
  web_ctas: ["Order now", "Find a store", "Track my order"],
  web_product: ["Zinger Box $12.95", "Wicked Wings $9.95", "Twister Combo $11.45", "Popcorn $6.95", "Chips $4.50", "Pepsi Max $3.95"],
};

const BREAKPOINTS = [
  { key: "desktop", label: "Desktop", icon: "desktop_windows", wKey: "wDesktop", hKey: "hDesktop", colKey: "cols",       itemKey: "items",       defW: 1200, defH: 520 },
  { key: "tablet",  label: "Tablet",  icon: "tablet_mac",      wKey: "wTablet",  hKey: "hTablet",  colKey: "colsTablet", itemKey: "itemsTablet", defW: 834,  defH: 420 },
  { key: "mobile",  label: "Mobile",  icon: "smartphone",      wKey: "wMobile",  hKey: "hMobile",  colKey: "colsMobile", itemKey: "itemsMobile", defW: 390,  defH: 320 },
];


const applyElementDefaults = (key) => {
  const x = ELEMENT_DEFAULTS[key] || ELEMENT_DEFAULTS.hero;
  return { maxRotation: String(x.slots), cols: x.cols, colsTablet: x.colsTablet, colsMobile: x.colsMobile,
           items: x.items, itemsTablet: x.itemsTablet, itemsMobile: x.itemsMobile,
           peek: x.peek ?? 0, peekTablet: x.peekTablet ?? 0, peekMobile: x.peekMobile ?? 0,
           itemAspect: x.itemAspect, gap: x.gap, widthMode: x.widthMode,
           wDesktop: x.wD, hDesktop: x.hD, wTablet: x.wT, hTablet: x.hT, wMobile: x.wM, hMobile: x.hM };
};

const webEl = (k) => WEB_ELEMENTS.find((e) => e.key === k) || WEB_ELEMENTS[0];
const isWebTP = (tp) => ["Responsive Web", "Mobile Store Site"].includes(tp);

/* Capability flags derived from the element type. */
function caps(d) {
  if (!isWebTP(d.touchPoint)) return { rotation: true, slots: true, grid: false, web: false, campaigns: true };
  const p = webEl(d.element?.type).plays;
  return {
    rotation: p === "sequential" || p === "single",
    slots: p === "sequential" || p === "simultaneous",
    grid: p === "simultaneous",
    carousel: p === "sequential",
    web: true,
    campaigns: p !== "static",
  };
}

const tpIcon = (n) => (TOUCH_POINTS.find((t) => t.name === n) || TOUCH_POINTS[0]).icon;

/* Structural markers shown against a display type in the list. */
const STRUCTURE_MARKERS = [
  { key: "phantom", icon: "crop_free", label: "Phantom zone defined", test: (t) => t.qrControl.phantomArea.enabled },
  { key: "zones", icon: "grid_view", label: "Multi-zone layout", test: (t) => t.multiZone.enabled },
  { key: "slots", icon: "view_week", label: "Capped rotation with assigned slots", test: (t) => isCapped(t) },
];

const COMPANY_AVAILABILITY = {
  in_store_radio: false, qr_control: true, proximity_mist: true,
  ai_agent_playback: false, vision_ai: true,
};

/* Which touch points each feature is relevant to. A feature irrelevant to the
   selected touch point is hidden entirely rather than shown disabled. */
const PHYSICAL = ["Digital Signage", "Kiosk"];
const ALL_TP = ["Digital Signage", "Responsive Web", "Mobile Store Site", "Kiosk"];
const FEATURE_TOUCH_POINTS = {
  in_store_radio: PHYSICAL,
  qr_control: PHYSICAL,   // on web the pairing overlay is set on the Layout template
  proximity_mist: PHYSICAL,
  ai_agent_playback: ALL_TP,
  vision_ai: PHYSICAL,
};

const FEATURES = [
  { key: "in_store_radio", icon: "music_note", label: "Enable In-Store Radio",
    hint: "Synchronised in-store audio." },
  { key: "qr_control", icon: "qr_code_2", label: "Enable QR Control",
    hint: "Renders the pairing QR inside the phantom zone so a customer can pair a device to this surface.",
    requiresPhantom: true },
  { key: "proximity_mist", icon: "sensors", label: "Enable Proximity based Personalisation (using MIST)",
    hint: "Triggers personalisation from a MIST zone or vBeacon rather than a scan." },
  { key: "ai_agent_playback", icon: "smart_toy", label: "Allow AI-Agents to Control Campaign Playback",
    hint: "A connected AI Agent sees every Active, AI-Agent-Enabled campaign assigned to this display and can trigger playback. Campaigns without that flag stay invisible to the agent." },
  { key: "vision_ai", icon: "visibility", label: "Enable Vision/AI (BETA)",
    hint: "On-device passerby insight and person match. Emits confidence-scored attributes." },
];

/* Mobile store site templates. The template chosen on a display's QR Control
   determines which mobile experience opens when that QR is scanned — so the
   same platform serves different experiences by display type or store location. */
/* ------------------- mobile store site templates -------------------------
   Modelled on Platform Admin › Mobile Store Sites. A template defines the
   site header and the menu items (CTAs) shown when it is assigned to a
   display, so the same platform serves different experiences per QR. ------ */

/* Connection states. This is a SEPARATE axis from the render ladder: a
   visitor can be Personalised AND Away From Store, or Default AND Connected
   Display. Campaigns resolve on the tier axis; CTAs resolve on this one. */
const CONNECTION_STATES = [
  { key: "connected_store",   label: "Connected Store State",         hint: "Paired and physically in store." },
  { key: "connected_display", label: "Connected Display State",       hint: "Paired to a specific display via QR." },
  { key: "connected_website", label: "Connected Store Website State", hint: "Connected through the store's website." },
  { key: "away",              label: "Away From Store State",         hint: "No store or display connection." },
];

/* Tokens substituted at render time, in headers and menu URLs. */
const SITE_TOKENS = ["${BrandName}", "${StoreName}", "${StoreCode}", "${FirstName}", "${QueuePosition}"];

const PRECONFIGURED_ITEMS = [
  { key: "custom",       label: "Custom",                     icon: "link" },
  { key: "queue",        label: "Join the queue",             icon: "groups" },
  { key: "appointment",  label: "Book an Appointment",        icon: "calendar_month" },
  { key: "store",        label: "Store Details",              icon: "map" },
  { key: "mobile_display", label: "Mobile<>Display Experience", icon: "cast" },
];

const CTA_ATTRS = ["loyalty_tier", "visitor_type_id", "reason_for_visit_id", "visitor_segments", "product_holdings", "purchase_intent", "SKUs", "Age", "gender", "device_type"];
const MENU_ICONS = ["link", "groups", "calendar_month", "map", "cast", "shopping_cart", "person", "support_agent", "local_offer", "receipt_long", "hub", "storefront"];

const MOBILE_TEMPLATE_DEFS = [
  { name: "Mobile App", isDefault: true, header: "${BrandName} ${StoreName}", qrScanner: true,
    items: [
      { icon: "shopping_cart", name: "Order now", pre: "custom", url: "{YourDomain}/order?store={$StoreCode}", newTab: false, states: ["connected_store", "connected_display"], hours: "24" },
      { icon: "map", name: "Store Details", pre: "store", url: "", newTab: false, states: ["connected_store", "away"], hours: "24" },
    ] },
  { name: "Pharmacy - Store Connect", isDefault: false, header: "${BrandName} ${StoreName}", qrScanner: true,
    items: [
      { icon: "calendar_month", name: "Book an Appointment", pre: "appointment", url: "", newTab: false, states: ["connected_store", "connected_website"], hours: "opening" },
      { icon: "groups", name: "Join the Queue", pre: "queue", url: "", newTab: false, states: ["connected_display", "connected_store"], hours: "opening" },
      { icon: "map", name: "Store Details", pre: "store", url: "", newTab: false, states: ["connected_store", "away"], hours: "24" },
      { icon: "hub", name: "Personalisation Hub", pre: "custom", url: "https://personalisationhub.com", newTab: true, states: ["connected_display", "away"], hours: "24" },
    ] },
  { name: "PH Walk-Thru", isDefault: false, header: "${BrandName} Walk-Thru", qrScanner: false,
    items: [
      { icon: "cast", name: "Continue on Display", pre: "mobile_display", url: "", newTab: false, states: ["connected_display"], hours: "24" },
    ] },
];
const MOBILE_TEMPLATES = MOBILE_TEMPLATE_DEFS.map((m) => m.name);
const MIST_ZONES = ["Personalisation Hub Demo - Welcome Zone", "Front of Store", "Aisle 3", "Checkout Queue", "Service Desk"];
const VISION_MODES = ["Monitor Passerby & Campaign Engagement Data", "Passerby Count Only", "Targeting & Personalisation", "Engagement Only"];
const DETECTION_PRESETS = {
  Fast: { streamQuality: 480, fps: 10, frameSkip: 7, missThreshold: 10,
    note: "Lower camera quality and fewer processed frames. Best for weak hardware; may miss small faces or short visits." },
  Balanced: { streamQuality: 640, fps: 15, frameSkip: 5, missThreshold: 15,
    note: "Recommended default. Reasonable CPU usage and stable detection." },
  Accurate: { streamQuality: 1280, fps: 24, frameSkip: 2, missThreshold: 24,
    note: "Higher camera quality, more frequent detection, longer stability windows. Better recall; uses more CPU." },
  Custom: { note: "Manual values that no longer exactly match a predefined preset." },
};
const matchPreset = (c) => Object.keys(DETECTION_PRESETS).find((k) => {
  const p = DETECTION_PRESETS[k];
  return p.fps && p.streamQuality === c.streamQuality && p.fps === c.fps && p.frameSkip === c.frameSkip && p.missThreshold === c.missThreshold;
}) || "Custom";

/* Display-type records and playlists come from ./model — the platform-aligned
   shape (REQUIREMENTS §8). Everything below reads and writes that shape; the
   UI itself is the original prototype's. */
const DEFAULTS = PLATFORM_DEFAULTS.playlistSettings;
const PHANTOM_DEFAULT_POSITION = PLATFORM_DEFAULTS.qrControl.phantomArea.position;

/* Feature rows keep their original keys; these map them onto the record.
   QR Control lives at qrControl (the platform's own panel), the rest under
   enabledFeatures. */
const FEATURE_PATH = { in_store_radio: "inStoreRadio", proximity_mist: "proximityMist", ai_agent_playback: "aiAgentPlayback", vision_ai: "visionAi" };
const featCfg = (d, key) => {
  if (key === "qr_control") {
    const q = d.qrControl;
    return { on: q.enabled, size: q.qrCode.size, colour: q.qrCode.colour, qrPosition: q.qrCode.position, connectedColour: q.connectedIconColour,
      mobileTemplate: q.mobileSiteTemplate, overlayPosition: q.webOverlay.position, offsetX: q.webOverlay.offsetX, offsetY: q.webOverlay.offsetY };
  }
  const f = d.enabledFeatures[FEATURE_PATH[key]] || { enabled: false };
  return { ...f, on: !!f.enabled, visionMode: f.mode };
};
const withFeat = (d, key, patch) => {
  if (key === "qr_control") {
    let q = d.qrControl;
    if ("on" in patch) q = { ...q, enabled: patch.on };
    if ("size" in patch) q = { ...q, qrCode: { ...q.qrCode, size: patch.size } };
    if ("colour" in patch) q = { ...q, qrCode: { ...q.qrCode, colour: patch.colour } };
    if ("connectedColour" in patch) q = { ...q, connectedIconColour: patch.connectedColour };
    if ("mobileTemplate" in patch) q = { ...q, mobileSiteTemplate: patch.mobileTemplate };
    return { ...d, qrControl: q };
  }
  const k = FEATURE_PATH[key];
  const { on, visionMode, ...rest } = patch;
  const next = { ...(d.enabledFeatures[k] || {}), ...rest };
  if ("on" in patch) next.enabled = on;
  if ("visionMode" in patch) next.mode = visionMode;
  return { ...d, enabledFeatures: { ...d.enabledFeatures, [k]: next } };
};
const W_OF = (d) => d.displayCanvasSize.width;
const H_OF = (d) => d.displayCanvasSize.height;
/* The rotation cap as the select shows it: null = Default, "Unlimited", or "n". */
const capValue = (d) => { const v = d.playlistSettings.maximumCampaignsPlayedInRotation; return v === null || v === undefined ? null : v === UNLIMITED ? "Unlimited" : String(v); };
/* Slots a web element starts with when its type changes (was applyElementDefaults). */
const ELEMENT_SLOTS = { hero: 1, carousel: 4, grid: 6, list: 4, product: 6, ctas: 3, faq: 5 };
const PAIRED_DEVICES = [
  { key: "phone", label: "Phone", icon: "smartphone" },
  { key: "glasses", label: "Glasses", icon: "eyeglasses" },
  { key: "watch", label: "Watch", icon: "watch" },
];

/* ------------------------------ primitives -------------------------------- */

const Icon = ({ name, size = 20, style, onClick }) => (
  <span className="material-symbols-outlined" onClick={onClick} style={{ fontSize: size, verticalAlign: "middle", lineHeight: 1, ...style }}>{name}</span>
);
const Pill = ({ children, color, bg, border, style }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 8px", borderRadius: 9999, fontSize: 12, lineHeight: "22px", color, background: bg, border: border ? `1px solid ${border}` : "none", whiteSpace: "nowrap", ...style }}>{children}</span>
);
const Btn = ({ children, onClick, variant = "default", disabled, style, title }) => {
  const v = {
    default: { background: "#fff", border: `1px solid ${T.border}`, color: T.text },
    primary: { background: T.primary, border: `1px solid ${T.primary}`, color: "#fff" },
    outline: { background: "#fff", border: `1px solid ${T.primary}`, color: T.primary },
    text: { background: "transparent", border: "1px solid transparent", color: T.primary },
    danger: { background: "#fff", border: `1px solid ${T.error}`, color: T.error },
  }[variant];
  return <button title={title} onClick={disabled ? undefined : onClick} style={{ height: 32, padding: "0 15px", borderRadius: 6, fontSize: 14, fontFamily: FONT, cursor: disabled ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: disabled ? 0.4 : 1, whiteSpace: "nowrap", overflow: "hidden", flexShrink: 0, ...v, ...style }}>{children}</button>;
};
const inputStyle = { height: 32, padding: "4px 11px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: FONT, color: T.text, background: "#fff", outline: "none", width: "100%", boxSizing: "border-box" };
const Label = ({ children, required, info }) => (
  <div style={{ fontSize: 14, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
    {required && <span style={{ color: T.error }}>*</span>}{children}{info && <Icon name="info" size={15} style={{ color: T.micro }} />}
  </div>
);
const Panel = ({ title, children, open, onToggle, badge }) => (
  <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, marginTop: 16, overflow: "hidden" }}>
    <div onClick={onToggle} style={{ padding: "12px 16px", background: T.surfaceAlt, borderBottom: open ? `1px solid ${T.borderSubtle}` : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13, letterSpacing: "0.3px" }}>
      <Icon name={open ? "expand_more" : "chevron_right"} size={18} style={{ color: T.muted }} />
      <span style={{ flex: 1 }}>{title}</span>
      {badge}
    </div>
    {open && <div style={{ padding: 16 }}>{children}</div>}
  </div>
);
const DefaultSelect = ({ value, onChange, options, fallback }) => (
  <select value={value === null ? "__d__" : value} onChange={(e) => onChange(e.target.value === "__d__" ? null : e.target.value)}
    style={{ ...inputStyle, color: value === null ? T.muted : T.text }}>
    <option value="__d__">Default ({fallback})</option>
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);
const IconSelect = ({ value, onChange, options }) => {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.name === value) || options[0];
  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => setOpen(!open)}
        style={{ ...inputStyle, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <Icon name={cur.icon} size={17} style={{ color: T.primary }} />
        <span style={{ flex: 1 }}>{cur.name}</span>
        <Icon name={open ? "expand_less" : "expand_more"} size={17} style={{ color: T.muted }} />
      </div>
      {open && (
        <div style={{ position: "absolute", zIndex: 20, left: 0, right: 0, marginTop: 3, background: "#fff", border: `1px solid ${T.border}`, borderRadius: 6, boxShadow: "0 4px 14px rgba(0,0,0,0.12)", overflow: "hidden" }}>
          {options.map((o) => (
            <div key={o.name} onClick={() => { onChange(o.name); setOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", cursor: "pointer", fontSize: 13, background: o.name === value ? T.primaryTint : "#fff", color: o.name === value ? T.primary : T.text }}>
              <Icon name={o.icon} size={17} />{o.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Toggle = ({ on, onChange, disabled }) => (
  <div onClick={disabled ? undefined : () => onChange(!on)}
    style={{ width: 44, height: 22, borderRadius: 9999, background: on ? T.primary : "rgba(0,0,0,0.25)", cursor: disabled ? "not-allowed" : "pointer", position: "relative", flexShrink: 0, opacity: disabled ? 0.45 : 1 }}>
    <div style={{ width: 18, height: 18, borderRadius: 9999, background: "#fff", position: "absolute", top: 2, left: on ? 24 : 2, transition: "left .15s" }} />
  </div>
);
const SubSettings = ({ children }) => (
  <div style={{ marginLeft: 28, marginTop: 12, padding: 12, background: T.surfaceAlt, border: `1px solid ${T.borderSubtle}`, borderRadius: 6 }}>{children}</div>
);
const Note = ({ children }) => <div style={{ fontSize: 11.5, color: T.muted, marginTop: 8, lineHeight: 1.5 }}>{children}</div>;

const SubPanel = ({ title, children }) => {
  const [o, setO] = React.useState(false);
  return (
    <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 6, marginBottom: 6, background: "#fff", overflow: "hidden" }}>
      <div onClick={() => setO(!o)} style={{ padding: "9px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13, background: T.surfaceAlt }}>
        <Icon name={o ? "expand_more" : "chevron_right"} size={16} style={{ color: T.muted }} />{title}
      </div>
      {o && <div style={{ padding: 12 }}>{children}</div>}
    </div>
  );
};

const Slider = ({ value, onChange, max = 1 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, height: 28 }}>
    <input type="range" min="0" max={max} step="0.01" value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, accentColor: T.primary, minWidth: 60 }} />
    <span style={{ fontSize: 12.5, width: 32, fontFamily: "ui-monospace, monospace" }}>{Number(value).toFixed(2)}</span>
  </div>
);
const Row = ({ children }) => <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>{children}</div>;
const Col = ({ children }) => <div style={{ flex: 1, minWidth: 0 }}>{children}</div>;

/* ---------------------------- usage resolution ---------------------------- */

function usageOf(playlistId, types) {
  const out = [];
  types.forEach((t) => {
    if (t.defaultPlaylistId === playlistId) out.push({ type: t, where: "Default playlist" });
    if (t.multiZone.enabled) t.multiZone.zones.forEach((z) => { if (z.playlistId === playlistId) out.push({ type: t, where: z.name }); });
  });
  return out;
}

/* --------------------------------- app ----------------------------------- */

export default function App() {
  const [nav, setNav] = useState("types");
  const [playlists, setPlaylists] = useState(INITIAL_PLAYLISTS);
  const [types, setTypes] = useState(INITIAL_TYPES);
  const [selType, setSelType] = useState("menu_board");
  const [templates, setTemplates] = useState(INITIAL_TEMPLATES);
  const [partners, setPartners] = useState(INITIAL_PARTNERS);
  const [companyLists, setCompanyLists] = useState(INITIAL_COMPANY_LISTS);
  const [exchange, setExchange] = useState(INITIAL_EXCHANGE);
  const [selPartner, setSelPartner] = useState(COMPANY_LISTS);

  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap";
    document.head.appendChild(l);
  }, []);

  /* Iframe canvas is fluid, set by the parent CTA frame (prototyping.md §3) —
     below this width the nav rail contracts to icons-only so the content
     column keeps enough room to be usable. */
  const [canvasW, setCanvasW] = useState(typeof window !== "undefined" ? window.innerWidth : 1280);
  useEffect(() => {
    const onResize = () => setCanvasW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const navCollapsed = canvasW < 900;

  const NAV = [
    { key: "types", label: "Display Types / Elements", icon: "dashboard_customize" },
    { key: "layout", label: "Experience Layout", icon: "space_dashboard", scope: SHOW_EXPERIENCE_LAYOUT },
    { key: "playlists", label: "Playlist Management", icon: "playlist_play" },
    { key: "partners", label: "Partners / DSPs", icon: "handshake" },
  ].filter((n) => n.scope !== false);

  const NAV_TITLES = {
    types: "Display Types Details",
    layout: "Experience Layout",
    playlists: "Playlist Management",
    partners: "Partners / DSPs",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#fff", padding: 20, fontFamily: FONT, color: T.text, fontSize: 14 }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{NAV_TITLES[nav]}</div>
      <div style={{ height: 1, background: T.divider, margin: "16px 0" }} />
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <div style={{ width: navCollapsed ? 56 : 230, flexShrink: 0, borderRight: `1px solid ${T.borderSubtle}`, position: "sticky", top: 20, maxHeight: "calc(100vh - 40px)", overflowY: "auto", overflowX: "hidden", transition: "width .15s" }}>
          {NAV.map((n) => {
            const a = nav === n.key;
            return <div key={n.key} onClick={() => setNav(n.key)} title={navCollapsed ? n.label : undefined}
              style={{ padding: navCollapsed ? "12px 0" : "12px 16px", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: navCollapsed ? "center" : "flex-start", gap: 8, color: a ? T.primary : T.text, background: a ? T.primaryTint : "transparent" }}>
              <Icon name={n.icon} size={18} />{!navCollapsed && n.label}
            </div>;
          })}
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingLeft: 20 }}>
          {nav === "types" && <TypesView types={types} setTypes={setTypes} playlists={playlists} setPlaylists={setPlaylists} sel={selType} setSel={setSelType} templates={templates} partners={partners} companyLists={companyLists} goToPartners={() => { setSelPartner(COMPANY_LISTS); setNav("partners"); }} />}
          {nav === "layout" && SHOW_EXPERIENCE_LAYOUT && <LayoutComposer types={types} templates={templates} setTemplates={setTemplates} playlists={playlists} />}
          {nav === "playlists" && <PlaylistManagement playlists={playlists} setPlaylists={setPlaylists} types={types} goToType={(id) => { setSelType(id); setNav("types"); }} />}
          {nav === "partners" && <PartnersView partners={partners} setPartners={setPartners} companyLists={companyLists} setCompanyLists={setCompanyLists} exchange={exchange} setExchange={setExchange} types={types} goToType={(id) => { setSelType(id); setNav("types"); }} sel={selPartner} setSel={setSelPartner} />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ display types ----------------------------- */

/* Three columns (type list + form + preview) need this much room side by
   side (widths + the two 20px gaps, §567). Below it the preview column
   would wrap below the form — reflowed above Touch Point instead, since a
   preview stranded beneath the whole form is easy to miss scrolling down. */
const THREE_COLUMN_MIN_WIDTH = 215 + 20 + 400 + 20 + 320;

function TypesView({ types, setTypes, playlists, setPlaylists, sel, setSel, templates, partners, companyLists, goToPartners }) {
  const [open, setOpen] = useState({ playlist: false, web: true, phantom: true, features: true, zones: true });
  const [pendingEl, setPendingEl] = useState(null);
  const columnsRef = useRef(null);
  const [fitsThreeColumns, setFitsThreeColumns] = useState(true);
  useEffect(() => {
    const el = columnsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setFitsThreeColumns((entries[0]?.contentRect?.width ?? el.clientWidth) >= THREE_COLUMN_MIN_WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const d = types.find((t) => t.id === sel) || types[0];
  const set = (patch) => setTypes(types.map((t) => (t.id === d.id ? { ...t, ...patch } : t)));
  const setPath = (path, value) => setTypes(types.map((t) => (t.id === d.id ? setIn(t, path, value) : t)));
  const update = (fn) => setTypes(types.map((t) => (t.id === d.id ? fn(t) : t)));
  const ps = d.playlistSettings;
  const slots = d.phExtensions.slots || [];
  const zones = d.multiZone.zones;
  const setZones = (z) => setPath("multiZone.zones", z);
  const toggle = (k) => setOpen({ ...open, [k]: !open[k] });
  /* Element type drives every layout setting, so changing it after the fact
     resets them. Confirm rather than silently discarding the configuration. */
  const tplUsage = (templates || []).filter((t) => (t.rows || []).some((r) => r.typeId === sel));
  /* Advertiser positions pointing at a partner that cannot currently take demand. */
  const advertiserSlots = slots.filter((sl) => sl.owner === "advertiser");
  const brokenSlots = advertiserSlots.filter((sl) => {
    const p = sl.partnerId && sl.partnerId !== ANY_PARTNER ? partnerById(partners, sl.partnerId) : null;
    return p && p.status !== "connected";
  });
  const askChangeElement = (k) => { if (k !== d.element?.type) setPendingEl(k); };
  const plName = (id) => playlists.find((p) => p.id === id)?.name || "—";

  /* Zone playlists follow a naming convention: "<Display Type> / Zone N".
     Created on demand and reassignable afterwards. */
  const ensureZonePlaylist = (n) => {
    const name = `${d.name} / Zone ${n}`;
    const found = playlists.find((p) => p.name === name);
    if (found) return found.id;
    const id = `pl_zone_${d.id}_${n}`;
    setPlaylists((prev) => (prev.some((p) => p.id === id) ? prev : [...prev, mkPlaylist({ id, name, autoCreatedFor: d.id })]));
    return id;
  };


  /* The preview and the Touch Point / Element Type control travel together in
     one column: the control that decides what the preview renders sits
     directly under it, rather than at the top of the form column two columns
     away. When there is no room for three columns the pair moves into the
     form column, still in that order. */
  const previewColumn = (
    <>
      <div style={{ marginBottom: 16 }}>
        <Preview d={d} plName={plName} setPath={setPath} partners={partners} companyLists={companyLists} />
      </div>
      {/* Capped to the form column's width so the control does not stretch to
          the full third column and dwarf the preview it belongs to. */}
      <div style={{ marginBottom: 16, maxWidth: 400 }}>
        <Label>Touch Point</Label>
        <IconSelect value={d.touchPoint} onChange={(v) => set({ touchPoint: v, element: isWebTP(v) ? (d.element || elementConfig("hero")) : d.element })} options={TOUCH_POINTS} />
        {isWebTP(d.touchPoint) && (
          <div style={{ marginTop: 14 }}>
            <Label required>Element Type</Label>
            <select value={d.element?.type}
              onChange={(e) => askChangeElement(e.target.value)} style={{ ...inputStyle }}>
              {WEB_ELEMENT_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {WEB_ELEMENTS.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                </optgroup>
              ))}
            </select>
            <div style={{ padding: 10, marginTop: 8, borderRadius: 6, background: T.surfaceAlt, border: `1px solid ${T.borderSubtle}`, fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
              {webEl(d.element?.type).desc}
              <div style={{ marginTop: 5, color: T.micro }}>
                Plays: <b style={{ color: T.text }}>{webEl(d.element?.type).plays}</b>
                {" · "}
                {caps(d).campaigns
                  ? (caps(d).grid ? "all campaigns render together" : caps(d).rotation ? "one at a time, rotates" : "single campaign")
                  : "renders no campaigns"}
              </div>
            </div>
            {pendingEl && (
              <div style={{ marginTop: 10, padding: 11, borderRadius: 6, background: "rgba(250,173,20,0.10)", border: `1px solid rgba(250,173,20,0.4)`, fontSize: 12.5, lineHeight: 1.5 }}>
                <b>Change element type to {webEl(pendingEl).name}?</b>
                <div style={{ marginTop: 5, color: T.muted }}>
                  Layout settings are specific to the element type. Slot count, columns, items shown, aspect ratio,
                  width mode and fold position will be reset to the defaults for {webEl(pendingEl).name}.
                  {SHOW_EXPERIENCE_LAYOUT && (tplUsage || []).length > 0 && <> This element is used in <b>{tplUsage.length}</b> template{tplUsage.length > 1 ? "s" : ""}, which will re-render.</>}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Btn variant="primary" style={{ height: 28, fontSize: 12.5 }}
                    onClick={() => {
                      const n = ELEMENT_SLOTS[pendingEl] ?? UNLIMITED;
                      update((t) => ({ ...t, element: elementConfig(pendingEl),
                        playlistSettings: { ...t.playlistSettings, maximumCampaignsPlayedInRotation: n },
                        phExtensions: { ...t.phExtensions, slots: n === UNLIMITED ? [] : resizeSlots([], n) },
                        ...(t.phExtensions.nameAuto ? { name: webEl(pendingEl).name } : {}) }));
                      setPendingEl(null);
                    }}>
                    Change and reset
                  </Btn>
                  <Btn style={{ height: 28, fontSize: 12.5 }} onClick={() => setPendingEl(null)}>Cancel</Btn>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div ref={columnsRef} style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ width: 215, flexShrink: 0, position: "sticky", top: 20, maxHeight: "calc(100vh - 40px)", overflowY: "auto", overflowX: "hidden" }}>
        <Btn variant="primary" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }}
          onClick={() => {
            const id = `dt_${Date.now()}`;
            const pid = `pl_${id}`;
            setPlaylists([...playlists, mkPlaylist({ id: pid, name: "New Display Type Playlist", autoCreatedFor: id })]);
            setTypes([...types, displayType({ id, name: "", touchPoint: "Digital Signage", defaultPlaylistId: pid,
              playlistSettings: { maximumCampaignsPlayedInRotation: UNLIMITED } })]);
            setSel(id);
          }}>
          <Icon name="add" size={16} />New display type
        </Btn>
        <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, overflow: "hidden" }}>
          {types.map((t) => {
            const a = t.id === sel;
            return <div key={t.id} onClick={() => setSel(t.id)}
              style={{ padding: "10px 12px", cursor: "pointer", borderBottom: `1px solid ${T.borderSubtle}`, background: a ? T.primaryTint : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                <Icon name={tpIcon(t.touchPoint)} size={17} style={{ color: a ? T.primary : T.muted, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: a ? T.primary : T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 3, marginLeft: 24 }}>{W_OF(t)}×{H_OF(t)}</div>
              <div style={{ display: "flex", gap: 5, marginTop: 5, marginLeft: 24, flexWrap: "wrap" }}>
                {STRUCTURE_MARKERS.filter((m) => m.test(t)).map((m) => (
                  <span key={m.key} title={m.label}
                    style={{ width: 20, height: 20, borderRadius: 4, background: T.primaryTint, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={m.icon} size={13} style={{ color: T.primary }} />
                  </span>
                ))}
                {FEATURES.filter((f) => COMPANY_AVAILABILITY[f.key] && featCfg(t, f.key).on).map((f) => (
                  <span key={f.key} title={f.label}
                    style={{ width: 20, height: 20, borderRadius: 4, background: "rgba(82,196,26,0.12)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={f.icon} size={13} style={{ color: T.success }} />
                  </span>
                ))}
              </div>
            </div>;
          })}
        </div>
      </div>

      <div style={{ width: 400, flexShrink: 0 }}>
        {!fitsThreeColumns && previewColumn}
        <div style={{ marginBottom: 16 }}>
          <Label required>Display Type / Element Name</Label>
          <input value={d.name} autoFocus={!d.name} placeholder="Name this display type / element"
            onChange={(e) => update((t) => ({ ...t, name: e.target.value, phExtensions: { ...t.phExtensions, nameAuto: false } }))}
            style={{ ...inputStyle, borderColor: d.name ? T.border : T.warning }} />
          {isWebTP(d.touchPoint) && d.phExtensions.nameAuto && (
            <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4 }}>
              Following the element selection. Edit to set your own name.
            </div>
          )}
        </div>
        {!isWebTP(d.touchPoint) && (
          <div style={{ marginBottom: 16 }}>
            <Label required info>Display Canvas Size (Resolution)</Label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: T.muted }}>W</span>
              <input type="number" value={W_OF(d)} onChange={(e) => setPath("displayCanvasSize.width", Number(e.target.value))} style={{ ...inputStyle, width: 95 }} />
              <span style={{ color: T.muted }}>H</span>
              <input type="number" value={H_OF(d)} onChange={(e) => setPath("displayCanvasSize.height", Number(e.target.value))} style={{ ...inputStyle, width: 95 }} />
            </div>
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <Label>Background Color</Label>
          <input type="color" value={d.backgroundColor} onChange={(e) => set({ backgroundColor: e.target.value })}
            style={{ width: 38, height: 34, border: `1px solid ${T.border}`, borderRadius: 6, padding: 2, cursor: "pointer", background: "#fff" }} />
        </div>
        {caps(d).campaigns ? (
          <div>
            <Label>Default Playlist</Label>
            <select value={d.defaultPlaylistId || ""} onChange={(e) => set({ defaultPlaylistId: e.target.value })} style={inputStyle}>
              {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}{p.autoCreatedFor === d.id ? " (auto-created)" : ""}</option>)}
            </select>
          </div>
        ) : (
          <div style={{ padding: 10, borderRadius: 6, background: T.surfaceAlt, border: `1px solid ${T.borderSubtle}`, fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
            <b style={{ color: T.text }}>{webEl(d.element?.type).name}</b> renders no campaigns, so it has no playlist.
            Its content is authored directly.
          </div>
        )}

        {/* ---- PLAYLIST SETTINGS ---- */}
        {caps(d).campaigns && (
        <Panel title="PLAYLIST SETTINGS" open={open.playlist} onToggle={() => toggle("playlist")}>
          <Row>
            <Col><Label>Asset Position</Label><DefaultSelect value={ps.assetPosition} onChange={(v) => setPath("playlistSettings.assetPosition", v)} fallback={DEFAULTS.assetPosition} options={["Top-Left", "Top-Right", "Center", "Bottom-Left", "Bottom-Right"]} /></Col>
            <Col><Label>Asset Fill</Label><DefaultSelect value={ps.assetFill} onChange={(v) => setPath("playlistSettings.assetFill", v)} fallback={DEFAULTS.assetFill} options={["Fit to Display", "Maintain Asset Property", "Fill", "Stretch"]} /></Col>
          </Row>
          <Row>
            <Col><Label>Maximum Campaigns Played In Rotation</Label>
              <DefaultSelect value={capValue(d)} onChange={(v) => {
                const n = v === null ? null : v === "Unlimited" ? UNLIMITED : Number(v);
                update((t) => ({ ...t, playlistSettings: { ...t.playlistSettings, maximumCampaignsPlayedInRotation: n },
                  phExtensions: { ...t.phExtensions, slots: n === null || n === UNLIMITED ? [] : resizeSlots(t.phExtensions.slots, n) } }));
              }} fallback={DEFAULTS.maximumCampaignsPlayedInRotation === UNLIMITED ? "Unlimited" : String(DEFAULTS.maximumCampaignsPlayedInRotation)} options={["Unlimited", "1", "2", "3", "4", "5", "6", "8", "10", "12"]} /></Col>
            <Col><Label>Campaign Transition</Label><DefaultSelect value={ps.campaignTransition} onChange={(v) => setPath("playlistSettings.campaignTransition", v)} fallback={DEFAULTS.campaignTransition} options={["None", "Fade", "Slide"]} /></Col>
          </Row>
          {isCapped(d) && (
            <div style={{ marginBottom: 16 }}>
              <Label>Slot assignment</Label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {slots.map((sl, i) => {
                  const o = SLOT_OWNERS[sl.owner];
                  const rtb = sl.owner === "advertiser" && (!sl.advertiser || sl.advertiser === RTB);
                  const p = sl.owner === "advertiser" && sl.partnerId && sl.partnerId !== ANY_PARTNER
                    ? partnerById(partners, sl.partnerId) : null;
                  const broken = sl.owner === "advertiser" && p && p.status !== "connected";
                  const col = p && !p.system ? partnerColour(p) : o.color;
                  return (
                    <div key={i} style={{ border: `1px solid ${broken ? T.error : col}`, borderStyle: rtb ? "dashed" : "solid", borderRadius: 6, padding: "6px 10px", background: o.bg, minWidth: 96 }}>
                      <div style={{ fontSize: 10.5, color: T.micro }}>Slot {i + 1}</div>
                      <div style={{ fontSize: 12, color: broken ? T.error : col, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                        <Icon name={p && providerOf(p) ? providerOf(p).icon : o.icon} size={13} />{o.label}
                      </div>
                      <div style={{ fontSize: 11, color: broken ? T.error : T.muted, marginTop: 2 }}>
                        {ownerAssignment(sl, partners, companyLists)}
                      </div>
                      {broken && <div style={{ fontSize: 10, color: T.error, marginTop: 2, display: "flex", alignItems: "center", gap: 3 }}>
                        <Icon name="error" size={11} />Not connected
                      </div>}
                    </div>
                  );
                })}
              </div>
              <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 6, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: SLOT_GRID, background: T.surfaceAlt, borderBottom: `1px solid ${T.borderSubtle}`, fontSize: 12, fontWeight: 600, color: T.muted }}>
                  {["#", "Label", "Owner", "Assigned to"].map((h) => <div key={h} style={{ padding: "7px 8px" }}>{h}</div>)}
                </div>
                {slots.map((sl, i) => {
                  const o = SLOT_OWNERS[sl.owner];
                  const setSlot = (patch) => setPath("phExtensions.slots", slots.map((q, k) => (k === i ? { ...q, ...patch } : q)));
                  const pid = sl.partnerId || ANY_PARTNER;
                  const p = pid === ANY_PARTNER ? null : partnerById(partners, pid);
                  const seats = p ? (p.seats || []) : [];
                  const eff = effectiveLists(p, companyLists);
                  const allowN = eff.allowList.length;
                  const blockN = eff.blockList.length;
                  /* The blacklist subtracts everywhere, so a blocked seat is not
                     offered — picking it could only produce a dead position. */
                  const sellableSeats = seats.filter((x) => !isBlocked(x.name, eff));
                  const namedButBlocked =
                    sl.owner === "advertiser" && sl.advertiser && sl.advertiser !== RTB &&
                    sl.advertiser !== ALLOW_LIST && sl.advertiser !== BLOCK_LIST &&
                    isBlocked(sl.advertiser, eff);
                  const broken = sl.owner === "advertiser" && p && p.status !== "connected";
                  return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: SLOT_GRID, alignItems: "center", borderBottom: i < slots.length - 1 ? `1px solid ${T.borderSubtle}` : "none" }}>
                      <div style={{ padding: "6px 8px", color: T.micro, fontSize: 12 }}>{i + 1}</div>
                      <div style={{ padding: "5px 8px" }}>
                        <input value={sl.label} onChange={(e) => setSlot({ label: e.target.value })} style={{ ...inputStyle, height: 26, fontSize: 12.5 }} />
                      </div>
                      <div style={{ padding: "5px 8px" }}>
                        <select value={sl.owner} onChange={(e) => setSlot({
                          owner: e.target.value,
                          partnerId: e.target.value === "advertiser" ? ANY_PARTNER : null,
                          advertiser: e.target.value === "advertiser" ? RTB : null,
                          storeScope: e.target.value === "retail" ? "Store staff" : null,
                        })} style={{ ...inputStyle, height: 26, fontSize: 12, color: o.color }}>
                          {Object.entries(SLOT_OWNERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      </div>

                      {/* Advertiser positions carry two things: which DSP the demand
                          arrives through, and whether it is reserved or left to clear. */}
                      <div style={{ padding: "5px 8px" }}>
                        {sl.owner === "advertiser" ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <select value={pid} onChange={(e) => {
                              const np = e.target.value;
                              const next = partnerById(partners, np);
                              /* A seat, and a list mode, belong to one partner — switching
                                 partner drops anything the new one cannot honour. */
                              const nextEff = effectiveLists(next, companyLists);
                              const keep =
                                (sl.advertiser === ALLOW_LIST && nextEff.allowList.length > 0) ||
                                (next && (next.seats || []).some((x) => x.name === sl.advertiser) &&
                                 !isBlocked(sl.advertiser, nextEff));
                              setSlot({ partnerId: np, advertiser: keep ? sl.advertiser : RTB });
                            }} title="Partner / DSP the demand for this position comes through"
                              style={{ ...inputStyle, height: 26, fontSize: 12, color: broken ? T.error : (p && !p.system ? partnerColour(p) : "#7c3aed") }}>
                              <option value={ANY_PARTNER}>Any connected DSP</option>
                              {(partners || []).map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}{x.status !== "connected" ? " (not connected)" : ""}
                                </option>
                              ))}
                            </select>
                            <select value={sl.advertiser || RTB} onChange={(e) => setSlot({ advertiser: e.target.value })}
                              disabled={pid === ANY_PARTNER}
                              title={pid === ANY_PARTNER ? "Name a partner first to reserve the position to one of its advertisers." : "Who this position may sell to"}
                              style={{ ...inputStyle, height: 26, fontSize: 12, background: pid === ANY_PARTNER ? T.surfaceAlt : "#fff",
                                       color: !sl.advertiser || sl.advertiser === RTB ? "#7c3aed" : T.text }}>
                              <option value={RTB}>
                                {blockN ? `RTB bidding \u2014 any except ${blockN} blocked` : "RTB bidding (open)"}
                              </option>
                              {isDsp(p) && <option value={ALLOW_LIST} disabled={allowN === 0}>
                                {allowN ? `Whitelist only (${allowN})` : "Whitelist only \u2014 list empty"}
                              </option>}
                              {sellableSeats.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                              {/* A named advertiser that has since been blocked stays selectable
                                  only so the position does not silently change under the user. */}
                              {namedButBlocked && <option value={sl.advertiser}>{sl.advertiser} — blocked</option>}
                            </select>
                            {namedButBlocked && (
                              <div style={{ fontSize: 10.5, color: T.error, display: "flex", alignItems: "flex-start", gap: 3 }}>
                                <Icon name="block" size={11} style={{ marginTop: 1 }} />
                                On the blacklist — this position cannot fill.
                              </div>
                            )}
                            {broken && <div style={{ fontSize: 10.5, color: T.error, display: "flex", alignItems: "center", gap: 3 }}>
                              <Icon name="error" size={11} />Not connected
                            </div>}
                          </div>
                        ) : sl.owner === "retail" ? (
                          <select value={sl.storeScope || "Store staff"} onChange={(e) => setSlot({ storeScope: e.target.value })}
                            style={{ ...inputStyle, height: 26, fontSize: 12 }}>
                            {STORE_SCOPES.map((x) => <option key={x}>{x}</option>)}
                          </select>
                        ) : (
                          <span style={{ fontSize: 11.5, color: T.micro }}>Based on priority</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
                <span><b style={{ color: T.primary }}>Headquarters</b> — filled from the eligible HQ campaigns by campaign priority. No fixed assignment.</span>
                <span><b style={{ color: "#7c3aed" }}>Advertiser</b> — demand reaches the position through a partner DSP. Open to RTB bidding by default, so it clears at auction. Name one of that partner's advertisers to reserve it instead.</span>
                <span><b style={{ color: T.warning }}>Stores</b> — delegated to store level. Store staff activate approved campaigns into the position.</span>
              </div>
              <Note>
                A capped rotation is what makes a position sellable or delegable. Slot ownership stamps the
                advertiser onto every render event, which is how retail media data is partitioned — it cannot
                be backfilled later. An RTB slot stamps the winning bidder at render time, so the partner is
                known at write time but the advertiser is not.
              </Note>
              {advertiserSlots.length > 0 && brokenSlots.length > 0 && (
                <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, border: `1px solid ${T.error}`, background: "rgba(255,77,79,0.06)", fontSize: 12, color: T.text, display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="error" size={16} style={{ color: T.error }} />
                  <span style={{ flex: 1 }}>
                    {brokenSlots.length} advertiser {brokenSlots.length === 1 ? "position is" : "positions are"} assigned to a
                    partner that is not connected. {brokenSlots.length === 1 ? "It" : "They"} will fall back to the next eligible
                    Headquarters campaign until the connection is fixed.
                  </span>
                  <Btn variant="outline" style={{ height: 26, fontSize: 12 }} onClick={goToPartners}>Fix connection</Btn>
                </div>
              )}
            </div>
          )}

          {caps(d).rotation ? (
            <Row>
              <Col><Label>Campaign Auto-Rotation</Label><DefaultSelect value={ps.campaignAutoRotation} onChange={(v) => setPath("playlistSettings.campaignAutoRotation", v)} fallback={DEFAULTS.campaignAutoRotation} options={["Auto-Rotate On", "Auto-Rotate Off"]} /></Col>
              <Col><Label>Campaign Auto-Play</Label><DefaultSelect value={ps.campaignAutoPlay} onChange={(v) => setPath("playlistSettings.campaignAutoPlay", v)} fallback={DEFAULTS.campaignAutoPlay} options={["Auto-Play On", "Auto-Play Off"]} /></Col>
            </Row>
          ) : (
            <Note>
              {caps(d).grid
                ? "All campaigns render together in this element, so rotation and transition do not apply. Slot count sets how many cells are rendered."
                : "This element renders no campaigns, so playback settings do not apply."}
            </Note>
          )}
        </Panel>
        )}

        {/* ---- PHANTOM ZONE (before enabled features) ---- */}
        {!isWebTP(d.touchPoint) && (
        <Panel title="PHANTOM ZONE" open={open.phantom} onToggle={() => toggle("phantom")}
          badge={d.qrControl.phantomArea.enabled ? <Pill color={T.success} bg="rgba(82,196,26,0.12)">defined</Pill> : <Pill color={T.muted} bg="rgba(0,0,0,0.04)">not defined</Pill>}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontSize: 13.5 }}>Define phantom zone</span>
            <Toggle on={d.qrControl.phantomArea.enabled} onChange={(v) => update((t) => ({ ...t, qrControl: { ...t.qrControl, enabled: v ? t.qrControl.enabled : false, phantomArea: { ...t.qrControl.phantomArea, enabled: v } } }))} />
          </div>
          {d.qrControl.phantomArea.enabled ? (
            <>
              <Row>
                <Col><Label info>Phantom Area(s) Size</Label>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: T.muted, fontSize: 13 }}>W</span>
                    <input type="number" value={d.qrControl.phantomArea.width} onChange={(e) => setPath("qrControl.phantomArea.width", Number(e.target.value))} style={{ ...inputStyle, width: 62 }} />
                    <span style={{ color: T.muted, fontSize: 13 }}>H</span>
                    <input type="number" value={d.qrControl.phantomArea.height} onChange={(e) => setPath("qrControl.phantomArea.height", Number(e.target.value))} style={{ ...inputStyle, width: 62 }} />
                  </div></Col>
                <Col><Label>Phantom Area(s) Position</Label>
                  <DefaultSelect value={d.qrControl.phantomArea.position} onChange={(v) => setPath("qrControl.phantomArea.position", v)} fallback={PHANTOM_DEFAULT_POSITION} options={["Top Left", "Top Right", "Bottom Left", "Bottom Right", "Center"]} /></Col>
              </Row>
              <Row>
                <Col><Label>Phantom Area(s) Sizing Mode</Label>
                  <select value={d.qrControl.phantomArea.sizingMode} onChange={(e) => setPath("qrControl.phantomArea.sizingMode", e.target.value)} style={inputStyle}>
                    {["Fit to Display", "Fixed", "Scale to Content"].map((o) => <option key={o}>{o}</option>)}
                  </select></Col>
                <Col />
              </Row>
              <Note>
                The phantom zone sits outside campaign rotation, so anything placed in it survives every
                campaign transition. Defining it here is what makes <b>Enable QR Control</b> available below.
              </Note>
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.5 }}>
              No phantom zone on this display type. QR Control cannot be enabled without one.
            </div>
          )}
        </Panel>
        )}

        {!isWebTP(d.touchPoint) && (
        <Panel title="ENABLED FEATURES" open={open.features} onToggle={() => toggle("features")}>
          <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 14, lineHeight: 1.5 }}>
            Defaults inherited by every device assigned to this display type, including each feature's own
            settings. A display can override any of them on its Enabled Features tab.
          </div>
          {FEATURES.filter((f) => (FEATURE_TOUCH_POINTS[f.key] || ALL_TP).includes(d.touchPoint)).map((f) => {
            const av = COMPANY_AVAILABILITY[f.key];
            const cfg = featCfg(d, f.key);
            const setCfg = (patch) => update((t) => withFeat(t, f.key, patch));
            return (
              <div key={f.key} style={{ padding: "11px 0", borderBottom: `1px solid ${T.borderSubtle}`, opacity: av ? 1 : 0.45 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon name={f.icon} size={18} style={{ color: av ? T.text : T.micro }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{f.label}</span>
                  <Toggle on={!!cfg.on} disabled={!av} onChange={(v) => setCfg({ on: v })} />
                </div>
                <div style={{ fontSize: 11.5, color: T.muted, marginTop: 5, marginLeft: 28, lineHeight: 1.45 }}>
                  {av ? f.hint : "Not enabled for this company — contact Platform Admin."}
                </div>
                {av && cfg.on && f.key === "qr_control" && (
                  <SubSettings>
                    <Grid cols={2}>
                      <Fld label="QR size (px)"><input type="number" value={cfg.size ?? 100} onChange={(e) => setCfg({ size: Number(e.target.value) })} style={ctl} /></Fld>
                      <Fld label="QR colour"><input type="color" value={cfg.colour || "#000000"} onChange={(e) => setCfg({ colour: e.target.value })} style={swatch} /></Fld>
                      <Fld label="Connected icon colour"><input type="color" value={cfg.connectedColour || "#169bc2"} onChange={(e) => setCfg({ connectedColour: e.target.value })} style={swatch} /></Fld>
                      <Fld label="Mobile site template">
                        <select value={cfg.mobileTemplate || MOBILE_TEMPLATES[0]} onChange={(e) => setCfg({ mobileTemplate: e.target.value })} style={ctl}>
                          {MOBILE_TEMPLATES.map((m) => <option key={m}>{m}</option>)}
                        </select>
                      </Fld>
                    </Grid>
                  </SubSettings>
                )}
                {av && cfg.on && f.key === "proximity_mist" && (
                  <SubSettings>
                    <Grid cols={2}>
                      <Fld label="Mode">
                        <select value={cfg.mode || "zone"} onChange={(e) => setCfg({ mode: e.target.value })} style={ctl}>
                          <option value="zone">Zone</option><option value="vbeacon">vBeacon</option>
                        </select>
                      </Fld>
                      <Fld label="Zone">
                        <select value={cfg.zone || MIST_ZONES[0]} onChange={(e) => setCfg({ zone: e.target.value })} style={ctl}>
                          {MIST_ZONES.map((z) => <option key={z}>{z}</option>)}
                        </select>
                      </Fld>
                    </Grid>
                  </SubSettings>
                )}
                {av && cfg.on && f.key === "vision_ai" && (
                  <SubSettings>
                    <Grid cols={2}>
                      <Fld label="Mode">
                        <select value={cfg.visionMode || VISION_MODES[0]} onChange={(e) => setCfg({ visionMode: e.target.value })} style={ctl}>
                          {VISION_MODES.map((v) => <option key={v}>{v}</option>)}
                        </select>
                      </Fld>
                      <Fld label="Detection preset">
                        <select value={cfg.preset || "Balanced"} onChange={(e) => setCfg({ preset: e.target.value, ...(DETECTION_PRESETS[e.target.value] || {}) })} style={ctl}>
                          {Object.keys(DETECTION_PRESETS).map((k) => <option key={k}>{k}</option>)}
                        </select>
                      </Fld>
                    </Grid>
                    <Note>{(DETECTION_PRESETS[cfg.preset || "Balanced"] || {}).blurb}</Note>
                  </SubSettings>
                )}
              </div>
            );
          })}
        </Panel>
        )}

        {/* ---- MULTI-ZONE LAYOUT ---- */}
        {!isWebTP(d.touchPoint) && (
        <Panel title="MULTI-ZONE LAYOUT" open={open.zones} onToggle={() => toggle("zones")}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontSize: 13.5 }}>Enable zones</span>
            <Toggle on={d.multiZone.enabled} onChange={(v) => set({ multiZone: { enabled: v, zones: v && zones.length === 0 ? [{ id: "z1", name: "Zone 1", x: 0, y: 0, width: 50, height: 100, playlistId: ensureZonePlaylist(1), trustZone: "agent_addressable" }, { id: "z2", name: "Zone 2", x: 50, y: 0, width: 50, height: 100, playlistId: ensureZonePlaylist(2), trustZone: "agent_addressable" }] : zones } })} />
          </div>
          {!d.multiZone.enabled ? (
            <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.5 }}>Single zone — the display runs the Default Playlist across the full canvas.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: T.muted, alignSelf: "center", marginRight: 4 }}>Quick split:</span>
                {[2, 3, 4, 6].map((n) => (
                  <Btn key={n} style={{ height: 26, fontSize: 12, padding: "0 10px" }}
                    onClick={() => setZones(Array.from({ length: n }, (_, i) => ({ id: `z${i + 1}`, name: `Zone ${i + 1}`, x: +(i * (100 / n)).toFixed(1), y: 0, width: +(100 / n).toFixed(1), height: 100, playlistId: ensureZonePlaylist(i + 1), trustZone: zones[i]?.trustZone || "agent_addressable" })))}>
                    {n}
                  </Btn>
                ))}
              </div>
              {zones.map((z, i) => (
                <div key={z.id} style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: ZONE_COLOURS[i % 6] }} />
                    <input value={z.name} onChange={(e) => setZones(zones.map((q, k) => (k === i ? { ...q, name: e.target.value } : q)))}
                      style={{ ...inputStyle, height: 28, fontSize: 13, flex: 1 }} />
                    {zones.length > 1 && <Icon name="close" size={16} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setZones(zones.filter((_, k) => k !== i))} />}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {[["x", "X %"], ["y", "Y %"]].map(([k, l]) => (
                      <div key={k} style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: T.muted, marginBottom: 2 }}>{l}</div>
                        <input type="number" value={z[k]} onChange={(e) => setZones(zones.map((q, j) => (j === i ? { ...q, [k]: Number(e.target.value) } : q)))}
                          style={{ ...inputStyle, height: 28, fontSize: 12.5 }} />
                      </div>
                    ))}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: T.muted, marginBottom: 2 }}>Width px</div>
                      <input type="number" value={Math.round((z.width / 100) * W_OF(d))}
                        onChange={(e) => setZones(zones.map((q, j) => (j === i ? { ...q, width: (Number(e.target.value) / W_OF(d)) * 100 } : q)))}
                        style={{ ...inputStyle, height: 28, fontSize: 12.5 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: T.muted, marginBottom: 2 }}>Height px</div>
                      <input type="number" value={Math.round((z.height / 100) * H_OF(d))}
                        onChange={(e) => setZones(zones.map((q, j) => (j === i ? { ...q, height: (Number(e.target.value) / H_OF(d)) * 100 } : q)))}
                        style={{ ...inputStyle, height: 28, fontSize: 12.5 }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: T.muted, marginBottom: 3 }}>Playlist</div>
                  <select value={z.playlistId} onChange={(e) => setZones(zones.map((q, k) => (k === i ? { ...q, playlistId: e.target.value } : q)))}
                    style={{ ...inputStyle, height: 28, fontSize: 12.5 }}>
                    {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              ))}
              <Btn variant="outline" style={{ height: 28, fontSize: 12.5 }}
                onClick={() => setZones([...zones, { id: `z${Date.now()}`, name: `Zone ${zones.length + 1}`, x: 0, y: 0, width: 25, height: 100, playlistId: ensureZonePlaylist(zones.length + 1), trustZone: "agent_addressable" }])}>
                <Icon name="add" size={15} />Add zone
              </Btn>
              <Note>Each zone runs its own playlist, so each has its own rotation. Whether a zone is locked or
                agent-controllable is <b>not</b> set here — the campaign running in it determines that.</Note>
            </>
          )}
        </Panel>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <Btn variant="primary">Save Changes</Btn><Btn>Cancel</Btn>
        </div>
      </div>

      {fitsThreeColumns && (
        <div style={{ flex: 1, minWidth: 320 }}>
          {previewColumn}
        </div>
      )}
    </div>
  );
}

/* -------------------------- display preview ------------------------------ */

const WIDE_THRESHOLD = 3;

/* Web elements preview as a rendered element inside a browser frame, with a
   breakpoint switch — an element has no fixed canvas, so a resolution-scaled
   signage preview would be meaningless. */
function WebPreview({ d, plName, setPath, partners, companyLists }) {
  const [bp, setBp] = useState("desktop");
  const [paired, setPaired] = useState(false);
  const [device, setDevice] = useState("phone");
  const el = webEl(d.element?.type);
  const c = caps(d);
  const B0 = BREAKPOINTS.find((x) => x.key === bp);
  const bpCfg = d.element.breakpoints[bp];
  const setB = (k, v) => setPath(`element.breakpoints.${bp}.${k}`, v);
  const vw = bpCfg.viewportWidth ?? B0.defW;
  const frameW = Math.max(140, Math.round(280 * (vw / 1200)));
  const cols = c.grid ? bpCfg.columns : 1;
  const total = isCapped(d) ? slotCount(d) : (c.grid ? 6 : 3);
  const shownAt = bpCfg.items ?? total;
  const shown = Math.min(total, shownAt || total);
  const aspectPad = { "16:9": 56, "4:3": 75, "1:1": 100, "3:4": 133, auto: 70 }[d.element.itemAspect] || 75;
  const inset = d.element.widthMode === "contained" ? 10 : 0;
  const qrCfg = featCfg(d, "qr_control");
  const gap = d.element.gap;
  const slotsArr = d.phExtensions.slots || [];

  const Cell = ({ i, h }) => {
    const sl = slotsArr[i];
    const o = sl ? SLOT_OWNERS[sl.owner] : null;
    return (
      <div style={{ flex: 1, minWidth: 0, height: h, borderRadius: 3, background: o ? o.bg : "rgba(22,155,194,0.12)",
        border: `1px solid ${o ? o.color : T.primaryAccent}`, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 2, overflow: "hidden", padding: 2, boxSizing: "border-box" }}>
        <Icon name={el.icon} size={13} style={{ color: o ? o.color : T.primary }} />
        {h > 34 && <div style={{ fontSize: 8, color: o ? o.color : T.primary, textAlign: "center", lineHeight: 1.2 }}>
          {sl ? ownerAssignment(sl, partners, companyLists) : `Campaign ${i + 1}`}
        </div>}
      </div>
    );
  };

  const body = () => {
    if (el.key === "order") return (
      <div style={{ border: `1px solid ${T.error}`, background: "rgba(255,77,79,0.06)", borderRadius: 3, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: T.error }}><Icon name="lock" size={11} />PH-authored — locked</div>
        <div style={{ height: 8, width: "45%", background: "rgba(0,0,0,0.25)", borderRadius: 2 }} />
        <div style={{ height: 5, width: "80%", background: "rgba(0,0,0,0.12)", borderRadius: 2 }} />
        <div style={{ height: 5, width: "65%", background: "rgba(0,0,0,0.12)", borderRadius: 2 }} />
      </div>
    );
    if (el.key === "split_hero") return (
      <div style={{ display: "flex", gap: 6 }}>
        <Cell i={0} h={90} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, justifyContent: "center" }}>
          <div style={{ height: 8, background: "rgba(0,0,0,0.2)", borderRadius: 2 }} />
          <div style={{ height: 5, background: "rgba(0,0,0,0.1)", borderRadius: 2 }} />
          <div style={{ height: 16, width: "55%", background: T.primary, borderRadius: 3 }} />
        </div>
      </div>
    );
    if (el.key === "content") return (
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {[70, 100, 92, 60].map((w, i) => <div key={i} style={{ height: i === 0 ? 9 : 5, width: `${w}%`, background: `rgba(0,0,0,${i === 0 ? 0.22 : 0.1})`, borderRadius: 2 }} />)}
      </div>
    );
    if (el.key === "order_panel" || el.key === "configurator" || el.key === "self_service") return (
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${T.borderSubtle}`, borderRadius: 3, padding: "5px 7px" }}>
            <Icon name={el.icon} size={12} style={{ color: T.primary }} />
            <div style={{ flex: 1, height: 5, background: "rgba(0,0,0,0.1)", borderRadius: 2 }} />
            <div style={{ width: 22, height: 12, background: T.primaryTint, borderRadius: 2 }} />
          </div>
        ))}
      </div>
    );
    if (c.grid) {
      const rows = Math.ceil(shown / cols);
      const cellH = Math.max(26, Math.round(((frameW - (cols - 1) * ((gap || 0) / 3)) / cols) * (aspectPad / 100)));
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: gap / 3 }}>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} style={{ display: "flex", gap: gap / 3 }}>
              {Array.from({ length: cols }, (_, k) => {
                const i = r * cols + k;
                return i < shown ? <Cell key={k} i={i} h={cellH} /> : <div key={k} style={{ flex: 1 }} />;
              })}
            </div>
          ))}
        </div>
      );
    }
    // sequential (carousel with optional peek) or single
    const inView = c.carousel ? (bpCfg.columns || 1) : 1;
    const peek = c.carousel ? (bpCfg.peek ?? 0) : 0;
    const gapPx = (gap || 0) / 3;
    // each full item's share of the track, allowing for the two peek slivers
    const unit = 100 / (inView + (peek / 100) * 2);
    const itemH = Math.max(30, Math.round(((frameW * unit) / 100) * (aspectPad / 100)));
    return (
      <div>
        <div style={{ display: "flex", gap: gapPx, overflow: "hidden" }}>
          {peek > 0 && (
            <div style={{ width: `${unit * (peek / 100)}%`, flexShrink: 0, height: itemH, borderRadius: 3,
              background: "rgba(22,155,194,0.07)", border: `1px solid ${T.borderSubtle}`, borderRight: "none",
              borderTopRightRadius: 0, borderBottomRightRadius: 0 }} />
          )}
          {Array.from({ length: inView }, (_, k) => (
            <div key={k} style={{ width: `${unit}%`, flexShrink: 0 }}>
              <Cell i={k} h={itemH} />
            </div>
          ))}
          {peek > 0 && (
            <div style={{ width: `${unit * (peek / 100)}%`, flexShrink: 0, height: itemH, borderRadius: 3,
              background: "rgba(22,155,194,0.07)", border: `1px solid ${T.borderSubtle}`, borderLeft: "none",
              borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }} />
          )}
        </div>
        {c.rotation && shown > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 6 }}>
            <Icon name="chevron_left" size={14} style={{ color: T.muted }} />
            <div style={{ display: "flex", gap: 4 }}>
              {Array.from({ length: Math.max(1, Math.ceil(total / inView)) }, (_, k) => (
                <span key={k} style={{ width: 5, height: 5, borderRadius: 9999, background: k === 0 ? T.primary : "transparent", border: `1px solid ${k === 0 ? T.primary : T.border}` }} />
              ))}
            </div>
            <Icon name="chevron_right" size={14} style={{ color: T.muted }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px" }}>Element Preview</div>
        <div style={{ display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
          {[["desktop", "desktop_windows"], ["tablet", "tablet_mac"], ["mobile", "smartphone"]].map(([k, ic], i) => (
            <div key={k} onClick={() => setBp(k)} title={k}
              style={{ padding: "4px 9px", cursor: "pointer", background: bp === k ? T.primary : "#fff", color: bp === k ? "#fff" : T.muted, borderRight: i < 2 ? `1px solid ${T.border}` : "none", display: "flex", alignItems: "center" }}>
              <Icon name={ic} size={15} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ width: frameW, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden", background: "#fff", transition: "width .15s" }}>
        <div style={{ height: 18, background: T.surfaceAlt, borderBottom: `1px solid ${T.borderSubtle}`, display: "flex", alignItems: "center", gap: 3, padding: "0 7px" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c2) => <span key={c2} style={{ width: 6, height: 6, borderRadius: 9999, background: c2 }} />)}
        </div>
        <div style={{ position: "relative", padding: `10px ${inset + 8}px`, background: d.backgroundColor === "#000000" || d.backgroundColor === "#333333" ? "#fff" : d.backgroundColor }}>
          {body()}
          {qrCfg.on && (() => {
            const scale = Math.max(0.5, frameW / 300);
            const box = Math.round((qrCfg.size / 3) * scale);
            const ox = Math.round(qrCfg.offsetX / 4), oy = Math.round(qrCfg.offsetY / 4);
            const anchor = {
              "Top Left": { left: ox, top: oy }, "Top Right": { right: ox, top: oy },
              "Bottom Left": { left: ox, bottom: oy }, "Bottom Right": { right: ox, bottom: oy },
              "Center": { left: "50%", top: "50%", transform: "translate(-50%,-50%)" },
            }[qrCfg.overlayPosition || "Bottom Right"];
            const dev = PAIRED_DEVICES.find((x) => x.key === device) || PAIRED_DEVICES[0];
            return (
              <div style={{ position: "absolute", ...anchor, zIndex: 5, width: box, height: box,
                background: "#fff", borderRadius: 6, boxShadow: "0 3px 12px rgba(0,0,0,0.28)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                border: `1px solid ${paired ? qrCfg.connectedColour : "rgba(0,0,0,0.08)"}`, transition: "all .18s" }}>
                {paired ? (
                  <img src={CONNECTED_ASSET} alt="Connected" style={{ width: "84%", display: "block" }} />
                ) : (
                  <Icon name="qr_code_2" size={Math.round(box * 0.74)} style={{ color: qrCfg.colour }} />
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {(qrCfg.on || el.key === "qr_control") && (
        <div style={{ marginTop: 10, border: `1px solid ${T.borderSubtle}`, borderRadius: 6, padding: 10, maxWidth: 300 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: paired ? 8 : 0 }}>
            <span style={{ fontSize: 12 }}>{paired ? "Session paired" : "Idle — awaiting scan"}</span>
            <div style={{ display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
              {[["Idle", false], ["Connected", true]].map(([l, v], i) => (
                <div key={l} onClick={() => setPaired(v)}
                  style={{ padding: "4px 9px", fontSize: 11.5, cursor: "pointer", background: paired === v ? T.primary : "#fff", color: paired === v ? "#fff" : T.muted, borderRight: i === 0 ? `1px solid ${T.border}` : "none" }}>{l}</div>
              ))}
            </div>
          </div>
          {paired && (
            <>
              <div style={{ display: "flex", gap: 5 }}>
                {PAIRED_DEVICES.map((x) => (
                  <div key={x.key} onClick={() => setDevice(x.key)}
                    style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 3px", borderRadius: 5, cursor: "pointer", fontSize: 10, textAlign: "center",
                      border: `1px solid ${device === x.key ? T.primary : T.border}`, background: device === x.key ? T.primaryTint : "#fff", color: device === x.key ? T.primary : T.muted }}>
                    <Icon name={x.icon} size={16} />{x.label}
                  </div>
                ))}
              </div>
              <Note>
                Live WebSocket open. The customer drives this surface by voice or on-device interface;
                updates stream back without the page reloading.
              </Note>
            </>
          )}
        </div>
      )}

      {setPath && (() => {
        const B = B0;
        return (
          <div style={{ marginTop: 12, border: `1px solid ${T.borderSubtle}`, borderRadius: 8, padding: 12, maxWidth: 300 }}>
            <div style={{ fontSize: 12, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name={B.icon} size={15} style={{ color: T.primary }} />
              <b>{B.label}</b><span style={{ color: T.muted }}>settings</span>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 4 }}>Element size at {B.label.toLowerCase()} (px)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11.5, color: T.muted }}>W</span>
                <input type="number" value={bpCfg.viewportWidth ?? B.defW} onChange={(e) => setB("viewportWidth", Number(e.target.value))}
                  style={{ ...inputStyle, height: 28, fontSize: 12.5 }} />
                <span style={{ fontSize: 11.5, color: T.muted }}>H</span>
                <input type="number" value={bpCfg.height ?? B.defH} onChange={(e) => setB("height", Number(e.target.value))}
                  style={{ ...inputStyle, height: 28, fontSize: 12.5 }} />
              </div>
              <div style={{ fontSize: 11, color: T.micro, marginTop: 4, lineHeight: 1.4 }}>
                Exact pixel dimensions — used to generate campaign creative for this element.
              </div>
            </div>
            {c.carousel && (
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 4 }}>Items in view</div>
                  <select value={bpCfg.columns} onChange={(e) => setB("columns", Number(e.target.value))} style={{ ...inputStyle, height: 28, fontSize: 12.5 }}>
                    {[1,2,3,4].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 4 }}>Peek %</div>
                  <select value={bpCfg.peek ?? 0} onChange={(e) => setB("peek", Number(e.target.value))} style={{ ...inputStyle, height: 28, fontSize: 12.5 }}>
                    {[0,5,10,12,15,20,25,30,40,50].map((n) => <option key={n} value={n}>{n}%</option>)}
                  </select>
                </div>
              </div>
            )}
            {c.grid && (
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 4 }}>Columns</div>
                  <select value={bpCfg.columns} onChange={(e) => setB("columns", Number(e.target.value))} style={{ ...inputStyle, height: 28, fontSize: 12.5 }}>
                    {[1,2,3,4,5,6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 4 }}>Items shown</div>
                  <select value={bpCfg.items} onChange={(e) => setB("items", Number(e.target.value))} style={{ ...inputStyle, height: 28, fontSize: 12.5 }}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 4 }}>Width</div>
                <select value={d.element.widthMode} onChange={(e) => setPath("element.widthMode", e.target.value)} style={{ ...inputStyle, height: 28, fontSize: 12.5 }}>
                  <option value="contained">Contained</option><option value="full">Full bleed</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 4 }}>Aspect</div>
                <select value={d.element.itemAspect} onChange={(e) => setPath("element.itemAspect", e.target.value)} style={{ ...inputStyle, height: 28, fontSize: 12.5 }}>
                  {["16:9","4:3","1:1","3:4","auto"].map((a) => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div style={{ width: 66 }}>
                <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 4 }}>Gap</div>
                <input type="number" value={gap} onChange={(e) => setPath("element.gap", Number(e.target.value))} style={{ ...inputStyle, height: 28, fontSize: 12.5 }} />
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{ marginTop: 10, fontSize: 11.5, color: T.muted, lineHeight: 1.5, maxWidth: 300 }}>
        <b>{el.name}</b> · {d.element.widthMode === "full" ? "full bleed" : `contained ${d.element.maxWidth}px`}
        {c.grid && ` · ${cols} col${cols > 1 ? "s" : ""} at ${bp}`}
        <div style={{ marginTop: 4, color: T.primary }}>
          {c.campaigns
            ? (c.grid ? `${shown} of ${total} item${total > 1 ? "s" : ""} rendered at ${bp}` : "1 item rendered")
            : "Renders no campaigns"}
        </div>
      </div>
    </div>
  );
}

function Preview({ d, plName, setPath, partners, companyLists }) {
  const [sigPaired, setSigPaired] = useState(false);
  if (isWebTP(d.touchPoint)) return <WebPreview d={d} plName={plName} setPath={setPath} partners={partners} companyLists={companyLists} />;
  const W = W_OF(d), H = H_OF(d);
  const aspect = W / H;
  const boxW = 300;   // ~25-30% of the working area
  const boxH = 320;   // cap so tall/portrait canvases stay fully visible

  // Fit inside the box on whichever axis constrains, so the whole layout is
  // visible without scrolling regardless of orientation.
  const fitW = Math.min(boxW, Math.round(boxH * aspect));
  const fitH = Math.round(fitW / aspect);
  const height = Math.max(60, fitH);
  const width = fitW;
  const pos = d.qrControl.phantomArea.position || PHANTOM_DEFAULT_POSITION;
  const qr = featCfg(d, "qr_control");
  const phantomOn = d.qrControl.phantomArea.enabled;
  const showQR = phantomOn && qr.on;
  const pw = (d.qrControl.phantomArea.width / W) * 100, ph = (d.qrControl.phantomArea.height / H) * 100;
  const place = { "Bottom Right": { right: "1.5%", bottom: "4%" }, "Bottom Left": { left: "1.5%", bottom: "4%" }, "Top Right": { right: "1.5%", top: "4%" }, "Top Left": { left: "1.5%", top: "4%" }, "Center": { left: `${50 - pw / 2}%`, top: `${50 - ph / 2}%` } }[pos];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px" }}>Display Preview</div>
      </div>

      {showQR && (
        <div style={{ display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
          {[["Idle", false], ["Connected", true]].map(([l, v], i) => (
            <div key={l} onClick={() => setSigPaired(v)}
              style={{ padding: "5px 12px", fontSize: 12, cursor: "pointer", background: sigPaired === v ? T.primary : "#fff", color: sigPaired === v ? "#fff" : T.muted, borderRight: i === 0 ? `1px solid ${T.border}` : "none" }}>{l}</div>
          ))}
        </div>
      )}
      <div style={{ maxWidth: boxW }}>
        <div style={{ width, height, background: d.backgroundColor, borderRadius: 6, position: "relative", overflow: "hidden", border: `1px solid ${T.border}`, boxSizing: "border-box", flexShrink: 0 }}>
          {d.multiZone.enabled ? d.multiZone.zones.map((z, i) => (
            <div key={z.id} style={{ position: "absolute", left: `${z.x}%`, top: `${z.y}%`, width: `${z.width}%`, height: `${z.height}%`, border: `2px dashed ${ZONE_COLOURS[i % 6]}`, background: `${ZONE_COLOURS[i % 6]}1a`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 3, boxSizing: "border-box", overflow: "hidden" }}>
            <div style={{ color: "#fff", fontSize: 10, fontWeight: 600, textAlign: "center" }}>{z.name}</div>
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 8.5, marginTop: 2, textAlign: "center", lineHeight: 1.3 }}>
              {Math.round((z.width / 100) * W)}×{Math.round((z.height / 100) * H)}px
            </div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 8, marginTop: 1, textAlign: "center", lineHeight: 1.25 }}>{plName(z.playlistId)}</div>
            </div>
          )) : (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 500 }}>{plName(d.defaultPlaylistId)}</div>
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 4 }}>single zone · full canvas</div>
            </div>
          )}

          {phantomOn && (
            <div style={{ position: "absolute", ...place, width: `${pw}%`, height: `${ph}%`, minWidth: 22, minHeight: 22, background: showQR ? "#fff" : "rgba(255,255,255,0.14)", border: showQR ? "none" : "1px dashed rgba(255,255,255,0.5)", borderRadius: 4, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: showQR ? "0 2px 8px rgba(0,0,0,0.35)" : "none" }}>
              {showQR ? (
                sigPaired ? (
                  <>
                    <Icon name="smartphone" size={Math.max(13, Math.min(28, (qr.size / W) * width * 1.2))} style={{ color: qr.connectedColour }} />
                    <div style={{ width: 5, height: 5, borderRadius: 9999, background: T.success, marginTop: 2 }} />
                  </>
                ) : (
                  <Icon name="qr_code_2" size={Math.max(14, Math.min(34, (qr.size / W) * width * 1.6))} style={{ color: qr.colour }} />
                )
              ) : (
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 9, textAlign: "center", lineHeight: 1.2 }}>phantom</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: T.muted, maxWidth: boxW, lineHeight: 1.6 }}>
        {W} × {H} · {d.multiZone.enabled ? `${d.multiZone.zones.length} zones` : "single zone"} ·{" "}
        {phantomOn ? (showQR ? "phantom zone with QR control" : "phantom zone defined, QR control off") : "no phantom zone"}
      </div>

      {/* No zone list here: the preview above already draws each zone, names
          it and colour-codes it, and the geometry and playlist per zone are
          edited in MULTI-ZONE LAYOUT. A third rendering was just noise. */}
    </div>
  );
}

/* --------------------------- playlist management -------------------------- */

function PlaylistManagement({ playlists, setPlaylists, types, goToType }) {
  const [sel, setSel] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newPl, setNewPl] = useState("");

  const usage = useMemo(() => Object.fromEntries(playlists.map((p) => [p.id, usageOf(p.id, types)])), [playlists, types]);
  const unusedCount = playlists.filter((p) => usage[p.id].length === 0).length;

  const rename = (id) => {
    if (!draftName.trim()) return;
    setPlaylists(playlists.map((p) => (p.id === id ? { ...p, name: draftName.trim() } : p)));
    setEditing(null);
  };
  const remove = (p) => {
    if (usage[p.id].length > 0) return;
    if (confirmDel !== p.id) { setConfirmDel(p.id); return; }
    setPlaylists(playlists.filter((x) => x.id !== p.id));
    setConfirmDel(null);
    if (sel === p.id) setSel(null);
  };
  const create = (n) => {
    if (!n || !n.trim()) return;
    setPlaylists([...playlists, mkPlaylist({ id: `pl_${Date.now()}`, name: n.trim() })]);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14 }}><b>{playlists.length}</b> Playlists · <b>{unusedCount}</b> unused</div>
        {creating ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input autoFocus value={newPl} onChange={(e) => setNewPl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { create(newPl); setNewPl(""); setCreating(false); } if (e.key === "Escape") setCreating(false); }}
              placeholder="Playlist name" style={{ ...inputStyle, height: 32, width: 200 }} />
            <Btn variant="primary" onClick={() => { create(newPl); setNewPl(""); setCreating(false); }}>Add</Btn>
            <Btn onClick={() => setCreating(false)}>Cancel</Btn>
          </div>
        ) : (
          <Btn variant="primary" onClick={() => setCreating(true)}><Icon name="add" size={16} />New playlist</Btn>
        )}
      </div>

      <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1.5fr 110px", background: T.surfaceAlt, borderBottom: `1px solid ${T.borderSubtle}`, fontSize: 13, fontWeight: 600 }}>
          {["Playlist", "Assigned to", ""].map((h, i) => <div key={i} style={{ padding: "8px 12px" }}>{h}</div>)}
        </div>
        {playlists.map((p) => {
          const u = usage[p.id];
          const inUse = u.length > 0;
          const isSel = sel === p.id;
          return (
            <div key={p.id} style={{ borderBottom: `1px solid ${T.borderSubtle}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1.5fr 110px", alignItems: "center", fontSize: 13, background: isSel ? T.primaryTint : "transparent" }}>
                <div style={{ padding: "10px 12px", minWidth: 0 }}>
                  {editing === p.id ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") rename(p.id); if (e.key === "Escape") setEditing(null); }}
                        style={{ ...inputStyle, height: 28, fontSize: 12.5 }} />
                      <Icon name="check" size={18} style={{ color: T.success, cursor: "pointer" }} onClick={() => rename(p.id)} />
                      <Icon name="close" size={18} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setEditing(null)} />
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        <Icon name="edit" size={14} style={{ color: T.micro, cursor: "pointer", flexShrink: 0 }} onClick={() => { setEditing(p.id); setDraftName(p.name); }} />
                      </div>
                      {p.autoCreatedFor && (
                        <div style={{ marginTop: 3 }}>
                          <Pill color={T.muted} bg="rgba(0,0,0,0.04)">auto-created with {types.find((t) => t.id === p.autoCreatedFor)?.name || p.autoCreatedFor}</Pill>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div style={{ padding: "10px 12px", minWidth: 0 }}>
                  {inUse ? (
                    <span onClick={() => setSel(isSel ? null : p.id)} style={{ cursor: "pointer", color: T.primary, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {u.length} assignment{u.length > 1 ? "s" : ""}<Icon name={isSel ? "expand_less" : "expand_more"} size={16} />
                    </span>
                  ) : <Pill color={T.muted} bg="rgba(0,0,0,0.04)">unused</Pill>}
                </div>
                <div style={{ padding: "6px 12px" }}>
                  <Btn variant="danger" disabled={inUse}
                    title={inUse ? "Assigned to a display type — reassign before deleting" : "Delete playlist"}
                    style={{ height: 28, padding: "0 10px", fontSize: 12.5 }} onClick={() => remove(p)}>
                    {confirmDel === p.id ? "Confirm" : <Icon name="delete" size={15} />}
                  </Btn>
                </div>
              </div>

              {isSel && inUse && (
                <div style={{ padding: "0 12px 12px 12px", background: T.primaryTint }}>
                  <div style={{ border: `1px solid ${T.primaryAccent}`, borderRadius: 6, background: "#fff", overflow: "hidden" }}>
                    <div style={{ padding: "8px 12px", fontSize: 12, color: T.muted, borderBottom: `1px solid ${T.borderSubtle}` }}>Currently assigned to</div>
                    {u.map((x, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: i < u.length - 1 ? `1px solid ${T.borderSubtle}` : "none", fontSize: 12.5, gap: 8 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <Icon name="dashboard_customize" size={15} style={{ color: T.muted }} />
                          <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.type.name}</b>
                          <span style={{ color: T.muted }}>·</span>
                          <span style={{ color: T.muted, whiteSpace: "nowrap" }}>{x.where}</span>
                        </span>
                        <Btn variant="text" style={{ height: 24, padding: "0 8px", fontSize: 12, flexShrink: 0 }} onClick={() => goToType(x.type.id)}>
                          Open<Icon name="arrow_forward" size={14} />
                        </Btn>
                      </div>
                    ))}
                    <div style={{ padding: "9px 12px", background: T.surfaceAlt, fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
                      Reassign every display type and zone above before this playlist can be deleted.
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
        A playlist is created automatically whenever a display type is created. Auto-created playlists can be
        renamed, reassigned and deleted once nothing references them.
      </div>
    </div>
  );
}

/* ------------------------------ layout composer --------------------------- */

/* ------------------------------ layout composer --------------------------- */

/* Consistent control sizing across every settings grid. */
const CTL_H = 32;
const Fld = ({ label, children, hint }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: 12, color: T.muted, marginBottom: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
    {children}
    {hint && <div style={{ fontSize: 11, color: T.micro, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
  </div>
);
const ctl = { height: CTL_H, padding: "4px 11px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: FONT, color: T.text, background: "#fff", outline: "none", width: "100%", boxSizing: "border-box" };
const swatch = { height: CTL_H, width: "100%", border: `1px solid ${T.border}`, borderRadius: 6, padding: 3, background: "#fff", boxSizing: "border-box", cursor: "pointer" };
const TokenField = ({ label, value, onChange, placeholder, hint }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5, gap: 8 }}>
      <span style={{ fontSize: 12, color: T.muted }}>{label}</span>
      <TokenMenu onPick={(tok) => onChange((value || "") + tok)} />
    </div>
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      style={{ ...ctl, fontFamily: MONO, fontSize: 12.5 }} />
    {hint && <div style={{ fontSize: 11, color: T.micro, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
  </div>
);

const TokenMenu = ({ onPick }) => {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span onClick={() => setOpen(!open)}
        style={{ fontSize: 12, color: T.primary, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}>
        <Icon name="add" size={14} />Add Token
      </span>
      {open && (
        <span style={{ position: "absolute", right: 0, top: 20, zIndex: 20, background: "#fff", border: `1px solid ${T.border}`,
          borderRadius: 6, boxShadow: "0 4px 14px rgba(0,0,0,0.12)", padding: 4, minWidth: 150, display: "block" }}>
          {SITE_TOKENS.map((tok) => (
            <span key={tok} onClick={() => { onPick(tok); setOpen(false); }}
              style={{ display: "block", padding: "6px 9px", fontSize: 11.5, fontFamily: MONO, color: T.text, cursor: "pointer", borderRadius: 4 }}>
              {tok}
            </span>
          ))}
        </span>
      )}
    </span>
  );
};

const Grid = ({ cols = 3, children, gap = 14 }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap, marginBottom: 14 }}>{children}</div>
);

function LayoutComposer({ types, templates, setTemplates, playlists }) {
  const [selId, setSel] = useState(templates[0].id);
  const [dragOver, setDragOver] = useState(null);
  const [bp, setBp] = useState("desktop");
  const [paired, setPaired] = useState(false);
  const [modSel, setModSel] = useState(null);     // selected mobile module
  const [ctaEdit, setCtaEdit] = useState(null);   // index | "new"
  const [creating, setCreating] = useState(false);
  const [newT, setNewT] = useState({ name: "", kind: "web_page" });

  const tpl = templates.find((t) => t.id === selId) || templates[0];
  const set = (patch) => setTemplates(templates.map((t) => (t.id === tpl.id ? { ...t, ...patch } : t)));
  const setPair = (patch) => set({ pairing: { ...(tpl.pairing || {}), ...patch } });
  const kind = TEMPLATE_KINDS.find((k) => k.key === tpl.kind) || TEMPLATE_KINDS[0];
  const isMobile = kind.frame === "phone";
  const palette = types.filter((t) => isWebTP(t.touchPoint) && t.element?.type !== "qr_control");
  const qrElements = types.filter((t) => t.element?.type === "qr_control");
  const typeOf = (id) => types.find((t) => t.id === id);

  /* Switching type must seed whatever structure the new type needs, or the
     canvas renders against undefined and throws. */
  const changeKind = (k) => {
    const toMobile = TEMPLATE_KINDS.find((x) => x.key === k).frame === "phone";
    const patch = { kind: k };
    if (toMobile) {
      if (!tpl.modules) patch.modules = [{ mid: `h${Date.now()}`, type: "header" }, { mid: `c${Date.now()}`, type: "carousel" }, { mid: `a${Date.now()}`, type: "ctas" }];
      if (!tpl.items) patch.items = [];
      if (tpl.header === undefined) patch.header = "${BrandName} ${StoreName}";
      if (tpl.qrScanner === undefined) patch.qrScanner = true;
      if (!tpl.carouselPlaylist) patch.carouselPlaylist = playlists[0]?.id;
    } else {
      if (!tpl.rows) patch.rows = [];
      if (tpl.maxWidth === undefined) patch.maxWidth = 1200;
      if (tpl.widthMode === undefined) patch.widthMode = "contained";
      if (!tpl.pairing) patch.pairing = { on: true, elementId: "web_qr", anchor: "Bottom Right", offsetX: 24, offsetY: 24, mobileTemplate: "Mobile App" };
    }
    setModSel(null); setCtaEdit(null);
    set(patch);
  };

  const addTemplate = () => {
    if (!newT.name.trim()) return;
    const id = `tpl_${Date.now()}`;
    const base = { id, name: newT.name.trim(), kind: newT.kind, background: "#ffffff",
      pairing: { on: newT.kind === "web_page", elementId: "web_qr", anchor: "Bottom Right", offsetX: 24, offsetY: 24, mobileTemplate: "Mobile App" } };
    const seeded = newT.kind === "web_page"
      ? { ...base, maxWidth: 1200, widthMode: "contained", rows: [] }
      : { ...base, header: "${BrandName} ${StoreName}", qrScanner: true, carouselPlaylist: playlists[0]?.id,
          modules: [{ mid: `h${Date.now()}`, type: "header" }, { mid: `c${Date.now()}`, type: "carousel" }, { mid: `a${Date.now()}`, type: "ctas" }],
          items: [] };
    setTemplates([...templates, seeded]);
    setSel(id); setCreating(false); setNewT({ name: "", kind: "web_page" });
  };

  /* ---- web drag & drop ---- */
  const dropAt = (i, e) => {
    e.preventDefault(); setDragOver(null);
    const payload = e.dataTransfer.getData("text/plain");
    if (!payload) return;
    if (payload.startsWith("new:")) {
      const rows = [...tpl.rows];
      rows.splice(i, 0, { rid: `r${Date.now()}`, typeId: payload.slice(4) });
      set({ rows });
    } else if (payload.startsWith("move:")) {
      const from = Number(payload.slice(5));
      if (from === i || from + 1 === i) return;
      const rows = [...tpl.rows];
      const [m] = rows.splice(from, 1);
      rows.splice(from < i ? i - 1 : i, 0, m);
      set({ rows });
    }
  };
  const DropZone = ({ i }) => (
    <div onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
      onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
      onDrop={(e) => dropAt(i, e)}
      style={{ height: dragOver === i ? 30 : 10, borderRadius: 4, transition: "height .12s",
        background: dragOver === i ? T.primaryTint : "transparent",
        border: dragOver === i ? `2px dashed ${T.primary}` : "2px dashed transparent",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: T.primary }}>
      {dragOver === i ? "Drop here" : ""}
    </div>
  );

  /* ---- mobile modules ---- */
  const moveMod = (i, d) => {
    const n = [...tpl.modules]; const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; set({ modules: n });
  };
  const addMod = (type) => set({ modules: [...tpl.modules, { mid: `m${Date.now()}`, type }] });

  const moveCta = (i, dnum) => {
    const n = [...(tpl.items || [])]; const j = i + dnum;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; set({ items: n });
  };
  const saveCta = (item) => {
    const items = ctaEdit === "new" ? [...tpl.items, item] : tpl.items.map((x, i) => (i === ctaEdit ? item : x));
    set({ items }); setCtaEdit(null);
  };

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* ---------------- templates + palette ---------------- */}
      <div style={{ width: 210, flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Templates</div>
        {creating ? (
          <div style={{ border: `1px solid ${T.primary}`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <Fld label="Template name">
              <input autoFocus value={newT.name} onChange={(e) => setNewT({ ...newT, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") addTemplate(); if (e.key === "Escape") setCreating(false); }}
                placeholder="e.g. Store Connect" style={ctl} />
            </Fld>
            <div style={{ height: 10 }} />
            <Fld label="Template type">
              <select value={newT.kind} onChange={(e) => setNewT({ ...newT, kind: e.target.value })} style={ctl}>
                {TEMPLATE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </Fld>
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!newT.name.trim()} onClick={addTemplate}>Create</Btn>
              <Btn onClick={() => setCreating(false)}>Cancel</Btn>
            </div>
          </div>
        ) : (
          <Btn variant="primary" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} onClick={() => setCreating(true)}>
            <Icon name="add" size={16} />New template
          </Btn>
        )}

        <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
          {templates.map((t) => {
            const a = t.id === tpl.id;
            const k = TEMPLATE_KINDS.find((x) => x.key === t.kind) || TEMPLATE_KINDS[0];
            const n = t.kind === "web_page" ? (t.rows || []).length : (t.modules || []).length;
            return (
              <div key={t.id} onClick={() => { setSel(t.id); setModSel(null); setCtaEdit(null); }}
                style={{ padding: "9px 11px", cursor: "pointer", borderBottom: `1px solid ${T.borderSubtle}`, background: a ? T.primaryTint : "transparent" }}>
                <div style={{ fontSize: 12.5, color: a ? T.primary : T.text, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <Icon name={k.icon} size={14} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                </div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                  {k.label} · {n} module{n === 1 ? "" : "s"}{t.isDefault ? " · default" : ""}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
          {isMobile ? "Modules" : "Display types"}
        </div>
        <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 8 }}>
          {isMobile ? "Click to add to the site." : "Drag onto the page."}
        </div>
        {isMobile
          ? MOBILE_MODULES.map((m) => (
              <div key={m.key} onClick={() => addMod(m.key)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", marginBottom: 6, borderRadius: 6, border: `1px solid ${T.border}`, background: "#fff", cursor: "pointer", fontSize: 12.5 }}>
                <Icon name="add" size={14} style={{ color: T.micro }} />
                <Icon name={m.icon} size={15} style={{ color: T.primary }} />{m.label}
              </div>
            ))
          : palette.map((t) => (
              <div key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `new:${t.id}`)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", marginBottom: 6, borderRadius: 6, border: `1px solid ${T.border}`, background: "#fff", cursor: "grab", fontSize: 12.5 }}>
                <Icon name="drag_indicator" size={15} style={{ color: T.micro }} />
                <Icon name={webEl(t.element?.type).icon} size={15} style={{ color: T.primary }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
              </div>
            ))}
      </div>

      {/* ---------------- canvas ---------------- */}
      <div style={{ flex: 1, minWidth: 320 }}>
        <Grid cols={2}>
          <Fld label="Template type">
            <select value={tpl.kind} onChange={(e) => changeKind(e.target.value)} style={ctl}>
              {TEMPLATE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </Fld>
          <div />
          <Fld label="Template name">
            <input value={tpl.name} onChange={(e) => set({ name: e.target.value })} style={ctl} />
          </Fld>
          <div />
        </Grid>

        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, background: T.surfaceAlt, minHeight: 180 }}>
          {isMobile ? (
            (tpl.modules || []).map((m, i) => {
              const def = MOBILE_MODULES.find((x) => x.key === m.type);
              const a = modSel === m.mid;
              return (
                <div key={m.mid} onClick={() => { setModSel(m.mid); setCtaEdit(null); }}
                  style={{ background: "#fff", border: `2px ${a ? "solid" : "dashed"} ${a ? T.primary : T.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
                    <span onClick={() => moveMod(i, -1)} style={{ cursor: "pointer", opacity: i === 0 ? 0.2 : 1, lineHeight: 0.65 }}><Icon name="expand_less" size={15} style={{ color: T.muted }} /></span>
                    <span onClick={() => moveMod(i, 1)} style={{ cursor: "pointer", opacity: i === tpl.modules.length - 1 ? 0.2 : 1, lineHeight: 0.65 }}><Icon name="expand_more" size={15} style={{ color: T.muted }} /></span>
                  </div>
                  <Icon name={def.icon} size={17} style={{ color: T.primary }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5 }}>{def.label}</div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                      {m.type === "ctas" ? `${(tpl.items || []).length} CTAs — click to manage`
                        : m.type === "carousel" ? (playlists.find((p) => p.id === tpl.carouselPlaylist)?.name || "No playlist")
                        : m.type === "header" ? tpl.header : def.desc}
                    </div>
                  </div>
                  <Icon name="close" size={16} style={{ color: T.muted, cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); set({ modules: tpl.modules.filter((_, k) => k !== i) }); }} />
                </div>
              );
            })
          ) : (
            <>
              <DropZone i={0} />
              {(tpl.rows || []).map((row, i) => {
                const t = typeOf(row.typeId);
                if (!t) return null;
                const el = webEl(t.element?.type);
                return (
                  <div key={row.rid}>
                    <div draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `move:${i}`)}
                      style={{ background: "#fff", border: `2px dashed ${T.primary}`, borderRadius: 8, padding: "10px 12px", cursor: "grab", display: "flex", alignItems: "center", gap: 10 }}>
                      <Icon name="drag_indicator" size={16} style={{ color: T.micro }} />
                      <Icon name={el.icon} size={17} style={{ color: T.primary }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5 }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                          {el.plays} · {t.wDesktop || 1200}×{t.hDesktop || 520}px
                        </div>
                      </div>
                      <Icon name="close" size={16} style={{ color: T.muted, cursor: "pointer" }}
                        onClick={() => set({ rows: tpl.rows.filter((_, k) => k !== i) })} />
                    </div>
                    <DropZone i={i + 1} />
                  </div>
                );
              })}
              {(tpl.rows || []).length === 0 && (
                <div style={{ padding: 26, textAlign: "center", color: T.muted, fontSize: 13 }}>Empty template — drag a display type here.</div>
              )}
            </>
          )}
        </div>

        {!isMobile && (
          <>
            <SectionLabel>Template settings</SectionLabel>
            <Grid cols={3}>
              <Fld label="Width"><select value={tpl.widthMode} onChange={(e) => set({ widthMode: e.target.value })} style={ctl}><option value="contained">Contained</option><option value="full">Full bleed</option></select></Fld>
              <Fld label="Max width (px)"><input type="number" value={tpl.maxWidth} onChange={(e) => set({ maxWidth: Number(e.target.value) })} style={ctl} /></Fld>
              <div />
            </Grid>
            <Grid cols={3}>
              <Fld label="Background"><input type="color" value={tpl.background} onChange={(e) => set({ background: e.target.value })} style={swatch} /></Fld>
              <div />
            </Grid>

            <SectionLabel>QR control (pairing overlay)</SectionLabel>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 12, lineHeight: 1.5 }}>
              Appearance — colours, icons and attribution — is defined on the QR Control element.
              The template decides <b>which element to use and where it sits</b>.
            </div>
            <Grid cols={3}>
              <Fld label="Enable overlay">
                <div style={{ height: CTL_H, display: "flex", alignItems: "center" }}>
                  <Toggle on={tpl.pairing.on} onChange={(v) => setPair({ on: v })} />
                </div>
              </Fld>
              <Fld label="QR Control element">
                <select value={tpl.pairing.elementId || ""} disabled={!tpl.pairing.on}
                  onChange={(e) => setPair({ elementId: e.target.value })} style={{ ...ctl, opacity: tpl.pairing.on ? 1 : 0.45 }}>
                  {qrElements.length === 0 && <option value="">No QR Control element defined</option>}
                  {qrElements.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
              </Fld>
              <Fld label="Opens">
                <select value={tpl.pairing.mobileTemplate} disabled={!tpl.pairing.on}
                  onChange={(e) => setPair({ mobileTemplate: e.target.value })} style={{ ...ctl, opacity: tpl.pairing.on ? 1 : 0.45 }}>
                  {templates.filter((x) => x.kind !== "web_page").map((x) => <option key={x.id}>{x.name}</option>)}
                </select>
              </Fld>
            </Grid>
            <Grid cols={3}>
              <Fld label="Anchor">
                <select value={tpl.pairing.anchor} disabled={!tpl.pairing.on} onChange={(e) => setPair({ anchor: e.target.value })} style={{ ...ctl, opacity: tpl.pairing.on ? 1 : 0.45 }}>
                  {["Top Left", "Top Right", "Bottom Left", "Bottom Right", "Center"].map((o) => <option key={o}>{o}</option>)}
                </select>
              </Fld>
              <Fld label="Offset X"><input type="number" value={tpl.pairing.offsetX} disabled={!tpl.pairing.on} onChange={(e) => setPair({ offsetX: Number(e.target.value) })} style={{ ...ctl, opacity: tpl.pairing.on ? 1 : 0.45 }} /></Fld>
              <Fld label="Offset Y"><input type="number" value={tpl.pairing.offsetY} disabled={!tpl.pairing.on} onChange={(e) => setPair({ offsetY: Number(e.target.value) })} style={{ ...ctl, opacity: tpl.pairing.on ? 1 : 0.45 }} /></Fld>
            </Grid>
          </>
        )}
      </div>

      {/* ---------------- right panel ---------------- */}
      <div style={{ width: 310, flexShrink: 0 }}>
        {isMobile && modSel ? (
          (() => {
            const mod = (tpl.modules || []).find((m) => m.mid === modSel);
            if (!mod) return <MobilePreview t={tpl} playlists={playlists} />;
            if (mod.type === "header") return (
              <div style={{ border: `1px solid ${T.primary}`, borderRadius: 8, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Site Header</span>
                  <Icon name="close" size={18} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setModSel(null)} />
                </div>
                <TokenField label="Header text" value={tpl.header} onChange={(v) => set({ header: v })}
                  hint="Substituted at render time from the resolved store and visitor context." />
                <div style={{ height: 14 }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13 }}>Enable QR Code Scanner</span>
                  <Toggle on={tpl.qrScanner} onChange={(v) => set({ qrScanner: v })} />
                </div>
                <Note>The scanner sits in the header, so it is configured here.</Note>
              </div>
            );
            if (mod.type === "carousel") return (
              <div style={{ border: `1px solid ${T.primary}`, borderRadius: 8, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Carousel</span>
                  <Icon name="close" size={18} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setModSel(null)} />
                </div>
                <Fld label="Playlist">
                  <select value={tpl.carouselPlaylist} onChange={(e) => set({ carouselPlaylist: e.target.value })} style={ctl}>
                    {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Fld>
                <Note>Campaigns in this playlist rotate at the top of the mobile site.</Note>
              </div>
            );
            if (mod.type === "content") return (
              <div style={{ border: `1px solid ${T.primary}`, borderRadius: 8, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Content</span>
                  <Icon name="close" size={18} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setModSel(null)} />
                </div>
                <TokenField label="Text" value={mod.text || ""} placeholder="Copy shown on the site"
                  onChange={(v) => set({ modules: tpl.modules.map((m) => (m.mid === mod.mid ? { ...m, text: v } : m)) })} />
              </div>
            );
            // ctas
            return ctaEdit !== null ? (
              <MenuItemEditor initial={ctaEdit === "new" ? null : tpl.items[ctaEdit]} onCancel={() => setCtaEdit(null)} onSave={saveCta} />
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>CTAs</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Btn variant="outline" style={{ height: 28, fontSize: 12.5 }} onClick={() => setCtaEdit("new")}><Icon name="add" size={15} />Add</Btn>
                    <Icon name="close" size={18} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setModSel(null)} />
                  </div>
                </div>
                <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, overflow: "hidden" }}>
                  {(tpl.items || []).map((it, i) => (
                    <div key={i} style={{ padding: "9px 11px", borderBottom: i < tpl.items.length - 1 ? `1px solid ${T.borderSubtle}` : "none", display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ display: "flex", flexDirection: "column", paddingTop: 1 }}>
                        <span onClick={() => moveCta(i, -1)} style={{ cursor: "pointer", opacity: i === 0 ? 0.2 : 1, lineHeight: 0.65 }}>
                          <Icon name="expand_less" size={15} style={{ color: T.muted }} /></span>
                        <span onClick={() => moveCta(i, 1)} style={{ cursor: "pointer", opacity: i === tpl.items.length - 1 ? 0.2 : 1, lineHeight: 0.65 }}>
                          <Icon name="expand_more" size={15} style={{ color: T.muted }} /></span>
                      </div>
                      <Icon name={it.icon} size={17} style={{ color: T.text, marginTop: 1 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{it.name}</div>
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 4 }}>
                          {it.states.map((st) => {
                            const c = CONNECTION_STATES.find((x) => x.key === st);
                            return <Pill key={st} color={T.primary} bg={T.primaryTint}>{c ? c.label.replace(" State", "") : st}</Pill>;
                          })}
                          <Pill color={T.muted} bg="rgba(0,0,0,0.04)">{it.hours === "24" ? "24h" : "hours"}</Pill>
                          {(it.rules || []).length > 0 && <Pill color={T.aiViolet} bg="rgba(151,71,255,0.10)"><Icon name="filter_alt" size={11} />{it.rules.length}</Pill>}
                        </div>
                      </div>
                      <Icon name="edit" size={15} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setCtaEdit(i)} />
                      <Icon name="delete" size={15} style={{ color: T.error, cursor: "pointer" }} onClick={() => set({ items: tpl.items.filter((_, k) => k !== i) })} />
                    </div>
                  ))}
                  {(tpl.items || []).length === 0 && <div style={{ padding: 20, textAlign: "center", fontSize: 12.5, color: T.muted }}>No CTAs yet.</div>}
                </div>
                <Note>Visibility is set per connection state, so the same site shows different actions in store and away from store.</Note>
              </div>
            );
          })()
        ) : isMobile ? (
          <MobilePreview t={tpl} playlists={playlists} />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px" }}>Preview</div>
              <div style={{ display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
                {[["desktop", "desktop_windows"], ["tablet", "tablet_mac"], ["mobile", "smartphone"]].map(([k, ic], i) => (
                  <div key={k} onClick={() => setBp(k)} style={{ padding: "4px 8px", cursor: "pointer", background: bp === k ? T.primary : "#fff", color: bp === k ? "#fff" : T.muted, borderRight: i < 2 ? `1px solid ${T.border}` : "none" }}>
                    <Icon name={ic} size={14} />
                  </div>
                ))}
              </div>
            </div>
            <TemplatePreview tpl={tpl} types={types} bp={bp} kind={kind} paired={paired} />
            {tpl.pairing.on && (
              <div style={{ marginTop: 10, display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
                {[["Idle", false], ["Connected", true]].map(([l, v], i) => (
                  <div key={l} onClick={() => setPaired(v)}
                    style={{ padding: "5px 12px", fontSize: 12, cursor: "pointer", background: paired === v ? T.primary : "#fff", color: paired === v ? "#fff" : T.muted, borderRight: i === 0 ? `1px solid ${T.border}` : "none" }}>{l}</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


function TemplatePreview({ tpl, types, bp, kind, paired }) {
  const qrEl = types.find((t) => t.id === tpl.pairing?.elementId);
  const idle = { qrColour: qrEl?.qrControl?.qrCode?.colour || "#000000", qrSize: qrEl?.qrControl?.qrCode?.size || 120, showPoweredBy: true, poweredByText: qrEl?.qrControl?.connected?.poweredByText || "Powered by Personalisation Hub" };
  const conn = { icon: qrEl?.qrControl?.connected?.icon || "smartphone", iconColour: qrEl?.qrControl?.connectedIconColour || "#169bc2", showPoweredBy: true };
  const w = kind.frame === "phone" ? 190 : { desktop: 300, tablet: 240, mobile: 175 }[bp];
  const typeOf = (id) => types.find((t) => t.id === id);
  const p = tpl.pairing;
  const anchor = {
    "Top Left": { left: 8, top: 8 }, "Top Right": { right: 8, top: 8 },
    "Bottom Left": { left: 8, bottom: 8 }, "Bottom Right": { right: 8, bottom: 8 },
    "Center": { left: "50%", top: "50%", transform: "translate(-50%,-50%)" },
  }[p.anchor];
  const qrBox = Math.max(26, Math.round(idle.qrSize / 3.2));

  return (
    <div style={{ width: w, border: `1px solid ${T.border}`, borderRadius: kind.frame === "phone" ? 16 : 8, overflow: "hidden", background: "#fff", position: "relative", transition: "width .15s" }}>
      <div style={{ height: 18, background: T.surfaceAlt, borderBottom: `1px solid ${T.borderSubtle}`, display: "flex", alignItems: "center", justifyContent: kind.frame === "phone" ? "center" : "flex-start", gap: 3, padding: "0 7px" }}>
        {kind.frame === "phone"
          ? <div style={{ width: 40, height: 5, borderRadius: 9999, background: "rgba(0,0,0,0.2)" }} />
          : ["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} style={{ width: 6, height: 6, borderRadius: 9999, background: c }} />)}
      </div>

      <div style={{ maxHeight: 380, overflowY: "auto", background: tpl.background, padding: tpl.widthMode === "contained" ? "8px 10px" : "8px 0" }}>
        {tpl.rows.map((row, i) => {
          const t = typeOf(row.typeId);
          if (!t) return null;
          const el = webEl(t.element?.type);
          const mock = MOCK[t.id] || ["Campaign"];
          const cols = el.plays === "simultaneous" ? (t.element?.breakpoints?.[bp]?.columns) || 1 : 1;
          const shown = el.plays === "simultaneous" ? ((t.element?.breakpoints?.[bp]?.items) || mock.length) : 1;
          const locked = el.key === "order";
          return (
            <div key={row.rid}>
              <div style={{ marginBottom: 8 }}>
                {locked ? (
                  <div style={{ border: `1px solid ${T.error}`, background: "rgba(255,77,79,0.06)", borderRadius: 4, padding: 7 }}>
                    <div style={{ fontSize: 8.5, color: T.error, display: "flex", alignItems: "center", gap: 3 }}><Icon name="lock" size={10} />PH-authored</div>
                    <div style={{ height: 7, width: "40%", background: "rgba(0,0,0,0.25)", borderRadius: 2, marginTop: 5 }} />
                    <div style={{ height: 4, width: "72%", background: "rgba(0,0,0,0.12)", borderRadius: 2, marginTop: 4 }} />
                  </div>
                ) : el.plays === "simultaneous" ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {mock.slice(0, shown).map((m, k) => (
                      <div key={k} style={{ width: `calc(${100 / cols}% - 4px)`, background: T.primaryTint, border: `1px solid ${T.primaryAccent}`, borderRadius: 3, padding: 5, minHeight: 30, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 8, color: T.primary, lineHeight: 1.2 }}>{m}</div>
                    ))}
                  </div>
                ) : (
                  <div style={{ background: T.primaryTint, border: `1px solid ${T.primaryAccent}`, borderRadius: 3, minHeight: el.key === "hero" ? 54 : 40, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, fontSize: 9, color: T.primary }}>
                    <Icon name={el.icon} size={14} />{mock[0]}
                    {el.plays === "sequential" && (
                      <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                        {mock.map((_, k) => <span key={k} style={{ width: 4, height: 4, borderRadius: 9999, background: k === 0 ? T.primary : "transparent", border: `1px solid ${T.primary}` }} />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {p.on && qrEl && (
        <div style={{ position: "absolute", ...anchor, width: qrBox, height: qrBox, background: "#fff", borderRadius: 5,
          boxShadow: "0 3px 10px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          border: `1px solid ${paired ? p.connectedColour : "rgba(0,0,0,0.08)"}` }}>
          {paired
            ? <img src={CONNECTED_ASSET} alt="Connected" style={{ width: "82%", display: "block" }} />
            : <Icon name="qr_code_2" size={Math.round(qrBox * 0.72)} style={{ color: p.colour }} />}
        </div>
      )}
    </div>
  );
}

/* --------------------------- mobile store sites --------------------------- */

function MenuItemEditor({ initial, onCancel, onSave }) {
  const [it, setIt] = useState(initial || { pre: "custom", icon: "link", name: "", url: "", newTab: false, states: ["connected_store"], hours: "24", rules: [] });
  const set = (p) => setIt({ ...it, ...p });
  const pre = PRECONFIGURED_ITEMS.find((p) => p.key === it.pre);
  const isCustom = it.pre === "custom";
  const valid = it.name.trim() && (!isCustom || it.url.trim());

  const choosePre = (k) => {
    const p = PRECONFIGURED_ITEMS.find((x) => x.key === k);
    set({ pre: k, icon: p.icon, name: it.name || (k === "custom" ? "" : p.label), url: k === "custom" ? it.url : "" });
  };

  return (
    <div style={{ border: `1px solid ${T.primary}`, borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Menu Item</div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 4 }}>Pre-configured menu item</div>
        <select value={it.pre} onChange={(e) => choosePre(e.target.value)} style={{ ...inputStyle, height: 30, fontSize: 12.5 }}>
          {PRECONFIGURED_ITEMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {!isCustom && <Note>{pre.label} is handled by the platform — no URL needed.</Note>}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ width: 96 }}>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 4 }}>Icon</div>
          <select value={it.icon} onChange={(e) => set({ icon: e.target.value })} style={{ ...inputStyle, height: 30, fontSize: 12 }}>
            {MENU_ICONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 4 }}>Menu Name</div>
          <input value={it.name} onChange={(e) => set({ name: e.target.value })} style={{ ...inputStyle, height: 30, fontSize: 12.5 }} />
        </div>
      </div>

      {isCustom && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: T.muted }}>URL</span>
          </div>
          <input value={it.url} onChange={(e) => set({ url: e.target.value })} placeholder="{YourDomain}?store={$StoreName}"
            style={{ ...inputStyle, height: 30, fontFamily: MONO, fontSize: 11.5 }} />
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
            {SITE_TOKENS.map((tok) => (
              <span key={tok} onClick={() => set({ url: it.url + tok })}
                style={{ fontSize: 10, fontFamily: MONO, padding: "2px 5px", borderRadius: 4, border: `1px solid ${T.border}`, cursor: "pointer", color: T.primary }}>{tok}</span>
            ))}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, cursor: "pointer", fontSize: 12.5 }}>
            <input type="checkbox" checked={it.newTab} onChange={(e) => set({ newTab: e.target.checked })} style={{ width: 15, height: 15, accentColor: T.primary }} />
            Open in New Tab
          </label>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>When Menu Item will be shown</div>
        {CONNECTION_STATES.map((c) => {
          const on = it.states.includes(c.key);
          return (
            <label key={c.key} style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={on} style={{ width: 15, height: 15, accentColor: T.primary, marginTop: 1 }}
                onChange={(e) => set({ states: e.target.checked ? [...it.states, c.key] : it.states.filter((x) => x !== c.key) })} />
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 12.5 }}>{c.label}</span>
                <span style={{ fontSize: 11, color: T.muted, display: "block", lineHeight: 1.35 }}>{c.hint}</span>
              </span>
            </label>
          );
        })}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: T.muted }}>Targeting criteria</span>
          <span onClick={() => set({ rules: [...(it.rules || []), { attr: CTA_ATTRS[0], op: "is", value: "" }] })}
            style={{ fontSize: 12, color: T.primary, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}>
            <Icon name="add" size={14} />Add rule
          </span>
        </div>
        {(it.rules || []).length === 0 && (
          <div style={{ fontSize: 11.5, color: T.micro, lineHeight: 1.45 }}>
            No criteria — shown to everyone in the selected states.
          </div>
        )}
        {(it.rules || []).map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 5, marginBottom: 5, alignItems: "center" }}>
            <select value={r.attr} onChange={(e) => set({ rules: it.rules.map((x, k) => (k === i ? { ...x, attr: e.target.value } : x)) })}
              style={{ ...ctl, height: 28, fontSize: 11.5, flex: 1.2 }}>
              {CTA_ATTRS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={r.op} onChange={(e) => set({ rules: it.rules.map((x, k) => (k === i ? { ...x, op: e.target.value } : x)) })}
              style={{ ...ctl, height: 28, fontSize: 11.5, width: 78 }}>
              {["is", "is not", "contains", "exists"].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {r.op !== "exists" && (
              <input value={r.value} onChange={(e) => set({ rules: it.rules.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })}
                placeholder="value" style={{ ...ctl, height: 28, fontSize: 11.5, flex: 1 }} />
            )}
            <Icon name="close" size={15} style={{ color: T.muted, cursor: "pointer" }}
              onClick={() => set({ rules: it.rules.filter((_, k) => k !== i) })} />
          </div>
        ))}
        <Note>All criteria must match. Evaluated on top of the connection states above.</Note>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>Availability</div>
        {[["24", "Show 24 hours a day"], ["opening", "Show based on Store Opening Hours"]].map(([k, l]) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, cursor: "pointer", fontSize: 12.5 }}>
            <input type="radio" checked={it.hours === k} onChange={() => set({ hours: k })} style={{ accentColor: T.primary }} />{l}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn variant="primary" disabled={!valid} onClick={() => onSave(it)}>Save</Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

function MobilePreview({ t, playlists }) {
  const [state, setState] = useState("connected_display");
  const visible = t.items.filter((i) => i.states.includes(state));
  const header = t.header
    .replace("${BrandName}", "One NZ").replace("${StoreName}", "Newmarket")
    .replace("${StoreCode}", "NM01").replace("${FirstName}", "Eli").replace("${QueuePosition}", "3");

  return (
    <div>
      <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Preview</div>
      <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>Connection state</div>
      <select value={state} onChange={(e) => setState(e.target.value)} style={{ ...inputStyle, height: 30, fontSize: 12.5, marginBottom: 12 }}>
        {CONNECTION_STATES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>

      <div style={{ width: 210, border: `2px solid ${T.border}`, borderRadius: 18, overflow: "hidden", background: "#fff" }}>
        <div style={{ height: 20, background: T.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 44, height: 5, borderRadius: 9999, background: "rgba(0,0,0,0.2)" }} />
        </div>
        <div style={{ padding: "12px 12px 8px", borderBottom: `1px solid ${T.borderSubtle}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{header}</div>
          {t.qrScanner && <Icon name="qr_code_scanner" size={17} style={{ color: T.primary, flexShrink: 0 }} />}
        </div>
        <div style={{ padding: 10 }}>
          {(t.modules || []).some((m) => m.type === "carousel") && (
            <div style={{ background: T.primaryTint, border: `1px solid ${T.primaryAccent}`, borderRadius: 5, minHeight: 62, marginBottom: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
              <Icon name="view_carousel" size={16} style={{ color: T.primary }} />
              <span style={{ fontSize: 9.5, color: T.primary, textAlign: "center", padding: "0 6px" }}>
                {(playlists || []).find((p) => p.id === t.carouselPlaylist)?.name || "Carousel"}
              </span>
              <div style={{ display: "flex", gap: 3 }}>
                {[0,1,2].map((k) => <span key={k} style={{ width: 4, height: 4, borderRadius: 9999, background: k === 0 ? T.primary : "transparent", border: `1px solid ${T.primary}` }} />)}
              </div>
            </div>
          )}
          {visible.map((i, k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", border: `1px solid ${T.borderSubtle}`, borderRadius: 6, marginBottom: 6 }}>
              <Icon name={i.icon} size={16} style={{ color: T.primary }} />
              <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.name}</span>
              <Icon name="chevron_right" size={14} style={{ color: T.micro }} />
            </div>
          ))}
          {visible.length === 0 && <div style={{ padding: 16, textAlign: "center", fontSize: 11.5, color: T.muted }}>No items shown in this state.</div>}
          {(t.modules || []).some((m) => m.type === "footer") && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.borderSubtle}`, textAlign: "center", fontSize: 9, color: T.micro, lineHeight: 1.5 }}>
              Site footer<br />Legal · Contact · Privacy
            </div>
          )}
        </div>
      </div>
      <Note>
        {visible.length} of {t.items.length} items visible in this state. Availability rules would further hide
        items outside store opening hours.
      </Note>
    </div>
  );
}
