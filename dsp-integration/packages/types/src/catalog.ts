/* Shared, fixed catalogues used by both the API and the admin UI.
   Shapes follow the prototype's model (prototype-reference/src/model/
   schema.js and sellside.js); keys follow the API contract. */
import type { Provider, SlotOwner } from './index'

/* ------------------------------------------------------ display types */

export const UNLIMITED = -1

/* Decision 1: Digital Signage and Kiosk only. */
export const TOUCH_POINTS = [
  { name: 'Digital Signage', icon: 'tv' },
  { name: 'Kiosk', icon: 'storefront' },
] as const
export type TouchPoint = (typeof TOUCH_POINTS)[number]['name']
export const touchPointIcon = (name: string) => (TOUCH_POINTS.find((t) => t.name === name) ?? TOUCH_POINTS[0]).icon

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

export const SLOT_OWNERS: Record<SlotOwner, { label: string; colour: string; bg: string; icon: string }> = {
  internal: { label: 'Headquarters', colour: '#169bc2', bg: 'rgba(22,155,194,0.10)', icon: 'corporate_fare' },
  advertiser: { label: 'Advertiser', colour: '#7c3aed', bg: 'rgba(124,58,237,0.10)', icon: 'sell' },
  retail: { label: 'Stores', colour: '#faad14', bg: 'rgba(250,173,20,0.14)', icon: 'storefront' },
}
export const STORE_SCOPES = ['Store staff', 'Store manager only', 'Regional manager', 'Franchisee'] as const

/* ---------------------------------------------------------------- DSPs */

export interface CredentialField {
  key: string
  label: string
  secret?: boolean
  placeholder?: string
  hint?: string
  options?: readonly string[]
  multiline?: boolean
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

/* Onboarding order: DV360, then Amazon Ads DSP, then The Trade Desk (spec §7). */
export const PROVIDERS: ProviderDef[] = [
  {
    key: 'google_dv360', label: 'Google DSP', sub: 'Display & Video 360', icon: 'ads_click', colour: '#4285f4',
    blurb: 'Grant the service account access to the DV360 partner before the first sync.',
    fields: [
      { key: 'partnerId', label: 'Partner ID', placeholder: '123456', hint: 'DV360 partner the inventory is sold under.' },
      { key: 'serviceAccountEmail', label: 'Service account email', placeholder: 'ph-retail-media@project.iam.gserviceaccount.com' },
      { key: 'privateKeyJson', label: 'Private key (JSON)', secret: true, placeholder: 'Paste the key file contents', multiline: true },
    ],
  },
  {
    key: 'amazon_dsp', label: 'Amazon Ads DSP', sub: 'Amazon Ads API', icon: 'shopping_basket', colour: '#ff9900',
    blurb: 'Login with Amazon supplies the credentials; the profile and entity IDs scope the account. Region is fixed once connected.',
    fields: [
      { key: 'region', label: 'Region', options: ['North America (NA)', 'Europe (EU)', 'Far East (FE)'], hint: 'Sets the API endpoint. Fixed once connected.' },
      { key: 'lwaClientId', label: 'LWA client ID', placeholder: 'amzn1.application-oa2-client.…' },
      { key: 'lwaClientSecret', label: 'LWA client secret', secret: true },
      { key: 'refreshToken', label: 'Refresh token', secret: true, placeholder: 'Atzr|…' },
      { key: 'profileId', label: 'Profile ID', placeholder: '1234567890' },
      { key: 'entityId', label: 'Entity ID', placeholder: 'ENTITY9Z8Y7X' },
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
    ],
  },
]
export const providerDef = (key: string) => PROVIDERS.find((p) => p.key === key)
export const secretFields = (provider: string) => (providerDef(provider)?.fields ?? []).filter((f) => f.secret).map((f) => f.key)

export const IAB_CATEGORIES = ['Food & Drink', 'Health & Fitness', 'Beauty', 'Retail', 'Family & Parenting', 'Automotive', 'Finance', 'Travel'] as const

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
const per = (key: string, label: string, values: string, operators: Operator[], tip?: string): TargetingVariableDef => ({ key, source: 'visitor', group: 'personalisation', label, values, tip, operators })

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
  loc('store.languages', 'Languages Spoken by Store Staff', 'English, Mandarin, Arabic', LIST),
  loc('store.reason_for_visit', 'Reason for Visit (Aggregate)', 'Returns, New phone, Bill enquiry (share of the queue here for the same reason)', COMPARE),
  loc('store.cv_gender', 'Computer Vision Gender', 'Female, Male', COMPARE_EXACT, 'Detected by Vision/AI for the person in front of the display — e.g. Female, Male'),
  loc('store.cv_age', 'Computer Vision Estimated Age', '18–24, 25–34, 35–44', COMPARE, 'Estimated by Vision/AI for the person in front of the display — e.g. 18–24, 25–34, 35–44'),
  per('visitor.age', 'Age', '18–24, 25–34, 35–44', COMPARE),
  per('visitor.gender', 'Gender', 'Female, Male', ONE),
  per('visitor.purchase_intent', 'Purchase Intent', 'Browse, Replenish, Gift', LIST),
  per('visitor.visitor_segments', 'Visitor Segments', 'New parent, Fitness, Value seeker', LIST),
  per('visitor.device_type', 'Device Type', 'iPhone, Pixel, Samsung', LIST, "The visitor's device in store — e.g. iPhone, Pixel, Samsung"),
  per('visitor.product_holdings', 'Product Holdings', 'Mobile plan, Home broadband', LIST),
  per('visitor.product_type', 'Product Type', 'Handset, Accessory', LIST),
  per('visitor.plan_type', 'Plan Type', 'Postpaid, Prepaid', LIST),
  per('visitor.plan_value', 'Plan Value', '$45, $65 per month', LIST),
  per('visitor.purchase_history', 'Purchase History', 'Bought in the last 30 days', LIST),
  per('visitor.events', 'Events', 'Scanned QR code, Viewed product page, Added to cart', LIST, 'Events in store or from a previous web session — e.g. Scanned QR code, Viewed product page, Added to cart'),
  per('visitor.skus', 'SKUs', 'SKU-10234, SKU-55871', LIST, 'SKUs the visitor has looked at before; target by listing SKUs — e.g. SKU-10234, SKU-55871'),
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
