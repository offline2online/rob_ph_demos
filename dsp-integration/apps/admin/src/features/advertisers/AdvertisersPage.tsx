/* Advertisers (spec §3; admin only): every advertiser across all DSPs, with
   campaign approval and floor multiplier per advertiser. Campaigns are not
   approved here. Changes are applied with Save changes (decision 4). */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, InputNumber, Spin, Switch } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { SLOT_OWNERS, type Advertiser, type AdvertiserSetting } from '@ph-dsp/types'
import { useMemo, useState } from 'react'
import { api, ApiRequestError } from '../../api/client'
import { Callout } from '../../shared/Callout'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { StatusPill } from '../../shared/Pill'
import { SaveBar } from '../../shared/SaveBar'
import { useReportDirty } from '../../shared/UnsavedChanges'
import { useDraft } from '../../shared/useDraft'
import { T } from '../../theme/phTheme'

interface Data { currency: string; floorCpm: number; items: Advertiser[] }
type Settings = Record<string, AdvertiserSetting>
type Ctx = { current: { settings: Settings; data: Data; set: (id: string, patch: Partial<AdvertiserSetting>) => void } }
type P = ICellRendererParams<Advertiser, unknown, Ctx>

const effective = (floor: number, m: number) => Math.round(floor * (m || 0) * 100) / 100

const NameCell = ({ data }: P) => (data ? <span className="inline-flex min-w-0 items-center gap-1.5"><Icon name="sell" size={14} style={{ color: SLOT_OWNERS.advertiser.colour }} /><span className="truncate">{data.name}</span></span> : null)
const ViaCell = ({ data }: P) => (data ? <span className="truncate" style={{ color: T.muted }}>{data.via.join(', ')}</span> : null)
function ApprovalCell({ data, context }: P) {
  if (!data) return null
  const s = context.current.settings[data.advertiserId]
  return (
    <span className="inline-flex items-center gap-2">
      <Switch size="small" aria-label={`${data.name}: campaign approval`} checked={s.approvalRequired} onChange={(v) => context.current.set(data.advertiserId, { approvalRequired: v })} />
      <span style={{ fontSize: 11.5, color: T.muted }}>{s.approvalRequired ? 'Required' : 'Not required'}</span>
    </span>
  )
}
function MultiplierCell({ data, context }: P) {
  if (!data) return null
  return (
    <InputNumber size="small" aria-label={`${data.name}: floor multiplier`} step={0.05} min={0} style={{ width: 90 }}
      formatter={(v) => (v === undefined || v === null ? '' : String(v))} parser={(v) => Number(v)}
      value={context.current.settings[data.advertiserId].floorMultiplier}
      onChange={(v) => context.current.set(data.advertiserId, { floorMultiplier: v === null ? 1 : Number(v) })} />
  )
}
function EffectiveCell({ data, context }: P) {
  if (!data) return null
  const { settings, data: d } = context.current
  return <span>{`${d.currency} ${effective(d.floorCpm, settings[data.advertiserId].floorMultiplier).toFixed(2)} CPM`}</span>
}
const header = (label: string, tip: string) => () => <WithTip tip={tip}><span className="ag-header-cell-text">{label}</span></WithTip>

export function AdvertisersPage() {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['advertisers'], queryFn: () => api<Data>('GET', '/admin/v1/advertisers'), retry: false })
  const saved = useMemo<Settings | undefined>(() => q.data && Object.fromEntries(q.data.items.map((a) => [a.advertiserId, { approvalRequired: a.approvalRequired, floorMultiplier: a.floorMultiplier }])), [q.data])
  const { draft, setDraft, dirty, reset, commitNext } = useDraft(saved)
  useReportDirty(dirty)
  const [saving, setSaving] = useState(false)
  const data = q.data
  const columns = useMemo<ColDef<Advertiser>[]>(() => data ? [
    { headerName: 'Advertiser', width: 200, cellRenderer: NameCell },
    { headerName: 'Via', width: 200, cellRenderer: ViaCell, headerComponent: header('Via', "The DSP(s) this advertiser's campaigns come through.") },
    { headerName: 'Campaign approval', width: 170, suppressSizeToFit: true, cellRenderer: ApprovalCell, headerComponent: header('Campaign approval', 'Required: the advertiser’s campaigns wait for approval in the Campaigns section. Not required: they publish after automated checks.') },
    { headerName: 'Floor multiplier', width: 140, suppressSizeToFit: true, cellRenderer: MultiplierCell, headerComponent: header('Floor multiplier', 'Scales this advertiser’s floor. Default 1.0, e.g. 0.8 for a preferred supplier or 1.2 for a new one.') },
    { headerName: 'Effective floor', width: 150, cellRenderer: EffectiveCell, headerComponent: header('Effective floor', `Floor CPM (${data.currency} ${data.floorCpm}, set in DSP Integration → Advertiser settings) × this advertiser's floor multiplier.`) },
  ] : [], [data])

  if (q.error) return <Callout tone="error" icon="block">{q.error instanceof ApiRequestError ? q.error.message : 'Could not load advertisers.'}</Callout>
  if (!data || !draft) return <Spin />

  const onSave = async () => {
    setSaving(true)
    try {
      await api('PUT', '/admin/v1/advertisers', { settings: draft })
      commitNext()
      await qc.invalidateQueries({ queryKey: ['advertisers'] })
    } catch (e) {
      message.error(e instanceof ApiRequestError ? [e.message, ...(e.body?.error.details ?? []).map((d) => d.reason)].join(' ') : 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }
  const context = { settings: draft, data, set: (id: string, patch: Partial<AdvertiserSetting>) => setDraft((cur) => (cur ? { ...cur, [id]: { ...cur[id], ...patch } } : cur)) }

  return (
    <div>
      <div className="mb-3.5 flex justify-end">
        <StatusPill colour={T.muted} icon="admin_panel_settings">Admin only</StatusPill>
      </div>
      {data.items.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}><Icon name="sell" size={18} />No advertisers yet. They appear here once a DSP is connected.</div>
      ) : (
        <Grid<Advertiser> label="Advertisers" rows={data.items} columns={columns} context={context} getRowId={(a) => a.advertiserId} />
      )}
      <SaveBar dirty={dirty} saving={saving} onSave={onSave} onCancel={reset} />
    </div>
  )
}
