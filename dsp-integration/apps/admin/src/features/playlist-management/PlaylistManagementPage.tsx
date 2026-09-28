/* Playlist Management (spec §2): rename, delete, and — 26 Sep 2026 — each
   playlist's own Playlist Settings, moved here from the Display Types page
   as an expandable row. Reassignment (which display type or zone uses a
   playlist) still happens on the Display Types form; here they are listed,
   with Open to go to the type. Settings are held as a page-level draft and
   applied with Save changes, the same pattern as Display Types.

   The settings toggle is its own leftmost column (a bigger, primary-colour
   chevron, not buried inside the Settings text cell) and shows for every
   playlist, assigned or not — a playlist's own settings (Asset Position/
   Fill, Campaign Transition, Auto-Rotation, Auto-Play) can be set up before
   it is ever assigned to a display type. Maximum Campaigns Played In
   Rotation and slot assignment stay per assignment (a position is sold per
   display type × slot), so they only show once the playlist has one.

   Each playlist name is led by its touch point's icon (ticket, 27 Sep
   2026) — the icon of every display type it fills (or, unassigned, the one
   it was auto-created for) — so the kind of screen a playlist plays on
   reads at a glance. */
import { useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Input, Popover, Spin, Tooltip } from 'antd'
import type { ColDef, GridApi, ICellRendererParams, RowHeightParams } from 'ag-grid-community'
import { touchPointIcon, type DeleteCheck, type DisplayType, type Partner, type Playlist } from '@ph-dsp/types'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiRequestError } from '../../api/client'
import { useFeatures } from '../../api/features'
import type { Flags } from '../../flags'
import { DeleteDialog } from '../../shared/DeleteDialog'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { SaveBar } from '../../shared/SaveBar'
import { SummaryChip } from '../../shared/SummaryChip'
import { useReportDirty } from '../../shared/UnsavedChanges'
import { useDraft } from '../../shared/useDraft'
import { T } from '../../theme/phTheme'
import { saveDisplayTypes, savePlaylistSettings, useAvailableInventory, useDisplayTypes, usePartners, usePlaylists } from '../display-types/api'
import { capSummary, isCappedFor, normaliseSlots, styleSummary } from '../display-types/model'
import { PlaylistCapSlotsFields } from './PlaylistCapSlotsFields'
import { PlaylistStyleFields } from './PlaylistStyleFields'

export const REASSIGN_TIP = 'Reassign every display type and zone above before this playlist can be deleted.'

type Row = { kind: 'playlist'; p: Playlist } | { kind: 'settings'; p: Playlist }
interface Ctx {
  editing: string | null
  settingsExpanded: string | null
  typeName: (id: string | null | undefined) => string
  startEdit: (p: Playlist) => void
  cancelEdit: () => void
  rename: (p: Playlist, name: string) => void
  toggleSettings: (id: string) => void
  askDelete: (p: Playlist) => void
  open: (displayTypeId: string) => void
  types: DisplayType[]
  playlists: Playlist[]
  update: (displayTypeId: string) => (fn: (t: DisplayType) => DisplayType) => void
  updatePlaylist: (playlistId: string) => (fn: (p: Playlist) => Playlist) => void
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

/* A playlist's touch point comes from the display types it fills. One that
   fills none and wasn't auto-created for one (a Website or Mobile App
   playlist made ahead of its display type, say) has nothing to read it from,
   so fall back to a touch point (or the older "Mobile Store Site" name)
   spelled out in the playlist's own name — never a guessed default, so an
   unrecognisable name simply shows no icon (ticket, 28 Sep 2026). */
const NAME_HINTS: [RegExp, string][] = [
  [/\bmobile\s+app\b|\bmobile\s+store\s+site\b/i, 'Mobile App'],
  [/\bwebsite\b|\bweb\b/i, 'Website'],
  [/\bkiosk\b/i, 'Kiosk'],
  [/\bdigital\s+signage\b/i, 'Digital Signage'],
]
const touchPointsOf = (p: Playlist, types: DisplayType[]): string[] => {
  const ids = p.assignments.length ? p.assignments.map((a) => a.displayTypeId) : p.autoCreatedFor ? [p.autoCreatedFor] : []
  const fromTypes = [...new Set(ids.map((id) => types.find((t) => t.id === id)?.touchPoint).filter((t): t is DisplayType['touchPoint'] => !!t))]
  if (fromTypes.length || ids.length) return fromTypes
  const hint = NAME_HINTS.find(([re]) => re.test(p.name))
  return hint ? [hint[1]] : []
}
function TouchPointIcons({ p, types }: { p: Playlist; types: DisplayType[] }) {
  const tps = touchPointsOf(p, types)
  if (!tps.length) return null
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      {tps.map((tp) => (
        <Tooltip key={tp} title={tp}>
          <span className="inline-flex" role="img" aria-label={`${tp} touch point`}><Icon name={touchPointIcon(tp)} size={17} style={{ color: T.primary }} /></span>
        </Tooltip>
      ))}
    </span>
  )
}

/* The name being typed lives here, in the input's own component, not in
   page state (ticket, 28 Sep 2026): as page state, every keystroke
   re-rendered the whole grid, and this controlled input's value lagged a
   render behind the keystroke — React reset the field to the old value and
   then applied the new one, which pushed the caret to the end each time, so
   a word at the start of a name couldn't be edited. */
function RenameField({ p, onSave, onCancel }: { p: Playlist; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(p.name)
  return (
    <div className="flex w-full min-w-0 items-center gap-1.5">
      <Input size="small" autoFocus aria-label="Playlist name" value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave(name); if (e.key === 'Escape') onCancel() }} />
      <Button type="text" size="small" aria-label="Save name" icon={<Icon name="check" size={18} style={{ color: T.success }} />} onClick={() => onSave(name)} />
      <Button type="text" size="small" aria-label="Cancel rename" icon={<Icon name="close" size={18} style={{ color: T.muted }} />} onClick={onCancel} />
    </div>
  )
}

function NameCell({ data, context }: Params) {
  if (!data) return null
  const c = context.current
  const p = data.p
  if (c.editing === p.id) return <RenameField key={p.id} p={p} onSave={(name) => c.rename(p, name)} onCancel={c.cancelEdit} />
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <TouchPointIcons p={p} types={c.types} />
        <span className="truncate">{p.name}</span>
        <Button type="text" size="small" aria-label={`Rename ${p.name}`} icon={<Icon name="edit" size={14} style={{ color: T.micro }} />} onClick={() => c.startEdit(p)} />
      </div>
      {p.autoCreatedFor && <div className="mt-[3px]"><Pill>auto-created with {c.typeName(p.autoCreatedFor)}</Pill></div>}
    </div>
  )
}

/* Not an expandable row any more (ticket, 26 Sep 2026: it read as its own
   accordion, competing with the settings toggle's). A hover shows which
   display types and zones this playlist fills, with an Open link to jump to
   each — the same content the old expanded row showed, just on hover
   instead of a click that pushed the grid down. */
function AssignedCell({ data, context }: Params) {
  if (!data) return null
  const c = context.current
  const n = data.p.assignments.length
  if (!n) return <Pill>unused</Pill>
  const content = (
    <div className="max-w-[280px]">
      <div className="mb-1.5" style={{ fontSize: 11.5, color: T.muted }}>{REASSIGN_TIP}</div>
      {data.p.assignments.map((a, i) => (
        <div key={i} className="flex items-center justify-between gap-2 py-1" style={{ fontSize: 12.5, borderTop: i > 0 ? `1px solid ${T.borderSubtle}` : 'none' }}>
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="dashboard_customize" size={14} style={{ color: T.muted }} />
            <b className="truncate">{a.displayTypeName}</b>
            <span style={{ color: T.muted }}>·</span>
            <span className="whitespace-nowrap" style={{ color: T.muted }}>{where(a)}</span>
          </span>
          <Button color="primary" variant="text" size="small" className="px-1" onClick={() => c.open(a.displayTypeId)}>
            Open<Icon name="arrow_forward" size={13} />
          </Button>
        </div>
      ))}
    </div>
  )
  return (
    <Popover trigger="hover" placement="rightTop" title={`Assigned to (${n})`} content={content}>
      <span className="inline-flex cursor-default items-center gap-1" tabIndex={0} aria-label={`${data.p.name} is assigned to ${n} display type${n > 1 ? 's' : ''} or zones`}>
        {n} assignment{n > 1 ? 's' : ''}<Icon name="info" size={14} style={{ color: T.micro }} />
      </span>
    </Popover>
  )
}

/* The settings disclosure arrow — its own leftmost column (not nested
   inside the Settings text cell), bigger and coloured, so it reads as an
   obviously clickable control on every row: assigned or not (26 Sep 2026,
   fixing failed-testing feedback that the previous, smaller chevron buried
   in the Settings column wasn't visible as clickable, and didn't show at
   all for a playlist with no assignments yet). */
function SettingsToggleCell({ data, context }: Params) {
  if (!data) return null
  const c = context.current
  const open = c.settingsExpanded === data.p.id
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} settings for ${data.p.name}`}
      onClick={() => c.toggleSettings(data.p.id)}
      className="flex h-full w-full cursor-pointer items-center justify-center border-0 bg-transparent p-0"
    >
      <Icon name={open ? 'expand_more' : 'chevron_right'} size={24} style={{ color: T.primary }} />
    </button>
  )
}

/* Read-only summary next to the toggle: this playlist's own settings
   (always — every playlist has these, assigned or not) plus, when it has
   exactly one assignment, that assignment's slot count (ambiguous with more
   than one, since each display type can cap the same playlist differently).
   For a zone's playlist that is the zone's own slots (28 Sep 2026). */
function SettingsSummaryCell({ data, context }: Params) {
  if (!data) return null
  const c = context.current
  const playlist = c.playlists.find((x) => x.id === data.p.id)
  const single = data.p.assignments.length === 1 ? c.types.find((t) => t.id === data.p.assignments[0].displayTypeId) : undefined
  const zoneId = data.p.assignments[0]?.zoneId ?? null
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {single && isCappedFor(single, zoneId) && capSummary(single, c.slotAssignment, zoneId).map(({ key, ...chip }) => <SummaryChip key={`cap-${key}`} {...chip} />)}
      {playlist && styleSummary(playlist).map(({ key, ...chip }) => <SummaryChip key={`style-${key}`} {...chip} />)}
    </span>
  )
}

function DeleteCell({ data, context }: Params) {
  if (!data) return null
  return <Button danger size="small" title="Delete playlist" aria-label={`Delete ${data.p.name}`} icon={<Icon name="delete" size={15} />} onClick={() => context.current.askDelete(data.p)} />
}

/* The playlist's own settings, expanded in place: shown once, whether or
   not it is assigned to anything. Below it, one Maximum Campaigns Played In
   Rotation / slot assignment block per assignment (labelled when there is
   more than one), since those stay tied to the specific screen. Height is
   measured (ResizeObserver), not guessed — Slot assignment's cards wrap
   unpredictably. */
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
  }, [data.p.id, data.p.assignments.length, c.types, c.playlists])
  const playlist = c.playlists.find((x) => x.id === data.p.id)
  const assignments = data.p.assignments
  return (
    <div className="px-3 pb-3">
      <div ref={ref} className="overflow-hidden rounded-md border bg-white" style={{ borderColor: '#38b0cf' }}>
        <div className="p-3.5">
          {playlist ? <PlaylistStyleFields p={playlist} update={c.updatePlaylist(data.p.id)} /> : <Spin size="small" />}
        </div>
        {assignments.map((a, i) => {
          const t = c.types.find((x) => x.id === a.displayTypeId)
          return (
            <div key={`${a.displayTypeId}:${a.zoneId ?? ''}`} className="p-3.5" style={{ borderTop: `1px solid ${T.borderSubtle}` }}>
              {assignments.length > 1 && (
                <div className="mb-2.5 flex items-center gap-1.5" style={{ fontSize: 12, color: T.muted }}>
                  <Icon name="dashboard_customize" size={14} />
                  <b style={{ color: T.text }}>{a.displayTypeName}</b>·<span>{where(a)}</span>
                </div>
              )}
              {t ? (
                <PlaylistCapSlotsFields
                  d={t}
                  update={c.update(a.displayTypeId)}
                  slotAssignment={c.slotAssignment}
                  advertiserOpen={c.advertiserOpenFor(a.displayTypeId)}
                  partners={c.partners}
                  onFixConnection={c.onFixConnection}
                  zoneId={a.zoneId ?? null}
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

/* First-paint guess only — SettingsRow measures the real height a moment
   later and corrects it via resetRowHeights(). Keeping the guess close cuts
   down the visible jump. */
const STYLE_BLOCK_ESTIMATE = 190
const CAP_BLOCK_ESTIMATE = 76
const SLOT_ESTIMATE = 150
function estimateSettingsHeight(p: Playlist, types: DisplayType[], slotAssignment: boolean) {
  let h = 28 + STYLE_BLOCK_ESTIMATE
  for (const a of p.assignments) {
    const t = types.find((x) => x.id === a.displayTypeId)
    h += 28 + CAP_BLOCK_ESTIMATE
    if (p.assignments.length > 1) h += 22
    if (t && slotAssignment && isCappedFor(t, a.zoneId ?? null)) h += SLOT_ESTIMATE
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
  /* Same query Advertisers / Inventory itself uses (ticket, 28 Sep 2026) —
     already prefetched in the background whenever DSP integration is on, so
     this rarely costs its own round trip. */
  const availableInventory = useAvailableInventory(slotAssignment)
  /* Same "greyed out, not hidden, while DSP integration is off" logic as
     Display Types used to apply (Rob, 24 Sep 2026), now here with it. */
  const features = useFeatures(slotAssignment)
  const dspOn = features.data?.dspIntegration !== false

  interface Draft { types: DisplayType[]; playlists: Playlist[] }
  const saved = useMemo<Draft | undefined>(
    () => (types.data && playlists.data ? { types: slotAssignment ? types.data.map(normaliseSlots) : types.data, playlists: playlists.data } : undefined),
    [types.data, playlists.data, slotAssignment],
  )
  const { draft, setDraft, dirty, reset, commitNext } = useDraft(saved)
  useReportDirty(dirty)
  const [saving, setSaving] = useState(false)

  const [editing, setEditing] = useState<string | null>(null)
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
    if (!draft || !types.data || !playlists.data) return
    setSaving(true)
    try {
      await Promise.all([
        saveDisplayTypes(draft.types, types.data, { extensions: slotAssignment }),
        savePlaylistSettings(draft.playlists, playlists.data),
      ])
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
    editing, settingsExpanded,
    typeName: (id) => (id ? typeNames.get(id) ?? id : ''),
    startEdit: (p) => setEditing(p.id),
    cancelEdit: () => setEditing(null),
    rename: async (p, name) => {
      if (!name.trim()) return
      try {
        await api('PUT', `/admin/v1/playlists/${p.id}/record`, { name: name.trim() })
        setEditing(null)
        await refresh()
      } catch (e) { fail(e, 'Could not rename the playlist.') }
    },
    toggleSettings: (id) => setSettingsExpanded((cur) => (cur === id ? null : id)),
    askDelete: async (p) => {
      try { setDeleting({ p, check: await api<DeleteCheck>('GET', `/admin/v1/playlists/${p.id}/delete-check`), busy: false }) } catch (e) { fail(e, 'Could not check this playlist.') }
    },
    open: (id) => navigate(`/display-types?id=${encodeURIComponent(id)}`),
    types: draft?.types ?? [],
    playlists: draft?.playlists ?? [],
    update: (displayTypeId) => (fn) => setDraft((cur) => (cur ? { ...cur, types: cur.types.map((t) => (t.id === displayTypeId ? fn(t) : t)) } : cur)),
    updatePlaylist: (playlistId) => (fn) => setDraft((cur) => (cur ? { ...cur, playlists: cur.playlists.map((p) => (p.id === playlistId ? fn(p) : p)) } : cur)),
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
    if (settingsExpanded === p.id) r.push({ kind: 'settings', p })
    return r
  }), [items, settingsExpanded])
  const columns = useMemo<ColDef<Row>[]>(() => [
    { headerName: '', width: 48, suppressSizeToFit: true, cellRenderer: SettingsToggleCell },
    { headerName: 'Playlist', width: 170, cellRenderer: NameCell },
    { headerName: 'Assigned to', width: 140, cellRenderer: AssignedCell },
    { headerName: 'Settings', width: 240, cellRenderer: SettingsSummaryCell },
    { headerName: '', width: 70, suppressSizeToFit: true, cellRenderer: DeleteCell },
  ], [])

  if (!playlists.data || !draft) return <Spin />
  const unused = items.filter((p) => !p.assignments.length).length
  const advertiserSlots = availableInventory.data?.items?.length
  const n = deleting?.check.dependents.length ?? 0
  return (
    <div>
      <div className="mb-3" style={{ fontSize: 14 }}>
        <b>{items.length}</b> Playlists · <b>{unused}</b> unused
        {slotAssignment && advertiserSlots !== undefined && <> · <b>{advertiserSlots}</b> advertiser slots</>}
      </div>
      <Grid<Row>
        label="Playlists"
        rows={rows}
        columns={columns}
        context={ctx}
        getRowId={(r) => `${r.kind}:${r.p.id}`}
        isFullWidthRow={(p) => p.rowNode.data?.kind === 'settings'}
        fullWidthCellRenderer={SettingsRow}
        getRowHeight={(p: RowHeightParams<Row>) => {
          if (p.data?.kind === 'settings') return Math.max(1, rowHeights.current.get(p.data.p.id) ?? estimateSettingsHeight(p.data.p, draft.types, slotAssignment))
          return p.data?.p.autoCreatedFor ? 62 : 44
        }}
        /* Expanding a row inserts a taller settings row; recompute every row's height and position. */
        onRowDataUpdated={(e) => e.api.resetRowHeights()}
        onGridReady={(e) => { gridApi.current = e.api }}
        getRowStyle={(p) => (p.data && p.data.p.id === settingsExpanded ? { background: T.primaryTint } : undefined)}
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
