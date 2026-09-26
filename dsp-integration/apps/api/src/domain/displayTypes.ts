/* Stand-in rules for the existing display type record (POC only). */
import { TOUCH_POINTS, type DisplayType, type Playlist } from '@ph-dsp/types'
import type { PlaylistRecord, PlaylistSource } from '../platform/PlaylistSource'

type Detail = { field: string; reason: string }
interface Zone { id: string; name: string; playlistId?: string }

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
   demand (spec §1 "zone playlists created on demand ... applied with Save changes"). */
export function ensureReferencedPlaylists(dt: DisplayType, playlists: PlaylistSource, isNew: boolean) {
  if (dt.defaultPlaylistId && !playlists.get(dt.defaultPlaylistId)) {
    playlists.create({ id: dt.defaultPlaylistId, name: isNew ? 'New Display Type Playlist' : `${dt.name} Playlist`, autoCreatedFor: dt.id })
  }
  for (const z of zonesOf(dt)) {
    if (z.playlistId && !playlists.get(z.playlistId)) playlists.create({ id: z.playlistId, name: `${dt.name} / ${z.name}`, autoCreatedFor: dt.id })
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
