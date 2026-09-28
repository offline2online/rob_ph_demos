/* Display Types — pure helpers ported from the prototype
   (prototype-reference/src/DisplayTypesAndPlaylists.jsx, model/schema.js,
   model/sellside.js), reshaped to the API contract. */
import {
  NEW_PLAYLIST_SETTINGS_DEFAULTS, PLATFORM_DEFAULTS, SLOT_OWNERS, UNLIMITED, assignedOf,
  type AdvertiserSettings, type DisplayType, type Partner, type Playlist, type Slot, type SlotOwner, type TouchPoint,
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

/* 26 Sep 2026: split off the display type. Maximum Campaigns Played In
   Rotation and slot assignment stay here — they size and sell that specific
   screen's positions. The other five (asset position/fill, transition,
   auto-rotation, auto-play) moved to the playlist itself, below, so they can
   be set on a playlist that isn't assigned to a display type yet. */
export interface CapSettings {
  maximumCampaignsPlayedInRotation: number | null
}
export interface PlaylistStyleSettings {
  assetPosition: string | null
  assetFill: string | null
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
/* A zone carries its own Maximum Campaigns Played In Rotation (28 Sep 2026):
   each zone runs its own playlist, so each has its own rotation and its own
   slots. null/absent = the platform default (Unlimited, no slots). */
export interface Zone { id: string; name: string; x: number; y: number; width: number; height: number; playlistId: string; maximumCampaignsPlayedInRotation?: number | null; [k: string]: unknown }
export interface MultiZone { enabled: boolean; zones: Zone[] }

export const capOf = (d: DisplayType) => d.playlistSettings as unknown as CapSettings
/* A playlist's own settings, whether or not it is currently assigned to a
   display type — an unassigned playlist's `playlistSettings` is `{}`
   (nothing overridden), same "null/absent means inherit" rule as capOf. */
export const styleOf = (p: Playlist) => (p.playlistSettings ?? {}) as unknown as PlaylistStyleSettings
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

/* Canvas defaults applied when a brand-new display type's Touch Point is
   switched to one of these (ticket, 28 Sep 2026: "Website default
   1920×1080, Mobile App default 330×400"). Digital Signage and Kiosk are
   deliberately not keys here — switching between them has never reset the
   canvas, and this must not start doing so ("must not change existing...
   flows"). Only applies while the display type is still new: an existing
   one's canvas is never touched by a Touch Point change. */
export const TOUCH_POINT_CANVAS_DEFAULTS: Partial<Record<TouchPoint, { width: number; height: number }>> = {
  Website: { width: 1920, height: 1080 },
  'Mobile App': { width: 330, height: 400 },
}

/* New display type (prototype: "New display type"): Digital Signage, 1920×1080,
   #333333, every playlist setting at its default (rotation "Default
   (Unlimited)", ticket 28 Sep 2026), with an auto-created playlist. */
export function newDisplayType(id: string): DisplayType {
  return {
    id, name: '', touchPoint: 'Digital Signage', description: null,
    displayCanvasSize: { width: 1920, height: 1080 }, backgroundColor: '#333333', defaultPlaylistId: `pl_${id}`,
    playlistSettings: { maximumCampaignsPlayedInRotation: null },
    qrControl: blankQrControl() as unknown as DisplayType['qrControl'],
    enabledFeatures: blankFeatures() as unknown as DisplayType['enabledFeatures'],
    multiZone: { enabled: false, zones: [] },
    phExtensions: { slots: [] },
  }
}

/* --------------------------------------------------------------- slots */

export const DEFAULTS = PLATFORM_DEFAULTS.playlistSettings
export const rotationCap = (d: DisplayType) => capOf(d).maximumCampaignsPlayedInRotation ?? DEFAULTS.maximumCampaignsPlayedInRotation
export const isCapped = (d: DisplayType) => rotationCap(d) !== UNLIMITED
export const slotCount = (d: DisplayType) => (isCapped(d) ? Number(rotationCap(d)) : 0)
/* The rotation cap as the select shows it: null = Default, "Unlimited", or "n". */
export const capValue = (d: DisplayType): string | null => {
  const v = capOf(d).maximumCampaignsPlayedInRotation
  return v === null || v === undefined ? null : v === UNLIMITED ? 'Unlimited' : String(v)
}
export const newSlot = (i: number): Slot => ({ label: `Slot ${i + 1}`, owner: 'internal', partnerIds: [], advertisers: [], listMode: null, storeScope: null, quota: null })
/* Resize the slot list to a new cap, keeping what was there. */
export const resizeSlots = (slots: Slot[], n: number): Slot[] => {
  const next = [...slots]
  while (next.length < n) next.push(newSlot(next.length))
  return next.slice(0, Math.max(0, n))
}

/* ---------------------------------------------------------------- zones */

/* Per-zone rotation and slots (ticket, 28 Sep 2026). On a multi-zone
   display type every zone runs its own playlist, so each zone has its own
   Maximum Campaigns Played In Rotation and its own slots: the display type's
   one `phExtensions.slots` list is one segment per zone, in zone order, each
   slot carrying its zone's id — never a "zone" a slot is tagged to by hand.
   A position is still identified by display type + slot number
   (PH-CORE-BOUNDARIES.md), so nothing about booking changes: a Menu Board
   with three zones of two slots simply has six positions. */
const countOfCap = (v: number | null | undefined) => (v === null || v === undefined || v === UNLIMITED ? 0 : Number(v))
export const isZoned = (d: DisplayType) => mz(d).enabled && mz(d).zones.length > 0
export const zoneOf = (d: DisplayType, zoneId: string | null | undefined): Zone | undefined => (zoneId && isZoned(d) ? mz(d).zones.find((z) => z.id === zoneId) : undefined)
export const zoneSlotCount = (z: Zone) => countOfCap(z.maximumCampaignsPlayedInRotation ?? DEFAULTS.maximumCampaignsPlayedInRotation)
/* A zone's cap as its select shows it: null = Default, "Unlimited", or "n". */
export const zoneCapValue = (z: Zone): string | null => {
  const v = z.maximumCampaignsPlayedInRotation
  return v === null || v === undefined ? null : v === UNLIMITED ? 'Unlimited' : String(v)
}
/* The cap and slot count one assignment edits: the zone's when the playlist
   fills a zone of a multi-zone display type, else the display type's own. */
export const capValueFor = (d: DisplayType, zoneId: string | null) => {
  const z = zoneOf(d, zoneId)
  return z ? zoneCapValue(z) : capValue(d)
}
export const slotCountFor = (d: DisplayType, zoneId: string | null) => {
  const z = zoneOf(d, zoneId)
  return z ? zoneSlotCount(z) : slotCount(d)
}
export const isCappedFor = (d: DisplayType, zoneId: string | null) => slotCountFor(d, zoneId) > 0
/* Every slot the display type should carry: one segment per zone when
   zoned, else its own cap. */
export const expectedSlotCount = (d: DisplayType) => (isZoned(d) ? mz(d).zones.reduce((n, z) => n + zoneSlotCount(z), 0) : slotCount(d))
/* Indexes into `slotsOf(d)` of the slots one assignment edits. A zoned
   display type's default playlist owns the layout, not a rotation, so it
   edits none. */
export const slotIndicesFor = (d: DisplayType, zoneId: string | null): number[] => {
  const slots = slotsOf(d)
  if (!isZoned(d)) return slots.map((_, i) => i)
  return zoneOf(d, zoneId) ? slots.flatMap((s, i) => (s.zoneId === zoneId ? [i] : [])) : []
}
const sameSlots = (a: Slot[], b: Slot[]) => a.length === b.length && a.every((s, i) => s === b[i])
/* Slots always match the rotation cap(s) in the editor: resized per zone
   segment on a zoned display type (a removed zone's slots go with it, a new
   or bigger zone gets new Headquarters slots), or as one list otherwise.
   Slots that belong to no current zone — the display type's own slots the
   moment zones are switched on, or a removed zone's — become the first
   zone's, and if that zone has no cap of its own yet it takes their count
   (28 Sep 2026): enabling zones keeps what was set up, it doesn't discard
   it. Same rule the API applies when it reads a record saved before zones
   had caps. */
export const normaliseSlots = (d: DisplayType): DisplayType => {
  const slots = slotsOf(d)
  if (!isZoned(d)) {
    const next = resizeSlots(slots, slotCount(d)).map((s) => (s.zoneId === undefined || s.zoneId === null ? s : { ...s, zoneId: null }))
    return sameSlots(next, slots) ? d : { ...d, phExtensions: { ...(d.phExtensions ?? {}), slots: next } }
  }
  const ids = new Set(mz(d).zones.map((z) => z.id))
  const stray = slots.filter((s) => !s.zoneId || !ids.has(s.zoneId))
  const first = mz(d).zones[0]
  const adopt = stray.length > 0 && (first.maximumCampaignsPlayedInRotation === null || first.maximumCampaignsPlayedInRotation === undefined)
  const zones = adopt ? mz(d).zones.map((z, i) => (i === 0 ? { ...z, maximumCampaignsPlayedInRotation: stray.length + slots.filter((s) => s.zoneId === z.id).length } : z)) : mz(d).zones
  const ofZone = (z: Zone, i: number) => [...slots.filter((s) => s.zoneId === z.id), ...(i === 0 ? stray : [])]
  const next = zones.flatMap((z, i) => resizeSlots(ofZone(z, i), zoneSlotCount(z)).map((s) => (s.zoneId === z.id ? s : { ...s, zoneId: z.id })))
  if (!adopt && sameSlots(next, slots)) return d
  return {
    ...d,
    ...(adopt ? { multiZone: { ...mz(d), zones } as unknown as DisplayType['multiZone'] } : {}),
    phExtensions: { ...(d.phExtensions ?? {}), slots: next },
  }
}

/* Changing the owner only changes the owner: who a sellable position is
   assigned to is set on Advertisers / Inventory, and the API keeps or drops
   it with the owner (Rob, 20 Sep). */
export const ownerChange = (owner: SlotOwner): Partial<Slot> => ({ owner })

/* --------------------------------------------------------------- lists */

export interface Lists { allowList: string[]; blockList: string[] }
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
export const effectiveLists = (p: Partner | null | undefined, company: AdvertiserSettings | undefined): Lists =>
  p && p.listsLinked === false
    ? { allowList: p.advertiserWhitelist ?? [], blockList: p.advertiserBlacklist ?? [] }
    : { allowList: company?.advertiserWhitelist ?? [], blockList: company?.advertiserBlacklist ?? [] }
export const isBlocked = (name: string, lists: Lists) => lists.blockList.some((x) => same(x, name))

/* One line describing what a slot is assigned to (sellside.js
   ownerAssignment). Read-only here: it is set on Advertisers / Inventory. */
export function ownerAssignment(sl: Slot, partners: Partner[]): string {
  if (sl.owner === 'internal') return 'Based on priority'
  if (sl.owner === 'retail') return sl.storeScope || 'Store staff'
  const a = assignedOf(sl)
  if (a.advertisers.length) return a.advertisers.join(', ')
  const names = a.partnerIds.map((id) => partners.find((x) => x.id === id)?.name ?? id)
  if (a.whitelistOnly) return `${names.join(', ') || 'Any connected DSP'} · whitelist`
  return `${names.join(', ') || 'Any connected DSP'} · RTB`
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
  { key: 'slots', icon: 'view_week', label: 'Capped rotation with assigned slots', test: (d) => expectedSlotCount(d) > 0 },
]

/* ------------------------------------------------ collapsed summaries */

export interface Chip { key: string; label: string; icon?: string; tone: 'on' | 'default'; colour?: string }

/* Maximum Campaigns Played In Rotation and slot assignment, still on the
   display type (26 Sep 2026: shown per assignment, inside a playlist's
   expanded row on Playlist Management, since a shared playlist can be
   capped differently on each screen it's assigned to). With a `zoneId`,
   that zone's own rotation and slots (28 Sep 2026); without one on a zoned
   display type, every zone's slots together. */
export function capSummary(d: DisplayType, showOwners: boolean, zoneId: string | null = null): Chip[] {
  const chips: Chip[] = []
  const slots = zoneOf(d, zoneId) ? slotIndicesFor(d, zoneId).map((i) => slotsOf(d)[i]) : slotsOf(d)
  const capped = zoneOf(d, zoneId) ? isCappedFor(d, zoneId) : isZoned(d) ? expectedSlotCount(d) > 0 : isCapped(d)
  if (capped) {
    chips.push({ key: 'slots', icon: 'view_week', label: `${slots.length} slots`, tone: 'on' })
    if (showOwners) {
      for (const o of ['internal', 'advertiser', 'retail'] as SlotOwner[]) {
        const n = slots.filter((x) => x.owner === o).length
        if (n) chips.push({ key: o, icon: SLOT_OWNERS[o].icon, label: `${n} ${SLOT_OWNERS[o].label}`, tone: 'on', colour: SLOT_OWNERS[o].colour })
      }
    }
  } else {
    chips.push({ key: 'default', label: 'Unlimited rotation', tone: 'default' })
  }
  return chips
}

/* A playlist's own settings (26 Sep 2026, moved off the display type): "n
   settings changed", or a single grey "Default settings" — one chip set per
   playlist, shown once regardless of how many display types it's assigned
   to (or none at all). */
export function styleSummary(p: Playlist): Chip[] {
  const s = styleOf(p)
  const keys: (keyof PlaylistStyleSettings)[] = ['assetPosition', 'assetFill', 'campaignTransition', 'campaignAutoRotation', 'campaignAutoPlay']
  const overrides = keys.filter((k) => s[k] !== null && s[k] !== undefined)
  return overrides.length
    ? [{ key: 'changed', icon: 'tune', label: `${overrides.length} setting${overrides.length > 1 ? 's' : ''} changed`, tone: 'on' }]
    : [{ key: 'default', label: 'Default settings', tone: 'default' }]
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
