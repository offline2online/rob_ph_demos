/* Stand-in rules for the existing display type record (POC only). */
import { NEW_PLAYLIST_SETTINGS_DEFAULTS, TOUCH_POINTS, type DisplayType, type Playlist } from '@ph-dsp/types'
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
   changes"). A brand-new display type's own default playlist starts with
   every setting at its default — `{}`, nothing overridden (ticket, 28 Sep
   2026: "ensure the default settings are used when creating a new display
   type"). A playlist added to an existing display type ("Add new
   playlist") or created for a zone starts with Auto-Rotation and Auto-Play
   explicitly off instead (NEW_PLAYLIST_SETTINGS_DEFAULTS, ticket 27 Sep
   2026) — a playlist nobody has configured yet shouldn't start rotating
   and playing campaigns. Either way, a client that shows its own editable
   copy of these fields while the playlist is still being created (Display
   Types' Playlist Settings panel) sends what it showed via the normal
   /settings PUT once the playlist exists. */
export function ensureReferencedPlaylists(dt: DisplayType, playlists: PlaylistSource, isNew: boolean) {
  if (dt.defaultPlaylistId && !playlists.get(dt.defaultPlaylistId)) {
    playlists.create({ id: dt.defaultPlaylistId, name: isNew ? 'New Display Type Playlist' : `${dt.name} Playlist`, autoCreatedFor: dt.id, playlistSettings: isNew ? {} : { ...NEW_PLAYLIST_SETTINGS_DEFAULTS } })
  }
  for (const z of zonesOf(dt)) {
    if (z.playlistId && !playlists.get(z.playlistId)) playlists.create({ id: z.playlistId, name: `${dt.name} / ${z.name}`, autoCreatedFor: dt.id, playlistSettings: { ...NEW_PLAYLIST_SETTINGS_DEFAULTS } })
  }
}

/* Playlist as the contract returns it, with its display type and zone assignments. */
export function toApiPlaylist(p: PlaylistRecord, types: DisplayType[]): Playlist {
  const assignments: Playlist['assignments'] = []
  for (const t of types) {
    if (t.defaultPlaylistId === p.id) assignments.push({ displayTypeId: t.id, displayTypeName: t.name, zoneId: null, zoneName: null })
    for (const z of zonesOf(t)) if (z.playlistId === p.id) assignments.push({ displayTypeId: t.id, displayTypeName: t.name, zoneId: z.id, zoneName: z.name })
  }
  return { id: p.id, name: p.name, autoCreatedFor: p.autoCreatedFor, playlistSettings: p.playlistSettings, assignments }
}
