/* Playlist Management (spec §2): rename, delete, and — 26 Sep 2026 — each
   playlist's own Playlist Settings, moved here from the Display Types page
   as an expandable row (decision 4 superseded: settings are no longer
   edited from the display type). Reassignment (which display type or zone
   uses a playlist) still happens on the Display Types form; here they are
   listed, with Open to go to the type. Settings are held as a page-level
   draft and applied with Save changes, the same pattern as Display Types. */
import { useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Input, Spin } from 'antd'
import type { ColDef, GridApi, ICellRendererParams, RowHeightParams } from 'ag-grid-community'
import type { DeleteCheck, DisplayType, Partner, Playlist } from '@ph-dsp/types'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiRequestError } from '../../api/client'
import { useFeatures } from '../../api/features'
import type { Flags } from '../../flags'
import { DeleteDialog } from '../../shared/DeleteDialog'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { SaveBar } from '../../shared/SaveBar'
import { SummaryChip } from '../../shared/SummaryChip'
import { useReportDirty } from '../../shared/UnsavedChanges'
import { useDraft } from '../../shared/useDraft'
import { T } from '../../theme/phTheme'
import { saveDisplayTypes, useDisplayTypes, usePartners, usePlaylists } from '../display-types/api'
import { isCapped, normaliseSlots, playlistSummary } from '../display-types/model'
import { PlaylistSettingsFields } from '../display-types/panels/PlaylistSettingsFields'

export const REASSIGN_TIP = 'Reassign every display type and zone above before this playlist can be deleted.'

type Row = { kind: 'playlist'; p: Playlist } | { kind: 'detail'; p: Playlist } | { kind: 'settings'; p: Playlist }
interface Ctx {
  editing: string | null
  draftName: string
  expanded: string | null
  settingsExpanded: string | null
  typeName: (id: string | null | undefined) => string
  setDraftName: (v: string) => void
  startEdit: (p: Playlist) => void
  cancelEdit: () => void
  rename: (p: Playlist) => void
  toggle: (id: string) => void
  toggleSettings: (id: string) => void
  askDelete: (p: Playlist) => void
  open: (displayTypeId: string) => void
  draft: DisplayType[]
  update: (displayTypeId: string) => (fn: (t: DisplayType) => DisplayType) => void
  slotAssignment: boolean
  advertiserOpenFor: (displayTypeId: string) => (i: number) => boolean
  partners: Partner[]
  onFixConnection: (partnerId: string) => void
  measureSettings: (id: string, height: number) => void
}
type Params = ICellRendererParams<Row, unknown, { current: Ctx }>

const where = (a: Playlist['assignments'][number]) => a.zoneName ?? 'Default playlist'
const Pill = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex h-[22px] items-center rounded-full px-2 whitespace-nowrap" style={{ fontSize: 12, color: T.muted, background: 'rgba(0,0,0,0.04)' }}>{children}</span>
)

function NameCell({ data, context }: Params) {
  if (!data) return null
  const c = context.current
  const p = data.p
  if (c.editing === p.id) {
    return (
      <div className="flex w-full min-w-0 items-center gap-1.5">
        <Input size="small" autoFocus aria-label="Playlist name" value={c.draftName} onChange={(e) => c.setDraftName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') c.rename(p); if (e.key === 'Escape') c.cancelEdit() }} />
        <Button type="text" size="small" aria-label="Save name" icon={<Icon name="check" size={18} style={{ color: T.success }} />} onClick={() => c.rename(p)} />
        <Button type="text" size="small" aria-label="Cancel rename" icon={<Icon name="close" size={18} style={{ color: T.muted }} />} onClick={c.cancelEdit} />
      </div>
    )
  }
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{p.name}</span>
        <Button type="text" size="small" aria-label={`Rename ${p.name}`} icon={<Icon name="edit" size={14} style={{ color: T.micro }} />} onClick={() => c.startEdit(p)} />
      </div>
      {p.autoCreatedFor && <div className="mt-[3px]"><Pill>auto-created with {c.typeName(p.autoCreatedFor)}</Pill></div>}
    </div>
  )
}

function AssignedCell({ data, context }: Params) {
  if (!data) return null
  const c = context.current
  const n = data.p.assignments.length
  if (!n) return <Pill>unused</Pill>
  const open = c.expanded === data.p.id
  return (
    <Button type="link" className="px-0" aria-expanded={open} onClick={() => c.toggle(data.p.id)}>
      {n} assignment{n > 1 ? 's' : ''}<Icon name={open ? 'expand_less' : 'expand_more'} size={16} />
    </Button>
  )
}

/* Settings disclosure (same chevron pattern as the display type's own
   collapsed panels, components.md §14): a single assignment shows that
   display type's real summary chips; more than one shows a plain count,
   since each display type keeps its own independent settings. */
function SettingsCell({ data, context }: Params) {
  if (!data) return null
  const c = context.current
  const n = data.p.assignments.length
  if (!n) return null
  const open = c.settingsExpanded === data.p.id
  const single = n === 1 ? c.draft.find((t) => t.id === data.p.assignments[0].displayTypeId) : undefined
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} settings for ${data.p.name}`}
      onClick={() => c.toggleSettings(data.p.id)}
      className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left"
    >
      <Icon name={open ? 'expand_more' : 'chevron_right'} size={18} style={{ color: T.muted }} />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {single
          ? playlistSummary(single, c.slotAssignment).map(({ key, ...chip }) => <SummaryChip key={key} {...chip} />)
          : <SummaryChip label={`${n} display types`} icon="dashboard_customize" tone="on" />}
      </span>
    </button>
  )
}

function DeleteCell({ data, context }: Params) {
  if (!data) return null
  return <Button danger size="small" title="Delete playlist" aria-label={`Delete ${data.p.name}`} icon={<Icon name="delete" size={15} />} onClick={() => context.current.askDelete(data.p)} />
}

function DetailRow({ data, context }: Params) {
  if (!data) return null
  const c = context.current
  const u = data.p.assignments
  return (
    <div className="h-full px-3 pb-3" style={{ background: T.primaryTint }}>
      <div className="overflow-hidden rounded-md border bg-white" style={{ borderColor: '#38b0cf' }}>
        <div className="border-b px-3 py-2" style={{ fontSize: 12, color: T.muted, borderColor: T.borderSubtle }}>
          <WithTip tip={REASSIGN_TIP}>Currently assigned to</WithTip>
        </div>
        {u.map((a, i) => (
          <div key={i} className="flex items-center justify-between gap-2 px-3 py-1" style={{ fontSize: 12.5, borderBottom: i < u.length - 1 ? `1px solid ${T.borderSubtle}` : 'none' }}>
            <span className="flex min-w-0 items-center gap-2">
              <Icon name="dashboard_customize" size={15} style={{ color: T.muted }} />
              <b className="truncate">{a.displayTypeName}</b>
              <span style={{ color: T.muted }}>·</span>
              <span className="whitespace-nowrap" style={{ color: T.muted }}>{where(a)}</span>
            </span>
            <Button color="primary" variant="text" size="small" onClick={() => c.open(a.displayTypeId)}>
              Open<Icon name="arrow_forward" size={14} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* The playlist's Playlist Settings, expanded in place. One block per
   assignment: almost every playlist has exactly one (the common case the
   ticket describes), shown with no extra heading; a playlist used by more
   than one display type or zone shows each one's own settings under its
   own heading, since they are not the same record. Height is measured
   (ResizeObserver), not guessed — Slot assignment's cards wrap unpredictably. */
function SettingsRow({ data, context }: Params) {
  if (!data) return null
  const c = context.current
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => c.measureSettings(data.p.id, el.getBoundingClientRect().height)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [data.p.id, data.p.assignments.length, c.draft])
  const assignments = data.p.assignments
  return (
    <div className="px-3 pb-3">
      <div ref={ref} className="overflow-hidden rounded-md border bg-white" style={{ borderColor: '#38b0cf' }}>
        {assignments.map((a, i) => {
          const t = c.draft.find((x) => x.id === a.displayTypeId)
          return (
            <div key={`${a.displayTypeId}:${a.zoneId ?? ''}`} className="p-3.5" style={{ borderTop: i > 0 ? `1px solid ${T.borderSubtle}` : 'none' }}>
              {assignments.length > 1 && (
                <div className="mb-2.5 flex items-center gap-1.5" style={{ fontSize: 12, color: T.muted }}>
                  <Icon name="dashboard_customize" size={14} />
                  <b style={{ color: T.text }}>{a.displayTypeName}</b>·<span>{where(a)}</span>
                </div>
              )}
              {t ? (
                <PlaylistSettingsFields
                  d={t}
                  update={c.update(a.displayTypeId)}
                  slotAssignment={c.slotAssignment}
                  advertiserOpen={c.advertiserOpenFor(a.displayTypeId)}
                  partners={c.partners}
                  onFixConnection={c.onFixConnection}
                />
              ) : (
                <Spin size="small" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FullWidthRow(params: Params) {
  if (!params.data) return null
  return params.data.kind === 'detail' ? <DetailRow {...params} /> : <SettingsRow {...params} />
}

/* First-paint guess only — SettingsRow measures the real height a moment
   later and corrects it via resetRowHeights(). Keeping the guess close cuts
   down the visible jump. */
const SETTINGS_BLOCK_ESTIMATE = 210
const SETTINGS_SLOT_ESTIMATE = 150
function estimateSettingsHeight(p: Playlist, types: DisplayType[], slotAssignment: boolean) {
  if (!p.assignments.length) return 0
  let h = 24
  for (const a of p.assignments) {
    const t = types.find((x) => x.id === a.displayTypeId)
    h += 28 + SETTINGS_BLOCK_ESTIMATE
    if (p.assignments.length > 1) h += 22
    if (t && slotAssignment && isCapped(t)) h += SETTINGS_SLOT_ESTIMATE
  }
  return h
}

export function PlaylistManagementPage({ flags }: { flags: Flags }) {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const slotAssignment = flags.dspIntegration

  const playlists = usePlaylists()
  const types = useDisplayTypes()
  const partners = usePartners(slotAssignment)
  /* Same "greyed out, not hidden, while DSP integration is off" logic as
     Display Types used to apply (Rob, 24 Sep 2026), now here with it. */
  const features = useFeatures(slotAssignment)
  const dspOn = features.data?.dspIntegration !== false

  const saved = useMemo<DisplayType[] | undefined>(
    () => (types.data ? (slotAssignment ? types.data.map(normaliseSlots) : types.data) : undefined),
    [types.data, slotAssignment],
  )
  const { draft, setDraft, dirty, reset, commitNext } = useDraft(saved)
  useReportDirty(dirty)
  const [saving, setSaving] = useState(false)

  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [settingsExpanded, setSettingsExpanded] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ p: Playlist; check: DeleteCheck; busy: boolean } | null>(null)

  /* Opening from Available Inventory's slot lands here with the display
     type it came from (Rob, 20 Sep — moved from /display-types?panel=playlist
     when Playlist Settings moved off that page, 26 Sep 2026): land on
     whichever playlist is that display type's default playlist. */
  const appliedDeepLink = useRef(false)
  const wantedDisplayTypeId = searchParams.get('displayTypeId')
  if (!appliedDeepLink.current && wantedDisplayTypeId && playlists.data && settingsExpanded === null) {
    const match = playlists.data.find((p) => p.assignments.some((a) => a.displayTypeId === wantedDisplayTypeId && !a.zoneId))
      ?? playlists.data.find((p) => p.assignments.some((a) => a.displayTypeId === wantedDisplayTypeId))
    if (match) {
      appliedDeepLink.current = true
      setSettingsExpanded(match.id)
    }
  }

  const gridApi = useRef<GridApi<Row> | null>(null)
  const rowHeights = useRef<Map<string, number>>(new Map())
  const measureSettings = (id: string, height: number) => {
    const rounded = Math.ceil(height)
    if (rowHeights.current.get(id) === rounded) return
    rowHeights.current.set(id, rounded)
    gridApi.current?.resetRowHeights()
  }

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['playlists'] }), qc.invalidateQueries({ queryKey: ['display-types'] })])
  const fail = (e: unknown, fallback: string) => message.error(e instanceof ApiRequestError ? [e.message, ...(e.body?.error.details ?? []).map((d) => d.reason)].join(' ') : fallback)
  const items = playlists.data ?? []
  /* Display type names, for the auto-created pill (a deleted type falls back to its id). */
  const typeNames = useMemo(() => new Map(items.flatMap((p) => p.assignments.map((a) => [a.displayTypeId, a.displayTypeName] as const))), [items])

  const onSave = async () => {
    if (!draft || !types.data) return
    setSaving(true)
    try {
      await saveDisplayTypes(draft, types.data, { extensions: slotAssignment })
      commitNext()
      await refresh()
    } catch (e) {
      fail(e, 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }
  const onCancel = () => reset()

  const ctx: Ctx = {
    editing, draftName, expanded, settingsExpanded,
    typeName: (id) => (id ? typeNames.get(id) ?? id : ''),
    setDraftName,
    startEdit: (p) => { setEditing(p.id); setDraftName(p.name) },
    cancelEdit: () => setEditing(null),
    rename: async (p) => {
      if (!draftName.trim()) return
      try {
        await api('PUT', `/admin/v1/playlists/${p.id}/record`, { name: draftName.trim() })
        setEditing(null)
        await refresh()
      } catch (e) { fail(e, 'Could not rename the playlist.') }
    },
    toggle: (id) => setExpanded((cur) => (cur === id ? null : id)),
    toggleSettings: (id) => setSettingsExpanded((cur) => (cur === id ? null : id)),
    askDelete: async (p) => {
      try { setDeleting({ p, check: await api<DeleteCheck>('GET', `/admin/v1/playlists/${p.id}/delete-check`), busy: false }) } catch (e) { fail(e, 'Could not check this playlist.') }
    },
    open: (id) => navigate(`/display-types?id=${encodeURIComponent(id)}`),
    draft: draft ?? [],
    update: (displayTypeId) => (fn) => setDraft((cur) => (cur ? cur.map((t) => (t.id === displayTypeId ? fn(t) : t)) : cur)),
    slotAssignment,
    advertiserOpenFor: (displayTypeId) => (i) => dspOn || types.data?.find((t) => t.id === displayTypeId)?.phExtensions?.slots?.[i]?.owner === 'advertiser',
    partners: partners.data ?? [],
    onFixConnection: (partnerId) => navigate(`/dsp-integration/partners/${partnerId}`),
    measureSettings,
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setDeleting({ ...deleting, busy: true })
    try {
      await api('DELETE', `/admin/v1/playlists/${deleting.p.id}`)
      setDeleting(null)
      await refresh()
    } catch (e) { setDeleting(null); fail(e, 'Could not delete this playlist.') }
  }

  const rows = useMemo<Row[]>(() => items.flatMap((p) => {
    const r: Row[] = [{ kind: 'playlist', p }]
    if (expanded === p.id && p.assignments.length) r.push({ kind: 'detail', p })
    if (settingsExpanded === p.id) r.push({ kind: 'settings', p })
    return r
  }), [items, expanded, settingsExpanded])
  const columns = useMemo<ColDef<Row>[]>(() => [
    { headerName: 'Playlist', width: 170, cellRenderer: NameCell },
    { headerName: 'Assigned to', width: 140, cellRenderer: AssignedCell },
    { headerName: 'Settings', width: 260, cellRenderer: SettingsCell },
    { headerName: '', width: 70, suppressSizeToFit: true, cellRenderer: DeleteCell },
  ], [])

  if (!playlists.data || !draft) return <Spin />
  const unused = items.filter((p) => !p.assignments.length).length
  const n = deleting?.check.dependents.length ?? 0
  return (
    <div>
      <div className="mb-3" style={{ fontSize: 14 }}><b>{items.length}</b> Playlists · <b>{unused}</b> unused</div>
      <Grid<Row>
        label="Playlists"
        rows={rows}
        columns={columns}
        context={ctx}
        getRowId={(r) => `${r.kind}:${r.p.id}`}
        isFullWidthRow={(p) => p.rowNode.data?.kind === 'detail' || p.rowNode.data?.kind === 'settings'}
        fullWidthCellRenderer={FullWidthRow}
        getRowHeight={(p: RowHeightParams<Row>) => {
          if (p.data?.kind === 'detail') return 34 + p.data.p.assignments.length * 33 + 14
          if (p.data?.kind === 'settings') return Math.max(1, rowHeights.current.get(p.data.p.id) ?? estimateSettingsHeight(p.data.p, draft, slotAssignment))
          return p.data?.p.autoCreatedFor ? 62 : 44
        }}
        /* Expanding a row inserts a taller detail row; recompute every row's height and position. */
        onRowDataUpdated={(e) => e.api.resetRowHeights()}
        onGridReady={(e) => { gridApi.current = e.api }}
        getRowStyle={(p) => (p.data && (p.data.p.id === expanded || p.data.p.id === settingsExpanded) ? { background: T.primaryTint } : undefined)}
      />
      <SaveBar dirty={dirty} saving={saving} onSave={onSave} onCancel={onCancel} />
      {deleting && (
        <DeleteDialog open name={deleting.p.name} blockedReason={deleting.check.canDelete ? null : 'This playlist is assigned to a display type or zone'}
          deleting={deleting.busy} onDelete={confirmDelete} onClose={() => setDeleting(null)}>
          {deleting.check.canDelete ? (
            <>This permanently deletes the playlist. It isn't assigned to any display type or zone. This can't be undone.</>
          ) : (
            <>
              <Alert className="mb-2.5" type="warning" message={<><b>This playlist can't be deleted.</b> It is assigned to {n} display type{n > 1 ? 's or zones' : ' or zone'}. Reassign {n > 1 ? 'them' : 'it'} first.</>} />
              <ul aria-label="Assigned to" className="m-0 max-h-[180px] list-none overflow-y-auto rounded-md border p-0" style={{ borderColor: T.borderSubtle }}>
                {deleting.check.dependents.map((x, i) => (
                  <li key={i} className="flex items-center gap-2 px-3 py-[7px]" style={{ fontSize: 12.5, borderBottom: i < n - 1 ? `1px solid ${T.borderSubtle}` : 'none' }}>
                    <Icon name="dashboard_customize" size={15} style={{ color: T.muted }} /><b>{x.name}</b><span style={{ color: T.muted }}>· {x.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </DeleteDialog>
      )}
    </div>
  )
}
