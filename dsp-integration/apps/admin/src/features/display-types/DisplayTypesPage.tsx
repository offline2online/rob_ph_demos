/* Display Types (spec §1): the list beside one full-width form, edited as a
   draft and applied with Save changes. */
import { useQueryClient } from '@tanstack/react-query'
import { App, Spin } from 'antd'
import type { DeleteCheck, DisplayType, Partner } from '@ph-dsp/types'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiRequestError } from '../../api/client'
import type { Flags } from '../../flags'
import { ListPageLayout } from '../../shared/ListPageLayout'
import { SaveBar } from '../../shared/SaveBar'
import { useReportDirty, useUnsavedGuard } from '../../shared/UnsavedChanges'
import { useDraft } from '../../shared/useDraft'
import { deleteCheck, deleteDisplayType, saveDisplayTypes, useAdvertiserSettings, useDisplayTypes, usePartners, usePlaylists } from './api'
import { DeleteDisplayType } from './DeleteDisplayType'
import { DisplayTypeForm, type PlaylistOption } from './DisplayTypeForm'
import { DisplayTypeList } from './DisplayTypeList'
import { newDisplayType, normaliseSlots } from './model'

interface Draft { types: DisplayType[]; newPlaylists: PlaylistOption[] }

export function DisplayTypesPage({ flags }: { flags: Flags }) {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const guard = useUnsavedGuard()
  const [params, setParams] = useSearchParams()
  const slotAssignment = flags.dspIntegration

  const types = useDisplayTypes()
  const playlists = usePlaylists()
  const partners = usePartners(slotAssignment)
  const company = useAdvertiserSettings(slotAssignment)

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

  const update = (fn: (t: DisplayType) => DisplayType) =>
    setDraft((cur) => (cur && d ? { ...cur, types: cur.types.map((t) => (t.id === d.id ? fn(t) : t)) } : cur))

  const allPlaylists: PlaylistOption[] = [
    ...(playlists.data ?? []).map((p) => ({ id: p.id, name: p.name, autoCreatedFor: p.autoCreatedFor ?? null })),
    ...(draft?.newPlaylists ?? []),
  ]
  /* Zone playlists are created on demand, named "<Display Type> / Zone n". */
  const zonePlaylistId = (n: number) => {
    if (!d) return ''
    const name = `${d.name} / Zone ${n}`
    const found = allPlaylists.find((p) => p.name === name)
    if (found) return found.id
    const id = `pl_zone_${d.id}_${n}`
    setDraft((cur) => (cur && !cur.newPlaylists.some((p) => p.id === id) ? { ...cur, newPlaylists: [...cur.newPlaylists, { id, name, autoCreatedFor: d.id }] } : cur))
    return id
  }

  const onNew = () =>
    guard(() => {
      reset()
      const id = `dt_${Date.now()}`
      setDraft((cur) => {
        const base = saved ?? cur
        if (!base) return cur
        return { types: [...base.types, newDisplayType(id)], newPlaylists: [{ id: `pl_${id}`, name: 'New Display Type Playlist', autoCreatedFor: id }] }
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
      await saveDisplayTypes(draft.types, types.data, { extensions: slotAssignment })
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
      await Promise.all([qc.invalidateQueries({ queryKey: ['display-types'] }), qc.invalidateQueries({ queryKey: ['playlists'] })])
    } catch (e) {
      setDeleting(null)
      message.error(errorText(e, 'Could not delete this display type.'))
    }
  }

  /* The DSP's seats, pulled on connect. */
  const seatsOf = (p: Partner) => (p.seats ?? []).map((s) => s.name)

  if (!draft || !d) return <Spin />
  return (
    <ListPageLayout list={<DisplayTypeList types={draft.types} selectedId={d.id} onSelect={onSelect} onNew={onNew} onDelete={onDelete} />}>
      <DisplayTypeForm
        key={d.id}
        d={d}
        update={update}
        playlists={allPlaylists}
        zonePlaylistId={zonePlaylistId}
        slotAssignment={slotAssignment}
        partners={partners.data ?? []}
        company={company.data}
        seatsOf={seatsOf}
        onFixConnection={(partnerId) => navigate(`/dsp-integration/partners/${partnerId}`)}
      />
      <SaveBar dirty={dirty} saving={saving} onSave={onSave} onCancel={onCancel} saveOnEnter />
      {deleting && (
        <DeleteDisplayType name={deleting.name} check={deleting.check} deleting={deleting.busy} onDelete={confirmDelete} onClose={() => setDeleting(null)} />
      )}
    </ListPageLayout>
  )
}

