/* Stand-in rules for the existing display type record (POC only). */
import { TOUCH_POINTS, type DisplayType, type Playlist } from '@ph-dsp/types'
import type { AudienceSource } from '../platform/AudienceSource'
import type { PlaylistRecord, PlaylistSource } from '../platform/PlaylistSource'

type Detail = { field: string; reason: string }
/* A zone runs its own playlist, so it has its own Maximum Campaigns Played
   In Rotation and its own slots (ticket, 28 Sep 2026): null/absent = the
   platform default (Unlimited — no slots). */
export interface Zone { id: string; name: string; playlistId?: string; maximumCampaignsPlayedInRotation?: number | null }

export const zonesOf = (dt: DisplayType): Zone[] => {
  const mz = dt.multiZone as { enabled?: boolean; zones?: Zone[] } | undefined
  return mz?.enabled ? (mz.zones ?? []) : []
}

/* The display type's default VAC-d (assumed views per play window, per
   display), or null when it has none. It is the exchange's own setting,
   saved with the type's DSP fields (phExtensions, migration 0035), so it is
   read here from the DisplayTypeSource record and handed to the audience
   source — never read by the audience source from the table (ticket
   DDOjJoYjraKROu4Ainj5, Rob 2 Oct 2026). A display type with no retailer
   scoring is scored by this default. */
export const defaultVacdOf = (dt: DisplayType): number | null => {
  const v = (dt.phExtensions as { defaultVacd?: unknown } | undefined)?.defaultVacd
  return typeof v === 'number' ? v : null
}
/* A slot's audience: the audience source's score, given the type's default. */
export const audienceOf = (audience: AudienceSource, dt: DisplayType, slot: number) => audience.forSlot(dt.id, slot, defaultVacdOf(dt))

/* Where a flat slot (1-based, across every zone) sits on a multi-zone
   display type: its zone's name and its 1-based place within that zone —
   the numbering each zone's own rotation uses and Available Inventory shows
   (ticket, 28 Sep 2026). A slot tagged to no current zone counts as the
   first zone's, as everywhere else. null on a single-zone display type. */
export const zonePlaceOf = (dt: DisplayType, slot: number): { zoneName: string; zoneSlot: number } | null => {
  const zones = zonesOf(dt)
  if (!zones.length) return null
  const slots = dt.phExtensions?.slots ?? []
  const zoneOf = (s: { zoneId?: string | null }) => zones.find((z) => z.id === s.zoneId) ?? zones[0]
  const target = slots[slot - 1]
  if (!target) return null
  const zone = zoneOf(target)
  const zoneSlot = slots.slice(0, slot).filter((s) => zoneOf(s).id === zone.id).length
  return { zoneName: zone.name, zoneSlot }
}

export function validateRecord(dt: DisplayType): Detail[] {
  const out: Detail[] = []
  if (!dt.name?.trim()) out.push({ field: 'name', reason: 'Display Type Name is required.' })
  if (!TOUCH_POINTS.some((t) => t.name === dt.touchPoint)) out.push({ field: 'touchPoint', reason: `Must be one of: ${TOUCH_POINTS.map((t) => t.name).join(', ')}.` })
  const { width, height } = dt.displayCanvasSize ?? {}
  if (!Number.isInteger(width) || width < 1) out.push({ field: 'displayCanvasSize.width', reason: 'Must be a positive whole number.' })
  if (!Number.isInteger(height) || height < 1) out.push({ field: 'displayCanvasSize.height', reason: 'Must be a positive whole number.' })
  return out
}

/* A playlist's own settings (26 Sep 2026): everything the display type's
   Playlist Settings block used to hold except Maximum Campaigns Played In
   Rotation and slot assignment, which stay on the display type because they
   size and sell that specific screen's positions, not the playlist's
   content. Rejected here rather than silently ignored, the same way the
   /record endpoint rejects anything but `name` — so a client can't drift
   the two apart without finding out. */
export const PLAYLIST_SETTINGS_FIELDS = ['assetPosition', 'assetFill', 'campaignTransition', 'campaignAutoRotation', 'campaignAutoPlay'] as const

export function validatePlaylistSettings(body: unknown): Detail[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return [{ field: 'settings', reason: 'An object is required.' }]
  const unexpected = Object.keys(body).filter((k) => !(PLAYLIST_SETTINGS_FIELDS as readonly string[]).includes(k))
  return unexpected.map((k) => ({
    field: k,
    reason: k === 'maximumCampaignsPlayedInRotation' || k === 'phExtensions'
      ? 'Not accepted here: edited per assignment, on the display type’s own /extensions endpoint.'
      : `Not accepted: one of ${PLAYLIST_SETTINGS_FIELDS.join(', ')}.`,
  }))
}

/* Playlists a display type references but that don't exist yet are created
   with it: its auto-created default playlist, and zone playlists created on
   demand (spec §1 "zone playlists created on demand ... applied with Save
   changes"). Every one starts with every setting at its default — `{}`,
   nothing overridden — whether it belongs to a brand-new display type, was
   added to an existing one ("Add new playlist") or was created for a zone:
   one set of new-playlist defaults (Rob, 1 Oct 2026, A0GyTNsA; replaced
   the 27 Sep Auto-Rotate/Auto-Play Off set). Either way, a client that shows its own editable
   copy of these fields while the playlist is still being created (Display
   Types' Playlist Settings panel) sends what it showed via the normal
   /settings PUT once the playlist exists. */
export async function ensureReferencedPlaylists(dt: DisplayType, playlists: PlaylistSource, isNew: boolean) {
  if (dt.defaultPlaylistId && !(await playlists.get(dt.defaultPlaylistId))) {
    await playlists.create({ id: dt.defaultPlaylistId, name: `${dt.name} Playlist`, autoCreatedFor: dt.id, playlistSettings: {} })
  }
  for (const z of zonesOf(dt)) {
    if (z.playlistId && !(await playlists.get(z.playlistId))) await playlists.create({ id: z.playlistId, name: `${dt.name} / ${z.name}`, autoCreatedFor: dt.id, playlistSettings: {} })
  }
}

/* Playlist as the contract returns it, with its display type and zone assignments.
   With zones on, each zone's own playlist is what plays, so the default
   playlist is no longer listed as assigned (it still carries the layout and
   still can't be deleted: playlistDeleteCheck). */
export function toApiPlaylist(p: PlaylistRecord, types: DisplayType[]): Playlist {
  const assignments: Playlist['assignments'] = []
  for (const t of types) {
    if (t.defaultPlaylistId === p.id && !zonesOf(t).length) assignments.push({ displayTypeId: t.id, displayTypeName: t.name, zoneId: null, zoneName: null })
    for (const z of zonesOf(t)) if (z.playlistId === p.id) assignments.push({ displayTypeId: t.id, displayTypeName: t.name, zoneId: z.id, zoneName: z.name })
  }
  return { id: p.id, name: p.name, autoCreatedFor: p.autoCreatedFor, playlistSettings: p.playlistSettings, assignments }
}
