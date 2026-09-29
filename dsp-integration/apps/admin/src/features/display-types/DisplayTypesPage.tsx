/* Display Types (spec §1): the list beside one full-width form, edited as a
   draft and applied with Save changes. */
import { useQueryClient } from '@tanstack/react-query'
import { App, Spin } from 'antd'
import { NEW_PLAYLIST_SETTINGS_DEFAULTS, type DeleteCheck, type DisplayType, type Playlist } from '@ph-dsp/types'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiRequestError } from '../../api/client'
import { useFeatures } from '../../api/features'
import type { Flags } from '../../flags'
import { ListPageLayout } from '../../shared/ListPageLayout'
import { SaveBar } from '../../shared/SaveBar'
import { useReportDirty, useUnsavedGuard } from '../../shared/UnsavedChanges'
import { useDraft } from '../../shared/useDraft'
import { deleteCheck, deleteDisplayType, saveDisplayTypes, useDisplayTypes, usePartners, usePlaylists } from './api'
import { DeleteDisplayType } from './DeleteDisplayType'
import { DisplayTypeForm, type PlaylistOption } from './DisplayTypeForm'
import { DisplayTypeList } from './DisplayTypeList'
import { newDisplayType, normaliseSlots } from './model'

interface Draft { types: DisplayType[]; newPlaylists: PlaylistOption[] }

export function DisplayTypesPage({ flags }: { flags: Flags }) {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const guard = useUnsavedGuard()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  /* Slot assignment is edited on Playlist Management once a display type
     exists; here it keeps phExtensions.slots round-tripping on save, and
     is editable while a display type is still being created (ticket, 28
     Sep 2026 — see the Playlist Settings panel). */
  const slotAssignment = flags.dspIntegration

  const types = useDisplayTypes()
  const playlists = usePlaylists()
  const partners = usePartners(slotAssignment)
  /* Same "Advertiser greyed out while DSP integration is off" read as
     Playlist Management (Rob, 24 Sep 2026). */
  const features = useFeatures(slotAssignment)
  const dspOn = features.data?.dspIntegration !== false

  /* Slots always match the rotation cap in the editor (flag on). */
  const saved = useMemo<Draft | undefined>(
    () => (types.data ? { types: slotAssignment ? types.data.map(normaliseSlots) : types.data, newPlaylists: [] } : undefined),
    [types.data, slotAssignment],
  )
  const { draft, setDraft, dirty, reset, commitNext } = useDraft(saved)
  useReportDirty(dirty)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<{ id: string; name: string; check: DeleteCheck; busy: boolean } | null>(null)

  const selectedId = params.get('id') ?? draft?.types[0]?.id
  const d = draft?.types.find((t) => t.id === selectedId) ?? draft?.types[0]
  const select = (id: string) => setParams({ id }, { replace: true })

  /* Every edit keeps the slots in step with the rotation cap(s) — a zone
     added, removed or switched off in Multi-Zone Layout resizes the slot
     list with it (28 Sep 2026), so what Save sends always validates. */
  const update = (fn: (t: DisplayType) => DisplayType) =>
    setDraft((cur) => (cur && d ? { ...cur, types: cur.types.map((t) => (t.id === d.id ? (slotAssignment ? normaliseSlots(fn(t)) : fn(t)) : t)) } : cur))

  const allPlaylists: PlaylistOption[] = [
    ...(playlists.data ?? []).map((p) => ({ id: p.id, name: p.name, autoCreatedFor: p.autoCreatedFor ?? null, playlistSettings: p.playlistSettings ?? {} })),
    ...(draft?.newPlaylists ?? []),
  ]
  /* A playlist still only in `draft.newPlaylists` has never been saved — no
     real playlist exists for it yet on Playlist Management. */
  const isNewPlaylist = (id: string | undefined) => !!id && !(playlists.data ?? []).some((p) => p.id === id) && (draft?.newPlaylists ?? []).some((p) => p.id === id)
  /* This display type itself hasn't been saved yet (ticket, 27 Sep 2026) —
     gates the Default Playlist dropdown on DisplayTypeForm. */
  const isNewDisplayType = !!d && !types.data?.some((t) => t.id === d.id)
  /* Edits a still-local default playlist's own settings from the Playlist
     Settings panel — the same shape `PlaylistStyleFields.update` always
     takes, applied to whichever `newPlaylists` entry the panel is showing. */
  const updateDefaultPlaylistSettings = (fn: (p: Playlist) => Playlist) =>
    setDraft((cur) => {
      if (!cur || !d) return cur
      return {
        ...cur,
        newPlaylists: cur.newPlaylists.map((p) => {
          if (p.id !== d.defaultPlaylistId) return p
          const next = fn({ id: p.id, name: p.name, autoCreatedFor: p.autoCreatedFor, playlistSettings: p.playlistSettings ?? {}, assignments: [] })
          return { ...p, playlistSettings: next.playlistSettings }
        }),
      }
    })

  /* Zone playlists are created on demand, named "<Display Type> / Zone n". */
  const zonePlaylistId = (n: number) => {
    if (!d) return ''
    const name = `${d.name} / Zone ${n}`
    const found = allPlaylists.find((p) => p.name === name)
    if (found) return found.id
    const id = `pl_zone_${d.id}_${n}`
    setDraft((cur) => (cur && !cur.newPlaylists.some((p) => p.id === id) ? { ...cur, newPlaylists: [...cur.newPlaylists, { id, name, autoCreatedFor: d.id, playlistSettings: { ...NEW_PLAYLIST_SETTINGS_DEFAULTS } }] } : cur))
    return id
  }

  /* "Add new playlist" from the Default Playlist dropdown (ticket, 26 Sep
     2026): scoped to this display type from the outset (autoCreatedFor), so
     it's ready to define its own multi-zone layout — edited on this same
     page, never in Playlist Management — the moment it's picked as the
     default. Named uniquely so two "Add new playlist" clicks on the same
     display type don't collide. Starts with Auto-Rotation/Auto-Play off
     (NEW_PLAYLIST_SETTINGS_DEFAULTS, ticket 27 Sep 2026) — the same defaults
     `ensureReferencedPlaylists` gives it server-side once Save actually
     creates it — shown as a read-only preview right here in the meantime
     (see the Playlist Settings block in DisplayTypeForm).
     Since ticket ThP7DPGo17FmPJdDKM7S (28 Sep 2026) it starts as a copy of
     the playlist it replaces — every setting matched to the display type's
     current default, editable before Save creates it — and only falls back
     to those defaults when there is no current default to copy. */
  const newPlaylistId = () => {
    if (!d) return ''
    let name = `${d.name} Playlist`
    for (let n = 2; allPlaylists.some((p) => p.name === name); n += 1) name = `${d.name} Playlist ${n}`
    const id = `pl_new_${d.id}_${Date.now()}`
    const current = allPlaylists.find((p) => p.id === d.defaultPlaylistId)?.playlistSettings
    const playlistSettings = current && Object.keys(current).length ? { ...current } : { ...NEW_PLAYLIST_SETTINGS_DEFAULTS }
    setDraft((cur) => (cur ? { ...cur, newPlaylists: [...cur.newPlaylists, { id, name, autoCreatedFor: d.id, playlistSettings }] } : cur))
    return id
  }

  /* A new display type starts with everything at its default (ticket, 28
     Sep 2026): its auto-created playlist has no setting overridden — the
     panel reads "Default settings" — and its rotation is Default
     (Unlimited) until a cap is picked, which is what makes the slot table
     appear so Headquarters/Advertiser slots can be set before first save. */
  const onNew = () =>
    guard(() => {
      reset()
      const id = `dt_${Date.now()}`
      setDraft((cur) => {
        const base = saved ?? cur
        if (!base) return cur
        return { types: [...base.types, newDisplayType(id)], newPlaylists: [{ id: `pl_${id}`, name: 'New Display Type Playlist', autoCreatedFor: id, playlistSettings: {} }] }
      })
      select(id)
    })

  const onSelect = (id: string) => {
    if (id === d?.id) return
    guard(() => {
      reset()
      select(id)
    })
  }

  const onSave = async () => {
    if (!draft || !types.data) return
    setSaving(true)
    try {
      await saveDisplayTypes(draft.types, types.data, { extensions: slotAssignment, newPlaylists: draft.newPlaylists })
      commitNext()
      await Promise.all([qc.invalidateQueries({ queryKey: ['display-types'] }), qc.invalidateQueries({ queryKey: ['playlists'] })])
    } catch (e) {
      message.error(errorText(e, 'Could not save changes.'))
    } finally {
      setSaving(false)
    }
  }
  const onCancel = () => {
    reset()
    if (d && !types.data?.some((t) => t.id === d.id)) setParams({}, { replace: true })
  }

  const errorText = (e: unknown, fallback: string) =>
    e instanceof ApiRequestError ? [e.message, ...(e.body?.error.details ?? []).map((x) => x.reason)].join(' ') : fallback

  const onDelete = async (id: string) => {
    const t = draft?.types.find((x) => x.id === id)
    if (!t) return
    /* A display type that was never saved has no displays and nothing to delete server-side. */
    const isSaved = types.data?.some((x) => x.id === id)
    try {
      const check = isSaved ? await deleteCheck(id) : { canDelete: true, dependents: [] }
      setDeleting({ id, name: t.name, check, busy: false })
    } catch (e) {
      message.error(errorText(e, 'Could not check this display type.'))
    }
  }
  const confirmDelete = async () => {
    if (!deleting) return
    const { id } = deleting
    setDeleting({ ...deleting, busy: true })
    try {
      if (types.data?.some((x) => x.id === id)) await deleteDisplayType(id)
      /* Applies now; any other unsaved change stays as it was. */
      setDraft((cur) => (cur ? { ...cur, types: cur.types.filter((x) => x.id !== id), newPlaylists: cur.newPlaylists.filter((p) => p.autoCreatedFor !== id) } : cur))
      if (d?.id === id) setParams({}, { replace: true })
      setDeleting(null)
      /* Available Inventory lists every advertiser slot by display type
         (api.ts's `inventory()`); left uncleared, a deleted display type's
         slots kept showing there until the cache happened to go stale on
         its own (up to staleTime, App.tsx) — looking like the delete hadn't
         actually removed them. */
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['display-types'] }),
        qc.invalidateQueries({ queryKey: ['playlists'] }),
        qc.invalidateQueries({ queryKey: ['available-inventory'] }),
      ])
    } catch (e) {
      setDeleting(null)
      message.error(errorText(e, 'Could not delete this display type.'))
    }
  }

  if (!draft || !d) return <Spin />
  return (
    <ListPageLayout list={<DisplayTypeList types={draft.types} selectedId={d.id} onSelect={onSelect} onNew={onNew} onDelete={onDelete} />}>
      <DisplayTypeForm key={d.id} d={d} update={update} playlists={allPlaylists} zonePlaylistId={zonePlaylistId} onAddPlaylist={newPlaylistId}
        isNewPlaylist={isNewPlaylist} isNewDisplayType={isNewDisplayType} updateDefaultPlaylistSettings={updateDefaultPlaylistSettings}
        slotAssignment={slotAssignment} partners={partners.data ?? []}
        advertiserOpen={(i) => dspOn || types.data?.find((t) => t.id === d.id)?.phExtensions?.slots?.[i]?.owner === 'advertiser'}
        onFixConnection={(partnerId) => navigate(`/dsp-integration/partners/${partnerId}`)} />
      <SaveBar dirty={dirty} saving={saving} onSave={onSave} onCancel={onCancel} saveOnEnter />
      {deleting && (
        <DeleteDisplayType name={deleting.name} check={deleting.check} deleting={deleting.busy} onDelete={confirmDelete} onClose={() => setDeleting(null)} />
      )}
    </ListPageLayout>
  )
}
