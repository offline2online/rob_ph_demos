/* Display Types — pure helpers ported from the prototype
   (prototype-reference/src/DisplayTypesAndPlaylists.jsx, model/schema.js,
   model/sellside.js), reshaped to the API contract. */
import {
  PLATFORM_DEFAULTS, SLOT_OWNERS, UNLIMITED,
  type AdvertiserSettings, type DisplayType, type Partner, type Slot, type SlotOwner,
} from '@ph-dsp/types'

/* ------------------------------------------------------------- options */

export const ASSET_POSITIONS = ['Top-Left', 'Top-Right', 'Center', 'Bottom-Left', 'Bottom-Right']
export const ASSET_FILLS = ['Fit to Display', 'Maintain Asset Property', 'Fill', 'Stretch']
export const ROTATION_CAPS = ['Unlimited', '1', '2', '3', '4', '5', '6', '8', '10', '12']
export const CAMPAIGN_TRANSITIONS = ['None', 'Fade', 'Slide']
export const AUTO_ROTATION = ['Auto-Rotate On', 'Auto-Rotate Off']
export const AUTO_PLAY = ['Auto-Play On', 'Auto-Play Off']
export const PHANTOM_POSITIONS = ['Top Left', 'Top Right', 'Bottom Left', 'Bottom Right', 'Center']
export const PHANTOM_SIZING_MODES = ['Fit to Display', 'Fixed', 'Scale to Content']
export const MOBILE_SITE_TEMPLATES = ['Mobile App', 'Pharmacy - Store Connect', 'PH Walk-Thru']
export const MIST_ZONES = ['Personalisation Hub Demo - Welcome Zone', 'Front of Store', 'Aisle 3', 'Checkout Queue', 'Service Desk']
export const VISION_MODES = ['Monitor Passerby & Campaign Engagement Data', 'Passerby Count Only', 'Targeting & Personalisation', 'Engagement Only']
export const DETECTION_PRESETS: Record<string, Record<string, number>> = {
  Fast: { streamQuality: 480, fps: 10, frameSkip: 7, missThreshold: 10 },
  Balanced: { streamQuality: 640, fps: 15, frameSkip: 5, missThreshold: 15 },
  Accurate: { streamQuality: 1280, fps: 24, frameSkip: 2, missThreshold: 24 },
  Custom: {},
}
export const ZONE_COLOURS = ['#169bc2', '#9747ff', '#52c41a', '#faad14', '#ef60a7', '#0891b2']

/* -------------------------------------------------------- record shape */

export interface PlaylistSettings {
  assetPosition: string | null
  assetFill: string | null
  maximumCampaignsPlayedInRotation: number | null
  campaignTransition: string | null
  campaignAutoRotation: string | null
  campaignAutoPlay: string | null
}
export interface QrControl {
  enabled: boolean
  phantomArea: { enabled: boolean; width: number; height: number; position: string | null; sizingMode: string }
  qrCode: { size: number; colour: string; position: string | null }
  connectedIconColour: string
  mobileSiteTemplate: string
  [k: string]: unknown
}
export interface FeatureConfig { enabled: boolean; [k: string]: unknown }
export interface Zone { id: string; name: string; x: number; y: number; width: number; height: number; playlistId: string; [k: string]: unknown }
export interface MultiZone { enabled: boolean; zones: Zone[] }

export const ps = (d: DisplayType) => d.playlistSettings as unknown as PlaylistSettings
export const qr = (d: DisplayType) => d.qrControl as unknown as QrControl
export const features = (d: DisplayType) => (d.enabledFeatures ?? {}) as unknown as Record<string, FeatureConfig>
export const mz = (d: DisplayType) => (d.multiZone ?? { enabled: false, zones: [] }) as unknown as MultiZone
export const slotsOf = (d: DisplayType) => d.phExtensions?.slots ?? []

export const blankQrControl = (): QrControl => ({
  enabled: false,
  phantomArea: { enabled: false, width: 250, height: 250, position: null, sizingMode: 'Fit to Display' },
  qrCode: { size: 100, colour: '#000000', position: null },
  connectedIconColour: '#169bc2',
  mobileSiteTemplate: 'Mobile App',
  connected: { icon: 'smartphone', showPoweredBy: true, poweredByText: 'Powered by Personalisation Hub' },
})
export const blankFeatures = (): Record<string, FeatureConfig> => ({
  inStoreRadio: { enabled: false },
  proximityMist: { enabled: false, mode: 'zone', zone: MIST_ZONES[0] },
  aiAgentPlayback: { enabled: false },
  visionAi: { enabled: false, mode: VISION_MODES[0], preset: 'Balanced', ...DETECTION_PRESETS.Balanced },
})

/* New display type (prototype: "New display type"): Digital Signage, 1920×1080,
   #333333, rotation explicitly Unlimited, with an auto-created playlist. */
export function newDisplayType(id: string): DisplayType {
  return {
    id, name: '', touchPoint: 'Digital Signage', description: null,
    displayCanvasSize: { width: 1920, height: 1080 }, backgroundColor: '#333333', defaultPlaylistId: `pl_${id}`,
    playlistSettings: { assetPosition: null, assetFill: null, maximumCampaignsPlayedInRotation: UNLIMITED, campaignTransition: null, campaignAutoRotation: null, campaignAutoPlay: null },
    qrControl: blankQrControl() as unknown as DisplayType['qrControl'],
    enabledFeatures: blankFeatures() as unknown as DisplayType['enabledFeatures'],
    multiZone: { enabled: false, zones: [] },
    phExtensions: { slots: [] },
  }
}

/* --------------------------------------------------------------- slots */

export const DEFAULTS = PLATFORM_DEFAULTS.playlistSettings
export const rotationCap = (d: DisplayType) => ps(d).maximumCampaignsPlayedInRotation ?? DEFAULTS.maximumCampaignsPlayedInRotation
export const isCapped = (d: DisplayType) => rotationCap(d) !== UNLIMITED
export const slotCount = (d: DisplayType) => (isCapped(d) ? Number(rotationCap(d)) : 0)
/* The rotation cap as the select shows it: null = Default, "Unlimited", or "n". */
export const capValue = (d: DisplayType): string | null => {
  const v = ps(d).maximumCampaignsPlayedInRotation
  return v === null || v === undefined ? null : v === UNLIMITED ? 'Unlimited' : String(v)
}
export const newSlot = (i: number): Slot => ({ label: `Slot ${i + 1}`, owner: 'internal', partnerId: null, advertiser: null, listMode: null, storeScope: null, quota: null })
/* Resize the slot list to a new cap, keeping what was there. */
export const resizeSlots = (slots: Slot[], n: number): Slot[] => {
  const next = [...slots]
  while (next.length < n) next.push(newSlot(next.length))
  return next.slice(0, Math.max(0, n))
}
/* Slots always match the rotation cap in the editor. */
export const normaliseSlots = (d: DisplayType): DisplayType =>
  slotsOf(d).length === slotCount(d) ? d : { ...d, phExtensions: { ...(d.phExtensions ?? {}), slots: resizeSlots(slotsOf(d), slotCount(d)) } }

export const ownerChange = (owner: SlotOwner): Partial<Slot> => ({
  owner,
  partnerId: null,
  advertiser: null,
  listMode: owner === 'advertiser' ? 'rtb' : null,
  storeScope: owner === 'retail' ? 'Store staff' : null,
})

/* --------------------------------------------------------------- lists */

export interface Lists { allowList: string[]; blockList: string[] }
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
export const effectiveLists = (p: Partner | null | undefined, company: AdvertiserSettings | undefined): Lists =>
  p && p.listsLinked === false
    ? { allowList: p.advertiserWhitelist ?? [], blockList: p.advertiserBlacklist ?? [] }
    : { allowList: company?.advertiserWhitelist ?? [], blockList: company?.advertiserBlacklist ?? [] }
export const isBlocked = (name: string, lists: Lists) => lists.blockList.some((x) => same(x, name))

/* Switching partner keeps the choice only if the new partner can honour it. */
export function partnerChange(sl: Slot, next: Partner | null, company: AdvertiserSettings | undefined, seatsOf: (p: Partner) => string[]): Partial<Slot> {
  const eff = effectiveLists(next, company)
  const keepWhitelist = sl.listMode === 'whitelist_only' && !!next && eff.allowList.length > 0
  const keepNamed = !!sl.advertiser && !!next && seatsOf(next).includes(sl.advertiser) && !isBlocked(sl.advertiser, eff)
  if (keepWhitelist) return { partnerId: next?.id ?? null, listMode: 'whitelist_only', advertiser: null }
  if (keepNamed) return { partnerId: next?.id ?? null, listMode: null, advertiser: sl.advertiser }
  return { partnerId: next?.id ?? null, listMode: 'rtb', advertiser: null }
}

/* One line describing what a slot is assigned to (sellside.js ownerAssignment). */
export function ownerAssignment(sl: Slot, partners: Partner[], company: AdvertiserSettings | undefined): string {
  if (sl.owner === 'internal') return 'Based on priority'
  if (sl.owner === 'retail') return sl.storeScope || 'Store staff'
  if (!sl.partnerId) return 'Any connected DSP · RTB'
  const p = partners.find((x) => x.id === sl.partnerId)
  if (!p) return 'Partner missing'
  const eff = effectiveLists(p, company)
  if (sl.listMode === 'whitelist_only') return `${p.name} · whitelist (${eff.allowList.length})`
  if (!sl.advertiser) return `${p.name} · RTB${eff.blockList.length ? ` (−${eff.blockList.length} blocked)` : ''}`
  return `${p.name} · ${sl.advertiser}`
}

/* ------------------------------------------------------------ features */

/* Stand-in for the company's feature availability (Company → Display Type
   → Display inheritance, spec §1), which the existing platform owns and the
   contract doesn't expose. Values are the prototype's. */
export const COMPANY_FEATURE_AVAILABILITY: Record<FeatureKey, boolean> = {
  in_store_radio: false, qr_control: true, proximity_mist: true, ai_agent_playback: false, vision_ai: true,
}
export type FeatureKey = 'in_store_radio' | 'qr_control' | 'proximity_mist' | 'ai_agent_playback' | 'vision_ai'
export const FEATURES: { key: FeatureKey; icon: string; label: string; short: string; hint: string }[] = [
  { key: 'in_store_radio', icon: 'music_note', label: 'Enable In-Store Radio', short: 'In-Store Radio', hint: 'Synchronised in-store audio.' },
  { key: 'qr_control', icon: 'qr_code_2', label: 'Enable QR Control', short: 'QR Control', hint: 'Renders the pairing QR inside the phantom zone so a customer can pair a device to this surface.' },
  { key: 'proximity_mist', icon: 'sensors', label: 'Enable Proximity based Personalisation (using MIST)', short: 'MIST', hint: 'Triggers personalisation from a MIST zone or vBeacon rather than a scan.' },
  { key: 'ai_agent_playback', icon: 'smart_toy', label: 'Allow AI-Agents to Control Campaign Playback', short: 'AI Agent', hint: 'A connected AI Agent sees every Active, AI-Agent-Enabled campaign assigned to this display and can trigger playback. Campaigns without that flag stay invisible to the agent.' },
  { key: 'vision_ai', icon: 'visibility', label: 'Enable Vision/AI (BETA)', short: 'Vision/AI', hint: 'On-device passerby insight and person match. Emits confidence-scored attributes.' },
]
const FEATURE_PATH: Record<Exclude<FeatureKey, 'qr_control'>, string> = { in_store_radio: 'inStoreRadio', proximity_mist: 'proximityMist', ai_agent_playback: 'aiAgentPlayback', vision_ai: 'visionAi' }

export const featureOn = (d: DisplayType, key: FeatureKey) => (key === 'qr_control' ? !!qr(d).enabled : !!features(d)[FEATURE_PATH[key]]?.enabled)
export const featureConfig = (d: DisplayType, key: Exclude<FeatureKey, 'qr_control'>): FeatureConfig => features(d)[FEATURE_PATH[key]] ?? { enabled: false }
export const withFeature = (d: DisplayType, key: Exclude<FeatureKey, 'qr_control'>, patch: Record<string, unknown>): DisplayType => ({
  ...d,
  enabledFeatures: { ...features(d), [FEATURE_PATH[key]]: { ...featureConfig(d, key), ...patch } } as unknown as DisplayType['enabledFeatures'],
})
export const withQr = (d: DisplayType, patch: (q: QrControl) => QrControl): DisplayType => ({ ...d, qrControl: patch(qr(d)) as unknown as DisplayType['qrControl'] })
/* Enabled and available to the company. */
export const enabledFeatures = (d: DisplayType) => FEATURES.filter((f) => COMPANY_FEATURE_AVAILABILITY[f.key] && featureOn(d, f.key))

/* Structural markers shown against a display type in the list. */
export const STRUCTURE_MARKERS: { key: string; icon: string; label: string; test: (d: DisplayType) => boolean }[] = [
  { key: 'phantom', icon: 'crop_free', label: 'Phantom zone defined', test: (d) => !!qr(d).phantomArea?.enabled },
  { key: 'zones', icon: 'grid_view', label: 'Multi-zone layout', test: (d) => mz(d).enabled },
  { key: 'slots', icon: 'view_week', label: 'Capped rotation with assigned slots', test: (d) => isCapped(d) },
]

/* ------------------------------------------------ collapsed summaries */

export interface Chip { key: string; label: string; icon?: string; tone: 'on' | 'default'; colour?: string }

/* Playlist Settings: slot count and slot assignment by owner when capped;
   "n settings changed"; or a single grey "Default settings" (spec §1). */
export function playlistSummary(d: DisplayType, showOwners: boolean): Chip[] {
  const s = ps(d)
  const overrides = (Object.keys(s) as (keyof PlaylistSettings)[]).filter((k) => k !== 'maximumCampaignsPlayedInRotation' && s[k] !== null && s[k] !== undefined)
  const chips: Chip[] = []
  if (isCapped(d)) {
    chips.push({ key: 'slots', icon: 'view_week', label: `${slotCount(d)} slots`, tone: 'on' })
    if (showOwners) {
      for (const o of ['internal', 'advertiser', 'retail'] as SlotOwner[]) {
        const n = slotsOf(d).filter((x) => x.owner === o).length
        if (n) chips.push({ key: o, icon: SLOT_OWNERS[o].icon, label: `${n} ${SLOT_OWNERS[o].label}`, tone: 'on', colour: SLOT_OWNERS[o].colour })
      }
    }
  }
  if (overrides.length) chips.push({ key: 'changed', icon: 'tune', label: `${overrides.length} setting${overrides.length > 1 ? 's' : ''} changed`, tone: 'on' })
  if (!isCapped(d) && !overrides.length) chips.push({ key: 'default', label: 'Default settings', tone: 'default' })
  return chips
}

export function phantomSummary(d: DisplayType): Chip[] {
  const pa = qr(d).phantomArea
  if (!pa?.enabled) return [{ key: 'none', label: 'Not defined', tone: 'default' }]
  return [
    { key: 'size', icon: 'crop_free', label: `${pa.width}×${pa.height}`, tone: 'on' },
    { key: 'pos', icon: 'place', label: pa.position || `Default (${PLATFORM_DEFAULTS.phantomAreaPosition})`, tone: pa.position ? 'on' : 'default' },
  ]
}

export function featuresSummary(d: DisplayType): Chip[] {
  const on = enabledFeatures(d)
  return on.length ? on.map((f) => ({ key: f.key, icon: f.icon, label: f.short, tone: 'on' as const, colour: '#52c41a' })) : [{ key: 'none', label: 'None enabled', tone: 'default' }]
}

export function zonesSummary(d: DisplayType): Chip[] {
  const z = mz(d)
  return z.enabled ? [{ key: 'zones', icon: 'grid_view', label: `${z.zones.length} zone${z.zones.length !== 1 ? 's' : ''}`, tone: 'on' }] : [{ key: 'single', label: 'Single zone', tone: 'default' }]
}
