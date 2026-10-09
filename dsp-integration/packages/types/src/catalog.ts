/* Shared, fixed catalogues used by both the API and the admin UI.
   Shapes follow the prototype's model (prototype-reference/src/model/
   schema.js and sellside.js); keys follow the API contract. */
import type { Provider, SlotOwner } from './index'

/* ------------------------------------------------------ display types */

export const UNLIMITED = -1

/* Decision 1 (Digital Signage and Kiosk only) widened 28 Sep 2026 (ticket):
   Website and Mobile App added — HQ-only touch points with no physical
   venue, see NO_ADVERTISING_TOUCH_POINTS/NO_STRUCTURE_TOUCH_POINTS below. */
export const TOUCH_POINTS = [
  { name: 'Digital Signage', icon: 'tv' },
  { name: 'Kiosk', icon: 'storefront' },
  { name: 'Website', icon: 'language' },
  { name: 'Mobile App', icon: 'smartphone' },
] as const
export type TouchPoint = (typeof TOUCH_POINTS)[number]['name']
export const touchPointIcon = (name: string) => (TOUCH_POINTS.find((t) => t.name === name) ?? TOUCH_POINTS[0]).icon

/* Website and Mobile App slots are set up exactly like Digital Signage (ticket
   0jviesctpWGyOYtK20tg, decision Rob 7 Oct 2026): the same slot editor, owner
   list, max slot rotation, Advertiser assignment, reserve, billing unit and
   campaign cap. This supersedes the 28 Sep "HQ-only" rule and the 7 Oct
   "RTB-only" switch (HAmTUHQVj63NDiY4hLk8), so no touch point is excluded
   from advertising any more. The lists are kept (empty) so a touch point can
   be excluded again in one place. What stays different for them is the bid
   request, below. */
export const NO_ADVERTISING_TOUCH_POINTS: readonly TouchPoint[] = []
export const allowsAdvertising = (touchPoint: string): boolean => !(NO_ADVERTISING_TOUCH_POINTS as readonly string[]).includes(touchPoint)
export const RTB_ONLY_TOUCH_POINTS: readonly TouchPoint[] = []
export const isRtbOnly = (touchPoint: string | undefined): boolean => touchPoint !== undefined && (RTB_ONLY_TOUCH_POINTS as readonly string[]).includes(touchPoint)
/* Website and Mobile App are web/app programmatic inventory: their bid request
   carries the OpenRTB `site` (Website) or `app` (Mobile App) object, never
   `dooh`, and no impression multiplier (one render, one impression). */
/* Which OpenRTB inventory object a touch point's bid request carries. */
export const openRtbInventoryOf = (touchPoint: string): 'dooh' | 'site' | 'app' => (touchPoint === 'Website' ? 'site' : touchPoint === 'Mobile App' ? 'app' : 'dooh')

/* Same two touch points also have no physical display to lay out or sense
   proximity around: Multi-Zone Layout and every Enabled Feature but QR
   Control (In-Store Radio, MIST, AI Agent, Vision/AI) are hidden for them,
   "unless confirmed otherwise" (ticket, 28 Sep 2026). Tracked separately
   from NO_ADVERTISING_TOUCH_POINTS — they happen to be the same two touch
   points today, but the reasons are different and needn't always coincide. */
export const NO_STRUCTURE_TOUCH_POINTS: readonly TouchPoint[] = ['Website', 'Mobile App']
export const hasStructuralFeatures = (touchPoint: string): boolean => !(NO_STRUCTURE_TOUCH_POINTS as readonly string[]).includes(touchPoint)

/* Platform (company-level) defaults an inherited `null` resolves to. */
export const PLATFORM_DEFAULTS = {
  playlistSettings: {
    assetPosition: 'Top-Left',
    assetFill: 'Fit to Display',
    maximumCampaignsPlayedInRotation: UNLIMITED,
    campaignTransition: 'None',
    campaignAutoRotation: 'Auto-Rotate On',
    campaignAutoPlay: 'Auto-Play On',
  },
  phantomAreaPosition: 'Bottom Right',
} as const

/* Every auto-created playlist — a new display type's, one added with "Add
   new playlist", a zone's, a layout's — starts with no setting overridden
   (`{}`), so it reads "Default settings" and inherits
   PLATFORM_DEFAULTS.playlistSettings. One set of new-playlist defaults
   (Rob, 1 Oct 2026, A0GyTNsA; built 3gGKowhK): this replaced the 27 Sep
   "Auto-Rotate Off / Auto-Play Off" set for added playlists and the 28 Sep
   copy-the-current-playlist behaviour. */

export const SLOT_OWNERS: Record<SlotOwner, { label: string; colour: string; bg: string; icon: string }> = {
  internal: { label: 'Headquarters', colour: '#169bc2', bg: 'rgba(22,155,194,0.10)', icon: 'corporate_fare' },
  advertiser: { label: 'Advertiser', colour: '#7c3aed', bg: 'rgba(124,58,237,0.10)', icon: 'sell' },
  retail: { label: 'Stores', colour: '#faad14', bg: 'rgba(250,173,20,0.14)', icon: 'storefront' },
}
export const STORE_SCOPES = ['Store staff', 'Store manager only', 'Regional manager', 'Franchisee'] as const

/* Who may buy a position (Rob, 20 Sep; buyers lists/private auctions added
   23 Sep). One multi-select on Advertisers / Inventory replaced the display
   type's "Assigned to" cell: DSPs say who may bid, advertisers hold the
   position for them, a buyers list restricts it to a private auction among
   its invited buyers, and none of these means any connected DSP. A buyers
   list is mutually exclusive with advertisers and whitelistOnly. Slots saved
   before this carried one partnerId and one advertiser, so they are read as
   one-element lists. */
export interface Assigned {
  partnerIds: string[]; advertisers: string[]; whitelistOnly: boolean
  /* The top tier of the waterfall (the first of buyersListIds), kept for readers that only know one list. */
  buyersListId: string | null
  /* Prioritised buyers lists (Rob, 7 Oct 2026; Broadsign model): priority is
     a property of this slot's assignment, not of the list. Highest first,
     one list per tier; the exchange tries the first and falls through only
     when it yields no winning bid at its floor. */
  buyersListIds: string[]
  /* An explicit Open auction tier below the deals (Rob, 9 Oct 2026): deals resolve ahead of time, and a window no deal
     wins falls through to the open auction, which runs across partnerIds (none = All DSPs). Never set with named
     advertisers or the whitelist. A slot with no deal is open by default; this only records the explicit choice. */
  openAuction: boolean
}
type SlotLike = {
  partnerIds?: readonly string[] | null
  advertisers?: readonly string[] | null
  listMode?: string | null
  partnerId?: string | null
  advertiser?: string | null
  buyersListId?: string | null
  buyersListIds?: readonly string[] | null
  openAuction?: boolean | null
}
export const assignedOf = (slot: SlotLike): Assigned => {
  const advertisers = [...(slot.advertisers ?? (slot.advertiser ? [slot.advertiser] : []))]
  /* Slots saved before the waterfall carry one buyersListId: a one-tier waterfall. */
  const saved = slot.buyersListIds?.length ? slot.buyersListIds : slot.buyersListId ? [slot.buyersListId] : []
  const buyersListIds = !advertisers.length && slot.listMode === 'deal' ? [...new Set(saved)] : []
  return {
    partnerIds: [...(slot.partnerIds ?? (slot.partnerId ? [slot.partnerId] : []))],
    advertisers,
    whitelistOnly: !advertisers.length && slot.listMode === 'whitelist_only',
    buyersListId: buyersListIds[0] ?? null,
    buyersListIds,
    openAuction: !advertisers.length && slot.listMode !== 'whitelist_only' && slot.openAuction === true,
  }
}
/* "Any connected DSP", or the pills in order: advertisers, buyers list, then DSPs. */
export const ALL_DSPS_LABEL = 'All DSPs'
export const assignedLabels = (a: { advertisers: readonly string[]; partnerNames?: readonly string[]; whitelistOnly?: boolean; buyersListName?: string | null; buyersListNames?: readonly string[]; openAuction?: boolean; partnerIds?: readonly string[] }): string[] =>
  [...a.advertisers, ...(a.whitelistOnly ? ['Whitelist only'] : []), ...(a.buyersListNames?.length ? a.buyersListNames.map((n, i) => `Buyers list${a.buyersListNames!.length > 1 ? ` ${i + 1}` : ''}: ${n}`) : a.buyersListName ? [`Buyers list: ${a.buyersListName}`] : []), ...(a.partnerNames ?? []), ...(a.openAuction && !a.partnerIds?.length ? [ALL_DSPS_LABEL] : [])]

/* Reserve price inheritance (Rob, 22 Sep; spec §1 configuration
   inheritance): a display type carries its own reserve price default, and
   a slot's own reservePrice overrides it whenever it is set — null always
   means inherit, never "explicitly no reserve" while a default exists. */
export const reservePriceOf = (dt: { phExtensions?: { reservePrice?: number | null } | null }, slot: { reservePrice?: number | null }): number | null =>
  slot.reservePrice ?? dt.phExtensions?.reservePrice ?? null

/* Interactive reserve price (ticket 5eLDRBqEGhNyJSHSIFFG, 4 Oct 2026): a
   slot may carry its own reserve price for interactive campaigns, so an
   interactive experience can be priced apart from the ordinary slot. null
   means interactive campaigns follow reservePriceOf. Slot-level only — a
   display type has no interactive default. */
export const interactiveReservePriceOf = (dt: { phExtensions?: { reservePrice?: number | null } | null }, slot: { reservePrice?: number | null; interactiveReservePrice?: number | null }): number | null =>
  slot.interactiveReservePrice ?? reservePriceOf(dt, slot)

/* Billing-unit inheritance (spec "Private auctions: two-period model", 23
   Sep 2026): the granularity a CPM is quoted and charged against — same
   override-always-wins inheritance as reservePriceOf, but always resolves
   to a real number — unlike a reserve price, there is no "no billing unit"
   state. Since OQ27 (Rob, 29 Sep 2026) it is also the slot's play-window
   length — the source of truth for how it is booked and billed. The chain
   is slot, then display type, then PLATFORM_DEFAULT_BILLING_UNIT_HOURS.
   There is no company-wide play window any more (Rob, 8 Oct 2026): the
   platform default is a named constant of its own, not a setting, and is
   only the last resort. Plays per window is NOT derived from it as a flat
   24-hour figure: it is max play length x slot count over the billing unit
   (plays.ts). */
export const PLATFORM_DEFAULT_BILLING_UNIT_HOURS = 24
export const billingUnitHoursOf = (dt: { phExtensions?: { billingUnitHours?: number | null } | null }, slot: { billingUnitHours?: number | null }): number =>
  slot.billingUnitHours ?? dt.phExtensions?.billingUnitHours ?? PLATFORM_DEFAULT_BILLING_UNIT_HOURS

/* Max campaigns (ticket "Available Inventory: Max campaigns column + slot
   playlist statement"): the single authority on how many campaigns
   (the mandatory default layer plus optional targeted versions) an
   advertiser may submit for a slot — replacing the former blanket
   20-targeted-versions submission cap for that slot. Purely a submission
   cap: it does not feed the auction or billing. Same override-always-wins
   inheritance as reservePriceOf/billingUnitHoursOf, but always resolves to
   a real integer (the platform default of 5 when neither the slot nor its
   display type sets one) — like billing unit, there is no "unlimited"
   state, and it is bounded 1-10 inclusive whenever a real value is set. */
export const DEFAULT_MAX_CAMPAIGNS = 5
export const MIN_MAX_CAMPAIGNS = 1
export const MAX_MAX_CAMPAIGNS = 10
/* Per-display-type floor (CPM, USD): null/absent inherits the central floor at
   read time. Never a copy of the central value, so a later change to the
   central floor reaches every inheriting type, and "inherit" stays distinct
   from "set to the same number". */
export const displayTypeFloorCpmOf = (dt: { phExtensions?: { floorCpm?: number | null } | null }): number | null => {
  const v = dt.phExtensions?.floorCpm
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}
export const maxCampaignsOf = (dt: { phExtensions?: { maxCampaigns?: number | null } | null }, slot: { maxCampaigns?: number | null }): number =>
  slot.maxCampaigns ?? dt.phExtensions?.maxCampaigns ?? DEFAULT_MAX_CAMPAIGNS

/* Max play length (ticket "Max play length as an inherited slot setting",
   7 Oct 2026): the FIXED duration of one play of a slot, in seconds. It is
   what a window's plays are counted against — playsPerWindow = floor(window /
   max play length) — never the loop length and never an advertiser's creative
   length (pDOOH practice: Broadsign builds the loop from a fixed slot length in
   loop policy). It is also the longest creative the slot accepts: longer is
   rejected at upload, never truncated. Same override-always-wins inheritance as
   reservePriceOf/billingUnitHoursOf: slot, else display type, else the
   company-wide default (Advertiser settings → maxPlayLengthSec, whose own
   platform default is 15 s). Whole seconds, 1-600 inclusive. */
export const DEFAULT_MAX_PLAY_LENGTH_SEC = 15
export const MIN_MAX_PLAY_LENGTH_SEC = 1
export const MAX_MAX_PLAY_LENGTH_SEC = 600
export const maxPlayLengthSecOf = (dt: { phExtensions?: { maxPlayLengthSec?: number | null } | null }, slot: { maxPlayLengthSec?: number | null }, inherited: number = DEFAULT_MAX_PLAY_LENGTH_SEC): number =>
  slot.maxPlayLengthSec ?? dt.phExtensions?.maxPlayLengthSec ?? inherited

/* The kinds of campaign (pricing types) the exchange knows. A slot does NOT
   carry a targeting capability (Rob, 7 Oct 2026): which targeting dimensions
   a deal may use is defined on the buyers and targeting list assigned to the
   slot, never as a property of the slot itself. */
export type TargetingMode = 'localised' | 'personalised' | 'interactive'
/* Interactive campaigns are out of scope for this release (Rob, 5 Oct 2026):
   one flag hides them everywhere — the
   interactive prices on GET /v1/inventory, the interactive pricingType on
   campaigns — and the code stays so they can return behind it. */
export const INTERACTIVE_ENABLED = false
const ALL_TARGETING_MODES: { key: TargetingMode; label: string; tip: string }[] = [
  { key: 'localised', label: 'Localised', tip: 'Store-level targeting only: the campaign varies by store, not by who is in front of the screen.' },
  { key: 'personalised', label: 'Personalised', tip: 'The campaign may use Personalisation Variables about the visitor. Personalised versions play in a window held by a reserve booking or sold as a deal (private auction, preferred or guaranteed), never in the open real-time auction.' },
  { key: 'interactive', label: 'Interactive', tip: 'The campaign may respond to the visitor on screen. Pays the interactive cost per engagement on top of the CPM.' },
]
export const TARGETING_MODES = ALL_TARGETING_MODES.filter((m) => INTERACTIVE_ENABLED || m.key !== 'interactive')
/* The reserve price tooltip (Rob, 5 Oct 2026), shared by the Available
   Inventory column and the display type's reserve price field. */
export const RESERVE_PRICE_TIP = 'The premium CPM an advertiser commits to up front to hold this slot for a window, out of the open auction. Reserved and deal-held slots play personalised versions (the open real-time auction never does): once committed, the advertiser submits the personalised variations their creative needs alongside the default.'
/* Personalised versions are sold through reserve bookings (Rob, 5 Oct 2026)
   and, since 8 Oct 2026, on deals too (never the open real-time auction).
   This reports only the reserve-price route; a deal-held slot is also
   eligible (enforcement.checkTargeting). */
export const personalisedAllowedOn = (dt: { phExtensions?: { reservePrice?: number | null } | null }, slot: { reservePrice?: number | null }): boolean =>
  reservePriceOf(dt, slot) !== null
export const targetingLabel = (modes: readonly string[]) =>
  TARGETING_MODES.filter((m) => modes.includes(m.key)).map((m) => m.label).join(', ')

/* ---------------------------------------------------------------- DSPs */

export interface CredentialField {
  key: string
  label: string
  secret?: boolean
  placeholder?: string
  hint?: string
  options?: readonly string[]
  multiline?: boolean
  /* The DSP fixes this value once connected: a change is refused until it is
     disconnected (Amazon Ads: region). */
  fixedOnceConnected?: boolean
  /* Not needed to connect: left empty it is not reported as a missing
     credential (the seller-side token, ticket lWSdh3qqsg1rOsfSFE5d). */
  optional?: boolean
}
export interface ProviderDef {
  key: Provider
  label: string
  sub: string
  icon: string
  colour: string
  blurb: string
  fields: CredentialField[]
}

/* The seller-side credential every DSP gets (ticket lWSdh3qqsg1rOsfSFE5d, Rob
   4 Oct 2026). The fields above authenticate PH as a buyer-side API user;
   none of them authenticates PH as a seller/exchange, which is what lets a
   DSP's seats and advertisers sync into the per-DSP whitelist/blacklist
   pickers. Stored write-only like the other secrets. Bid-time allow/block
   does not use it: it matches the seat on the bid response itself. */
const SELLER_TOKEN: CredentialField = {
  key: 'sellerAuthToken', label: 'Seller auth token', secret: true, optional: true,
  hint: 'Authenticates PH to this DSP as a seller / exchange, for syncing its seats and advertisers into the whitelist and blacklist.',
}

/* Onboarding order: DV360, then Amazon Ads DSP, then The Trade Desk (spec §7). */
export const PROVIDERS: ProviderDef[] = [
  {
    key: 'google_dv360', label: 'Google DSP', sub: 'Display & Video 360', icon: 'ads_click', colour: '#4285f4',
    blurb: 'Grant the service account access to the DV360 partner before the first sync.',
    fields: [
      { key: 'partnerId', label: 'Partner ID', placeholder: '123456', hint: 'DV360 partner the inventory is sold under.' },
      { key: 'serviceAccountEmail', label: 'Service account email', placeholder: 'ph-retail-media@project.iam.gserviceaccount.com' },
      { key: 'privateKeyJson', label: 'Private key (JSON)', secret: true, placeholder: 'Paste the key file contents', multiline: true },
      SELLER_TOKEN,
    ],
  },
  {
    key: 'amazon_dsp', label: 'Amazon Ads DSP', sub: 'Amazon Ads API', icon: 'shopping_basket', colour: '#ff9900',
    blurb: 'Login with Amazon supplies the credentials; the profile and entity IDs scope the account. Region is fixed once connected.',
    fields: [
      { key: 'region', label: 'Region', options: ['North America (NA)', 'Europe (EU)', 'Far East (FE)'], hint: 'Sets the API endpoint. Fixed once connected.', fixedOnceConnected: true },
      { key: 'lwaClientId', label: 'LWA client ID', placeholder: 'amzn1.application-oa2-client.…' },
      { key: 'lwaClientSecret', label: 'LWA client secret', secret: true },
      { key: 'refreshToken', label: 'Refresh token', secret: true, placeholder: 'Atzr|…' },
      { key: 'profileId', label: 'Profile ID', placeholder: '1234567890' },
      { key: 'entityId', label: 'Entity ID', placeholder: 'ENTITY9Z8Y7X' },
      SELLER_TOKEN,
    ],
  },
  {
    key: 'the_trade_desk', label: 'The Trade Desk', sub: 'TTD supply integration', icon: 'candlestick_chart', colour: '#1f7ae0',
    blurb: "Supply-source setup on TTD's side, sellers.json validation, then a certification period before real spend.",
    fields: [
      { key: 'supplySourceId', label: 'Supply source ID', placeholder: 'Assigned by TTD on approval' },
      { key: 'ttdPartnerId', label: 'TTD partner ID', placeholder: 'e.g. phub-retail' },
      { key: 'apiToken', label: 'API token', secret: true, hint: 'For deal setup and reporting reconciliation.' },
      { key: 'region', label: 'Region', options: ['EMEA', 'APAC', 'North America'] },
      SELLER_TOKEN,
    ],
  },
]
export const providerDef = (key: string) => PROVIDERS.find((p) => p.key === key)
export const secretFields = (provider: string) => (providerDef(provider)?.fields ?? []).filter((f) => f.secret).map((f) => f.key)

/* IAB categories: the full Content Taxonomy 1.0 lives in ./iabTaxonomy. */

/* ------------------------------------------------ targeting variables */

export type VariableGroup = 'localisation' | 'personalisation'
/* The platform's own operator keys (Targeting tab, campaign-targetings
   /categories/{category}/operators), lower-cased: INCLUDE → include. */
export type Operator =
  | 'include' | 'match_exactly' | 'exclude_or' | 'exclude_and'
  | 'equal' | 'not_equal' | 'greater_than' | 'less_than' | 'greater_than_or_equal' | 'less_than_or_equal'
export const OPERATOR_LABELS: Record<Operator, string> = {
  include: 'includes selected', match_exactly: 'matches exactly', exclude_or: 'excludes selected [OR]', exclude_and: 'excludes selected [AND]',
  equal: 'equal', not_equal: 'not equal', greater_than: 'greater than', less_than: 'less than',
  greater_than_or_equal: 'greater than or equal', less_than_or_equal: 'less than or equal',
}
export interface TargetingVariableDef {
  key: string
  source: 'store' | 'visitor'
  group: VariableGroup
  label: string
  values: string
  tip?: string
  operators: Operator[]
}
/* Operators per variable, matched to the platform's Targeting tab (BUILD-PLAN
   Q4, read from demo.personalisationhub.com). The platform has four sets. */
const LIST: Operator[] = ['include', 'match_exactly', 'exclude_or', 'exclude_and']
const COMPARE: Operator[] = ['equal', 'not_equal', 'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal']
const COMPARE_EXACT: Operator[] = [...COMPARE, 'match_exactly']
const ONE: Operator[] = ['equal', 'not_equal']
const loc = (key: string, label: string, values: string, operators: Operator[], tip?: string): TargetingVariableDef => ({ key, source: 'store', group: 'localisation', label, values, tip, operators })
/* Personalisation variables are mostly visitor data; the aggregates and the
   Computer Vision ones are store data, in the same group (Rob, 20 Sep). */
const per = (key: string, label: string, values: string, operators: Operator[], tip?: string, source: 'store' | 'visitor' = 'visitor'): TargetingVariableDef => ({ key, source, group: 'personalisation', label, values, tip, operators })

/* The platform's default variables, in display order (spec §6). */
export const TARGETING_VARIABLES: TargetingVariableDef[] = [
  loc('store.hours', 'Store Open / Closed', 'Open, Closed', ONE, 'Whether the store is open or closed at the time — e.g. Open, Closed'),
  loc('store.fixed_segments', 'Fixed Store Segments', 'Airport, Metro, Regional', LIST),
  loc('store.variable_segments', 'Variable Store Segments', 'Cold Day, iPhone 17 – Out of Stock (switched on and off by store managers)', LIST),
  loc('store.display_tags', 'Display Tag(s)', 'Entrance, Checkout, Food Court', LIST),
  loc('store.suburb', 'Suburb', 'Surry Hills, Parramatta', LIST),
  loc('store.postcode', 'Postcode', '2000, 2150', LIST),
  loc('store.state', 'State', 'NSW, VIC, QLD', LIST),
  loc('store.country', 'Country', 'Australia, New Zealand', LIST),
  /* Languages Spoken by Store Staff was removed from the default set — not
     supported initially, revisit in a later release (ticket, 22 Sep). */
  /* Computer Vision first, then the aggregates, then Purchase Intent, Purchase History, SKUs and Events, then the rest (Rob, 20 Sep; 8 Oct 2026).
     Both are personalisation, so both default to no DSP (Q49 revisited). */
  per('store.cv_gender', 'Gender (Computer Vision)', 'Female, Male', COMPARE_EXACT, 'Read by Vision/AI running at the edge, for the person in front of the display — e.g. Female, Male. Nothing leaves the store.', 'store'),
  per('store.cv_age', 'Estimated Age (Computer Vision)', '18–24, 25–34, 35–44', COMPARE, 'Estimated by Vision/AI running at the edge, for the person in front of the display — e.g. 18–24, 25–34, 35–44. Nothing leaves the store.', 'store'),
  per('store.reason_for_visit', 'Reason for Visit (Aggregate)', 'Returns, New phone, Bill enquiry (share of the queue here for the same reason)', COMPARE, 'Everyone in the queue here right now, not one visitor: the share waiting for the same reason — e.g. Returns, New phone, Bill enquiry', 'store'),
  per('store.device_type_aggregate', 'Device Type (Aggregate)', 'iPhone, Pixel, Samsung', COMPARE, 'Everyone in the store right now, not one visitor: the share carrying each device — e.g. iPhone, Pixel, Samsung', 'store'),
  per('visitor.purchase_intent', 'Purchase Intent', 'Browse, Replenish, Gift', LIST),
  per('visitor.purchase_history', 'Purchase History', 'Bought in the last 30 days', LIST),
  per('visitor.skus', 'SKUs', 'SKU-10234, SKU-55871', LIST, 'SKUs the visitor has looked at before; target by listing SKUs — e.g. SKU-10234, SKU-55871'),
  per('visitor.events', 'Events', 'Scanned QR code, Viewed product page, Added to cart', LIST, 'Events in store or from a previous web session — e.g. Scanned QR code, Viewed product page, Added to cart'),
  per('visitor.age', 'Age', '18–24, 25–34, 35–44', COMPARE, 'The identified visitor’s age, from the systems that hold the customer record (CRM, CDP or loyalty) — e.g. 18–24, 25–34, 35–44'),
  per('visitor.gender', 'Gender', 'Female, Male', ONE, 'The identified visitor’s gender, from the systems that hold the customer record (CRM, CDP or loyalty) — e.g. Female, Male'),
  per('visitor.visitor_segments', 'Visitor Segments', 'New parent, Fitness, Value seeker', LIST),
  per('visitor.reason_for_visit', 'Reason for Visit', 'Returns, New phone, Bill enquiry', LIST, 'Why the visitor in front of the screen is here, for that one person — e.g. Returns, New phone, Bill enquiry. The aggregate version above is the whole queue.'),
  per('visitor.device_type', 'Device Type', 'iPhone, Pixel, Samsung', LIST, 'The device the visitor in front of the screen is carrying — e.g. iPhone, Pixel, Samsung'),
  per('visitor.product_holdings', 'Product Holdings', 'Mobile plan, Home broadband', LIST),
  per('visitor.product_type', 'Product Type', 'Handset, Accessory', LIST),
  per('visitor.plan_type', 'Plan Type', 'Postpaid, Prepaid', LIST),
  per('visitor.plan_value', 'Plan Value', '$45, $65 per month', LIST),
]
export const ALL_DSPS = 'all' as const
/* Defaults (spec §6): Localisation → all connected DSPs; Personalisation → none. */
export const defaultVariableAccess = (v: TargetingVariableDef): 'all' | string[] => (v.group === 'personalisation' ? [] : ALL_DSPS)

/* ---------------------------------------------------------- advertisers */

/* Stable advertiser id: a slug of the seat name, shared across DSPs
   (decision 6), e.g. "L'Oréal" → "loreal". */
export const advertiserSlug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
