/* Consolidated Apple-style segmented Approve/Reject control for a campaign
   that is Awaiting approval (ticket "Campaign table + detail: segmented
   Approve/Reject control"), used identically by the campaign table's
   activation column and the campaign detail page's status bar so both
   read the same. One pill: left half approves directly (tick), right half
   opens the existing reject-with-reason popover (cross) — it never fires
   on its own click, only once a reason is entered and confirmed there.
   Neutral at rest; hover/press tints the half green or red so intent is
   shown before it is committed. Presentation only — no change to the
   underlying approve/reject behaviour, permissions or the required-reason
   rule. */
import { Tooltip } from 'antd'
import { type CSSProperties, useState } from 'react'
import { RejectWithReason } from './ApprovalActions'
import { Icon } from './Icon'
import { C } from './tokens'

export function ApproveRejectSegmented({ canApprove = true, busy, onApprove, onReject }: {
  canApprove?: boolean
  busy?: boolean
  onApprove: () => void | Promise<unknown>
  onReject: (reason: string) => void | Promise<unknown>
}) {
  const [hover, setHover] = useState<'approve' | 'reject' | null>(null)
  const disabled = !canApprove || !!busy
  const half = (which: 'approve' | 'reject'): CSSProperties => {
    const tint = which === 'approve' ? C.success : C.error
    const active = hover === which && !disabled
    return {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, border: 'none', padding: 0,
      background: active ? tint : 'transparent', color: active ? '#fff' : tint,
      cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background-color 120ms ease, color 120ms ease',
    }
  }
  return (
    <Tooltip title={canApprove ? undefined : 'Only HQ Admin can approve or reject'}>
      <span
        role="group" aria-label="Approve or reject"
        style={{ display: 'inline-flex', alignItems: 'stretch', height: 28, borderRadius: 9999, overflow: 'hidden', border: `1px solid ${C.border}`, opacity: disabled ? 0.6 : 1 }}
      >
        <button
          type="button" aria-label="Approve" disabled={disabled} style={half('approve')}
          onMouseEnter={() => setHover('approve')} onMouseLeave={() => setHover((h) => (h === 'approve' ? null : h))}
          onClick={() => onApprove()}
        >
          <Icon name="check" size={16} />
        </button>
        <span aria-hidden style={{ width: 1, background: C.border }} />
        <RejectWithReason onReject={onReject} busy={busy}>
          {(open) => (
            <button
              type="button" aria-label="Reject…" disabled={disabled} style={half('reject')}
              onMouseEnter={() => setHover('reject')} onMouseLeave={() => setHover((h) => (h === 'reject' ? null : h))}
              onClick={open}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </RejectWithReason>
      </span>
    </Tooltip>
  )
}
