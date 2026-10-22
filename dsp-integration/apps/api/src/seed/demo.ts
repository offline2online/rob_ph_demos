/* The demo estate (Rob, 22 Sep): the volume of data that lets the UX be
   exercised for real, on top of the base seed. Four advertiser slots on
   Landscape and three on Portrait (the Menu Board keeps its three), twelve
   stores and thirty-odd displays so display counts and reach differ per
   position, three DSPs and two direct advertisers — a dozen between them, all real suppliers to a global convenience retailer (7-Eleven) — settings for
   each, campaigns in every approval state with briefs and creatives,
   localised / personalised bookings on every position so the
   booking schedule's layer pills all have something to show, slot floors
   both inherited and overridden, and whitelist-only and held-for positions.

   `seed()` applies it after the base data unless told not to; the API tests
   keep the minimal base seed they can count (test/helpers.ts). Additive and
   idempotent, like bookings.ts: `npm run db:demo` adds it to a database that
   is already running, and a second run changes nothing. */
import { TRANSACTING_CURRENCY } from '../domain/currency'
import { randomUUID } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
import { advertiserSlug, type DisplayTypeExtensions, type Slot } from '@ph-dsp/types'
import type { Context } from '../context'
import { onFree, tx } from '../db/db'
import { allPositions, assignmentOf, nextWindow, windowMs } from '../domain/positions'
import type { StoredTargeting } from '../domain/targetingSummary'
import { CHECKS, bookablePositions, campaignFor } from './bookings'
import { audienceOf } from '../domain/displayTypes'
import { refreshCommittedPlays } from '../domain/committedPlays'

/* ------------------------------------------------------------- the estate */

const DEMO_STORES = [
  { id: 'st_melbourne_cbd', name: 'Melbourne CBD', region: 'Melbourne Inner' },
  { id: 'st_chadstone', name: 'Chadstone', region: 'Melbourne East' },
  { id: 'st_brisbane_city', name: 'Brisbane City', region: 'Brisbane Inner' },
  { id: 'st_chermside', name: 'Chermside', region: 'Brisbane North' },
  { id: 'st_perth_cbd', name: 'Perth CBD', region: 'Perth Inner' },
  { id: 'st_adelaide_rundle', name: 'Adelaide Rundle Mall', region: 'Adelaide Inner' },
  { id: 'st_newcastle', name: 'Newcastle', region: 'Hunter' },
  { id: 'st_canberra_centre', name: 'Canberra Centre', region: 'ACT' },
]

/* [id, name, store name, display type] */
const DEMO_DISPLAYS: [string, string, string, string][] = [
  ['d_2001', 'Entrance Screen', 'Parramatta', 'landscape'], ['d_2002', 'Checkout Screen', 'Parramatta', 'landscape'],
  ['d_2003', 'Entrance Screen', 'Chatswood', 'landscape'], ['d_2004', 'Aisle 1 Portrait', 'Chatswood', 'portrait'],
  ['d_2005', 'Entrance Screen', 'Bondi Junction', 'landscape'], ['d_2006', 'Beauty Aisle Portrait', 'Bondi Junction', 'portrait'],
  ['d_2007', 'Aisle 5 Portrait', 'Sydney CBD', 'portrait'],
  ['d_2008', 'Entrance Screen', 'Melbourne CBD', 'landscape'], ['d_2009', 'Checkout Screen', 'Melbourne CBD', 'landscape'],
  ['d_2010', 'Health Aisle Portrait', 'Melbourne CBD', 'portrait'], ['d_2011', 'Menu Board', 'Melbourne CBD', 'menu_board'],
  ['d_2012', 'Entrance Screen', 'Chadstone', 'landscape'], ['d_2013', 'Food Court Portrait', 'Chadstone', 'portrait'], ['d_2014', 'Menu Board', 'Chadstone', 'menu_board'],
  ['d_2015', 'Entrance Screen', 'Brisbane City', 'landscape'], ['d_2016', 'Checkout Screen', 'Brisbane City', 'landscape'], ['d_2017', 'Menu Board', 'Brisbane City', 'menu_board'],
  ['d_2018', 'Entrance Screen', 'Chermside', 'landscape'], ['d_2019', 'Aisle 2 Portrait', 'Chermside', 'portrait'],
  ['d_2020', 'Entrance Screen', 'Perth CBD', 'landscape'], ['d_2021', 'Checkout Screen', 'Perth CBD', 'landscape'], ['d_2022', 'Menu Board', 'Perth CBD', 'menu_board'],
  ['d_2023', 'Entrance Screen', 'Adelaide Rundle Mall', 'landscape'], ['d_2024', 'Beauty Aisle Portrait', 'Adelaide Rundle Mall', 'portrait'],
  ['d_2025', 'Entrance Screen', 'Newcastle', 'landscape'], ['d_2026', 'Menu Board', 'Newcastle', 'menu_board'],
  ['d_2027', 'Entrance Screen', 'Canberra Centre', 'landscape'], ['d_2028', 'Checkout Screen', 'Canberra Centre', 'landscape'], ['d_2029', 'Aisle 4 Portrait', 'Canberra Centre', 'portrait'],
]

const slot = (label: string, over: Partial<Slot> = {}): Slot => ({
  label, owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'rtb', storeScope: null, quota: null, ...over,
})

const DEMO_DEAL_ID = 'bl_demo_private_auction'
/* One Direct advertiser deal each, with a flight and a fixed CPM. They share Portrait's third slot, so their flights
   follow each other: reserving deals never overlap on a slot (ticket OMwDvy3OUmY9raBtTf7v; E2E 21 Oct 2026, both had
   held 1 Sep 2026 – 31 Mar 2027, so Gatorade's could never book). */
const DEMO_DIRECT_DEALS = [
  { id: 'bl_demo_direct_redbull', advertiser: 'Red Bull', floorCpm: 180, activeFrom: '2026-09-01T00:00:00.000Z', activeTo: '2026-12-31T23:59:59.999Z', campaignId: 'c_demo_redbull_portrait' },
  { id: 'bl_demo_direct_gatorade', advertiser: 'Gatorade', floorCpm: 150, activeFrom: '2027-01-01T00:00:00.000Z', activeTo: '2027-03-31T23:59:59.999Z', campaignId: 'c_demo_gatorade_portrait' },
]
const DIRECT_DEAL_IDS = new Set(DEMO_DIRECT_DEALS.map((d) => d.id))

/* Nestlé's hold on Landscape's fourth slot is a Programmatic guaranteed deal with its Google DSP seat (22 Oct 2026, ticket
   QdMaGvVhMZgcdcmIAalT): a buyer is never named on a slot. A one-week flight that starts today, so the demo shows it live. */
const NESTLE_PG = { id: 'bl_demo_pg_nestle', advertiser: 'Nestlé', partnerId: 'p_google', seatId: '5130001', floorCpm: 200, campaignId: 'c_demo_nestle_kitkat' }
const NESTLE_FLIGHT_MS = 7 * 24 * 3_600_000
const nestleFlight = (now: Date) => {
  const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return { activeFrom: new Date(from).toISOString(), activeTo: new Date(from + NESTLE_FLIGHT_MS).toISOString() }
}

/* Four sellable positions on Landscape, three on Portrait. Each display type
   inherits the platform floor; the hero slot on each carries a floor of its own
   (the hero slot is dearer). */
const DEMO_SLOTS: Record<string, { cap: number; loopLengthSec: number; slots: Slot[] }> = {
  landscape: {
    cap: 4, loopLengthSec: 48,
    slots: [
      slot('Hero slot', { floorCpm: 220 }),
      /* Sold by window: the demo's private auction. Every other open slot is real time. */
      slot('Supplier slot', { partnerIds: ['p_google', 'p_ttd'], listMode: 'deal', buyersListId: DEMO_DEAL_ID }),
      slot('Whitelist slot', { listMode: 'whitelist_only' }),
      /* Sold through Nestlé's Programmatic guaranteed deal, never by naming the buyer on the slot. */
      slot('Nestlé: guaranteed deal', { partnerIds: [], listMode: 'deal', buyersListId: NESTLE_PG.id, buyersListIds: [NESTLE_PG.id] }),
    ],
  },
  portrait: {
    cap: 3, loopLengthSec: 24,
    slots: [
      slot('Aisle hero', { floorCpm: 120 }),
      slot('Health & beauty', { partnerIds: ['p_google', 'p_ttd'], }),
      /* Direct advertisers play through their Direct advertiser deals (22 Oct 2026), never by being named on the slot. */
      slot('Direct deals: Red Bull & Gatorade', { partnerIds: [], listMode: 'deal', buyersListId: DEMO_DIRECT_DEALS[0].id, buyersListIds: DEMO_DIRECT_DEALS.map((d) => d.id) }),
    ],
  },
}

/* Who each DSP brings: suppliers a global convenience retailer (7-Eleven)
   really buys from, beverages and confectionery first. Unilever, Blackmores,
   Swisse and L'Oréal are not in the demo (21 Oct 2026). Nestlé's seat is the
   base seed's; the base seed's Swisse and L'Oréal placeholders are retired by `retirePlaceholderAdvertisers` below. */
const DEMO_SEATS: Record<string, { id: string; name: string; domain: string }[]> = {
  p_google: [
    { id: '5130003', name: 'Coca-Cola', domain: 'coca-cola.com' },
    { id: '5130004', name: 'Mars Wrigley', domain: 'mars.com' },
    { id: '5130005', name: 'Mondelez International', domain: 'mondelezinternational.com' },
    { id: '5130006', name: 'Kellanova', domain: 'kellanova.com' },
  ],
  p_amazon: [{ id: '588104412', name: 'The Hershey Company', domain: 'thehersheycompany.com' }],
  p_ttd: [
    { id: 'ttd-7002', name: 'PepsiCo', domain: 'pepsico.com' },
    { id: 'ttd-7003', name: 'Frito-Lay', domain: 'fritolay.com' },
    { id: 'ttd-7004', name: 'Monster Energy', domain: 'monsterenergy.com' },
  ],
}

/* Advertisers that deal with the retailer directly, with no DSP. */
const DEMO_DIRECT = ['Red Bull', 'Gatorade']
const DIRECT_PARTNER = 'direct'

/* Advertisers whitelisted on each demo DSP, by seat name. */
const DEMO_WHITELIST: Record<string, string[]> = {
  p_google: ['Coca-Cola'],
  p_ttd: ['PepsiCo'],
}

const DEMO_ADVERTISER_SETTINGS: Record<string, { approvalRequired: boolean }> = {
  [advertiserSlug('Coca-Cola')]: { approvalRequired: false },
  [advertiserSlug('PepsiCo')]: { approvalRequired: false },
  [advertiserSlug('Red Bull')]: { approvalRequired: false },
  [advertiserSlug('Monster Energy')]: { approvalRequired: true },
  [advertiserSlug('Gatorade')]: { approvalRequired: false },
  [advertiserSlug('Mars Wrigley')]: { approvalRequired: true },
  [advertiserSlug('Mondelez International')]: { approvalRequired: true },
  [advertiserSlug('The Hershey Company')]: { approvalRequired: true },
  [advertiserSlug('Kellanova')]: { approvalRequired: true },
  [advertiserSlug('Frito-Lay')]: { approvalRequired: false },
}

/* ---------------------------------------------------------- the campaigns */

type State = 'draft' | 'awaiting' | 'approved' | 'approved_off' | 'rejected'
interface DemoCampaign {
  id: string; name: string; advertiser: string; partnerId: string; displayTypeId: string
  pricingType: 'localised' | 'personalised'; state: State; colour: string; line: string
  targeting: StoredTargeting; brief: Record<string, unknown>; createdAt: string; rejectReason?: string
  /* A real PNG creative rather than the SVG placeholder, for one the exchange hands off. */
  png?: boolean
}

const LOCALISED: StoredTargeting = { default: { pricingType: 'localised' } }
const rule = (variable: string, op: string, values: string[], source: 'store' | 'visitor' = 'store') => ({ source, variable, op, values })
const metro = (pricingType: string): StoredTargeting => ({
  default: { pricingType: 'localised' },
  targeted: [{ id: 'metro', priority: 10, pricingType, rules: [[rule('store.fixed_segments', 'include', ['Metro'])], [rule('store.hours', 'equal', ['Open'])]] }],
})
const states = (...s: string[]): StoredTargeting => ({
  default: { pricingType: 'localised' },
  targeted: [{ id: 'states', priority: 10, pricingType: 'localised', rules: [[rule('store.state', 'include', s)]] }],
})
/* Every advertiser also carries a default layer now (decision, 22 Sep,
   superseding the earlier same-day "baseline optional" decision — ticket
   "Make default creative mandatory; retire localised-only booking path"):
   the part-sold scenario this used to demonstrate (localised variants only,
   unmatched stores left unsold to another advertiser) is retired — a slot
   goes to one advertiser, and localised/personalised are upsells on that
   one purchase. */
const localisedUpsell = (...tags: string[]): StoredTargeting => ({
  default: { pricingType: 'localised' },
  targeted: [{ id: 'tagged', priority: 10, pricingType: 'localised', rules: [[rule('store.display_tags', 'include', tags)]] }],
})
/* extraGroups exercises the other two personalised-trigger tiers alongside
   the individual one every personalised demo campaign already had (ticket
   "Booking schedule: personalised trigger icons", 22 Sep) — the trigger
   icons are derived from which of these variables a campaign's rules use,
   so at least one demo campaign needs to combine tiers to show more than
   one icon lit. */
const personalised = (segment: string[], extraGroups: ReturnType<typeof rule>[][] = []): StoredTargeting => ({
  default: { pricingType: 'localised' },
  targeted: [{ id: 'segment', priority: 20, pricingType: 'personalised', rules: [[rule('visitor.visitor_segments', 'include', segment, 'visitor')], [rule('store.hours', 'equal', ['Open'])], ...extraGroups] }],
})
const intentTargeted = (intent: string[]): StoredTargeting => ({
  default: { pricingType: 'localised' },
  targeted: [{ id: 'intent', priority: 20, pricingType: 'localised', rules: [[rule('visitor.purchase_intent', 'include', intent, 'visitor')]] }],
})
const brief = (details: string, over: Record<string, unknown> = {}) => ({ details, objective: 'Increase Revenue / Sales', touchPoints: ['Digital Signage'], ...over })

const DEMO_CAMPAIGNS: DemoCampaign[] = [
  { id: 'c_demo_nestle_kitkat', name: 'Nestlé — KitKat break', advertiser: 'Nestlé', partnerId: 'p_google', displayTypeId: 'landscape', pricingType: 'personalised', state: 'approved', colour: '#c8102e', line: 'Have a break', createdAt: '2026-09-10T09:00:00.000Z',
    /* Combines the individual and computer-vision trigger tiers, so the demo
       estate has at least one tile with more than one trigger icon lit. */
    targeting: personalised(['Value seeker', 'Snacker'], [[rule('store.cv_age', 'include', ['18–24'])]]),
    brief: brief('Afternoon snack occasion on entrance screens; personalised creative for value seekers, or anyone the display reads as a younger shopper.', { promotedProducts: ['KitKat 4 Finger', 'KitKat Chunky'], skus: ['SKU-20411', 'SKU-20412'], targetAudiences: ['Afternoon shoppers'], landingPageUrl: 'https://kitkat.com.au' }) },
  { id: 'c_demo_nestle_coffee', name: 'Nestlé — Nescafé iced coffee', advertiser: 'Nestlé', partnerId: 'p_google', displayTypeId: 'portrait', pricingType: 'localised', state: 'draft', colour: '#4e342e', line: 'Iced coffee, ready to go', createdAt: '2026-09-19T14:00:00.000Z',
    targeting: LOCALISED, brief: brief('Grab-and-go iced coffee beside the chiller, pending creative sign-off.', { promotedProducts: ['Nescafé Iced Coffee 250ml'] }) },
  { id: 'c_demo_redbull_summer', name: 'Red Bull — Summer Energy', advertiser: 'Red Bull', partnerId: DIRECT_PARTNER, displayTypeId: 'landscape', pricingType: 'localised', state: 'approved', colour: '#1a237e', line: 'Gives you wings', createdAt: '2026-09-11T09:00:00.000Z',
    targeting: metro('localised'), brief: brief('Metro stores through the summer, booked direct with the retailer.', { promotedProducts: ['Red Bull 250ml', 'Red Bull Sugarfree 250ml'], skus: ['SKU-50101'] }) },
  { id: 'c_demo_redbull_edition', name: 'Red Bull — Summer Edition', advertiser: 'Red Bull', partnerId: DIRECT_PARTNER, displayTypeId: 'portrait', pricingType: 'localised', state: 'awaiting', colour: '#c62828', line: 'The Summer Edition', createdAt: '2026-09-19T09:30:00.000Z',
    targeting: states('NSW', 'VIC'), brief: brief('Limited-run flavour for the east coast.', { promotedProducts: ['Red Bull Summer Edition 250ml'], targetAudiences: ['Adults 18–34'], objective: 'Brand Awareness' }) },
  /* What each Direct advertiser deal books on Portrait's third slot: approved, activated and a PNG (the hand-off takes PNG, JPEG or MP4 only; E2E 21 Oct 2026). */
  { id: 'c_demo_redbull_portrait', name: 'Red Bull — Wings at the chiller', advertiser: 'Red Bull', partnerId: DIRECT_PARTNER, displayTypeId: 'portrait', pricingType: 'localised', state: 'approved', png: true, colour: '#1a237e', line: 'Gives you wings', createdAt: '2026-09-10T09:00:00.000Z',
    targeting: LOCALISED, brief: brief('Booked direct with the retailer through its Direct advertiser deal on the chiller screen.', { promotedProducts: ['Red Bull 250ml'] }) },
  { id: 'c_demo_gatorade_portrait', name: 'Gatorade — Thirst Quencher', advertiser: 'Gatorade', partnerId: DIRECT_PARTNER, displayTypeId: 'portrait', pricingType: 'localised', state: 'approved', png: true, colour: '#e65100', line: 'Is it in you?', createdAt: '2026-09-10T10:00:00.000Z',
    targeting: LOCALISED, brief: brief('Booked direct with the retailer through its Direct advertiser deal, from January.', { promotedProducts: ['Gatorade Lemon-Lime 600ml'] }) },
  { id: 'c_demo_cocacola_zero', name: 'Coca-Cola — Zero Sugar', advertiser: 'Coca-Cola', partnerId: 'p_google', displayTypeId: 'landscape', pricingType: 'personalised', state: 'approved', colour: '#000000', line: 'Zero Sugar. Real taste.', createdAt: '2026-09-09T09:00:00.000Z',
    /* Combines the individual and aggregate-store trigger tiers. */
    targeting: personalised(['Fitness', 'Health'], [[rule('store.reason_for_visit', 'greater_than_or_equal', ['Returns: 30%'])]]),
    brief: brief('Always-on Zero Sugar with a fitness-segment variant, or when the queue here is mostly here for returns (a proxy for a busier, more price-sensitive moment).', { promotedProducts: ['Coca-Cola Zero Sugar 600ml'], skus: ['SKU-40011'], targetAudiences: ['Fitness'] }) },
  { id: 'c_demo_cocacola_share', name: 'Coca-Cola — Share a Coke', advertiser: 'Coca-Cola', partnerId: 'p_google', displayTypeId: 'portrait', pricingType: 'localised', state: 'draft', colour: '#f40009', line: 'Share a Coke', createdAt: '2026-09-20T11:00:00.000Z',
    targeting: localisedUpsell('Entrance', 'Food Court'), brief: brief('Entrance and food-court screens get the Share a Coke variant; the default plays everywhere else.', { promotedProducts: ['Coca-Cola 600ml Share bottles'] }) },
  { id: 'c_demo_pepsi_max', name: 'PepsiCo — Pepsi Max Summer', advertiser: 'PepsiCo', partnerId: 'p_ttd', displayTypeId: 'landscape', pricingType: 'localised', state: 'approved', colour: '#0d47a1', line: 'Maximum taste', createdAt: '2026-09-14T09:00:00.000Z',
    targeting: LOCALISED, brief: brief('Summer chiller push on the entrance screens.', { promotedProducts: ['Pepsi Max 600ml'] }) },
  { id: 'c_demo_pepsi_mtndew', name: 'PepsiCo — Mountain Dew Game Night', advertiser: 'PepsiCo', partnerId: 'p_ttd', displayTypeId: 'portrait', pricingType: 'personalised', state: 'draft', colour: '#689f38', line: 'Game on', createdAt: '2026-09-21T09:00:00.000Z',
    targeting: personalised(['Snacker']), brief: brief('Evening snack occasion; personalised for the snacker segment.', { promotedProducts: ['Mountain Dew 600ml'] }) },
  { id: 'c_demo_monster_ultra', name: 'Monster Energy — Ultra Paradise', advertiser: 'Monster Energy', partnerId: 'p_ttd', displayTypeId: 'menu_board', pricingType: 'localised', state: 'awaiting', colour: '#2e7d32', line: 'Unleash the beast', createdAt: '2026-09-20T08:00:00.000Z',
    targeting: LOCALISED, brief: brief('Cold-drink zone on the menu boards.', { promotedProducts: ['Monster Ultra Paradise 500ml'] }) },
  { id: 'c_demo_gatorade_summer', name: 'Gatorade — Summer Hydration', advertiser: 'Gatorade', partnerId: DIRECT_PARTNER, displayTypeId: 'menu_board', pricingType: 'localised', state: 'approved_off', colour: '#e65100', line: 'Fuel the game', createdAt: '2026-09-08T09:00:00.000Z',
    targeting: LOCALISED, brief: brief('Approved but switched off until the in-store display stock lands.', { promotedProducts: ['Gatorade Orange 600ml'] }) },
  { id: 'c_demo_mars_mms', name: 'Mars Wrigley — M&M’s Crispy', advertiser: 'Mars Wrigley', partnerId: 'p_google', displayTypeId: 'landscape', pricingType: 'localised', state: 'approved', colour: '#ffb300', line: 'M&M’s Crispy', createdAt: '2026-09-13T09:00:00.000Z',
    targeting: states('QLD', 'WA'), brief: brief('Northern and western states while the weather is warm.', { promotedProducts: ['M&M’s Crispy 145g'] }) },
  { id: 'c_demo_mondelez_easter', name: 'Mondelez — Cadbury Easter', advertiser: 'Mondelez International', partnerId: 'p_google', displayTypeId: 'landscape', pricingType: 'localised', state: 'approved', colour: '#4a148c', line: 'Cadbury Easter', createdAt: '2026-09-12T09:00:00.000Z',
    targeting: metro('localised'), brief: brief('Easter range at the front of store, metro stores first.', { promotedProducts: ['Cadbury Dairy Milk Easter Eggs'], skus: ['SKU-30101'] }) },
  { id: 'c_demo_kellanova_pringles', name: 'Kellanova — Pringles Game Day', advertiser: 'Kellanova', partnerId: 'p_google', displayTypeId: 'landscape', pricingType: 'personalised', state: 'approved', colour: '#b71c1c', line: 'Once you pop', createdAt: '2026-09-15T09:00:00.000Z',
    targeting: personalised(['Snacker']), brief: brief('Game-day snacking, personalised for the snacker segment; localised elsewhere.', { promotedProducts: ['Pringles Original 134g'], targetAudiences: ['Snackers'] }) },
  { id: 'c_demo_fritolay_doritos', name: 'Frito-Lay — Doritos Game Night', advertiser: 'Frito-Lay', partnerId: 'p_ttd', displayTypeId: 'landscape', pricingType: 'personalised', state: 'approved', colour: '#d84315', line: 'For the bold', createdAt: '2026-09-14T11:00:00.000Z',
    targeting: personalised(['Snacker', 'Value seeker']), brief: brief('Personalised for the snacker and value-seeker segments.', { promotedProducts: ['Doritos Nacho Cheese 170g'] }) },
  { id: 'c_demo_hershey_reeses', name: 'The Hershey Company — Reese’s Cups', advertiser: 'The Hershey Company', partnerId: 'p_amazon', displayTypeId: 'landscape', pricingType: 'localised', state: 'rejected', colour: '#6d4c41', line: 'Reese’s Cups', createdAt: '2026-09-18T10:00:00.000Z',
    targeting: LOCALISED, brief: brief('Reese’s launch at the checkout.'), rejectReason: 'Creative is 1280×720; the Landscape canvas is 1920×1080.' },
]

const svg = (w: number, h: number, bg: string, brand: string, line: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${bg}"/>` +
    `<text x="50%" y="45%" fill="#fff" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(h / 8)}" font-weight="700" text-anchor="middle">${brand}</text>` +
    `<text x="50%" y="60%" fill="#fff" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(h / 18)}" text-anchor="middle">${line}</text></svg>`)

/* A real PNG in the brand colour with a white band, for a creative that has to pass the hand-off's file checks. */
function solidPng(w: number, h: number, hex: string) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const row = (c: number[]) => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from(c))])
  const brand = row(rgb), band = row([255, 255, 255])
  const raw = Buffer.concat(Array.from({ length: h }, (_, y) => (y > h * 0.55 && y < h * 0.62 ? band : brand)))
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/* ------------------------------------------------- retiring placeholders */

/* The base seed (kept minimal, and counted by the API tests) brings Swisse and
   L'Oréal, which are not suppliers to a convenience retailer. When the demo
   estate is applied they are retired: their DSP seats are dropped and their
   three sample campaigns are re-labelled under advertisers that are, with a
   new creative. Idempotent; on a database that already holds bookings under
   the old names, reset it rather than re-running this. */
const PLACEHOLDER_SEATS = ['Swisse', 'L\'Oréal', 'L’Oréal', 'Blackmores', 'Unilever']
const RELABELLED = [
  { id: 'c_api_swisse', from: 'swisse', advertiser: 'Mondelez International', name: 'Mondelez — Cadbury Easter', colour: '#4a148c', line: 'Cadbury Easter',
    brief: brief('Easter chocolate, aimed at shoppers already at the confectionery fixture.', { promotedProducts: ['Cadbury Mini Eggs 300g'], targetAudiences: ['Families'], objective: 'Brand Awareness' }) },
  { id: 'c_api_swisse_kids', from: 'swisse', advertiser: 'Kellanova', name: 'Kellanova — Pringles Game Day (draft)', colour: '#b71c1c', line: 'Pringles Game Day', brief: null },
  { id: 'c_dsp_loreal', from: 'loreal', advertiser: 'The Hershey Company', name: 'The Hershey Company — Reese’s Party Pack', colour: '#6d4c41', line: 'Reese’s Party Pack — A$29.95',
    brief: brief('Reese’s Party Pack launch across metro stores.', { promotedProducts: ['Reese’s Party Pack 300g'] }) },
]

export async function retirePlaceholderAdvertisers(ctx: Context) {
  for (const p of await ctx.partners.list()) {
    const gone = p.seats.filter((s) => PLACEHOLDER_SEATS.includes(s.name))
    if (!gone.length) continue
    const ids = new Set(gone.map((s) => s.id))
    await ctx.partners.update(p.id, { seats: p.seats.filter((s) => !ids.has(s.id)), allowList: p.allowList.filter((id) => !ids.has(id)) })
  }
  for (const r of RELABELLED) {
    const row = ctx.db.prepare('SELECT advertiser_id AS a, display_type_id AS d FROM campaigns WHERE id = ?').get(r.id) as { a: string; d: string } | undefined
    if (!row || row.a !== r.from) continue
    const dt = await ctx.displayTypes.get(row.d)
    const { width, height } = dt?.displayCanvasSize ?? { width: 1920, height: 1080 }
    const file = await ctx.assets.put(svg(width, height, r.colour, r.advertiser, r.line), '.svg')
    await onFree(ctx.db, () => {
      /* The brief and the approval history go too: they named the retired brand's products (E2E 21 Oct 2026). */
      ctx.db.prepare('UPDATE campaigns SET name = ?, advertiser_id = ?, brief = ? WHERE id = ?').run(r.name, advertiserSlug(r.advertiser), r.brief ? JSON.stringify(r.brief) : null, r.id)
      ctx.db.prepare('UPDATE campaign_assets SET file = ? WHERE campaign_id = ?').run(file, r.id)
      ctx.db.prepare("UPDATE campaign_approval_audit SET actor = ? WHERE campaign_id = ? AND actor IN ('Swisse', 'L’Oréal', 'L''Oréal')").run(r.advertiser, r.id)
    })
  }
}

/* ---------------------------------------------------------------- apply */

export async function seedDemo(ctx: Context) {
  const report = { stores: 0, displays: 0, slots: 0, seats: 0, campaigns: 0, bookings: 0 }
  await retirePlaceholderAdvertisers(ctx)

  await tx(ctx.db, async () => {
    /* Stores and displays. */
    const insStore = ctx.db.prepare('INSERT INTO stores (id, name, region) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    for (const s of DEMO_STORES) report.stores += Number(insStore.run(s.id, s.name, s.region).changes)
    /* Localized segments for the booking schedule's plays-per-day cuts (stand-in for the platform's store segments). */
    const setSegments = ctx.db.prepare('UPDATE stores SET segments = ? WHERE id = ? AND segments = ?')
    for (const [id, segs] of [['st_melbourne_cbd', ['Metro']], ['st_brisbane_city', ['Metro']], ['st_perth_cbd', ['Metro']], ['st_newcastle', ['Regional']]] as const) setSegments.run(JSON.stringify(segs), id, '[]')
    const storeId = ctx.db.prepare('SELECT id FROM stores WHERE name = ?')
    const insDisplay = ctx.db.prepare('INSERT INTO displays (id, name, store, store_id, display_type_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
    for (const [id, name, store, dt] of DEMO_DISPLAYS) {
      const row = storeId.get(store) as { id: string } | undefined
      if (row) report.displays += Number(insDisplay.run(id, name, store, row.id, dt).changes)
    }

    /* DSPs and their seats. */
    if (!(await ctx.partners.get('p_ttd'))) {
      await ctx.partners.insert({
        id: 'p_ttd', provider: 'the_trade_desk', name: 'The Trade Desk', status: 'connected', mode: 'test', lastSync: 'Today, 06:40',
        credsPublic: { supplySourceId: 'ss-phub-2291', ttdPartnerId: 'phub-retail', region: 'APAC' },
        secrets: { apiToken: 'poc-placeholder-token' },
        bidder: { bidderEndpoint: ctx.config.bidders.the_trade_desk.bidUrl, seatIds: ['phub-retail'] },
        seats: [], listsLinked: true, allowList: [], blockList: [], categoryAllowList: [], categoryBlockList: [],
      })
    }
    for (const [partnerId, seats] of Object.entries(DEMO_SEATS)) {
      const p = await ctx.partners.get(partnerId)
      if (!p) continue
      const missing = seats.filter((s) => !p.seats.some((x) => x.name === s.name))
      if (!missing.length) continue
      await ctx.partners.update(partnerId, { seats: [...p.seats, ...missing] })
      report.seats += missing.length
    }

    /* Direct advertisers (no DSP). */
    const direct = new Set((await ctx.company.directAdvertisers()).map((d) => d.advertiserId))
    for (const name of DEMO_DIRECT) if (!direct.has(advertiserSlug(name))) await ctx.company.addDirectAdvertiser(advertiserSlug(name), name)

    /* Advertiser settings (only where none is saved yet) and the lists. */
    const saved = await ctx.company.advertiserSettings()
    const fresh = Object.fromEntries(Object.entries(DEMO_ADVERTISER_SETTINGS).filter(([id]) => !(id in saved)))
    if (Object.keys(fresh).length) await ctx.company.saveAdvertiserSettings(fresh)
    /* Each DSP's own whitelist, from the seats it synced. */
    for (const [partnerId, names] of Object.entries(DEMO_WHITELIST)) {
      const p = await ctx.partners.get(partnerId)
      if (!p) continue
      const ids = p.seats.filter((s) => names.includes(s.name)).map((s) => s.id)
      const allowList = [...new Set([...p.allowList, ...ids])]
      if (allowList.length !== p.allowList.length) await ctx.partners.update(partnerId, { allowList })
    }

    /* The demo's one private auction (8 Oct 2026: windows are sold only under a deal or by a hold; every other open slot is real time), inviting every seat of Google DSP and The Trade Desk. */
    if (!(await ctx.buyersLists.get(DEMO_DEAL_ID))) {
      const invited = (await Promise.all(['p_google', 'p_ttd'].map((id) => ctx.partners.get(id)))).flatMap((p) => (p?.seats ?? []).map((s) => ({ partnerId: p!.id, seatId: s.id })))
      await ctx.buyersLists.insert({
        id: DEMO_DEAL_ID, name: 'Demo private auction', description: 'Open to every Google DSP and Trade Desk advertiser; no auction deadline, so it clears a fresh auction every play window.',
        invitedBuyers: invited, activeFrom: null, activeTo: null, auctionCloses: null,
      })
    }

    /* Direct advertiser deals: how Red Bull and Gatorade get their slot. */
    for (const d of DEMO_DIRECT_DEALS) {
      if (await ctx.buyersLists.get(d.id)) continue
      await ctx.buyersLists.insert({
        id: d.id, name: `${d.advertiser} direct`, description: `${d.advertiser} books the retailer directly, with no DSP: its own flight on the slot at a fixed CPM.`, dealType: 'direct',
        invitedBuyers: [{ partnerId: DIRECT_PARTNER, seatId: advertiserSlug(d.advertiser) }], floorCpm: d.floorCpm,
        activeFrom: d.activeFrom, activeTo: d.activeTo, auctionCloses: null,
      })
    }

    /* Nestlé's Programmatic guaranteed deal: its Google DSP seat, a fixed CPM, a one-week flight starting today. */
    if (!(await ctx.buyersLists.get(NESTLE_PG.id))) {
      await ctx.buyersLists.insert({
        id: NESTLE_PG.id, name: `${NESTLE_PG.advertiser} guaranteed`, description: `${NESTLE_PG.advertiser} buys a week on Landscape's fourth slot through its Google DSP seat: a guaranteed deal at a fixed CPM, with no auction.`, dealType: 'guaranteed',
        invitedBuyers: [{ partnerId: NESTLE_PG.partnerId, seatId: NESTLE_PG.seatId }], floorCpm: NESTLE_PG.floorCpm,
        ...nestleFlight(ctx.clock()), auctionCloses: null,
      })
    }

    /* Slots: only on a display type that has no sellable position yet, so a
       hand-edited estate is never overwritten. */
    for (const [id, spec] of Object.entries(DEMO_SLOTS)) {
      const dt = await ctx.displayTypes.get(id)
      if (!dt || (dt.phExtensions?.slots ?? []).some((s) => s.owner === 'advertiser')) continue
      await ctx.displayTypes.saveRecord(id, { ...dt, playlistSettings: { ...(dt.playlistSettings as object), maximumCampaignsPlayedInRotation: spec.cap } })
      const ext: DisplayTypeExtensions = {
        ...(dt.phExtensions ?? { slots: [] }),
        slots: spec.slots,
        venue: { ...(dt.phExtensions?.venue ?? {}), loopLengthSec: spec.loopLengthSec },
      }
      await ctx.displayTypes.saveExtensions(id, ext)
      report.slots += spec.slots.length
    }
  })
  /* Their committed plays are derived from the slots they hold, which were only just written (E2E 21 Oct 2026: they were null). */
  await refreshCommittedPlays(ctx, [...DEMO_DIRECT_DEALS.map((d) => d.id), NESTLE_PG.id], 'Demo seed')

  /* Campaigns in every state. */
  const insertCampaign = ctx.db.prepare(
    `INSERT INTO campaigns (id, name, targeting, created_at, source, advertiser_id, partner_id, display_type_id, pricing_type, activation_enabled, brief)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  )
  const insertAsset = ctx.db.prepare("INSERT INTO campaign_assets (id, campaign_id, version, role, file, mime_type, width, height, size_bytes, created_at) VALUES (?, ?, 1, 'default', ?, ?, ?, ?, ?, ?)")
  for (const c of DEMO_CAMPAIGNS) {
    if (await ctx.campaigns.getCampaign(c.id)) continue
    const dt = await ctx.displayTypes.get(c.displayTypeId)
    if (!dt) continue
    const { width, height } = dt.displayCanvasSize
    const partner = await ctx.partners.get(c.partnerId)
    const source = partner?.provider === 'the_trade_desk' || c.state === 'draft' ? 'api' : 'dsp'
    /* A rejected-for-size creative really is the wrong size. */
    const [w, h] = c.rejectReason?.includes('1280×720') ? [1280, 720] : [width, height]
    const bytes = c.png ? solidPng(w, h, c.colour) : svg(w, h, c.colour, c.advertiser, c.line)
    const file = await ctx.assets.put(bytes, c.png ? '.png' : '.svg')
    await onFree(ctx.db, () => {
      insertCampaign.run(c.id, c.name, JSON.stringify(c.targeting), c.createdAt, source, advertiserSlug(c.advertiser), c.partnerId, c.displayTypeId, c.pricingType, JSON.stringify(c.brief))
      insertAsset.run(randomUUID(), c.id, file, c.png ? 'image/png' : 'image/svg+xml', w, h, c.png ? bytes.length : 1024, c.createdAt)
    })
    report.campaigns++
    if (c.state === 'draft') continue
    const checks = CHECKS(width, height).map((k) => (k.name === 'dimensions' && (w !== width || h !== height) ? { ...k, passed: false, detail: `${w}×${h} does not match the ${width}×${height} canvas` } : k))
    await ctx.approvals.submit(c.id, checks, partner?.name ?? c.advertiser)
    const status = await ctx.approvals.statusOf(c.id)
    if (c.state === 'rejected') {
      if (status === 'awaiting_approval') await ctx.approvals.reject(c.id, 'v1', 'HQ Admin (POC)', c.rejectReason ?? 'Rejected.')
      continue
    }
    if (c.state === 'awaiting') continue
    if (status === 'awaiting_approval') await ctx.approvals.approve(c.id, 'v1', 'HQ Admin (POC)')
    await ctx.approvalCampaigns.setActivation(c.id, c.state === 'approved')
  }

  report.bookings = await seedDemoBookings(ctx)
  return report
}

/* ---------------------------------------------------------------- bookings */

const MONEY = [110, 125, 140, 160, 175, 190, 210, 240]
const PRICING: ('localised' | 'personalised')[] = ['localised', 'localised', 'personalised', 'localised', 'localised', 'personalised']

/* Six windows per advertiser spread across every position, in the mix of
   layers the position supports; the same never-step-on-a-sold-window rule
   as bookings.ts. Past windows for two advertisers, with plays, so billing
   has more than one line. */
async function seedDemoBookings(ctx: Context) {
  const everyPosition = await allPositions(ctx)
  const positions = bookablePositions(everyPosition)
  const brands = (await ctx.partners.list())
    .filter((p) => p.status === 'connected')
    .flatMap((p) => p.seats.map((s) => ({ partnerId: p.id, name: s.name, advertiserId: advertiserSlug(s.name) })))
    /* Advertisers with no DSP book direct with the retailer. */
    .concat(DEMO_DIRECT.map((name) => ({ partnerId: DIRECT_PARTNER, name, advertiserId: advertiserSlug(name) })))
    /* One booking identity per advertiser: the first DSP that brings it. */
    .filter((b, i, all) => all.findIndex((x) => x.advertiserId === b.advertiserId) === i)
  if (!positions.length || !brands.length) return 0

  /* Each position's own window grid (OQ27: its billing unit is its window length). */
  const gridOf = async (p: (typeof positions)[number]) => {
    const len = await windowMs(ctx, p)
    return { len, first: (await nextWindow(ctx, len)).getTime() }
  }
  const currency = TRANSACTING_CURRENCY
  const insVacd = ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 0)')
  for (const p of everyPosition) {
    if ((await audienceOf(ctx.audience, p.displayType, p.slot)).assumedViewsPerWindow) continue
    const n = Math.max(1, (await ctx.displays.listByDisplayType(p.displayType.id)).length) * 412
    await onFree(ctx.db, () => insVacd.run(p.displayType.id, p.slot, n))
  }
  /* A campaign of the right pricing type for a booking, if the advertiser has one that is approved. */
  const campaignOf = async (advertiserId: string, pricingType: string) => {
    const c = DEMO_CAMPAIGNS.find((x) => advertiserSlug(x.advertiser) === advertiserId && x.pricingType === pricingType && x.state === 'approved')
    return c && (await ctx.approvals.statusOf(c.id)) === 'approved' ? c.id : null
  }

  let written = 0
  for (const [b, brand] of brands.entries()) {
    /* Only what a position is assigned to can book it, so each advertiser
       rotates through the positions it may use (a DSP-only or direct
       advertiser would otherwise land on slots it can't book and show none). */
    /* A direct advertiser reaches a slot only through its Direct advertiser deal, and a slot holding a guaranteed deal is reserved
       by it for the flight (22 Oct 2026): neither takes part in the rotation; their bookings are seeded below. */
    if (brand.partnerId === DIRECT_PARTNER) continue
    const eligible = positions.filter((p) => {
      if ((p.def.buyersListIds ?? []).some((id) => DIRECT_DEAL_IDS.has(id) || id === NESTLE_PG.id)) return false
      const allowed = p.def.partnerIds ?? []
      return !allowed.length || allowed.includes(brand.partnerId)
    })
    if (!eligible.length) continue
    for (let n = 0; n < 6; n++) {
      const position = eligible[(b + n) % eligible.length]
      const dt = position.displayType
      const wanted = PRICING[(b + n) % PRICING.length]
      const reserve = n % 3 === 0
      /* Personalised versions are sold only in a reservation or on a deal, never the open auction. */
      const pricingType = wanted === 'personalised' && !reserve && assignmentOf(position.def) !== 'deal' ? 'localised' : wanted
      const campaignId = (await campaignOf(brand.advertiserId, pricingType)) ??
        (await campaignFor(ctx, { ...brand, displayTypeId: dt.id }, '#37474f', dt.displayCanvasSize.width, dt.displayCanvasSize.height))
      /* Packed into the next three weeks, so the Daily view is busy rather
         than one booking a fortnight: advertiser and window step at
         different strides (modulo a prime, so twelve advertisers sharing one deal slot rarely meet), and a clash on a sold window is simply skipped. */
      const { len, first } = await gridOf(position)
      const start = new Date(first + ((b * 7 + n * 13) % 61) * len).toISOString()
      const id = `res_demo_${brand.advertiserId}_${n}`
      if (await ctx.reservations.get(id)) continue
      if ((await ctx.reservations.forWindow(position.positionId, start)).some((r) => !r.testMode && ['won', 'reserved'].includes(r.status))) continue
      const cpm = Math.round(MONEY[(b + n) % MONEY.length] * (pricingType === 'localised' ? 1 : pricingType === 'personalised' ? 1.5 : 1.25))
      await ctx.reservations.insert({
        id, partnerId: brand.partnerId, advertiserId: brand.advertiserId, campaignId, positionId: position.positionId, windowStart: start,
        type: reserve ? 'reserve' : 'bid', channel: reserve ? 'api' : 'openrtb',
        bidCpm: cpm, currency, status: reserve ? 'reserved' : 'won', clearingCpm: cpm, reason: null,
        testMode: false, pricingType, handedOffAt: new Date().toISOString(),
      })
      await ctx.campaigns.bookSlot({
        id: `bk_demo_${brand.advertiserId}_${n}`, campaignId, displayTypeId: dt.id, slot: position.slot,
        windowStart: start, windowEnd: new Date(Date.parse(start) + len).toISOString(),
      })
      written++
    }
  }

  /* Nestlé's Programmatic guaranteed deal: a run of windows inside its one-week flight, at the deal's rate, on the slot it is attached to, each linked to the deal. */
  {
    const position = positions.find((p) => (p.def.buyersListIds ?? []).includes(NESTLE_PG.id))
    const deal = await ctx.buyersLists.get(NESTLE_PG.id)
    if (position && deal?.activeFrom && deal.activeTo && (await ctx.campaigns.getCampaign(NESTLE_PG.campaignId))) {
      const advertiserId = advertiserSlug(NESTLE_PG.advertiser)
      const { len, first } = await gridOf(position)
      const from = Math.max(first, Math.ceil((Date.parse(deal.activeFrom) - first) / len) * len + first)
      for (const [k, step] of [0, 1, 3, 6, 10, 15].entries()) {
        const start = new Date(from + step * len).toISOString()
        if (Date.parse(start) > Date.parse(deal.activeTo)) break
        const id = `res_demo_pg_${advertiserId}_${k}`
        if (await ctx.reservations.get(id)) continue
        if ((await ctx.reservations.forWindow(position.positionId, start)).some((r) => !r.testMode && ['won', 'reserved'].includes(r.status))) continue
        await ctx.reservations.insert({
          id, partnerId: NESTLE_PG.partnerId, advertiserId, campaignId: NESTLE_PG.campaignId, positionId: position.positionId, windowStart: start,
          type: 'reserve', channel: 'api', bidCpm: NESTLE_PG.floorCpm, currency, status: 'reserved', clearingCpm: NESTLE_PG.floorCpm,
          reason: `Reserved: ${deal.name} (${deal.dealId}), a Programmatic guaranteed deal with ${NESTLE_PG.advertiser} via Google DSP, booked for its one-week flight with no auction.`,
          testMode: false, pricingType: 'personalised', handedOffAt: new Date().toISOString(), dealType: 'guaranteed', seatId: NESTLE_PG.seatId,
        })
        await ctx.campaigns.bookSlot({ id: `bk_demo_pg_${advertiserId}_${k}`, campaignId: NESTLE_PG.campaignId, displayTypeId: position.displayType.id, slot: position.slot, windowStart: start, windowEnd: new Date(Date.parse(start) + len).toISOString() })
        written++
      }
    }
  }

  /* Each Direct advertiser deal's slot: a run of windows inside its flight, at the deal's rate, as the exchange books them (exchange/directDeal.ts). */
  for (const d of DEMO_DIRECT_DEALS) {
    const position = positions.find((p) => (p.def.buyersListIds ?? []).includes(d.id))
    if (!position || !(await ctx.campaigns.getCampaign(d.campaignId))) continue
    const advertiserId = advertiserSlug(d.advertiser)
    const deal = await ctx.buyersLists.get(d.id)
    const { len, first } = await gridOf(position)
    const from = Math.max(first, Math.ceil((Date.parse(d.activeFrom) - first) / len) * len + first)
    for (const [k, step] of [0, 1, 3, 6, 10, 15].entries()) {
      const start = new Date(from + step * len).toISOString()
      if (Date.parse(start) > Date.parse(d.activeTo)) break
      const id = `res_demo_direct_${advertiserId}_${k}`
      if (await ctx.reservations.get(id)) continue
      if ((await ctx.reservations.forWindow(position.positionId, start)).some((r) => !r.testMode && ['won', 'reserved'].includes(r.status))) continue
      await ctx.reservations.insert({
        id, partnerId: DIRECT_PARTNER, advertiserId, campaignId: d.campaignId, positionId: position.positionId, windowStart: start,
        type: 'reserve', channel: 'api', bidCpm: d.floorCpm, currency, status: 'reserved', clearingCpm: d.floorCpm,
        reason: `Reserved: ${deal?.name ?? d.id} (${deal?.dealId ?? ''}), a Direct advertiser deal, booked for its whole flight with no auction.`,
        testMode: false, pricingType: 'localised', handedOffAt: new Date().toISOString(), dealType: 'guaranteed',
      })
      await ctx.campaigns.bookSlot({ id: `bk_demo_direct_${advertiserId}_${k}`, campaignId: d.campaignId, displayTypeId: position.displayType.id, slot: position.slot, windowStart: start, windowEnd: new Date(Date.parse(start) + len).toISOString() })
      written++
    }
  }

  /* Two windows that have already played, on the Landscape hero slot. */
  const hero = positions.find((p) => p.positionId === 'landscape.s1')
  if (hero && !(await ctx.reservations.get('res_demo_past_cocacola'))) {
    const play = ctx.db.prepare('INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec) VALUES (?, ?, ?, ?, 12)')
    const displays = (await ctx.displays.listByDisplayType('landscape')).slice(0, 4)
    for (const [k, past] of [['cocacola', 'c_demo_cocacola_zero', '2026-09-16'], ['mars', 'c_demo_mars_mms', '2026-09-17']].entries()) {
      const [key, campaignId, day] = past
      if (!(await ctx.campaigns.getCampaign(campaignId))) continue
      const start = `${day}T00:00:00.000Z`
      const brand = brands.find((x) => x.advertiserId === advertiserSlug(key === 'cocacola' ? 'Coca-Cola' : 'Mars Wrigley'))
      if (!brand) continue
      await ctx.reservations.insert({
        id: `res_demo_past_${key}`, partnerId: brand.partnerId, advertiserId: brand.advertiserId, campaignId, positionId: hero.positionId, windowStart: start,
        type: 'bid', channel: 'openrtb', bidCpm: 160 + k * 20, currency, status: 'won', clearingCpm: 160 + k * 20, reason: null, testMode: false,
        pricingType: 'localised', handedOffAt: `${day}T00:00:00.000Z`,
      })
      await ctx.campaigns.bookSlot({ id: `bk_demo_past_${key}`, campaignId, displayTypeId: 'landscape', slot: hero.slot, windowStart: start, windowEnd: new Date(Date.parse(start) + (await gridOf(hero)).len).toISOString() })
      const t0 = Date.parse(start)
      await tx(ctx.db, () => {
        displays.forEach((d, i) => {
          /* A 48s loop: 1,800 plays a day on a display that is on all day; the last one was on for half the day. */
          const plays = i === displays.length - 1 ? 900 : 1800
          for (let j = 0; j < plays; j++) play.run(`pl_demo_${key}_${d.id}_${j}`, d.id, campaignId, new Date(t0 + j * 48_000).toISOString())
        })
      })
      written++
    }
  }
  return written
}
