/* Buyers lists table (spec "Support private auctions" — Available
   Inventory UX): view, manage and edit the buyers lists that are then
   selectable in Available Inventory's Assigned to column, underneath that
   table (Rob, 23 Sep). */
import { Button } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import type { BuyersList } from '@ph-dsp/types'
import { useState } from 'react'
import { api, ApiRequestError } from '../../api/client'
import { DeleteDialog } from '../../shared/DeleteDialog'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { SectionLabel } from '../../shared/SectionLabel'
import { T } from '../../theme/phTheme'
import { BuyersListModal } from './BuyersListModal'

type Ctx = { current: { onEdit: (l: BuyersList) => void; onDelete: (l: BuyersList) => void; canEdit: boolean } }
type P = ICellRendererParams<BuyersList, unknown, Ctx>

const NameCell = ({ data }: P) =>
  data ? (
    <div className="min-w-0">
      <div className="truncate" style={{ fontWeight: 500 }}>{data.name}</div>
      {data.description && <div className="truncate" style={{ fontSize: 11.5, color: T.muted }}>{data.description}</div>}
    </div>
  ) : null
const BuyersCell = ({ data }: P) => (data ? <span>{data.invitedBuyers.length} buyer{data.invitedBuyers.length === 1 ? '' : 's'}</span> : null)
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
/* The deal's own one-time bidding deadline, and — once it has cleared —
   the rate it locked in for the rest of the delivery term above. */
const RateCell = ({ data }: P) => {
  if (!data) return null
  if (data.lockedWin) return <span style={{ fontSize: 12.5, color: T.primary }}>Locked: {data.lockedWin.cpm} CPM</span>
  if (data.auctionCloses) return <span style={{ fontSize: 12.5 }}>Bidding closes {fmt(data.auctionCloses)}</span>
  return <span style={{ color: T.muted }}>Clears every window</span>
}
const ActionsCell = ({ data, context }: P) =>
  data ? (
    <span className="inline-flex gap-1">
      <Button type="text" size="small" aria-label={`Edit ${data.name}`} icon={<Icon name="edit" size={15} />} onClick={() => context.current.onEdit(data)} />
      <Button type="text" size="small" danger aria-label={`Delete ${data.name}`} icon={<Icon name="delete" size={15} />} onClick={() => context.current.onDelete(data)} />
    </span>
  ) : null

export function BuyersListsTable({ lists, canEdit, onChanged }: { lists: BuyersList[]; canEdit: boolean; onChanged: () => void }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<BuyersList | null>(null)
  const [deleting, setDeleting] = useState<BuyersList | null>(null)
  const [deleteError, setDeleteError] = useState<ApiRequestError | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const columns: ColDef<BuyersList>[] = [
    { headerName: 'Buyers list', flex: 2, minWidth: 220, cellRenderer: NameCell, valueGetter: (p) => p.data?.name ?? '' },
    { headerName: 'Invited buyers', width: 150, minWidth: 130, cellRenderer: BuyersCell },
    { headerName: 'Delivery term', width: 260, minWidth: 220, cellRenderer: TermCell },
    { headerName: 'Rate', width: 200, minWidth: 170, cellRenderer: RateCell },
    ...(canEdit ? [{ headerName: '', width: 90, suppressSizeToFit: true, cellRenderer: ActionsCell }] : []),
  ]
  const context = {
    canEdit,
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
      <div className="mb-2 flex items-center justify-between gap-3">
        <SectionLabel>
          <WithTip tip="A reusable private-auction deal: an invited-buyer list plus an active time window, created once and then selectable in Available Inventory's Assigned to column for any slot.">
            Buyers lists
          </WithTip>
        </SectionLabel>
        {canEdit && (
          <Button type="text" size="small" icon={<Icon name="add" size={16} />} onClick={() => { setEditing(null); setModalOpen(true) }}>
            New buyers list
          </Button>
        )}
      </div>
      {lists.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}>
          <Icon name="gavel" size={18} />
          <span>No buyers lists yet. Create one to run a private auction on a slot.</span>
        </div>
      ) : (
        <Grid<BuyersList> label="Buyers lists" rows={lists} columns={columns} context={context} getRowId={(l) => l.id} rowHeight={52} headerHeight={40} />
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
