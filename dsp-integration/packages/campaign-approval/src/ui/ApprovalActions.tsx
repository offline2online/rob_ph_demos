/* In place of the activation toggle (spec §3): Awaiting approval shows the
   segmented Approve/Reject control (below); Approved shows `children` (the
   host's existing activation toggle, passed through untouched). Draft and
   Rejected campaigns can't be activated, so nothing is shown. */
import { Button, Input, Popover, Tooltip } from 'antd'
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { ApprovalStatus } from '../types'
import { Icon } from './Icon'
import { C } from './tokens'

export function RejectWithReason({ onReject, busy, children }: { onReject: (reason: string) => void | Promise<unknown>; busy?: boolean; children: (open: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const content = (
    <div style={{ width: 280 }}>
      <Input.TextArea aria-label="Reason for rejection" autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <Button size="small" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="small" type="primary" danger disabled={!reason.trim()} loading={busy}
          onClick={async () => { await onReject(reason.trim()); setOpen(false); setReason('') }}>Reject</Button>
      </div>
    </div>
  )
  return (
    <Popover open={open} onOpenChange={setOpen} trigger="click" title="Reason for rejection" content={content}>
      {children(() => setOpen(true))}
    </Popover>
  )
}

/* One half of the segmented control. Neutral at rest; on hover/press it
   tints toward its side's colour (green for Approve, red for Reject) so
   intent is clear before committing — presentation only, the same
   onApprove/onReject/permission/reason rules apply underneath. Icon-only,
   so it always carries a hover tooltip naming the action (ticket feedback,
   26 Sep: the first cut showed no label at all on hover). */
function SegmentHalf({ side, icon, label, disabled, deniedReason, busy, onClick }: {
  side: 'approve' | 'reject'
  icon: string
  label: string
  disabled?: boolean
  deniedReason?: string
  busy?: boolean
  onClick: () => void
}) {
  const [state, setState] = useState<'idle' | 'hover' | 'press'>('idle')
  const tint = side === 'approve' ? C.success : C.error
  const lit = !disabled && state !== 'idle'
  const style: CSSProperties = {
    width: 32, height: 26, padding: 0, borderRadius: 0,
    background: lit ? (state === 'press' ? `${tint}33` : `${tint}1a`) : 'transparent',
    color: lit ? tint : undefined,
  }
  return (
    <Tooltip title={disabled ? deniedReason : label}>
      <Button
        type="text" size="small" aria-label={label} disabled={disabled} loading={busy} style={style}
        icon={<Icon name={icon} size={18} />}
        onMouseEnter={() => setState('hover')}
        onMouseLeave={() => setState('idle')}
        onMouseDown={() => setState('press')}
        onMouseUp={() => setState('hover')}
        onClick={onClick}
      />
    </Tooltip>
  )
}

/* The consolidated segmented Approve/Reject control (ticket, 26 Sep): one
   pill, not two loose actions — left half approves directly, right half
   opens the reject-with-reason popover (rejection still only commits once
   a reason is entered and confirmed there). Used identically by the
   campaign table's activation column and the campaign detail page, so both
   read the same. */
function ApprovalSegmentedControl({ canApprove, busy, onApprove, onReject }: {
  canApprove: boolean
  busy?: boolean
  onApprove: () => void | Promise<unknown>
  onReject: (reason: string) => void | Promise<unknown>
}) {
  const deniedReason = 'Only HQ Admin can approve'
  return (
    <span role="group" aria-label="Approve or reject" style={{ display: 'inline-flex', alignItems: 'stretch', border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
      <SegmentHalf side="approve" icon="check_circle" label="Approve" disabled={!canApprove} deniedReason={deniedReason} busy={busy} onClick={() => onApprove()} />
      <span aria-hidden style={{ width: 1, background: C.border }} />
      <RejectWithReason onReject={onReject} busy={busy}>
        {(open) => <SegmentHalf side="reject" icon="cancel" label="Reject" disabled={!canApprove} deniedReason={deniedReason} onClick={open} />}
      </RejectWithReason>
    </span>
  )
}

export function ApprovalActions({ status, canApprove = true, busy, onApprove, onReject, children, awaitingExtra }: {
  status: ApprovalStatus | null | undefined
  canApprove?: boolean
  busy?: boolean
  onApprove: () => void | Promise<unknown>
  onReject: (reason: string) => void | Promise<unknown>
  /* The host's existing activation toggle. */
  children: ReactNode
  /* Rendered beside the segmented control only while Awaiting approval —
     e.g. the campaign detail page's own status bar with its activation
     toggle shown disabled. Omit to show the segmented control alone (the
     campaign table's activation column). */
  awaitingExtra?: ReactNode
}) {
  /* No approval state (e.g. an HQ-authored campaign): the host's toggle as-is. */
  if (!status || status === 'approved') return <>{children}</>
  if (status !== 'awaiting_approval') return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {awaitingExtra}
      <ApprovalSegmentedControl canApprove={canApprove} busy={busy} onApprove={onApprove} onReject={onReject} />
    </span>
  )
}
