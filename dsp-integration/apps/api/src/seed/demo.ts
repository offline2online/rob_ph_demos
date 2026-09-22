/* The demo estate (Rob, 22 Sep): the volume of data that lets the UX be
   exercised for real, on top of the base seed. Four advertiser slots on
   Landscape and three on Portrait (the Menu Board keeps its three), twelve
   stores and thirty-odd displays so display counts and reach differ per
   position, three DSPs with a dozen advertisers between them, settings for
   each, campaigns in every approval state with briefs and creatives,
   localised / personalised / interactive bookings on every position so the
   booking schedule's layer pills all have something to show, reserve prices
   both inherited and overridden, and whitelist-only and held-for positions.

   `seed()` applies it after the base data unless told not to; the API tests
   keep the minimal base seed they can count (test/helpers.ts). Additive and
   idempotent, like bookings.ts: `npm run db:demo` adds it to a database that
   is already running, and a second run changes nothing. */
import { randomUUID } from 'node:crypto'
import { advertiserSlug, supportedTargetingOf, type DisplayTypeExtensions, type Slot } from '@ph-dsp/types'
import type { Context } from '../context'
import { tx } from '../db/db'
import { allPositions, nextWindow, windowMs } from '../domain/positions'
import type { StoredTargeting } from '../domain/targetingSummary'
import { CHECKS, campaignFor } from './bookings'

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
  label, owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'rtb', storeScope: null, quota: null, supportedTargeting: ['localised'], reservePrice: null, ...over,
})

/* Four sellable positions on Landscape, three on Portrait. Each display type
   carries a reserve price default that its slots inherit; one slot on each
   overrides it (the hero slot is dearer). */
const DEMO_SLOTS: Record<string, { cap: number; loopLengthSec: number; reservePrice: number | null; slots: Slot[] }> = {
  landscape: {
    cap: 4, loopLengthSec: 48, reservePrice: 150,
    slots: [
      slot('Hero slot', { supportedTargeting: ['localised', 'personalised', 'interactive'], reservePrice: 220 }),
      slot('Supplier slot', { partnerIds: ['p_google'], supportedTargeting: ['localised', 'personalised'] }),
      slot('Whitelist slot', { listMode: 'whitelist_only' }),
      slot('Held for Nestlé', { partnerIds: ['p_google'], advertisers: ['Nestlé'], listMode: null, supportedTargeting: ['localised', 'personalised'] }),
    ],
  },
  portrait: {
    cap: 3, loopLengthSec: 24, reservePrice: 90,
    slots: [
      slot('Aisle hero', { supportedTargeting: ['localised', 'personalised', 'interactive'], reservePrice: 120 }),
      slot('Health & beauty', { partnerIds: ['p_google', 'p_ttd'], supportedTargeting: ['localised', 'personalised'] }),
      slot('Held for Swisse', { partnerIds: ['p_google'], advertisers: ['Swisse'], listMode: null }),
    ],
  },
}

/* Who each DSP brings. Unilever is on two DSPs, which is what the
   Advertisers table's "via" column exists to show. */
const DEMO_SEATS: Record<string, { id: string; name: string; domain: string }[]> = {
  p_google: [
    { id: '5130003', name: 'Arnott’s', domain: 'arnotts.com.au' },
    { id: '5130004', name: 'Coca-Cola', domain: 'coca-cola.com' },
    { id: '5130005', name: 'Unilever', domain: 'unilever.com' },
    { id: '5130006', name: 'Mars Wrigley', domain: 'mars.com' },
    { id: '5130007', name: 'Kellogg’s', domain: 'kelloggs.com.au' },
  ],
  p_amazon: [{ id: '588104412', name: 'Colgate-Palmolive', domain: 'colgatepalmolive.com' }],
  p_ttd: [
    { id: 'ttd-7001', name: 'Unilever', domain: 'unilever.com' },
    { id: 'ttd-7002', name: 'Procter & Gamble', domain: 'pg.com' },
    { id: 'ttd-7003', name: 'Bega', domain: 'bega.com.au' },
    { id: 'ttd-7004', name: 'Lion', domain: 'lionco.com' },
  ],
}

const DEMO_ADVERTISER_SETTINGS: Record<string, { approvalRequired: boolean; floorMultiplier: number }> = {
  [advertiserSlug('Arnott’s')]: { approvalRequired: false, floorMultiplier: 0.9 },
  [advertiserSlug('Coca-Cola')]: { approvalRequired: false, floorMultiplier: 1.1 },
  [advertiserSlug('Unilever')]: { approvalRequired: true, floorMultiplier: 1 },
  [advertiserSlug('Mars Wrigley')]: { approvalRequired: true, floorMultiplier: 0.95 },
  [advertiserSlug('Kellogg’s')]: { approvalRequired: true, floorMultiplier: 1 },
  [advertiserSlug('Colgate-Palmolive')]: { approvalRequired: true, floorMultiplier: 1.25 },
  [advertiserSlug('Procter & Gamble')]: { approvalRequired: false, floorMultiplier: 1.15 },
  [advertiserSlug('Bega')]: { approvalRequired: true, floorMultiplier: 0.85 },
  [advertiserSlug('Lion')]: { approvalRequired: true, floorMultiplier: 1.3 },
}

/* ---------------------------------------------------------- the campaigns */

type State = 'draft' | 'awaiting' | 'approved' | 'approved_off' | 'rejected'
interface DemoCampaign {
  id: string; name: string; advertiser: string; partnerId: string; displayTypeId: string
  pricingType: 'localised' | 'personalised' | 'interactive'; state: State; colour: string; line: string
  targeting: StoredTargeting; brief: Record<string, unknown>; createdAt: string; rejectReason?: string
}

const LOCALISED: StoredTargeting = { baseline: { pricingType: 'localised' } }
const rule = (variable: string, op: string, values: string[], source: 'store' | 'visitor' = 'store') => ({ source, variable, op, values })
const metro = (pricingType: string): StoredTargeting => ({
  baseline: { pricingType: 'localised' },
  targeted: [{ id: 'metro', priority: 10, pricingType, rules: [[rule('store.fixed_segments', 'include', ['Metro'])], [rule('store.hours', 'equal', ['Open'])]] }],
})
const states = (...s: string[]): StoredTargeting => ({
  baseline: { pricingType: 'localised' },
  targeted: [{ id: 'states', priority: 10, pricingType: 'localised', rules: [[rule('store.state', 'include', s)]] }],
})
/* No fallback: localised variants only (decision, 22 Sep) — the unmatched
   stores stay unsold, which is what makes a position part-sold. */
const variantsOnly = (...tags: string[]): StoredTargeting => ({
  targeted: [{ id: 'tagged', priority: 10, pricingType: 'localised', rules: [[rule('store.display_tags', 'include', tags)]] }],
})
const personalised = (segment: string[]): StoredTargeting => ({
  baseline: { pricingType: 'localised' },
  targeted: [{ id: 'segment', priority: 20, pricingType: 'personalised', rules: [[rule('visitor.visitor_segments', 'include', segment, 'visitor')], [rule('store.hours', 'equal', ['Open'])]] }],
})
const interactive = (intent: string[]): StoredTargeting => ({
  baseline: { pricingType: 'localised' },
  targeted: [{ id: 'intent', priority: 20, pricingType: 'interactive', rules: [[rule('visitor.purchase_intent', 'include', intent, 'visitor')]] }],
})
const brief = (details: string, over: Record<string, unknown> = {}) => ({ details, objective: 'Increase Revenue / Sales', touchPoints: ['Digital Signage'], ...over })

const DEMO_CAMPAIGNS: DemoCampaign[] = [
  { id: 'c_demo_nestle_kitkat', name: 'Nestlé — KitKat break', advertiser: 'Nestlé', partnerId: 'p_google', displayTypeId: 'landscape', pricingType: 'personalised', state: 'approved', colour: '#c8102e', line: 'Have a break', createdAt: '2026-09-10T09:00:00.000Z',
    targeting: personalised(['Value seeker', 'Snacker']), brief: brief('Afternoon snack occasion on entrance screens; personalised creative for value seekers.', { promotedProducts: ['KitKat 4 Finger', 'KitKat Chunky'], skus: ['SKU-20411', 'SKU-20412'], targetAudiences: ['Afternoon shoppers'], landingPageUrl: 'https://kitkat.com.au' }) },
  { id: 'c_demo_nestle_purina', name: 'Nestlé — Purina ONE', advertiser: 'Nestlé', partnerId: 'p_google', displayTypeId: 'portrait', pricingType: 'localised', state: 'draft', colour: '#6a1b9a', line: 'Purina ONE', createdAt: '2026-09-19T14:00:00.000Z',
    targeting: LOCALISED, brief: brief('Pet aisle portrait screens, pending creative sign-off.', { promotedProducts: ['Purina ONE Adult'] }) },
  { id: 'c_demo_swisse_mens', name: 'Swisse — Men’s Ultivite', advertiser: 'Swisse', partnerId: 'p_google', displayTypeId: 'landscape', pricingType: 'localised', state: 'awaiting', colour: '#004d40', line: 'Men’s Ultivite', createdAt: '2026-09-19T09:30:00.000Z',
    targeting: states('NSW', 'VIC'), brief: brief('East-coast launch of the reformulated Men’s Ultivite.', { promotedProducts: ['Men’s Ultivite'], targetAudiences: ['Men 30–55'], objective: 'Brand Awareness' }) },
  { id: 'c_demo_swisse_beauty', name: 'Swisse — Beauty collagen', advertiser: 'Swisse', partnerId: 'p_google', displayTypeId: 'portrait', pricingType: 'interactive', state: 'approved', colour: '#ad1457', line: 'Scan for a sample', createdAt: '2026-09-12T09:00:00.000Z',
    targeting: interactive(['Browse', 'Gift']), brief: brief('Interactive sample offer in the beauty aisle: scan the QR code for a sachet.', { promotedProducts: ['Beauty Collagen Glow'], targetAudiences: ['Beauty browsers'], landingPageUrl: 'https://swisse.com/collagen' }) },
  { id: 'c_demo_arnotts_timtam', name: 'Arnott’s — Tim Tam Double Coat', advertiser: 'Arnott’s', partnerId: 'p_google', displayTypeId: 'landscape', pricingType: 'localised', state: 'approved', colour: '#3e2723', line: 'Double Coat is back', createdAt: '2026-09-11T09:00:00.000Z',
    targeting: metro('localised'), brief: brief('Metro stores only, while stocks last.', { promotedProducts: ['Tim Tam Double Coat'], skus: ['SKU-30101'] }) },
  { id: 'c_demo_arnotts_shapes', name: 'Arnott’s — Shapes Pizza', advertiser: 'Arnott’s', partnerId: 'p_google', displayTypeId: 'menu_board', pricingType: 'localised', state: 'approved_off', colour: '#e65100', line: 'Shapes Pizza', createdAt: '2026-09-08T09:00:00.000Z',
    targeting: LOCALISED, brief: brief('Approved but switched off until the in-store display stock lands.', { promotedProducts: ['Shapes Pizza'] }) },
  { id: 'c_demo_cocacola_zero', name: 'Coca-Cola — Zero Sugar', advertiser: 'Coca-Cola', partnerId: 'p_google', displayTypeId: 'landscape', pricingType: 'personalised', state: 'approved', colour: '#000000', line: 'Zero Sugar. Real taste.', createdAt: '2026-09-09T09:00:00.000Z',
    targeting: personalised(['Fitness', 'Health']), brief: brief('Always-on Zero Sugar with a fitness-segment variant.', { promotedProducts: ['Coca-Cola Zero Sugar 600ml'], skus: ['SKU-40011'], targetAudiences: ['Fitness'] }) },
  { id: 'c_demo_cocacola_summer', name: 'Coca-Cola — Summer share pack', advertiser: 'Coca-Cola', partnerId: 'p_google', displayTypeId: 'portrait', pricingType: 'localised', state: 'draft', colour: '#f40009', line: 'Share a Coke', createdAt: '2026-09-20T11:00:00.000Z',
    targeting: variantsOnly('Entrance', 'Food Court'), brief: brief('Entrance and food-court screens only; no fallback for other stores.', { promotedProducts: ['Coca-Cola 24pk'] }) },
  { id: 'c_demo_unilever_dove', name: 'Unilever — Dove Deep Moisture', advertiser: 'Unilever', partnerId: 'p_ttd', displayTypeId: 'portrait', pricingType: 'localised', state: 'awaiting', colour: '#1565c0', line: 'Dove', createdAt: '2026-09-19T16:00:00.000Z',
    targeting: LOCALISED, brief: brief('Beauty aisle portrait screens, all stores.', { promotedProducts: ['Dove Deep Moisture Body Wash'], objective: 'Brand Awareness' }) },
  { id: 'c_demo_unilever_streets', name: 'Unilever — Streets Magnum', advertiser: 'Unilever', partnerId: 'p_google', displayTypeId: 'landscape', pricingType: 'localised', state: 'rejected', colour: '#4e342e', line: 'Magnum — 2 for $8', createdAt: '2026-09-17T12:00:00.000Z',
    targeting: LOCALISED, brief: brief('Magnum multi-buy on the checkout screens.', { promotedProducts: ['Magnum Classic 4pk'] }), rejectReason: 'Price shown in the artwork (2 for $8). Prices come from Personalisation Hub, not the creative.' },
  { id: 'c_demo_mars_mms', name: 'Mars Wrigley — M&M’s Crispy', advertiser: 'Mars Wrigley', partnerId: 'p_google', displayTypeId: 'landscape', pricingType: 'localised', state: 'approved', colour: '#ffb300', line: 'M&M’s Crispy', createdAt: '2026-09-13T09:00:00.000Z',
    targeting: states('QLD', 'WA'), brief: brief('Northern and western states while the weather is warm.', { promotedProducts: ['M&M’s Crispy 145g'] }) },
  { id: 'c_demo_kelloggs_nutrigrain', name: 'Kellogg’s — Nutri-Grain', advertiser: 'Kellogg’s', partnerId: 'p_google', displayTypeId: 'menu_board', pricingType: 'localised', state: 'awaiting', colour: '#2e7d32', line: 'Iron Man Food', createdAt: '2026-09-20T08:00:00.000Z',
    targeting: LOCALISED, brief: brief('Breakfast daypart on the menu boards.', { promotedProducts: ['Nutri-Grain 500g'] }) },
  { id: 'c_demo_pg_gillette', name: 'Procter & Gamble — Gillette Labs', advertiser: 'Procter & Gamble', partnerId: 'p_ttd', displayTypeId: 'landscape', pricingType: 'personalised', state: 'approved', colour: '#0d47a1', line: 'Gillette Labs', createdAt: '2026-09-14T09:00:00.000Z',
    targeting: personalised(['Grooming']), brief: brief('Personalised for visitors in the grooming segment; localised elsewhere.', { promotedProducts: ['Gillette Labs Razor'], targetAudiences: ['Men 25–45'] }) },
  { id: 'c_demo_bega_peanut', name: 'Bega — Peanut Butter', advertiser: 'Bega', partnerId: 'p_ttd', displayTypeId: 'landscape', pricingType: 'localised', state: 'rejected', colour: '#8d6e63', line: 'Bega Peanut Butter', createdAt: '2026-09-18T10:00:00.000Z',
    targeting: LOCALISED, brief: brief('Spread awareness.'), rejectReason: 'Creative is 1280×720; the Landscape canvas is 1920×1080.' },
  { id: 'c_demo_lion_xxxx', name: 'Lion — XXXX Zero', advertiser: 'Lion', partnerId: 'p_ttd', displayTypeId: 'menu_board', pricingType: 'localised', state: 'draft', colour: '#f9a825', line: 'XXXX Zero', createdAt: '2026-09-21T09:00:00.000Z',
    targeting: LOCALISED, brief: brief('Zero-alcohol range on the menu boards; awaiting category approval.') },
]

const svg = (w: number, h: number, bg: string, brand: string, line: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${bg}"/>` +
    `<text x="50%" y="45%" fill="#fff" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(h / 8)}" font-weight="700" text-anchor="middle">${brand}</text>` +
    `<text x="50%" y="60%" fill="#fff" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(h / 18)}" text-anchor="middle">${line}</text></svg>`)

/* ---------------------------------------------------------------- apply */

export async function seedDemo(ctx: Context) {
  const report = { stores: 0, displays: 0, slots: 0, seats: 0, campaigns: 0, bookings: 0 }

  tx(ctx.db, () => {
    /* Stores and displays. */
    const insStore = ctx.db.prepare('INSERT OR IGNORE INTO stores (id, name, region) VALUES (?, ?, ?)')
    for (const s of DEMO_STORES) report.stores += Number(insStore.run(s.id, s.name, s.region).changes)
    const storeId = ctx.db.prepare('SELECT id FROM stores WHERE name = ?')
    const insDisplay = ctx.db.prepare('INSERT OR IGNORE INTO displays (id, name, store, store_id, display_type_id) VALUES (?, ?, ?, ?, ?)')
    for (const [id, name, store, dt] of DEMO_DISPLAYS) {
      const row = storeId.get(store) as { id: string } | undefined
      if (row) report.displays += Number(insDisplay.run(id, name, store, row.id, dt).changes)
    }

    /* DSPs and their seats. */
    if (!ctx.partners.get('p_ttd')) {
      ctx.partners.insert({
        id: 'p_ttd', provider: 'the_trade_desk', name: 'The Trade Desk', status: 'connected', mode: 'test', lastSync: 'Today, 06:40',
        credsPublic: { supplySourceId: 'ss-phub-2291', ttdPartnerId: 'phub-retail', region: 'APAC' },
        secrets: { apiToken: 'poc-placeholder-token' },
        bidder: { bidderEndpoint: 'https://bid.adsrvr.org/openrtb2/bid', seatIds: ['phub-retail'] },
        seats: [], listsLinked: true, allowList: [], blockList: [],
      })
    }
    for (const [partnerId, seats] of Object.entries(DEMO_SEATS)) {
      const p = ctx.partners.get(partnerId)
      if (!p) continue
      const missing = seats.filter((s) => !p.seats.some((x) => x.name === s.name))
      if (!missing.length) continue
      ctx.partners.update(partnerId, { seats: [...p.seats, ...missing] })
      report.seats += missing.length
    }

    /* Advertiser settings (only where none is saved yet) and the lists. */
    const saved = ctx.company.advertiserSettings()
    const fresh = Object.fromEntries(Object.entries(DEMO_ADVERTISER_SETTINGS).filter(([id]) => !(id in saved)))
    if (Object.keys(fresh).length) ctx.company.saveAdvertiserSettings(fresh)
    const company = ctx.company.get()
    const whitelist = [...new Set([...company.advertiserWhitelist, 'Coca-Cola', 'Unilever', 'Procter & Gamble'])]
    if (whitelist.length !== company.advertiserWhitelist.length) ctx.company.save({ ...company, advertiserWhitelist: whitelist })

    /* Slots: only on a display type that has no sellable position yet, so a
       hand-edited estate is never overwritten. */
    for (const [id, spec] of Object.entries(DEMO_SLOTS)) {
      const dt = ctx.displayTypes.get(id)
      if (!dt || (dt.phExtensions?.slots ?? []).some((s) => s.owner === 'advertiser')) continue
      ctx.displayTypes.saveRecord(id, { ...dt, playlistSettings: { ...(dt.playlistSettings as object), maximumCampaignsPlayedInRotation: spec.cap } })
      const ext: DisplayTypeExtensions = {
        ...(dt.phExtensions ?? { slots: [] }),
        slots: spec.slots,
        reservePrice: spec.reservePrice,
        venue: { ...(dt.phExtensions?.venue ?? {}), loopLengthSec: spec.loopLengthSec },
      }
      ctx.displayTypes.saveExtensions(id, ext)
      report.slots += spec.slots.length
    }
  })

  /* Campaigns in every state. */
  const insertCampaign = ctx.db.prepare(
    `INSERT INTO campaigns (id, name, targeting, created_at, source, advertiser_id, partner_id, display_type_id, pricing_type, activation_enabled, brief)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  )
  const insertAsset = ctx.db.prepare("INSERT INTO campaign_assets (id, campaign_id, version, role, file, mime_type, width, height, size_bytes, created_at) VALUES (?, ?, 1, 'baseline', ?, 'image/svg+xml', ?, ?, 1024, ?)")
  for (const c of DEMO_CAMPAIGNS) {
    if (ctx.campaigns.getCampaign(c.id)) continue
    const dt = ctx.displayTypes.get(c.displayTypeId)
    if (!dt) continue
    const { width, height } = dt.displayCanvasSize
    const partner = ctx.partners.get(c.partnerId)
    const source = partner?.provider === 'the_trade_desk' || c.state === 'draft' ? 'api' : 'dsp'
    insertCampaign.run(c.id, c.name, JSON.stringify(c.targeting), c.createdAt, source, advertiserSlug(c.advertiser), c.partnerId, c.displayTypeId, c.pricingType, JSON.stringify(c.brief))
    /* A rejected-for-size creative really is the wrong size. */
    const [w, h] = c.rejectReason?.includes('1280×720') ? [1280, 720] : [width, height]
    insertAsset.run(randomUUID(), c.id, ctx.assets.put(svg(w, h, c.colour, c.advertiser, c.line), '.svg'), w, h, c.createdAt)
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
const PRICING: ('localised' | 'personalised' | 'interactive')[] = ['localised', 'localised', 'personalised', 'localised', 'interactive', 'personalised']

/* Six windows per advertiser spread across every position, in the mix of
   layers the position supports; the same never-step-on-a-sold-window rule
   as bookings.ts. Past windows for two advertisers, with plays, so billing
   has more than one line. */
async function seedDemoBookings(ctx: Context) {
  const positions = allPositions(ctx)
  const brands = ctx.partners.list()
    .filter((p) => p.status === 'connected')
    .flatMap((p) => p.seats.map((s) => ({ partnerId: p.id, name: s.name, advertiserId: advertiserSlug(s.name) })))
    /* One booking identity per advertiser: the first DSP that brings it. */
    .filter((b, i, all) => all.findIndex((x) => x.advertiserId === b.advertiserId) === i)
  if (!positions.length || !brands.length) return 0

  const len = windowMs(ctx)
  const first = nextWindow(ctx).getTime()
  const currency = ctx.company.get().currency
  const insVacd = ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 0)')
  for (const p of positions) {
    if (ctx.audience.forSlot(p.displayType.id, p.slot).assumedViewsPerWindow) continue
    insVacd.run(p.displayType.id, p.slot, Math.max(1, ctx.displays.listByDisplayType(p.displayType.id).length) * 412)
  }
  /* A campaign of the right pricing type for a booking, if the advertiser has one that is approved. */
  const campaignOf = async (advertiserId: string, pricingType: string) => {
    const c = DEMO_CAMPAIGNS.find((x) => advertiserSlug(x.advertiser) === advertiserId && x.pricingType === pricingType && x.state === 'approved')
    return c && (await ctx.approvals.statusOf(c.id)) === 'approved' ? c.id : null
  }

  let written = 0
  for (const [b, brand] of brands.entries()) {
    for (let n = 0; n < 6; n++) {
      const position = positions[(b + n) % positions.length]
      const dt = position.displayType
      /* Only what the position is assigned to can book it. */
      const allowed = position.def.partnerIds ?? []
      if (allowed.length && !allowed.includes(brand.partnerId)) continue
      if ((position.def.advertisers ?? []).length && !position.def.advertisers!.includes(brand.name)) continue
      const supported = supportedTargetingOf(position.def)
      const wanted = PRICING[(b + n) % PRICING.length]
      const pricingType = supported.includes(wanted) ? wanted : 'localised'
      const campaignId = (await campaignOf(brand.advertiserId, pricingType)) ??
        (await campaignFor(ctx, { ...brand, displayTypeId: dt.id }, '#37474f', dt.displayCanvasSize.width, dt.displayCanvasSize.height))
      /* Packed into the next three weeks, so the Daily view is busy rather
         than one booking a fortnight: advertiser and window step at
         different strides, and a clash on a sold window is simply skipped. */
      const start = new Date(first + ((b * 2 + n * 5) % 21) * len).toISOString()
      const id = `res_demo_${brand.advertiserId}_${n}`
      if (ctx.reservations.get(id)) continue
      if (ctx.reservations.forWindow(position.positionId, start).some((r) => !r.testMode && ['won', 'reserved'].includes(r.status))) continue
      const cpm = Math.round(MONEY[(b + n) % MONEY.length] * (pricingType === 'localised' ? 1 : pricingType === 'personalised' ? 1.5 : 1.25))
      const reserve = n % 3 === 0
      ctx.reservations.insert({
        id, partnerId: brand.partnerId, advertiserId: brand.advertiserId, campaignId, positionId: position.positionId, windowStart: start,
        type: reserve ? 'reserve' : 'bid', channel: reserve ? 'api' : 'openrtb',
        bidCpm: cpm, currency, status: reserve ? 'reserved' : 'won', clearingCpm: cpm, reason: null,
        testMode: false, pricingType, handedOffAt: new Date().toISOString(),
      })
      ctx.campaigns.bookSlot({
        id: `bk_demo_${brand.advertiserId}_${n}`, campaignId, displayTypeId: dt.id, slot: position.slot,
        windowStart: start, windowEnd: new Date(Date.parse(start) + len).toISOString(),
      })
      written++
    }
  }

  /* A position held for a named advertiser is only ever theirs, so it
     would sit nearly empty in the rotation above: give the holder a run of
     windows on it. */
  for (const position of positions) {
    for (const name of position.def.advertisers ?? []) {
      const brand = brands.find((x) => x.name === name)
      if (!brand) continue
      const dt = position.displayType
      const campaignId = (await campaignOf(brand.advertiserId, 'localised')) ??
        (await campaignFor(ctx, { ...brand, displayTypeId: dt.id }, '#37474f', dt.displayCanvasSize.width, dt.displayCanvasSize.height))
      for (const [k, day] of [1, 2, 5, 8, 12].entries()) {
        const id = `res_demo_held_${position.positionId}_${k}`
        const start = new Date(first + day * len).toISOString()
        if (ctx.reservations.get(id)) continue
        if (ctx.reservations.forWindow(position.positionId, start).some((r) => !r.testMode && ['won', 'reserved'].includes(r.status))) continue
        const cpm = MONEY[(k + 3) % MONEY.length]
        ctx.reservations.insert({
          id, partnerId: brand.partnerId, advertiserId: brand.advertiserId, campaignId, positionId: position.positionId, windowStart: start,
          type: 'reserve', channel: 'api', bidCpm: cpm, currency, status: 'reserved', clearingCpm: cpm, reason: null,
          testMode: false, pricingType: 'localised', handedOffAt: new Date().toISOString(),
        })
        ctx.campaigns.bookSlot({ id: `bk_demo_held_${position.positionId}_${k}`, campaignId, displayTypeId: dt.id, slot: position.slot, windowStart: start, windowEnd: new Date(Date.parse(start) + len).toISOString() })
        written++
      }
    }
  }

  /* Two windows that have already played, on the Landscape hero slot. */
  const hero = positions.find((p) => p.positionId === 'landscape.s1')
  if (hero && !ctx.reservations.get('res_demo_past_cocacola')) {
    const play = ctx.db.prepare('INSERT INTO plays (id, display_id, campaign_id, played_at, duration_sec) VALUES (?, ?, ?, ?, 12)')
    const displays = ctx.displays.listByDisplayType('landscape').slice(0, 4)
    for (const [k, past] of [['cocacola', 'c_demo_cocacola_zero', '2026-09-16'], ['arnotts', 'c_demo_arnotts_timtam', '2026-09-17']].entries()) {
      const [key, campaignId, day] = past
      if (!ctx.campaigns.getCampaign(campaignId)) continue
      const start = `${day}T00:00:00.000Z`
      const brand = brands.find((x) => x.advertiserId === advertiserSlug(key === 'cocacola' ? 'Coca-Cola' : 'Arnott’s'))
      if (!brand) continue
      ctx.reservations.insert({
        id: `res_demo_past_${key}`, partnerId: brand.partnerId, advertiserId: brand.advertiserId, campaignId, positionId: hero.positionId, windowStart: start,
        type: 'bid', channel: 'openrtb', bidCpm: 160 + k * 20, currency, status: 'won', clearingCpm: 160 + k * 20, reason: null, testMode: false,
        pricingType: 'localised', handedOffAt: `${day}T00:00:00.000Z`,
      })
      ctx.campaigns.bookSlot({ id: `bk_demo_past_${key}`, campaignId, displayTypeId: 'landscape', slot: hero.slot, windowStart: start, windowEnd: new Date(Date.parse(start) + len).toISOString() })
      const t0 = Date.parse(start)
      tx(ctx.db, () => {
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
