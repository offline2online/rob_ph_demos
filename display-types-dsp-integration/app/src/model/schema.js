/* ------------------------------------------------------------------
   Data model — System Two (display types / elements) and the playback
   objects (playlists, items, scenes).

   Aligned to Personalisation Hub's EXISTING display-type and playlist
   records, as the Real-Time Personalised Surface Architecture Specification
   v1.2 describes them (§3 playback, §5.4 display type schema) and as the
   live HQ Admin "Display Types Details" form exposes them. Field names that
   the spec quotes are used verbatim:

     displayType.playlistSettings.maximumCampaignsPlayedInRotation  (-1 = unlimited)
     displayType.multiZone.zones[] / activeCampaignsByZone (runtime, read-only)
     playlist.items[].priority / playbackDuration / campaignType
     playlist.items[].campaignCreativeSettings.{default,selected,unselected}
     scene.text[] with entrance/exit animation and a variants[] binding point

   `null` on a display-type setting means "inherit the platform default" —
   the platform's own form renders that as "Default (…)", and this prototype
   keeps the same convention so an override is always distinguishable from
   an inherited value (REQUIREMENTS §2, configuration inheritance).

   Everything under `phExtensions` is what THIS project adds on top of the
   existing record (slot ownership, trust zones, store quotas). Keeping it in
   one sub-object means the base record stays byte-compatible with what the
   platform already stores.
------------------------------------------------------------------- */

export const UNLIMITED = -1;

/* ---------------------------------------------------------------- enums */

export const TOUCH_POINTS = [
  { name: "Digital Signage", icon: "tv", physical: true },
  { name: "Kiosk", icon: "storefront", physical: true },
  { name: "Responsive Web", icon: "devices", physical: false },
  { name: "Mobile Store Site", icon: "mobile_friendly", physical: false },
];
export const PHYSICAL_TOUCH_POINTS = TOUCH_POINTS.filter((t) => t.physical).map((t) => t.name);
export const isPhysicalTP = (tp) => PHYSICAL_TOUCH_POINTS.includes(tp);
export const isWebTP = (tp) => !isPhysicalTP(tp);
export const tpIcon = (n) => (TOUCH_POINTS.find((t) => t.name === n) || TOUCH_POINTS[0]).icon;

/* Option lists exactly as the HQ Admin form offers them. */
export const ASSET_POSITIONS = ["Top-Left", "Top-Right", "Center", "Bottom-Left", "Bottom-Right"];
export const ASSET_FILLS = ["Fit to Display (Maintain Aspect Ratio)", "Fill Display (Crop)", "Stretch to Display", "Original Size"];
export const CAMPAIGN_TRANSITIONS = ["None", "Fade", "Slide", "Wipe"];
export const AUTO_ROTATION = ["Auto-Rotate", "Manual Rotation"];
export const AUTO_PLAY = ["Auto-Play", "Manual Play"];
export const ROTATION_CAPS = [UNLIMITED, 1, 2, 3, 4, 5, 6, 8, 10, 12];
export const PHANTOM_POSITIONS = ["Top Left", "Top Right", "Bottom Left", "Bottom Right", "Center"];
export const PHANTOM_SIZING_MODES = ["Fit to Display", "Fixed", "Scale to Content"];
export const QR_POSITIONS = ["Center", "Top Left", "Top Right", "Bottom Left", "Bottom Right"];

/* Platform (company-level) defaults an inherited `null` resolves to. */
export const PLATFORM_DEFAULTS = {
  playlistSettings: {
    assetPosition: "Top-Left",
    assetFill: "Fit to Display (Maintain Aspect Ratio)",
    maximumCampaignsPlayedInRotation: UNLIMITED,
    campaignTransition: "None",
    campaignAutoRotation: "Auto-Rotate",
    campaignAutoPlay: "Auto-Play",
  },
  qrControl: { phantomArea: { position: "Bottom Right" }, qrCode: { position: "Center" } },
  firstPaintBudgetMs: 800,
};

/* ------------------------------------------------ trust zones (spec §7) */

export const TRUST_ZONES = {
  agent_addressable: { key: "agent_addressable", label: "Agent-addressable", icon: "smart_toy", colour: "#169bc2",
    hint: "Configuration or selection within Personalisation Hub's eligible set. A campaign, an advertiser creative or a paired agent may address it." },
  ph_locked: { key: "ph_locked", label: "PH-locked", icon: "lock", colour: "#ff4d4f",
    hint: "Price, offer terms and disclosures. Personalisation Hub writes here; no external agent, advertiser creative or store-authored campaign can." },
};

/* --------------------------------------------- enabled features (§5.4) */

export const FEATURES = [
  { key: "inStoreRadio", icon: "music_note", label: "Enable In-Store Radio", touchPoints: PHYSICAL_TOUCH_POINTS,
    hint: "Synchronised in-store audio." },
  { key: "proximityMist", icon: "sensors", label: "Enable Proximity based Personalisation (using MIST)", touchPoints: PHYSICAL_TOUCH_POINTS,
    hint: "Triggers personalisation from a MIST zone or vBeacon rather than a scan." },
  { key: "aiAgentPlayback", icon: "smart_toy", label: "Allow AI-Agents to Control Campaign Playback", touchPoints: TOUCH_POINTS.map((t) => t.name),
    hint: "A connected AI Agent sees every Active, AI-Agent-Enabled campaign assigned to this display and can trigger playback. Campaigns without that flag stay invisible to the agent." },
  { key: "visionAi", icon: "visibility", label: "Enable Vision/AI (BETA)", touchPoints: PHYSICAL_TOUCH_POINTS,
    hint: "On-device passerby insight and person match. Emits confidence-scored attributes — and a counted audience multiplier for programmatic reporting (REQUIREMENTS §7)." },
];
export const COMPANY_FEATURE_AVAILABILITY = { inStoreRadio: false, proximityMist: true, aiAgentPlayback: false, visionAi: true };

export const MIST_ZONES = ["Personalisation Hub Demo - Welcome Zone", "Front of Store", "Aisle 3", "Checkout Queue", "Service Desk"];
export const VISION_MODES = ["Monitor Passerby & Campaign Engagement Data", "Passerby Count Only", "Targeting & Personalisation", "Engagement Only"];
export const DETECTION_PRESETS = {
  Fast: { streamQuality: 480, fps: 10, frameSkip: 7, missThreshold: 10, note: "Lower camera quality and fewer processed frames. Best for weak hardware; may miss small faces or short visits." },
  Balanced: { streamQuality: 640, fps: 15, frameSkip: 5, missThreshold: 15, note: "Recommended default. Reasonable CPU usage and stable detection." },
  Accurate: { streamQuality: 1280, fps: 24, frameSkip: 2, missThreshold: 24, note: "Higher camera quality, more frequent detection, longer stability windows. Better recall; uses more CPU." },
  Custom: { note: "Manual values that no longer exactly match a predefined preset." },
};

export const blankFeatures = () => ({
  inStoreRadio: { enabled: false },
  proximityMist: { enabled: false, mode: "zone", zone: MIST_ZONES[0] },
  aiAgentPlayback: { enabled: false },
  visionAi: { enabled: false, mode: VISION_MODES[0], preset: "Balanced", ...DETECTION_PRESETS.Balanced, note: undefined },
});

/* ------------------------------------- Responsive Web elements (§5.2) */

export const WEB_ELEMENT_GROUPS = ["Showcase", "Multi-item", "Commerce", "Content", "Pairing"];
export const WEB_ELEMENTS = [
  { key: "hero", name: "Hero", icon: "featured_video", group: "Showcase", plays: "single", desc: "Lead element. One item at a time, in any format — image, video or copy." },
  { key: "carousel", name: "Carousel", icon: "view_carousel", group: "Multi-item", plays: "sequential", desc: "One item visible at a time with pagination. The customer can navigate." },
  { key: "grid", name: "Grid", icon: "grid_view", group: "Multi-item", plays: "simultaneous", desc: "All items visible at once in a responsive grid." },
  { key: "list", name: "List", icon: "view_agenda", group: "Multi-item", plays: "simultaneous", desc: "Vertical list of items." },
  { key: "product", name: "Product Tiles", icon: "sell", group: "Commerce", plays: "simultaneous", desc: "Product tiles with imagery, detail and price. Price is supplied by Personalisation Hub." },
  { key: "order", name: "Order Summary", icon: "receipt_long", group: "Commerce", plays: "static", desc: "Basket, totals and terms for the paired session." },
  { key: "ctas", name: "CTAs", icon: "ads_click", group: "Content", plays: "simultaneous", desc: "A set of calls to action offered on this surface." },
  { key: "faq", name: "FAQ", icon: "quiz", group: "Content", plays: "simultaneous", desc: "Expandable question and answer items." },
  { key: "text", name: "Rich Text", icon: "article", group: "Content", plays: "static", desc: "Headings, copy and imagery. No item rotation." },
  { key: "footer", name: "Site Footer", icon: "bottom_navigation", group: "Content", plays: "static", desc: "Persistent footer — legal, contact and secondary links." },
  { key: "qr_control", name: "QR Control", icon: "qr_code_2", group: "Pairing", plays: "static", desc: "The pairing affordance as an element. On web the pairing overlay is configured on the Layout template." },
];
export const webEl = (k) => WEB_ELEMENTS.find((e) => e.key === k) || WEB_ELEMENTS[0];

export const BREAKPOINTS = [
  { key: "desktop", label: "Desktop", icon: "desktop_windows", defW: 1200, defH: 520 },
  { key: "tablet", label: "Tablet", icon: "tablet_mac", defW: 834, defH: 420 },
  { key: "mobile", label: "Mobile", icon: "smartphone", defW: 390, defH: 320 },
];

const BP = (w, h, cols, items, peek = 0) => ({ viewportWidth: w, height: h, columns: cols, items, peek });
export const ELEMENT_DEFAULTS = {
  hero: { slots: 1, itemAspect: "16:9", gap: 0, widthMode: "full", desktop: BP(1200, 520, 1, 1), tablet: BP(834, 380, 1, 1), mobile: BP(390, 260, 1, 1) },
  carousel: { slots: 4, itemAspect: "16:9", gap: 12, widthMode: "contained", desktop: BP(1200, 360, 1, 4, 10), tablet: BP(834, 300, 1, 4, 10), mobile: BP(390, 240, 1, 4, 15) },
  grid: { slots: 6, itemAspect: "4:3", gap: 16, widthMode: "contained", desktop: BP(1200, 640, 3, 6), tablet: BP(834, 520, 2, 4), mobile: BP(390, 600, 1, 3) },
  list: { slots: 4, itemAspect: "16:9", gap: 12, widthMode: "contained", desktop: BP(1200, 480, 1, 4), tablet: BP(834, 420, 1, 3), mobile: BP(390, 400, 1, 3) },
  product: { slots: 6, itemAspect: "1:1", gap: 12, widthMode: "contained", desktop: BP(1200, 560, 3, 6), tablet: BP(834, 480, 2, 4), mobile: BP(390, 440, 2, 4) },
  order: { slots: 1, itemAspect: "auto", gap: 8, widthMode: "contained", desktop: BP(1200, 300, 1, 1), tablet: BP(834, 280, 1, 1), mobile: BP(390, 260, 1, 1) },
  ctas: { slots: 3, itemAspect: "auto", gap: 10, widthMode: "contained", desktop: BP(1200, 120, 3, 3), tablet: BP(834, 110, 3, 3), mobile: BP(390, 180, 1, 2) },
  faq: { slots: 5, itemAspect: "auto", gap: 6, widthMode: "contained", desktop: BP(1200, 420, 1, 5), tablet: BP(834, 400, 1, 5), mobile: BP(390, 380, 1, 4) },
  text: { slots: 1, itemAspect: "auto", gap: 8, widthMode: "contained", desktop: BP(1200, 300, 1, 1), tablet: BP(834, 280, 1, 1), mobile: BP(390, 260, 1, 1) },
  footer: { slots: 1, itemAspect: "auto", gap: 8, widthMode: "full", desktop: BP(1200, 180, 1, 1), tablet: BP(834, 200, 1, 1), mobile: BP(390, 260, 1, 1) },
  qr_control: { slots: 1, itemAspect: "1:1", gap: 0, widthMode: "contained", aboveFold: true, desktop: BP(240, 240, 1, 1), tablet: BP(240, 240, 1, 1), mobile: BP(200, 200, 1, 1) },
};

/* The element block of a Responsive Web display type. */
export const elementConfig = (key) => {
  const x = ELEMENT_DEFAULTS[key] || ELEMENT_DEFAULTS.hero;
  return {
    type: key, plays: webEl(key).plays, itemAspect: x.itemAspect, gap: x.gap, widthMode: x.widthMode, maxWidth: 1200,
    breakpoints: { desktop: { ...x.desktop }, tablet: { ...x.tablet }, mobile: { ...x.mobile } },
  };
};

/* Capability flags derived from the touch point / element. */
export function caps(d) {
  if (isPhysicalTP(d.touchPoint)) return { rotation: true, slots: true, grid: false, carousel: false, web: false, campaigns: true };
  const p = webEl(d.element?.type).plays;
  return { rotation: p === "sequential" || p === "single", slots: p === "sequential" || p === "simultaneous", grid: p === "simultaneous", carousel: p === "sequential", web: true, campaigns: p !== "static" };
}

/* ------------------------------------------------- slot ownership (§2) */

export const SLOT_OWNERS = {
  internal: { key: "internal", label: "Headquarters", colour: "#169bc2", bg: "rgba(22,155,194,0.10)", icon: "corporate_fare" },
  advertiser: { key: "advertiser", label: "Advertiser", colour: "#7c3aed", bg: "rgba(124,58,237,0.10)", icon: "sell" },
  retail: { key: "retail", label: "Stores", colour: "#faad14", bg: "rgba(250,173,20,0.14)", icon: "storefront" },
};
export const STORE_SCOPES = ["Store staff", "Store manager only", "Regional manager", "Franchisee"];

export const slot = (over = {}) => ({
  label: "Slot", owner: "internal", partnerId: null, advertiser: null, storeScope: null,
  quota: null,                         // Stores only: { mode: "count"|"percent", value }
  trustZone: "agent_addressable",      // spec §7 — a slot carrying price/terms is ph_locked
  ...over,
});

/* --------------------------------------------------- display type record */

export const displayType = (over = {}) => {
  const base = {
    id: null,
    touchPoint: "Digital Signage",
    name: "",
    description: "",
    image: null,                                   // "Display Type Image" on the platform form
    displayCanvasSize: { width: 1920, height: 1080 },
    backgroundColor: "#333333",
    defaultPlaylistId: null,
    playlistSettings: {                            // PLAYLIST SETTINGS panel; null = Default (…)
      assetPosition: null, assetFill: null,
      maximumCampaignsPlayedInRotation: null,      // null = platform default; -1 = Unlimited
      campaignTransition: null, campaignAutoRotation: null, campaignAutoPlay: null,
    },
    qrControl: {                                   // QR CONTROL (PHANTOM ZONE) panel
      enabled: false,
      phantomArea: { width: 250, height: 250, position: null, sizingMode: "Fit to Display" },
      qrCode: { size: 120, colour: "#000000", position: null },
      connectedIconColour: "#169bc2",
      mobileSiteTemplate: "Mobile App",
      connected: { icon: "smartphone", showPoweredBy: true, poweredByText: "Powered by Personalisation Hub" },
    },
    enabledFeatures: blankFeatures(),
    multiZone: { enabled: false, zones: [] },      // zones[]: { id, name, x, y, width, height (% of canvas), playlistId, trustZone }
    element: null,                                 // Responsive Web only — see elementConfig()
    phExtensions: {
      slots: [],                                   // one per capped rotation position — see slot()
      nameAuto: false,
    },
    updatedAt: null,
  };
  const out = deepMerge(base, over);
  if (isWebTP(out.touchPoint) && !out.element) out.element = elementConfig("hero");
  return out;
};

/* Playback settings resolved against the platform defaults. */
export const effectivePlaylistSettings = (d) => {
  const s = d.playlistSettings || {};
  const out = {};
  Object.keys(PLATFORM_DEFAULTS.playlistSettings).forEach((k) => { out[k] = s[k] === null || s[k] === undefined ? PLATFORM_DEFAULTS.playlistSettings[k] : s[k]; });
  return out;
};
export const rotationCap = (d) => effectivePlaylistSettings(d).maximumCampaignsPlayedInRotation;
export const isCapped = (d) => rotationCap(d) !== UNLIMITED;
export const slotCount = (d) => (isCapped(d) ? Number(rotationCap(d)) : 0);
export const capLabel = (n) => (n === UNLIMITED || n === null || n === undefined ? "Unlimited" : String(n));
export const shareOfVoice = (d) => (isCapped(d) ? 1 / slotCount(d) : null);   // §7 — the cap IS the SOV denominator

/* Resize the slots array to match a new cap, keeping what was there. */
export const resizeSlots = (slots, n) => {
  const next = [...(slots || [])];
  while (next.length < n) next.push(slot({ label: `Slot ${next.length + 1}` }));
  return next.slice(0, Math.max(0, n));
};

/* Wire record: the display type as it would be PUT to the platform. Same
   object minus UI-only bookkeeping. */
export const toDisplayTypeRecord = (d) => {
  const { phExtensions, ...rest } = d;
  const { nameAuto, ...ext } = phExtensions || {};
  return { ...rest, phExtensions: ext };
};

/* ------------------------------------------------------------ playlists */

export const CAMPAIGN_TYPES = ["LOCALISED", "ON_ROTATION", "TRIGGERED", "TARGETED"];
export const PLAYLIST_SCHEDULE_MODES = [
  { key: "store_hours", label: "Store opening hours" },
  { key: "always", label: "Always (24h)" },
  { key: "custom", label: "Custom window" },
];

/* One item = one campaign in the rotation. `campaignCreativeSettings` maps
   directly onto device pairing (§3): unpaired renders `default`; the item a
   paired customer engages renders `selected`; concurrent items `unselected`. */
export const playlistItem = (over = {}) => ({
  id: null,
  campaignId: null,
  priority: 10,
  playbackDuration: 10,                  // seconds
  campaignType: ["LOCALISED", "ON_ROTATION"],
  campaignCreativeSettings: {
    default: { sceneId: null },
    selected: { sceneId: null },
    unselected: { sceneId: null },
  },
  enabled: true,
  ...over,
});

export const playlist = (over = {}) => ({
  id: null,
  name: "",
  autoCreatedFor: null,                  // display type id when auto-created with it
  schedule: { mode: "store_hours", from: null, to: null },
  items: [],
  ...over,
});

/* Loop length and the visibility deadline of a slot position (§1): the
   deadline for slot n is first-paint budget + Σ playbackDuration of the
   preceding slots. */
export const loopLengthSeconds = (pl) => (pl?.items || []).filter((i) => i.enabled !== false).reduce((s, i) => s + (Number(i.playbackDuration) || 0), 0);
export const visibilityDeadlineMs = (pl, slotIndex, firstPaintBudgetMs = PLATFORM_DEFAULTS.firstPaintBudgetMs) => {
  const items = (pl?.items || []).filter((i) => i.enabled !== false).sort((a, b) => a.priority - b.priority);
  let t = firstPaintBudgetMs;
  for (let i = 0; i < Math.min(slotIndex, items.length); i++) t += (Number(items[i].playbackDuration) || 0) * 1000;
  return t;
};

/* --------------------------------------------------------------- scenes */

export const ANIMATIONS = ["None", "Fade in", "Slide up", "Slide left", "Zoom in", "Typewriter"];
export const EXIT_ANIMATIONS = ["None", "Fade out", "Slide down", "Slide right", "Zoom out"];

export const textElement = (over = {}) => ({
  id: null,
  content: "",
  x: 5, y: 5, width: 60, height: 12,     // % of the scene
  font: { family: "Roboto", size: 48, weight: 700, colour: "#ffffff", align: "left" },
  animation: { entrance: "Fade in", exit: "Fade out", delayMs: 0, durationMs: 400 },
  trustZone: "agent_addressable",        // price / terms text is ph_locked
  variants: [],                          // personalisation binding point — grammar is open question 2
  ...over,
});

/* A variant is a conditional replacement for a text element's content. The
   grammar below is a WORKING ASSUMPTION (open question 2): a flat list of
   {when, content} evaluated in order, first match wins, falling back to the
   element's own content. */
export const textVariant = (over = {}) => ({ id: null, when: { attr: "", op: "eq", value: "" }, content: "", ...over });

export const scene = (over = {}) => ({
  id: null,
  name: "",
  background: { type: "colour", value: "#111111", assetId: null },   // colour | image | video
  text: [],
  ...over,
});

/* ----------------------------------------------------------------- misc */

export function deepMerge(base, over) {
  if (Array.isArray(over)) return over.map((x) => (x && typeof x === "object" && !Array.isArray(x) ? deepMerge({}, x) : x));
  if (over === null || typeof over !== "object") return over === undefined ? base : over;
  const out = { ...(base || {}) };
  Object.keys(over).forEach((k) => {
    const b = base ? base[k] : undefined;
    out[k] = b && typeof b === "object" && !Array.isArray(b) && over[k] && typeof over[k] === "object" && !Array.isArray(over[k]) ? deepMerge(b, over[k]) : deepMerge(undefined, over[k]);
  });
  return out;
}

/* Immutable path set: setIn(obj, "a.b.c", v). */
export function setIn(obj, path, value) {
  const keys = Array.isArray(path) ? path : path.split(".");
  if (keys.length === 0) return value;
  const [k, ...rest] = keys;
  const cur = obj && typeof obj === "object" ? obj : {};
  return Array.isArray(cur) ? cur.map((x, i) => (String(i) === String(k) ? setIn(x, rest, value) : x)) : { ...cur, [k]: setIn(cur[k], rest, value) };
}
export const getIn = (obj, path) => (Array.isArray(path) ? path : path.split(".")).reduce((o, k) => (o == null ? undefined : o[k]), obj);
