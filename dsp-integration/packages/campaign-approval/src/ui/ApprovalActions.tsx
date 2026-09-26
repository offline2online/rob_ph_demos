/* In place of the activation toggle (spec §3): Awaiting approval shows the
   segmented Approve/Reject control (ticket "Campaign table + detail:
   segmented Approve/Reject control"); Approved shows `children` (the host's
   existing activation toggle, passed through untouched). Draft and
   Rejected campaigns can't be activated, so nothing is shown. */
import { Button, Input, Popover } from 'antd'
import { useState, type ReactNode } from 'react'
import type { ApprovalStatus } from '../types'
import { ApproveRejectSegmented } from './ApproveRejectSegmented'

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

export function ApprovalActions({ status, canApprove = true, busy, onApprove, onReject, children, showControlsAlongsideChildren }: {
  status: ApprovalStatus | null | undefined
  canApprove?: boolean
  busy?: boolean
  onApprove: () => void | Promise<unknown>
  onReject: (reason: string) => void | Promise<unknown>
  /* The host's existing activation toggle. */
  children: ReactNode
  /* Campaign detail page (ticket "Campaign table + detail: segmented
     Approve/Reject control"): while Awaiting approval, show the segmented
     control next to `children` (rendered disabled by the host) instead of
     in its place — the campaign table keeps swapping the toggle out
     entirely, exactly as before. */
  showControlsAlongsideChildren?: boolean
}) {
  /* No approval state (e.g. an HQ-authored campaign): the host's toggle as-is. */
  if (!status || status === 'approved') return <>{children}</>
  if (status !== 'awaiting_approval') return null
  const controls = <ApproveRejectSegmented canApprove={canApprove} busy={busy} onApprove={onApprove} onReject={onReject} />
  if (!showControlsAlongsideChildren) return controls
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {children}
      {controls}
    </span>
  )
}
