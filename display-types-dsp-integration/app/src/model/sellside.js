/* ------------------------------------------------------------------
   The sell side — partners / DSPs, advertiser lists, the targeting
   vocabulary a partner may use, and the exchange settings that make
   Personalisation Hub the SSP (REQUIREMENTS §6–§7). Reservations, campaign
   sets and delivery records are spec only (§6) — not modelled here.
------------------------------------------------------------------- */


/* ---------------------------------------------------------- partners */

export const DIRECT_PARTNER = "__direct__";
export const ANY_PARTNER = "__any__";
export const RTB = "__rtb__";
export const ALLOW_LIST = "__allow__";
export const COMPANY_LISTS = "__company__";

export const DSP_PROVIDERS = {
  google_dsp: {
    label: "Google DSP", sub: "Display & Video 360", icon: "ads_click", colour: "#4285f4", apiTier: 1,
    blurb: "Partner and advertiser IDs are the ones shown in the DV360 UI. The service account must be granted access to the partner before the first sync will return seats.",
    scope: "https://www.googleapis.com/auth/display-video",
    fields: [
      { key: "partnerId", label: "Partner ID", required: true, placeholder: "123456", hint: "DV360 partner the inventory is sold under." },
      { key: "advertiserId", label: "Advertiser ID", required: true, placeholder: "7654321" },
      { key: "authMode", label: "Authentication", required: true, type: "select", options: ["Service account (JSON key)", "OAuth 2.0 client"] },
      { key: "saEmail", label: "Service account email", required: true, placeholder: "ph-retail-media@project.iam.gserviceaccount.com", when: (c) => c.authMode !== "OAuth 2.0 client" },
      { key: "saKey", label: "Private key (JSON)", required: true, secret: true, placeholder: "Paste the key file contents", multiline: true, when: (c) => c.authMode !== "OAuth 2.0 client" },
      { key: "clientId", label: "OAuth client ID", required: true, placeholder: "…apps.googleusercontent.com", when: (c) => c.authMode === "OAuth 2.0 client" },
      { key: "clientSecret", label: "OAuth client secret", required: true, secret: true, when: (c) => c.authMode === "OAuth 2.0 client" },
      { key: "networkCode", label: "Ad Manager network code", required: false, placeholder: "Optional — only for the exchange side" },
    ],
    defaults: { authMode: "Service account (JSON key)", currency: "GBP" },
  },
  amazon_dsp: {
    label: "Amazon Ads DSP", sub: "Amazon Ads API", icon: "shopping_basket", colour: "#ff9900", apiTier: 1,
    blurb: "Login with Amazon supplies the client credentials and refresh token; the profile, advertiser and entity IDs scope which account this connection sells for. The region fixes the API endpoint and cannot be changed after connecting.",
    scope: "advertising::campaign_management",
    fields: [
      { key: "region", label: "Region", required: true, type: "select", options: ["North America (NA)", "Europe (EU)", "Far East (FE)"], hint: "Sets the API endpoint. Fixed once connected." },
      { key: "clientId", label: "LWA client ID", required: true, placeholder: "amzn1.application-oa2-client.…" },
      { key: "clientSecret", label: "LWA client secret", required: true, secret: true },
      { key: "refreshToken", label: "Refresh token", required: true, secret: true, placeholder: "Atzr|…" },
      { key: "profileId", label: "Profile ID", required: true, placeholder: "1234567890" },
      { key: "advertiserId", label: "Advertiser ID", required: true, placeholder: "ENTITY1A2B3C" },
      { key: "entityId", label: "Entity ID", required: true, placeholder: "ENTITY9Z8Y7X" },
    ],
    defaults: { region: "Europe (EU)", currency: "GBP" },
  },
  trade_desk: {
    label: "The Trade Desk", sub: "TTD supply integration", icon: "candlestick_chart", colour: "#1f7ae0", apiTier: 1,
    blurb: "The largest independent buyer of programmatic DOOH. Onboarding is a supply-vendor process: seat and supply-source setup on TTD's side, sellers.json validation, then a certification period against live traffic before real spend.",
    scope: "openrtb::dooh",
    fields: [
      { key: "supplySourceId", label: "Supply source ID", required: true, placeholder: "Assigned by TTD on approval" },
      { key: "partnerId", label: "TTD partner ID", required: true, placeholder: "e.g. phub-retail" },
      { key: "apiToken", label: "API token", required: true, secret: true, hint: "For deal setup and reporting reconciliation." },
      { key: "region", label: "Region", required: true, type: "select", options: ["EMEA", "APAC", "North America"] },
    ],
    defaults: { region: "EMEA", currency: "GBP" },
  },
  ph_native: {
    label: "PH-native partner", sub: "Tier 2 — bilateral agreement", icon: "handshake", colour: "#9747ff", apiTier: 2,
    blurb: "A direct or local partner integrating against the PH-native API (REQUIREMENTS §6, tier 2). Everything tier 2 adds is strictly additive: switch it all off and the partner still works as a tier-1 buyer.",
    scope: "ph::v1",
    fields: [
      { key: "orgName", label: "Organisation", required: true, placeholder: "Blackmores" },
      { key: "apiKeyId", label: "API key ID", required: true, placeholder: "phk_…" },
      { key: "apiSecret", label: "API secret", required: true, secret: true },
      { key: "webhook", label: "Delivery webhook", required: false, placeholder: "https://…/ph/delivery" },
    ],
    defaults: { currency: "GBP" },
  },
};
export const ONBOARDING_ORDER = ["google_dsp", "amazon_dsp", "trade_desk"];

export const BIDDER_FIELDS = [
  { key: "bidderEndpoint", label: "Bidder endpoint", required: true, placeholder: "https://…/openrtb2/bid", hint: "Where we send the bid request." },
  { key: "seatIds", label: "Seat IDs", required: true, placeholder: "Comma separated", hint: "What the advertiser blocklist is matched against on the bid response." },
  { key: "qps", label: "QPS ceiling", required: false, placeholder: "e.g. 500" },
  { key: "timeoutMs", label: "Bid timeout (ms)", required: false, placeholder: "e.g. 300" },
];
export const AUCTION_TYPES = ["Open RTB", "Preferred deal", "Programmatic guaranteed"];
export const CURRENCIES = ["GBP", "EUR", "USD", "AUD"];
export const IAB_CATEGORIES = ["Food & Drink", "Health & Fitness", "Beauty", "Retail", "Family & Parenting", "Automotive", "Finance", "Travel"];

export const partner = (over = {}) => ({
  id: null, provider: null, name: "", status: "draft", system: false,
  creds: {}, bidder: { bidderEndpoint: "", seatIds: "", qps: "", timeoutMs: "" },
  floorCpm: null, currency: "GBP", auctionType: "Open RTB", categories: [], exclusions: [],
  seats: [],                                   // [{ id, name, approvalRequired }]
  listsLinked: true, allowList: [], blockList: [],
  targeting: { enabledAttributes: [] },        // registry keys this partner may target
  deals: [],                                   // [{ id, dealId, kind, cpm }]
  lastSync: null,
  ...over,
});

export const partnerById = (partners, id) => (partners || []).find((p) => p.id === id) || null;
export const connectedPartners = (partners) => (partners || []).filter((p) => p.status === "connected");
export const providerOf = (p) => (p && p.provider ? DSP_PROVIDERS[p.provider] : null);
export const partnerColour = (p) => (providerOf(p) ? providerOf(p).colour : "#7c3aed");
export const isDsp = (p) => !!(p && p.provider);
export const missingCreds = (provider, creds) => {
  const def = DSP_PROVIDERS[provider];
  if (!def) return [];
  return def.fields.filter((f) => f.required && (!f.when || f.when(creds || {})) && !String((creds || {})[f.key] || "").trim()).map((f) => f.label);
};

/* Lists: inherited from the company unless the partner has unlinked. */
export const effectiveLists = (p, company) => {
  if (!p || !isDsp(p) || p.listsLinked !== false) return { linked: true, allowList: company.allowList, blockList: company.blockList };
  return { linked: false, allowList: p.allowList || [], blockList: p.blockList || [] };
};
export const isBlocked = (name, eff) => !!name && (eff.blockList || []).some((x) => x.name.toLowerCase() === String(name).toLowerCase());

/* One line describing what a slot is assigned to. */
export const ownerAssignment = (sl, partners, company) => {
  if (sl.owner === "internal") return "By campaign priority";
  if (sl.owner === "retail") return sl.storeScope || "Store staff";
  const pid = sl.partnerId || ANY_PARTNER;
  if (pid === ANY_PARTNER) return "Any connected DSP · RTB";
  const p = partnerById(partners, pid);
  if (!p) return "Partner missing";
  const eff = effectiveLists(p, company);
  if (!sl.advertiser || sl.advertiser === RTB) return `${p.name} · RTB${eff.blockList.length ? ` (−${eff.blockList.length} blocked)` : ""}`;
  if (sl.advertiser === ALLOW_LIST) return `${p.name} · whitelist (${eff.allowList.length})`;
  return `${p.name} · ${sl.advertiser}`;
};

/* --------------------------------------------- targeting vocabulary */

/* The Live Visitor Profile attribute registry as Display Types consumes it
   (interface contract: four families). `visitor: true` attributes are off
   for every partner by default. `contributedBy` marks a partner-supplied
   attribute — namespaced and private to its owner. */
export const ATTRIBUTE_FAMILIES = {
  device: { label: "Device / display context", icon: "tv", hint: "Platform-supplied, one authoritative source." },
  interaction: { label: "Interaction / campaign", icon: "touch_app", hint: "Mostly PH-derived — Display Types' own output feeding back in." },
  visitor: { label: "Visitor / customer", icon: "person", hint: "The contested inbound envelope. Off for every partner by default." },
  env: { label: "Environmental / contextual", icon: "thermostat", hint: "The place and the moment, not the person." },
};
export const ATTRIBUTE_REGISTRY = [
  { key: "display.touch_point", family: "device", label: "Touch point", type: "enum", values: ["Digital Signage", "Kiosk", "Responsive Web", "Mobile Store Site"] },
  { key: "display.display_tags", family: "device", label: "Display tags", type: "set", values: ["entrance", "checkout", "aisle", "pharmacy", "window"] },
  { key: "display.mist_site_id", family: "device", label: "MIST site", type: "string" },
  { key: "interaction.active_campaign", family: "interaction", label: "Active campaign", type: "string" },
  { key: "interaction.matched_intent_campaign", family: "interaction", label: "Matched intent campaign", type: "string" },
  { key: "visitor.loyalty_tier", family: "visitor", label: "Loyalty tier", type: "enum", values: ["Bronze", "Silver", "Gold", "Platinum"], visitor: true },
  { key: "visitor.visitor_segments", family: "visitor", label: "Visitor segments", type: "set", values: ["new_parent", "fitness", "wellness", "value_seeker"], visitor: true },
  { key: "visitor.purchase_intent", family: "visitor", label: "Purchase intent", type: "enum", values: ["browse", "replenish", "gift"], visitor: true },
  { key: "visitor.age_band", family: "visitor", label: "Age band", type: "enum", values: ["18-24", "25-34", "35-44", "45-54", "55+"], visitor: true },
  { key: "env.temp_c", family: "env", label: "Temperature (°C)", type: "number", contributedBy: "p_ph_blackmores" },
  { key: "env.condition", family: "env", label: "Weather condition", type: "enum", values: ["sunny", "cloudy", "rain", "snow"], contributedBy: "p_ph_blackmores" },
  { key: "env.daypart", family: "env", label: "Daypart", type: "enum", values: ["morning", "midday", "afternoon", "evening"] },
  { key: "env.store_segments", family: "env", label: "Store segments", type: "set", values: ["metro", "regional", "airport", "24h"] },
  { key: "env.store_stock", family: "env", label: "Store stock (SKU availability)", type: "enum", values: ["in_stock", "low", "out_of_stock"], contributedBy: "p_ph_blackmores", promotion: "Products & Assets program" },
  { key: "env.store_hours_state", family: "env", label: "Store hours state", type: "enum", values: ["open", "closing_soon", "closed"] },
];
export const attrByKey = (k) => ATTRIBUTE_REGISTRY.find((a) => a.key === k) || null;
export const OPS = {
  number: [["gte", "≥"], ["gt", ">"], ["lte", "≤"], ["lt", "<"], ["eq", "="], ["neq", "≠"]],
  enum: [["eq", "is"], ["neq", "is not"], ["in", "is one of"]],
  set: [["contains", "contains"], ["not_contains", "does not contain"]],
  string: [["eq", "is"], ["neq", "is not"], ["exists", "is present"]],
};

/* What THIS partner may target: enabled non-visitor attributes plus any
   visitor attribute explicitly enabled, plus its own contributed ones.
   Permissioning shows up as a smaller vocabulary, never as a rejection. */
export const permittedVocabulary = (p) => ATTRIBUTE_REGISTRY.filter((a) => {
  if (a.contributedBy && a.contributedBy !== p.id && !(p.targeting?.enabledAttributes || []).includes(a.key)) return false;
  if (a.contributedBy === p.id) return true;
  return (p.targeting?.enabledAttributes || []).includes(a.key);
});

export const DEFAULT_EXCHANGE = {
  sellerOfRecord: "retailer",                 // retailer | ph  (open question 33)
  sellersJson: { sellerId: "ph-4471", name: "Personalisation Hub Demo Retail", domain: "personalisationhub.com", sellerType: "PUBLISHER", isConfidential: false, published: true },
  supplyChain: { asi: "personalisationhub.com", sid: "ph-4471", hp: 1 },
  openRtb: { version: "2.6", dooh: true, venueTaxonomy: "OpenOOH 1.2.0", impressionMultiplier: true },
  audienceCurrency: "sensor_where_available",  // sensor_where_available | modelled_only (open question 34)
  reportingFloorN: 50,                         // open question 30
  playWindowHours: 24,                         // open question 27
  preAuction: { floor: true, categories: true, blocklist: true, venueExclusions: true },
  venueExclusions: [],
};

