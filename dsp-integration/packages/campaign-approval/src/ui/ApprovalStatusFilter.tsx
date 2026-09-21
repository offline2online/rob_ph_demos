/* Status filter above the campaign table (spec §3): the four statuses, each
   with its count. Choosing the selected status again clears the filter. */
import { Button } from 'antd'
import { STATUSES, STATUS_LABELS, type ApprovalStatus, type StatusCounts } from '../types'

export function ApprovalStatusFilter({ counts, value, onChange }: { counts: StatusCounts; value: ApprovalStatus | null; onChange: (v: ApprovalStatus | null) => void }) {
  return (
    <div role="group" aria-label="Filter by approval status" style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
      {STATUSES.map((s) => (
        <Button key={s} aria-pressed={value === s} type={value === s ? 'primary' : 'default'} ghost={value === s} onClick={() => onChange(value === s ? null : s)}>
          {STATUS_LABELS[s]} <b style={{ marginLeft: 4 }}>{counts[s]}</b>
        </Button>
      ))}
    </div>
  )
}
