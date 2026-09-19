/* Playlist Management (spec §2): rename and delete only (decision 4). Changes
   apply immediately, as in the prototype. Assignments are made on the
   Display Types form; here they are listed, with Open to go to the type. */
import { useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Input, Spin } from 'antd'
import type { ColDef, ICellRendererParams, RowHeightParams } from 'ag-grid-community'
import type { DeleteCheck, Playlist } from '@ph-dsp/types'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiRequestError } from '../../api/client'
import { DeleteDialog } from '../../shared/DeleteDialog'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { T } from '../../theme/phTheme'
import { usePlaylists } from '../display-types/api'

export const REASSIGN_TIP = 'Reassign every display type and zone above before this playlist can be deleted.'

type Row = { kind: 'playlist'; p: Playlist } | { kind: 'detail'; p: Playlist }
interface Ctx {
  editing: string | null
  draftName: string
  expanded: string | null
  typeName: (id: string | null | undefined) => string
  setDraftName: (v: string) => void
  startEdit: (p: Playlist) => void
  cancelEdit: () => void
  rename: (p: Playlist) => void
  toggle: (id: string) => void
  askDelete: (p: Playlist) => void
  open: (displayTypeId: string) => void
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
            <Button type="text" size="small" className="text-primary" onClick={() => c.open(a.displayTypeId)}>
              Open<Icon name="arrow_forward" size={14} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PlaylistManagementPage() {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const playlists = usePlaylists()
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ p: Playlist; check: DeleteCheck; busy: boolean } | null>(null)

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['playlists'] }), qc.invalidateQueries({ queryKey: ['display-types'] })])
  const fail = (e: unknown, fallback: string) => message.error(e instanceof ApiRequestError ? [e.message, ...(e.body?.error.details ?? []).map((d) => d.reason)].join(' ') : fallback)
  const items = playlists.data ?? []
  /* Display type names, for the auto-created pill (a deleted type falls back to its id). */
  const typeNames = useMemo(() => new Map(items.flatMap((p) => p.assignments.map((a) => [a.displayTypeId, a.displayTypeName] as const))), [items])

  const ctx: Ctx = {
    editing, draftName, expanded,
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
    askDelete: async (p) => {
      try { setDeleting({ p, check: await api<DeleteCheck>('GET', `/admin/v1/playlists/${p.id}/delete-check`), busy: false }) } catch (e) { fail(e, 'Could not check this playlist.') }
    },
    open: (id) => navigate(`/display-types?id=${encodeURIComponent(id)}`),
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setDeleting({ ...deleting, busy: true })
    try {
      await api('DELETE', `/admin/v1/playlists/${deleting.p.id}`)
      setDeleting(null)
      await refresh()
    } catch (e) { setDeleting(null); fail(e, 'Could not delete the playlist.') }
  }

  const rows = useMemo<Row[]>(() => items.flatMap((p) => (expanded === p.id && p.assignments.length ? [{ kind: 'playlist' as const, p }, { kind: 'detail' as const, p }] : [{ kind: 'playlist' as const, p }])), [items, expanded])
  const columns = useMemo<ColDef<Row>[]>(() => [
    { headerName: 'Playlist', width: 170, cellRenderer: NameCell },
    { headerName: 'Assigned to', width: 150, cellRenderer: AssignedCell },
    { headerName: '', width: 70, suppressSizeToFit: true, cellRenderer: DeleteCell },
  ], [])

  if (!playlists.data) return <Spin />
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
        isFullWidthRow={(p) => p.rowNode.data?.kind === 'detail'}
        fullWidthCellRenderer={DetailRow}
        getRowHeight={(p: RowHeightParams<Row>) =>
          p.data?.kind === 'detail' ? 34 + p.data.p.assignments.length * 33 + 14 : p.data?.p.autoCreatedFor ? 62 : 44}
        /* Expanding a row inserts a taller detail row; recompute every row's height and position. */
        onRowDataUpdated={(e) => e.api.resetRowHeights()}
        getRowStyle={(p) => (p.data && p.data.p.id === expanded ? { background: T.primaryTint } : undefined)}
      />
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
