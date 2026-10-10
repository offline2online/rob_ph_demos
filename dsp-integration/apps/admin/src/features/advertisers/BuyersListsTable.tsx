/* Buyers and targeting table (spec "Support private auctions" — Available
   Inventory UX): view, manage and edit the buyers lists that are then
   selectable in Available Inventory's Assigned to column, underneath that
   table (Rob, 23 Sep). */
import { Button } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { TARGETING_VARIABLES, type BuyersList } from '@ph-dsp/types'
import { useState } from 'react'
import { api, ApiRequestError } from '../../api/client'
import { DeleteDialog } from '../../shared/DeleteDialog'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { Tip } from '../../shared/Tip'
import { SectionLabel } from '../../shared/SectionLabel'
import { T } from '../../theme/phTheme'
import { BuyersListModal } from './BuyersListModal'
import { cpmKind, cpmKindHint, playsText, rateText, sourceLabel } from './effectiveTerm'

type Capacity = Map<string, { plays: number; displayTypes: number; positions: number }>
type Ctx = { current: { capacity: Capacity; onEdit: (l: BuyersList) => void; onDelete: (l: BuyersList) => void; canEdit: boolean } }
type P = ICellRendererParams<BuyersList, unknown, Ctx>

/* The name is the way in (ph-designer: a row's name opens it; the icon button is only a shortcut). */
const NameCell = ({ data, context }: P) =>
  data ? (
    <div className="min-w-0">
      {context.current.canEdit ? (
        <button
          type="button"
          className="block max-w-full truncate border-0 bg-transparent p-0 text-left hover:underline"
          style={{ color: T.primary, cursor: 'pointer', font: 'inherit', fontWeight: 500 }}
          onClick={() => context.current.onEdit(data)}
        >
          {data.name}
        </button>
      ) : (
        <div className="truncate" style={{ fontWeight: 500 }}>{data.name}</div>
      )}
      {data.description && <div className="truncate" style={{ fontSize: 11.5, color: T.muted }}>{data.description}</div>}
    </div>
  ) : null
/* Who the deal is for: named advertisers, IAB categories, or both (a union). */
const BuyersCell = ({ data }: P) => {
  if (!data) return null
  const buyers = data.invitedBuyers.length ? `${data.invitedBuyers.length} buyer${data.invitedBuyers.length === 1 ? '' : 's'}` : ''
  const cats = (data.invitedCategories ?? []).length ? `Category: ${data.invitedCategories.join(', ')}` : ''
  return <span className="truncate" title={[buyers, cats].filter(Boolean).join(' + ')}>{[buyers, cats].filter(Boolean).join(' + ')}</span>
}
const TargetingCell = ({ data }: P) => {
  const t = data?.targeting ?? []
  if (!data) return null
  if (!t.length) return <span style={{ color: T.muted }}>No targeting</span>
  const label = (v: string) => TARGETING_VARIABLES.find((x) => x.key === v)?.label ?? v
  return <span className="truncate" style={{ fontSize: 12.5 }} title={t.map((c) => `${label(c.variable)}: ${c.values.length} value${c.values.length === 1 ? '' : 's'}`).join('; ')}>{t.length} criteri{t.length === 1 ? 'on' : 'a'}: {t.map((c) => label(c.variable)).join(', ')}</span>
}
const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : null)
/* The delivery term (spec "Private auctions: two-period model", 23 Sep
   2026) — the span this deal is awarded for; was "Active window" before
   the auction window (bidding deadline) became a separate period. */
const TermCell = ({ data }: P) => {
  if (!data) return null
  const from = fmt(data.activeFrom)
  const to = fmt(data.activeTo)
  if (!from && !to) return <span style={{ color: T.muted }}>Always active</span>
  return <span style={{ fontSize: 12.5 }}>{from ?? 'No start'} → {to ?? 'No end'}</span>
}
/* Rate (USD CPM): the rate a deal locked in for the rest of its delivery term, once it has one; until then the
   rate it inherits platform -> DSP -> this list, so the cell is never blank. */
const Sub = ({ children }: { children: string }) => <div style={{ fontSize: 11.5, color: T.muted }}>{children}</div>
const RateCell = ({ data }: P) => {
  if (!data) return null
  const kind = cpmKind(data.dealType)
  if (data.lockedWin) return <Tip title="Locked: the rate this deal's auction settled at, billed for the rest of its delivery term."><span style={{ fontSize: 12.5, color: T.primary }}>Locked: {data.lockedWin.cpm} CPM</span></Tip>
  const text = rateText(data.effectiveRateCpm)
  const src = sourceLabel(data.effectiveRateCpm?.source ?? 'none')
  return text
    ? <Tip title={`${cpmKindHint(data.dealType)}${src ? ` Source: ${src}.` : ''}`}><div><span style={{ fontSize: 12.5 }}>{text} {kind}</span><Sub>{src}</Sub></div></Tip>
    : <span style={{ color: T.muted }}>Per play</span>
}
/* Volume lives on the deal (open question 45): the single committed figure ('M plays', no 'of' denominator: a guaranteed deal is sold, not capped) for a deal with its own commitment;
   otherwise the volume inherited platform -> DSP, or 'Per play' when no level sets one. */
const VolumeCell = ({ data }: P) => {
  if (!data) return null
  /* Only a guaranteed deal commits volume; a private auction or preferred deal has none, so nothing is shown for it. */
  if (data.dealType !== 'guaranteed') return <span style={{ color: T.muted }}>Not applicable</span>
  if (data.committedPlays != null) return <span style={{ fontSize: 12.5 }}>{data.committedPlays.toLocaleString()} plays</span>
  const text = playsText(data.effectiveCommittedPlays)
  return text ? <div><span style={{ fontSize: 12.5 }}>{text}</span><Sub>{sourceLabel(data.effectiveCommittedPlays.source)}</Sub></div> : <span style={{ color: T.muted }}>Per play</span>
}
/* Estimated volume (8 Oct 2026): combined plays per window across every position the list is assigned to, an estimate from the criteria set on the list rather than a hard figure; the ceiling for committed volume. */
const CapacityCell = ({ data, context }: P) => {
  if (!data) return null
  const c = context.current.capacity.get(data.id)
  if (!c) return <span style={{ color: T.muted }}>Not assigned</span>
  return (
    <Tip title={`Estimated volume, not a hard figure, based on the buyers and targeting criteria set on this list: ${c.plays.toLocaleString('en-US')} plays per window across ${c.positions} assigned position${c.positions === 1 ? '' : 's'} on ${c.displayTypes} display type${c.displayTypes === 1 ? '' : 's'}: the sum of each one's plays per display x displays registered in PH Core.`}>
      <span style={{ fontSize: 12.5 }}>{c.plays.toLocaleString('en-US')}</span>
    </Tip>
  )
}
const DEAL_TYPE_LABELS = { private_auction: 'Private auction', preferred: 'Preferred deal', guaranteed: 'Programmatic guaranteed' } as const
const DealTypeCell = ({ data }: P) => (data ? <span style={{ fontSize: 12.5 }}>{DEAL_TYPE_LABELS[data.dealType] ?? 'Private auction'}</span> : null)
const ActionsCell = ({ data, context }: P) =>
  data ? (
    <span className="inline-flex gap-1">
      <Button type="text" size="small" aria-label={`Edit ${data.name}`} icon={<Icon name="edit" size={15} />} onClick={() => context.current.onEdit(data)} />
      <Button type="text" size="small" danger aria-label={`Delete ${data.name}`} icon={<Icon name="delete" size={15} />} onClick={() => context.current.onDelete(data)} />
    </span>
  ) : null

export function BuyersListsTable({ lists, canEdit, capacity, onChanged }: { lists: BuyersList[]; canEdit: boolean; capacity: Capacity; onChanged: () => void }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<BuyersList | null>(null)
  const [deleting, setDeleting] = useState<BuyersList | null>(null)
  const [deleteError, setDeleteError] = useState<ApiRequestError | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const columns: ColDef<BuyersList>[] = [
    { headerName: 'Buyers and targeting', flex: 2, minWidth: 220, cellRenderer: NameCell, valueGetter: (p) => `${p.data?.name}|${p.data?.description}` },
    { headerName: 'CPM', width: 200, minWidth: 170, cellRenderer: RateCell, valueGetter: (p) => JSON.stringify([p.data?.dealType, p.data?.lockedWin, p.data?.effectiveRateCpm]) },
    /* These cells have no field, so AG Grid saw an unchanged value (undefined) after a save and kept the old cell:
       an edited deal type kept showing "Private auction". Each gets a valueGetter over everything it renders. */
    { headerName: 'Deal type', width: 170, minWidth: 150, cellRenderer: DealTypeCell, valueGetter: (p) => p.data?.dealType ?? '' },
    { headerName: 'Invited buyers', width: 190, minWidth: 130, cellRenderer: BuyersCell, valueGetter: (p) => JSON.stringify([p.data?.invitedBuyers ?? [], p.data?.invitedCategories ?? []]) },
    { headerName: 'Committed volume', width: 190, minWidth: 160, cellRenderer: VolumeCell, valueGetter: (p) => JSON.stringify([p.data?.dealType, p.data?.committedPlays, p.data?.deliveredPlays, p.data?.effectiveCommittedPlays]) },
    { headerName: 'Estimated volume', width: 190, minWidth: 170, cellRenderer: CapacityCell, valueGetter: (p) => p.context.current.capacity.get(p.data?.id ?? '')?.plays ?? 0 },
    { headerName: 'Targeting', width: 230, minWidth: 180, cellRenderer: TargetingCell, valueGetter: (p) => JSON.stringify(p.data?.targeting ?? []) },
    { headerName: 'Delivery term', width: 260, minWidth: 220, cellRenderer: TermCell, valueGetter: (p) => `${p.data?.activeFrom}|${p.data?.activeTo}` },
    ...(canEdit ? [{ headerName: '', width: 90, suppressSizeToFit: true, cellRenderer: ActionsCell }] : []),
  ]
  const context = {
    canEdit, capacity,
    onEdit: (l: BuyersList) => {
      setEditing(l)
      setModalOpen(true)
    },
    onDelete: (l: BuyersList) => {
      setDeleting(l)
      setDeleteError(null)
    },
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api('DELETE', `/admin/v1/buyers-lists/${deleting.id}`)
      setDeleting(null)
      onChanged()
    } catch (e) {
      setDeleteError(e instanceof ApiRequestError ? e : null)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="mt-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionLabel style={{ margin: 0 }}>
          <WithTip tip="Reusable deal definitions for guaranteed and programmatic campaigns. Each list sets the deal type (private auction, preferred deal or programmatic guaranteed), who can buy (invited advertisers and IAB categories), the targeting criteria appended to the deal, the delivery term, the committed plays (programmatic guaranteed), the floor price and the auction close (private auction). Create one once, then pick it in Available Inventory's Assigned to column for any slot.">
            Buyers and targeting
          </WithTip>
        </SectionLabel>
        {canEdit && (
          <Button type="primary" icon={<Icon name="add" size={16} />} onClick={() => { setEditing(null); setModalOpen(true) }}>
            New buyers and targeting list
          </Button>
        )}
      </div>
      {lists.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}>
          <Icon name="gavel" size={18} />
          <span>No buyers and targeting yet. Create one to run a private auction on a slot.</span>
        </div>
      ) : (
        <Grid<BuyersList> label="Buyers and targeting" rows={lists} columns={columns} context={context} getRowId={(l) => l.id} rowHeight={52} headerHeight={40} stickyHeader />
      )}
      <BuyersListModal open={modalOpen} editing={editing} onClose={() => setModalOpen(false)} onSaved={() => onChanged()} />
      {deleting && (
        <DeleteDialog
          open={!!deleting} name={deleting.name}
          blockedReason={deleteError?.message}
          deleting={deleteBusy} onDelete={confirmDelete} onClose={() => setDeleting(null)}
        >
          This removes the buyers list. It can’t be undone.
          {deleteError?.body?.error.details?.length ? (
            <ul className="mt-2 mb-0 pl-[18px]">
              {deleteError.body.error.details.map((d, i) => <li key={i}>{d.reason}</li>)}
            </ul>
          ) : null}
        </DeleteDialog>
      )}
    </div>
  )
}
