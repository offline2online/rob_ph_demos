/* The Campaigns table's "Advertiser" column (ticket TCSUmrBV…, 4 Nov 2026).
   One column carries all advertiser info: the advertiser's name, the DSP it
   came through (or "Direct") beneath it, and the approval badge. Display
   only: approve / reject stays in the Upcoming Campaign Approval table.
   Props only: pass the row's CampaignRef-derived fields and the row's
   Approval from useCampaignApprovals (undefined for an HQ campaign). */
import { Tooltip } from 'antd'
import { STATUS_LABELS, type Approval } from '../types'
import { C } from './tokens'

export interface AdvertiserCellProps {
  /* null / empty for an HQ- or retailer-authored campaign: the cell shows a dash. */
  advertiserName: string | null | undefined
  /* The DSP the campaign came through; null / empty means a direct advertiser deal. */
  dspName?: string | null
  /* The row's approval from useCampaignApprovals; undefined while it loads or for an HQ campaign. */
  approval?: Pick<Approval, 'status' | 'mode' | 'pendingEdit' | 'reason' | 'reviewedBy' | 'reviewedAt'> | null
}

const COLOURS = { awaiting_approval: C.warning, approved: C.success, rejected: C.error, draft: C.muted } as const

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null)

/* "Rejected" tooltip: the reason, who and when. */
function rejectionTitle(a: NonNullable<AdvertiserCellProps['approval']>) {
  const by = a.reviewedBy ? `by ${a.reviewedBy}` : null
  const at = when(a.reviewedAt)
  return (
    <span>
      {a.reason || 'No reason recorded'}
      {(by || at) && <><br /><span style={{ opacity: 0.75 }}>{[by, at].filter(Boolean).join(' · ')}</span></>}
    </span>
  )
}

export function AdvertiserCell({ advertiserName, dspName, approval }: AdvertiserCellProps) {
  if (!advertiserName) return <span aria-label="No advertiser" style={{ color: C.muted }}>–</span>
  /* A draft is never shown to a retailer (spec §3): no badge for it. */
  const a = approval && approval.status !== 'draft' ? approval : null
  const label = a ? (a.status === 'approved' && a.pendingEdit ? 'Approved · edit pending' : STATUS_LABELS[a.status]) : null
  const badge = a && label && (
    <span data-status={a.status} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.text }}>
      <span style={{ width: 8, height: 8, borderRadius: 9999, background: COLOURS[a.status], flexShrink: 0 }} />
      {label}
      {a.status === 'approved' && a.mode === 'auto' && (
        <Tooltip title="Approved automatically: this advertiser doesn't require approval">
          <span style={{ fontSize: 11, lineHeight: '16px', padding: '0 6px', borderRadius: 4, background: C.subtle, color: C.muted }}>Auto</span>
        </Tooltip>
      )}
    </span>
  )
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 14, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{advertiserName}</span>
      <span style={{ fontSize: 12, color: C.muted }}>{dspName || 'Direct'}</span>
      {badge && (a!.status === 'rejected' ? <Tooltip title={rejectionTitle(a!)}><span tabIndex={0}>{badge}</span></Tooltip> : badge)}
    </span>
  )
}

/* Number of campaigns awaiting approval, from the bulk listApprovals result. */
export const awaitingCount = (approvals: Record<string, Pick<Approval, 'status'> | undefined>) =>
  Object.values(approvals).filter((a) => a?.status === 'awaiting_approval').length
