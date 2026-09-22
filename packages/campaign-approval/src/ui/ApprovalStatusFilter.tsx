/* Status filter above the campaign table (spec §3): Awaiting approval,
   Approved and Rejected, each with its count — never Draft (ticket,
   22 Sep): a retailer only ever sees a campaign once it has been
   submitted, so Draft never surfaces in this filter even though it stays
   a real internal status (`StatusCounts.draft`, for other consumers of the
   counts). Choosing the selected status again clears the filter. */
import { Button } from 'antd'
import { STATUS_LABELS, type ApprovalStatus, type StatusCounts } from '../types'

/* The statuses a retailer-facing view ever shows or filters on. */
export const RETAILER_VISIBLE_STATUSES: ApprovalStatus[] = ['awaiting_approval', 'approved', 'rejected']

export function ApprovalStatusFilter({ counts, value, onChange }: { counts: StatusCounts; value: ApprovalStatus | null; onChange: (v: ApprovalStatus | null) => void }) {
  return (
    <div role="group" aria-label="Filter by approval status" style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
      {RETAILER_VISIBLE_STATUSES.map((s) => (
        <Button key={s} aria-pressed={value === s} type={value === s ? 'primary' : 'default'} ghost={value === s} onClick={() => onChange(value === s ? null : s)}>
          {STATUS_LABELS[s]} <b style={{ marginLeft: 4 }}>{counts[s]}</b>
        </Button>
      ))}
    </div>
  )
}
