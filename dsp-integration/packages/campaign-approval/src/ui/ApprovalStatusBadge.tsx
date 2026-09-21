/* The campaign's approval status, with "Approved automatically" under it
   where relevant (spec §3). Status names are fixed so the table can filter. */
import { STATUS_LABELS, type ApprovalMode, type ApprovalStatus } from '../types'
import { C } from './tokens'

const COLOURS: Record<ApprovalStatus, string> = { draft: C.muted, awaiting_approval: C.warning, approved: C.success, rejected: C.error }

export function ApprovalStatusBadge({ status, mode }: { status: ApprovalStatus; mode?: ApprovalMode | null }) {
  const colour = COLOURS[status]
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <span data-status={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.text }}>
        <span style={{ width: 8, height: 8, borderRadius: 9999, background: colour, flexShrink: 0 }} />
        {STATUS_LABELS[status]}
      </span>
      {status === 'approved' && mode === 'auto' && <span style={{ fontSize: 11, color: C.muted, marginLeft: 14 }}>Approved automatically</span>}
    </span>
  )
}
