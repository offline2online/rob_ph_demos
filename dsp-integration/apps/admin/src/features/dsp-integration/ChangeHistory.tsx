/* Change history (ticket W9b1lEcTUbEMphsmBma3, 9 Oct 2026): every change to a
   retailer-side SSP setting — who (a person, or an agent), what object and
   field, from what to what, and when. Read-only: the log is written by the
   API around each save and nothing here can alter it. The same data is what
   an agent reads from GET /admin/v1/ssp-audit-log. */
import { useQuery } from '@tanstack/react-query'
import { Button, Input, Select, Spin } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { useMemo, useState } from 'react'
import { api } from '../../api/client'
import { Callout } from '../../shared/Callout'
import { Field } from '../../shared/Field'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { StatusPill } from '../../shared/Pill'
import { T } from '../../theme/phTheme'
import { SubPageHeader } from './SubPageHeader'

export interface AuditEntry {
  id: string; at: string; changeId: string
  actor: { type: 'human' | 'agent'; id: string; name: string; sessionUserId: string }
  request: string; reason: string | null
  objectType: string; objectId: string; objectLabel: string
  changeType: 'created' | 'updated' | 'deleted'
  field: string; oldValue: unknown; newValue: unknown
}
interface Page { items: AuditEntry[]; next: string | null }
interface Filters { objectType?: string; objectId: string; field: string; actorType?: string; actorId: string; from: string; to: string }

export const HISTORY_TIP =
  'Every change to a setting that governs what you sell and at what price: exchange settings, floors and CPMs (including each display type’s), deals, buyers lists, inventory and auction configuration, and each DSP’s bid settings. Each entry shows who changed it (a person or an agent), the field, the old and new value, and when. The same history can be queried by an agent.'

const OBJECT_TYPES = [
  { value: 'exchange', label: 'Exchange settings' },
  { value: 'pricing_settings', label: 'Pricing and auction' },
  { value: 'advertiser_setting', label: 'Advertiser' },
  { value: 'targeting_variable_access', label: 'Targeting variable access' },
  { value: 'buyers_list', label: 'Buyers list (deal)' },
  { value: 'display_type', label: 'Display type / slots' },
  { value: 'dsp_partner', label: 'DSP' },
]
const typeLabel = (t: string) => OBJECT_TYPES.find((o) => o.value === t)?.label ?? t
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export const showValue = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'string' ? (v === '' ? '(empty)' : v) : JSON.stringify(v))
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

function queryString(f: Filters, cursor?: string) {
  const p = new URLSearchParams()
  if (f.objectType) p.set('objectType', f.objectType)
  if (f.objectId.trim()) p.set('objectId', f.objectId.trim())
  if (f.field.trim()) p.set('fieldPrefix', f.field.trim())
  if (f.actorType) p.set('actorType', f.actorType)
  if (f.actorId.trim()) p.set('actorId', f.actorId.trim())
  if (f.from) p.set('from', new Date(f.from).toISOString())
  if (f.to) p.set('to', new Date(f.to).toISOString())
  if (cursor) p.set('cursor', cursor)
  p.set('limit', '100')
  return `?${p}`
}

const ActorCell = ({ data }: ICellRendererParams<AuditEntry>) =>
  data ? (
    <div className="flex items-center gap-2 py-1">
      <StatusPill colour={data.actor.type === 'agent' ? '#9747ff' : T.primary} icon={data.actor.type === 'agent' ? 'smart_toy' : 'person'}>{data.actor.type === 'agent' ? 'Agent' : 'Person'}</StatusPill>
      <span className="truncate" title={data.actor.id}>{data.actor.name}</span>
    </div>
  ) : null
const ObjectCell = ({ data }: ICellRendererParams<AuditEntry>) =>
  data ? (
    <div className="py-1" style={{ lineHeight: 1.3 }}>
      <div className="truncate">{data.objectLabel}</div>
      <div className="truncate" style={{ fontSize: 11, color: T.micro }}>{typeLabel(data.objectType)}{data.changeType !== 'updated' ? ` · ${data.changeType}` : ''}</div>
    </div>
  ) : null
const ChangeCell = ({ data }: ICellRendererParams<AuditEntry>) =>
  data ? (
    <div className="py-1" style={{ lineHeight: 1.4 }}>
      <div style={{ fontFamily: MONO, fontSize: 12 }}>{data.field}</div>
      <div className="flex flex-wrap items-center gap-1.5" style={{ fontSize: 12.5 }}>
        <span style={{ color: T.muted, textDecoration: data.oldValue == null ? 'none' : 'line-through' }}>{showValue(data.oldValue)}</span>
        <Icon name="arrow_forward" size={14} style={{ color: T.micro }} />
        <b>{showValue(data.newValue)}</b>
      </div>
      {data.reason && <div style={{ fontSize: 11, color: T.micro }}>Reason: {data.reason}</div>}
    </div>
  ) : null

const EMPTY: Filters = { objectId: '', field: '', actorId: '', from: '', to: '' }

export function ChangeHistory() {
  const [draft, setDraft] = useState<Filters>(EMPTY)
  const [applied, setApplied] = useState<Filters>(EMPTY)
  const [more, setMore] = useState<AuditEntry[]>([])
  const [next, setNext] = useState<string | null | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const q = useQuery({ queryKey: ['ssp-audit-log', applied], queryFn: () => api<Page>('GET', `/admin/v1/ssp-audit-log${queryString(applied)}`) })
  const rows = [...(q.data?.items ?? []), ...more]
  const cursor = next === undefined ? q.data?.next ?? null : next

  const apply = () => { setMore([]); setNext(undefined); setApplied(draft) }
  const clear = () => { setDraft(EMPTY); setMore([]); setNext(undefined); setApplied(EMPTY) }
  const loadMore = async () => {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await api<Page>('GET', `/admin/v1/ssp-audit-log${queryString(applied, cursor)}`)
      setMore((m) => [...m, ...page.items])
      setNext(page.next)
    } finally { setLoadingMore(false) }
  }

  const columns = useMemo<ColDef<AuditEntry>[]>(() => [
    { headerName: 'When', width: 170, valueGetter: (p) => (p.data ? when(p.data.at) : '') },
    { headerName: 'Changed by', width: 230, cellRenderer: ActorCell },
    { headerName: 'Setting', width: 220, cellRenderer: ObjectCell },
    { headerName: 'Change', flex: 1, minWidth: 280, cellRenderer: ChangeCell },
  ], [])
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const filtered = JSON.stringify(applied) !== JSON.stringify(EMPTY)

  return (
    <>
      <SubPageHeader icon="history" title="Change history" tip={HISTORY_TIP} sub={q.data ? <><b>{rows.length}{cursor ? '+' : ''}</b> {rows.length === 1 ? 'change' : 'changes'}{filtered ? ' match' : ''}, newest first</> : undefined} />
      <form className="mt-4 grid grid-cols-4 items-end gap-x-3 gap-y-2" onSubmit={(e) => { e.preventDefault(); apply() }} aria-label="Filter the change history">
        <Field label="Setting type" htmlFor="h-type">
          <Select id="h-type" allowClear placeholder="Any" style={{ width: '100%' }} value={draft.objectType} onChange={(v) => set('objectType', v)} options={OBJECT_TYPES} />
        </Field>
        <Field label="Object ID" htmlFor="h-object">
          <Input id="h-object" value={draft.objectId} onChange={(e) => set('objectId', e.target.value)} placeholder="e.g. menu_board" />
        </Field>
        <Field label="Field" htmlFor="h-field">
          <Input id="h-field" value={draft.field} onChange={(e) => set('field', e.target.value)} placeholder="e.g. floorCpm" />
        </Field>
        <Field label="Changed by" htmlFor="h-by">
          <Select id="h-by" allowClear placeholder="Anyone" style={{ width: '100%' }} value={draft.actorType} onChange={(v) => set('actorType', v)} options={[{ value: 'human', label: 'People' }, { value: 'agent', label: 'Agents' }]} />
        </Field>
        <Field label="Actor ID" htmlFor="h-actor">
          <Input id="h-actor" value={draft.actorId} onChange={(e) => set('actorId', e.target.value)} placeholder="user or agent id" />
        </Field>
        <Field label="From" htmlFor="h-from">
          <Input id="h-from" type="datetime-local" value={draft.from} onChange={(e) => set('from', e.target.value)} />
        </Field>
        <Field label="To" htmlFor="h-to">
          <Input id="h-to" type="datetime-local" value={draft.to} onChange={(e) => set('to', e.target.value)} />
        </Field>
        <div className="flex items-center gap-2">
          <Button type="primary" htmlType="submit">Apply</Button>
          <Button type="text" onClick={clear} disabled={!filtered && JSON.stringify(draft) === JSON.stringify(EMPTY)}>Clear</Button>
        </div>
      </form>
      <div className="mt-4">
        {q.isLoading ? <div className="py-10 text-center"><Spin /></div>
          : q.isError ? <Callout tone="warning" icon="warning">The change history couldn’t be loaded{(q.error as Error)?.message ? `: ${(q.error as Error).message}` : '.'}</Callout>
          : !rows.length ? <Callout tone="info" icon="history">{filtered ? 'No changes match these filters.' : 'No settings have been changed yet. Changes made from now on are listed here.'}</Callout>
          : (
            <>
              <Grid<AuditEntry> label="Change history" rows={rows} columns={columns} getRowId={(r) => r.id} rowHeight={64} headerHeight={40} stickyHeader />
              {cursor && <div className="mt-3 text-center"><Button onClick={loadMore} loading={loadingMore}>Load older changes</Button></div>}
            </>
          )}
      </div>
    </>
  )
}
