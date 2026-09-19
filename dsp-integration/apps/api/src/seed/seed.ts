/* Seed data = the prototype's sample data (prototype-reference/src/model/
   data.js), reshaped to the API contract. Decision 1: the prototype's four
   Responsive Web display types are not seeded. */
import { advertiserSlug } from '@ph-dsp/types'
import { generateKeyPairSync } from 'node:crypto'
import type { Context } from '../context'
import { seedCampaigns } from './campaigns'
import { tx } from '../db/db'

const blankFeatures = () => ({
  inStoreRadio: { enabled: false },
  proximityMist: { enabled: false, mode: 'zone', zone: 'Personalisation Hub Demo - Welcome Zone' },
  aiAgentPlayback: { enabled: false },
  visionAi: { enabled: false, mode: 'Monitor Passerby & Campaign Engagement Data', preset: 'Balanced', streamQuality: 640, fps: 15, frameSkip: 5, missThreshold: 15 },
})
const qrControl = (over: { phantom?: { width?: number; height?: number } } = {}) => ({
  enabled: true,
  phantomArea: { enabled: true, width: over.phantom?.width ?? 250, height: over.phantom?.height ?? 250, position: null, sizingMode: 'Fit to Display' },
  qrCode: { size: 100, colour: '#000000', position: null },
  connectedIconColour: '#169bc2',
  mobileSiteTemplate: 'Mobile App',
  connected: { icon: 'smartphone', showPoweredBy: true, poweredByText: 'Powered by Personalisation Hub' },
})
const playlistSettings = (cap: number | null = null) => ({
  assetPosition: null, assetFill: null, maximumCampaignsPlayedInRotation: cap, campaignTransition: null, campaignAutoRotation: null, campaignAutoPlay: null,
})
const slot = (label: string, owner: 'internal' | 'advertiser' | 'retail', over: Record<string, unknown> = {}) => ({
  label, owner, partnerId: null, advertiser: null, listMode: null, storeScope: null, quota: null, ...over,
})

type Item = [id: string, campaignId: string, priority: number, playbackDuration: number, campaignType: string[]]
const items = (...xs: Item[]) => xs.map(([id, campaignId, priority, playbackDuration, campaignType]) => ({ id, campaignId, priority, playbackDuration, campaignType, enabled: true }))

export const SEED_PLAYLISTS = [
  { id: 'pl_landscape', name: 'Landscape Playlist', autoCreatedFor: 'landscape', items: items(['pi_1', 'c_zinger', 1, 10, ['LOCALISED', 'ON_ROTATION']], ['pi_2', 'c_wings', 2, 8, ['LOCALISED', 'ON_ROTATION']], ['pi_3', 'c_pepsi', 3, 8, ['LOCALISED', 'ON_ROTATION']], ['pi_4', 'c_family', 4, 12, ['LOCALISED', 'ON_ROTATION']], ['pi_5', 'c_loyalty', 5, 8, ['TRIGGERED', 'TARGETED']]) },
  { id: 'pl_portrait', name: 'Portrait Playlist', autoCreatedFor: 'portrait', items: items(['pi_6', 'c_queue', 1, 12, ['TRIGGERED']], ['pi_7', 'c_wings', 2, 8, ['LOCALISED', 'ON_ROTATION']]) },
  { id: 'pl_menu', name: 'Menu Board Playlist', autoCreatedFor: 'menu_board', items: items(['pi_8', 'c_notice', 1, 15, ['LOCALISED', 'ON_ROTATION']]) },
  { id: 'pl_web_hero', name: 'Web Hero Playlist', autoCreatedFor: null, items: items(['pi_14', 'c_zinger', 1, 8, ['LOCALISED']]) },
  { id: 'pl_mss_default', name: 'Default Mobile Store Site Playlist', autoCreatedFor: null, items: items(['pi_15', 'c_wings', 1, 6, ['LOCALISED']], ['pi_16', 'c_family', 2, 6, ['LOCALISED']]) },
  { id: 'pl_zone_menu_board_1', name: 'Menu Board — Long Format / Zone 1', autoCreatedFor: 'menu_board', items: items(['pi_9', 'c_menu_l', 1, 30, ['LOCALISED', 'ON_ROTATION']]) },
  { id: 'pl_zone_menu_board_2', name: 'Menu Board — Long Format / Zone 2', autoCreatedFor: 'menu_board', items: items(['pi_10', 'c_menu_c', 1, 30, ['LOCALISED', 'ON_ROTATION']]) },
  { id: 'pl_zone_menu_board_3', name: 'Menu Board — Long Format / Zone 3', autoCreatedFor: 'menu_board', items: items(['pi_11', 'c_zinger', 1, 10, ['LOCALISED', 'ON_ROTATION']], ['pi_12', 'c_pepsi', 2, 8, ['LOCALISED', 'ON_ROTATION']], ['pi_13', 'c_menu_r', 3, 20, ['LOCALISED', 'ON_ROTATION']]) },
  { id: 'pl_promo', name: 'Promo Rotation', autoCreatedFor: null, items: items(['pi_17', 'c_wings', 1, 8, ['LOCALISED', 'ON_ROTATION']], ['pi_18', 'c_family', 2, 8, ['LOCALISED', 'ON_ROTATION']], ['pi_19', 'c_pepsi', 3, 8, ['LOCALISED', 'ON_ROTATION']], ['pi_20', 'c_breakfast', 4, 8, ['TRIGGERED']]) },
  { id: 'pl_notices', name: 'Store Notices', autoCreatedFor: null, items: items(['pi_21', 'c_notice', 1, 15, ['LOCALISED', 'ON_ROTATION']]) },
  { id: 'pl_seasonal', name: 'Seasonal Overflow', autoCreatedFor: null, items: [] },
  { id: 'pl_archive', name: 'Archived Q1 Campaigns', autoCreatedFor: null, items: [] },
]

export const SEED_DISPLAY_TYPES = [
  {
    id: 'landscape', name: 'Landscape', touchPoint: 'Digital Signage', description: null, displayCanvasSize: { width: 1920, height: 1080 }, backgroundColor: '#000000',
    defaultPlaylistId: 'pl_landscape', playlistSettings: playlistSettings(), qrControl: qrControl(),
    enabledFeatures: { ...blankFeatures(), visionAi: { ...blankFeatures().visionAi, enabled: true } }, multiZone: { enabled: false, zones: [] },
    phExtensions: { slots: [], venue: { openOohVenueType: 'retail.grocery', orientation: 'landscape' as const, loopLengthSec: 46 } },
  },
  {
    id: 'portrait', name: 'Portrait', touchPoint: 'Digital Signage', description: null, displayCanvasSize: { width: 1080, height: 1920 }, backgroundColor: '#000000',
    defaultPlaylistId: 'pl_portrait', playlistSettings: playlistSettings(), qrControl: qrControl({ phantom: { width: 220, height: 220 } }),
    enabledFeatures: { ...blankFeatures(), proximityMist: { enabled: true, mode: 'zone', zone: 'Front of Store' } }, multiZone: { enabled: false, zones: [] },
    phExtensions: { slots: [], venue: { openOohVenueType: 'retail.grocery', orientation: 'portrait' as const, loopLengthSec: 20 } },
  },
  {
    id: 'menu_board', name: 'Menu Board — Long Format', touchPoint: 'Digital Signage', description: null, displayCanvasSize: { width: 5760, height: 1080 }, backgroundColor: '#111111',
    defaultPlaylistId: 'pl_menu', playlistSettings: playlistSettings(3), qrControl: qrControl(),
    enabledFeatures: { ...blankFeatures(), visionAi: { ...blankFeatures().visionAi, enabled: true } },
    multiZone: { enabled: true, zones: [
      { id: 'z1', name: 'Zone 1', x: 0, y: 0, width: 33.3, height: 100, playlistId: 'pl_zone_menu_board_1' },
      { id: 'z2', name: 'Zone 2', x: 33.3, y: 0, width: 33.4, height: 100, playlistId: 'pl_zone_menu_board_2' },
      { id: 'z3', name: 'Zone 3', x: 66.7, y: 0, width: 33.3, height: 100, playlistId: 'pl_zone_menu_board_3' },
    ] },
    phExtensions: {
      slots: [
        slot('Priority 1', 'internal'),
        slot('Supplier slot', 'advertiser', { partnerId: 'p_google', listMode: 'rtb' }),
        slot('Store choice', 'retail', { storeScope: 'Store staff' }),
      ],
      venue: { openOohVenueType: 'retail.grocery', orientation: 'landscape' as const, loopLengthSec: 45 },
    },
  },
]

/* The platform's stores (StoreSource stand-in), with their regions. */
export const SEED_STORES = [
  { id: 'st_sydney_cbd', name: 'Sydney CBD', region: 'Sydney Inner' },
  { id: 'st_parramatta', name: 'Parramatta', region: 'Western Sydney' },
  { id: 'st_chatswood', name: 'Chatswood', region: 'North Shore' },
  { id: 'st_bondi_junction', name: 'Bondi Junction', region: 'Eastern Suburbs' },
]

export const SEED_DISPLAYS = [
  { id: 'd_1001', name: 'Entrance Screen', store: 'Sydney CBD', displayTypeId: 'landscape' },
  { id: 'd_1002', name: 'Checkout Screen', store: 'Sydney CBD', displayTypeId: 'landscape' },
  { id: 'd_1003', name: 'Aisle 3 Portrait', store: 'Parramatta', displayTypeId: 'portrait' },
  { id: 'd_1004', name: 'Menu Board', store: 'Sydney CBD', displayTypeId: 'menu_board' },
  { id: 'd_1005', name: 'Menu Board', store: 'Chatswood', displayTypeId: 'menu_board' },
  { id: 'd_1006', name: 'Menu Board', store: 'Bondi Junction', displayTypeId: 'menu_board' },
]

/* The HQ campaign catalogue the seeded playlists reference (HQ-authored). */
export const SEED_CAMPAIGNS = [
  ['c_zinger', 'Zinger Box — hero'], ['c_wings', 'Wicked Wings 6pk'], ['c_family', 'Family Feast'], ['c_breakfast', 'Breakfast till 11'],
  ['c_pepsi', 'Pepsi Max 600ml'], ['c_notice', 'Store notice — allergens'], ['c_queue', 'Join the queue from your phone'],
  ['c_menu_l', 'Menu — left panel'], ['c_menu_c', 'Menu — centre panel'], ['c_menu_r', 'Menu — right panel'], ['c_loyalty', 'Gold member double points'],
] as const

const serviceAccountKeyFile = (clientEmail: string) =>
  JSON.stringify({
    type: 'service_account', project_id: 'ph-demo', client_email: clientEmail,
    private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  })

export async function seed(ctx: Context) {
  if (ctx.displayTypes.list().length) return false
  tx(ctx.db, () => {
    SEED_PLAYLISTS.forEach((p) => ctx.playlists.create(p))
    SEED_DISPLAY_TYPES.forEach((d) => ctx.displayTypes.create(d))
    const insStore = ctx.db.prepare('INSERT INTO stores (id, name, region) VALUES (?, ?, ?)')
    SEED_STORES.forEach((s) => insStore.run(s.id, s.name, s.region))
    const insDisplay = ctx.db.prepare('INSERT INTO displays (id, name, store, store_id, display_type_id) VALUES (?, ?, ?, ?, ?)')
    SEED_DISPLAYS.forEach((d) => insDisplay.run(d.id, d.name, d.store, SEED_STORES.find((s) => s.name === d.store)!.id, d.displayTypeId))
    const insCampaign = ctx.db.prepare("INSERT INTO campaigns (id, name, targeting, created_at, source, activation_enabled) VALUES (?, ?, NULL, ?, 'hq', 1)")
    SEED_CAMPAIGNS.forEach(([id, name]) => insCampaign.run(id, name, '2026-09-01T00:00:00.000Z'))

    ctx.partners.insert({
      id: 'p_google', provider: 'google_dv360', name: 'Google DSP', status: 'connected', mode: 'live', lastSync: 'Today, 07:12',
      credsPublic: { partnerId: '884512', serviceAccountEmail: 'ph-retail-media@ph-demo.iam.gserviceaccount.com' },
      /* A freshly generated key in the real key-file format, so Connect works against the mock DV360. */
      secrets: { privateKeyJson: serviceAccountKeyFile('ph-retail-media@ph-demo.iam.gserviceaccount.com') },
      bidder: { bidderEndpoint: 'https://rtb.doubleclick.net/openrtb2/bid', seatIds: ['884512', '884513'] },
      seats: [{ id: '5130001', name: 'Nestlé', domain: 'nestle.com' }, { id: '5130002', name: 'Swisse', domain: 'swisse.com' }], listsLinked: true, allowList: [], blockList: [],
    })
    ctx.partners.insert({
      id: 'p_amazon', provider: 'amazon_dsp', name: 'Amazon Ads DSP', status: 'error', mode: 'test', lastSync: 'Refresh token rejected — 3 days ago',
      credsPublic: { region: 'Europe (EU)', lwaClientId: 'amzn1.application-oa2-client.7f3c', profileId: '3390127745', entityId: 'ENTITY8Q1R5T' },
      secrets: { lwaClientSecret: 'poc-placeholder-secret', refreshToken: 'Atzr|poc-placeholder' },
      bidder: {}, seats: [{ id: '588104411', name: "L'Oréal", domain: 'loreal.com' }], listsLinked: false, allowList: ["L'Oréal"], blockList: ['Red Bull', 'Chemist Warehouse'],
    })

    ctx.company.save({
      currency: 'AUD', floorCpm: 100, personalisedMultiplier: 1.5, interactiveMultiplier: 3,
      advertiserWhitelist: ['Nestlé', 'Swisse', 'Arnott’s'], advertiserBlacklist: ['Red Bull', 'Monster Energy'],
      categoryWhitelist: ['Food & Drink', 'Health & Fitness'], categoryBlacklist: ['Finance'],
    })
    ctx.company.saveAdvertiserSettings({
      [advertiserSlug('Nestlé')]: { approvalRequired: false, floorMultiplier: 0.8 },
      [advertiserSlug('Swisse')]: { approvalRequired: true, floorMultiplier: 1 },
      [advertiserSlug("L'Oréal")]: { approvalRequired: true, floorMultiplier: 1.2 },
    })
    ctx.company.saveVariableAccess({
      'store.suburb': [], 'store.postcode': [], 'store.country': [], 'store.languages': [],
      'store.reason_for_visit': ['p_google'], 'visitor.purchase_intent': ['p_google'],
    })
    /* Assumed views (VAC-d) per play window for each advertiser slot (AudienceSource
       stand-in): 412 per display, as in API.md's example bid request, across the
       three Menu Boards. Vision/AI is on for Menu Board, so the count is sensor-derived. */
    ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, ?)').run('menu_board', 2, 1236, 1)
    ctx.exchange.save({ organisation: 'Demo Retail Group', domain: 'demoretail.example', sellerId: 'drg-4471', contactEmail: 'adops@demoretail.example' })
  })
  await seedCampaigns(ctx)
  return true
}

