/* ------------------------------------------------------------------
   The sell side — partners / DSPs, advertiser lists, the targeting
   vocabulary a partner may use, and the exchange settings that make
   Personalisation Hub the SSP (REQUIREMENTS §6–§7). Reservations and
   campaign sets are spec only (§6) — not modelled here. Playback,
   targeting evaluation and campaign playback analytics are existing
   Personalisation Hub functionality and are not modelled here either.
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
    blurb: "Grant the service account access to the DV360 partner before the first sync.",
    scope: "https://www.googleapis.com/auth/display-video",
    fields: [
      { key: "partnerId", label: "Partner ID", required: true, placeholder: "123456", hint: "DV360 partner the inventory is sold under." },
      { key: "saEmail", label: "Service account email", required: true, placeholder: "ph-retail-media@project.iam.gserviceaccount.com" },
      { key: "saKey", label: "Private key (JSON)", required: true, secret: true, placeholder: "Paste the key file contents", multiline: true },
    ],
    defaults: { currency: "GBP" },
  },
  amazon_dsp: {
    label: "Amazon Ads DSP", sub: "Amazon Ads API", icon: "shopping_basket", colour: "#ff9900", apiTier: 1,
    blurb: "Login with Amazon supplies the credentials; the profile and entity IDs scope the account. Region is fixed once connected.",
    scope: "advertising::campaign_management",
    fields: [
      { key: "region", label: "Region", required: true, type: "select", options: ["North America (NA)", "Europe (EU)", "Far East (FE)"], hint: "Sets the API endpoint. Fixed once connected." },
      { key: "clientId", label: "LWA client ID", required: true, placeholder: "amzn1.application-oa2-client.…" },
      { key: "clientSecret", label: "LWA client secret", required: true, secret: true },
      { key: "refreshToken", label: "Refresh token", required: true, secret: true, placeholder: "Atzr|…" },
      { key: "profileId", label: "Profile ID", required: true, placeholder: "1234567890" },
      { key: "entityId", label: "Entity ID", required: true, placeholder: "ENTITY9Z8Y7X" },
    ],
    defaults: { region: "Europe (EU)", currency: "GBP" },
  },
  trade_desk: {
    label: "The Trade Desk", sub: "TTD supply integration", icon: "candlestick_chart", colour: "#1f7ae0", apiTier: 1,
    blurb: "Supply-source setup on TTD's side, sellers.json validation, then a certification period before real spend.",
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
    ],
    defaults: { currency: "GBP" },
  },
};
export const ONBOARDING_ORDER = ["google_dsp", "amazon_dsp", "trade_desk"];

export const BIDDER_FIELDS = [
  { key: "bidderEndpoint", label: "Bidder endpoint", required: true, placeholder: "https://…/openrtb2/bid", hint: "Where we send the bid request." },
  { key: "seatIds", label: "Seat IDs", required: true, placeholder: "Comma separated", hint: "What the advertiser blocklist is matched against on the bid response." },
];
export const AUCTION_TYPES = ["Open RTB", "Preferred deal", "Programmatic guaranteed"];
export const CURRENCIES = ["GBP", "EUR", "USD", "AUD"];
export const IAB_CATEGORIES = ["Food & Drink", "Health & Fitness", "Beauty", "Retail", "Family & Parenting", "Automotive", "Finance", "Travel"];

export const partner = (over = {}) => ({
  id: null, provider: null, name: "", status: "draft", system: false,
  creds: {}, bidder: { bidderEndpoint: "", seatIds: "" },   // QPS and timeout are platform defaults
  floorCpm: null, currency: "GBP", auctionType: "Open RTB", categories: [], exclusions: [],
  seats: [],                                   // [{ id, name }] — auto-approve and floor multiplier live on the company advertiser list
  mode: "test",                                // test | live — test during the DSP's certification period
  listsLinked: true, allowList: [], blockList: [],
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
  if (sl.owner === "internal") return "Based on priority";
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

/* --------------------------------------------- targeting variables */

/* The platform's existing campaign targeting object — the same data sources
   and variables as a campaign's Targeting tab. Default platform variables
   only, read-only in this release (managing them is a later release).
   Personalisation Variables are off for every DSP by default. */
export const TARGETING_SOURCES = {
  store: { label: "Localisation Variables", icon: "storefront" },
  visitor: { label: "Personalisation Variables", icon: "person", visitor: true },
};
export const TARGETING_VARIABLES = [
  { key: "store.hours", source: "store", label: "Store Open / Closed", values: "Open, Closed", tip: "Whether the store is open or closed at the time — e.g. Open, Closed" },
  { key: "store.fixed_segments", source: "store", label: "Fixed Store Segments", values: "Airport, Metro, Regional" },
  { key: "store.variable_segments", source: "store", label: "Variable Store Segments", values: "Cold Day, iPhone 17 – Out of Stock (switched on and off by store managers)" },
  { key: "store.display_tags", source: "store", label: "Display Tag(s)", values: "Entrance, Checkout, Food Court" },
  { key: "store.suburb", source: "store", label: "Suburb", values: "Surry Hills, Parramatta" },
  { key: "store.postcode", source: "store", label: "Postcode", values: "2000, 2150" },
  { key: "store.state", source: "store", label: "State", values: "NSW, VIC, QLD" },
  { key: "store.country", source: "store", label: "Country", values: "Australia, New Zealand" },
  { key: "store.languages", source: "store", label: "Languages Spoken by Store Staff", values: "English, Mandarin, Arabic" },
  { key: "store.reason_for_visit", source: "store", label: "Reason for Visit (Aggregate)", values: "Returns, New phone, Bill enquiry (share of the queue here for the same reason)" },
  { key: "store.cv_gender", source: "store", label: "Computer Vision Gender", values: "Female, Male", tip: "Detected by Vision/AI for the person in front of the display — e.g. Female, Male" },
  { key: "store.cv_age", source: "store", label: "Computer Vision Estimated Age", values: "18–24, 25–34, 35–44", tip: "Estimated by Vision/AI for the person in front of the display — e.g. 18–24, 25–34, 35–44" },
  { key: "visitor.age", source: "visitor", label: "Age", values: "18–24, 25–34, 35–44" },
  { key: "visitor.gender", source: "visitor", label: "Gender", values: "Female, Male" },
  { key: "visitor.purchase_intent", source: "visitor", label: "Purchase Intent", values: "Browse, Replenish, Gift" },
  { key: "visitor.visitor_segments", source: "visitor", label: "Visitor Segments", values: "New parent, Fitness, Value seeker" },
  { key: "visitor.device_type", source: "visitor", label: "Device Type", values: "iPhone, Pixel, Samsung", tip: "The visitor's device in store — e.g. iPhone, Pixel, Samsung" },
  { key: "visitor.product_holdings", source: "visitor", label: "Product Holdings", values: "Mobile plan, Home broadband" },
  { key: "visitor.product_type", source: "visitor", label: "Product Type", values: "Handset, Accessory" },
  { key: "visitor.plan_type", source: "visitor", label: "Plan Type", values: "Postpaid, Prepaid" },
  { key: "visitor.plan_value", source: "visitor", label: "Plan Value", values: "$45, $65 per month" },
  { key: "visitor.purchase_history", source: "visitor", label: "Purchase History", values: "Bought in the last 30 days" },
  { key: "visitor.events", source: "visitor", label: "Events", values: "Scanned QR code, Viewed product page, Added to cart", tip: "Events in store or from a previous web session — e.g. Scanned QR code, Viewed product page, Added to cart" },
  { key: "visitor.skus", source: "visitor", label: "SKUs", values: "SKU-10234, SKU-55871", tip: "SKUs the visitor has looked at before; target by listing SKUs — e.g. SKU-10234, SKU-55871" },
];
/* Which DSPs may target each variable, held once for the company:
   "all" = every connected DSP (including ones added later), or an explicit
   list of partner ids ([] = none). Defaults: Localisation Variables to all
   connected DSPs; Personalisation Variables to none. */
export const ALL_DSPS = "all";
export const defaultVariableAccess = (v) => (v.source === "visitor" ? [] : ALL_DSPS);
export const variableAccess = (company, key) => {
  const v = TARGETING_VARIABLES.find((x) => x.key === key);
  const set = (company.variableAccess || {})[key];
  return set === undefined ? (v ? defaultVariableAccess(v) : []) : set;
};
export const DEFAULT_ENABLED_VARIABLES = TARGETING_VARIABLES.filter((v) => defaultVariableAccess(v) === ALL_DSPS).map((v) => v.key);

/* What THIS partner may target — a smaller vocabulary, never a rejection. */
export const permittedVocabulary = (p, company) => TARGETING_VARIABLES.filter((v) => {
  const a = variableAccess(company, v.key);
  return a === ALL_DSPS ? p.status === "connected" : a.includes(p.id);
});

/* Per-advertiser settings held once for the company: auto-approve and the
   base floor multiplier (default 1.0 — e.g. 0.8 preferred, 1.2 new). */
export const advertiserSetting = (company, name) => ({ approvalRequired: true, floorMultiplier: 1, ...((company.advertiserSettings || {})[String(name || "").toLowerCase()] || {}) });

/* Exchange settings belong to the CLIENT running this instance. Personalisation
   Hub runs inside the client's own VPC; the client owns the screens, is the
   seller of record, and is the exchange DSPs bid into. Nothing here is
   Personalisation Hub's own identity. */
export const DEFAULT_EXCHANGE = {
  client: { name: "", domain: "", contactEmail: "" },              // filled in by the client
  sellersJson: { sellerId: "", sellerType: "PUBLISHER", isConfidential: false, published: false },
  supplyChain: { hp: 1 },                                          // asi = client domain, sid = seller ID
  openRtb: { version: "2.6", dooh: true, venueTaxonomy: "OpenOOH 1.2.0", impressionMultiplier: true },
  audienceCurrency: "sensor_where_available",                      // sensor_where_available | modelled_only (open question 34)
  reportingFloorN: 50,                                             // open question 30
  playWindowHours: 24,                                             // open question 27
  preAuction: { floor: true, categories: true, blocklist: true, venueExclusions: true },
  venueExclusions: [],
};
