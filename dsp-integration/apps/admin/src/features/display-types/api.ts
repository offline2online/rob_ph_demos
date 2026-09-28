/* Display Types data: existing records through the POC stand-in endpoints,
   slot ownership through PUT …/extensions (flag-gated). */
import { useQuery } from '@tanstack/react-query'
import type { DeleteCheck, DisplayType, Playlist } from '@ph-dsp/types'
import { api } from '../../api/client'
import { Q } from '../../api/queries'
import { deepEqual } from '../../shared/deepEqual'

export const useDisplayTypes = () => useQuery(Q.displayTypes)
export const usePlaylists = () => useQuery(Q.playlists)
export const usePartners = (enabled: boolean) => useQuery({ ...Q.partners, enabled })
export const useAdvertiserSettings = (enabled: boolean) => useQuery({ ...Q.advertiserSettings, enabled })
export const deleteCheck = (id: string) => api<DeleteCheck>('GET', `/admin/v1/display-types/${id}/delete-check`)
export const deleteDisplayType = (id: string) => api<void>('DELETE', `/admin/v1/display-types/${id}`)

const recordOf = ({ phExtensions: _ext, ...rest }: DisplayType) => rest

/* A playlist that only exists as a local draft on the Display Types page
   until Save creates it, with the settings the page showed for it. */
export interface DraftPlaylist { id: string; autoCreatedFor: string | null; playlistSettings?: Record<string, unknown> }
const referencedPlaylistIds = (d: DisplayType) => new Set([
  d.defaultPlaylistId,
  ...((d.multiZone as { enabled?: boolean; zones?: { playlistId?: string }[] } | undefined)?.enabled ? ((d.multiZone as { zones?: { playlistId?: string }[] }).zones ?? []).map((z) => z.playlistId) : []),
].filter((id): id is string => !!id))

/* Save changes: new types are created, changed records and changed slot
   ownership are saved; everything else is left alone. A draft playlist the
   save creates (ensureReferencedPlaylists, server side) then gets the
   settings the page previewed for it (ticket, 28 Sep 2026) — before this,
   what the Playlist Settings panel showed while a display type was being
   created was never sent, and the playlist came out with the server's own
   starting values instead. */
export async function saveDisplayTypes(draft: DisplayType[], saved: DisplayType[], opts: { extensions: boolean; newPlaylists?: DraftPlaylist[] }) {
  for (const d of draft) {
    const before = saved.find((s) => s.id === d.id)
    if (!before) await api('POST', '/admin/v1/display-types', recordOf(d))
    else if (!deepEqual(recordOf(d), recordOf(before))) await api('PUT', `/admin/v1/display-types/${d.id}/record`, recordOf(d))
    const referenced = referencedPlaylistIds(d)
    for (const p of opts.newPlaylists ?? []) {
      if (p.autoCreatedFor === d.id && referenced.has(p.id)) await api('PUT', `/admin/v1/playlists/${p.id}/settings`, p.playlistSettings ?? {})
    }
    if (opts.extensions && d.phExtensions && !deepEqual(d.phExtensions, before?.phExtensions ?? { slots: [] })) {
      await api('PUT', `/admin/v1/display-types/${d.id}/extensions`, d.phExtensions)
    }
  }
}

/* A playlist's own settings (26 Sep 2026) — everything but Maximum Campaigns
   Played In Rotation and slot assignment, which stay part of the display
   type record above. Rename and delete are immediate elsewhere; only this
   goes through the page's Save changes draft. */
export async function savePlaylistSettings(draft: Playlist[], saved: Playlist[]) {
  for (const p of draft) {
    const before = saved.find((s) => s.id === p.id)
    if (before && !deepEqual(p.playlistSettings, before.playlistSettings)) {
      await api('PUT', `/admin/v1/playlists/${p.id}/settings`, p.playlistSettings)
    }
  }
}
