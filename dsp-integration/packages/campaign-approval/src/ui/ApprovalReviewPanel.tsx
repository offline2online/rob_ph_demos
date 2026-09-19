/* Review panel (spec §3): the creative rendered on the target display
   type's canvas, advertiser and DSP, a summary of the targeting rules and
   the automated check results, with Approve / Reject. */
import { Button, Tooltip } from 'antd'
import type { Approval } from '../types'
import { ApprovalStatusBadge } from './ApprovalStatusBadge'
import { RejectWithReason } from './ApprovalActions'
import { Icon } from './Icon'
import { C } from './tokens'

const CHECK_LABELS: Record<string, string> = {
  file_type: 'File type', file_size: 'File size', bitrate: 'Bitrate', dimensions: 'Dimensions', aspect_ratio: 'Aspect ratio',
  duration: 'Duration', baseline_present: 'Baseline present', targeting_permitted: 'Targeting permitted',
}
const COMPLIANCE_TIP = 'Advertiser artwork must not contain price, offer terms or disclosures. A price baked into supplied artwork is a compliance breach an automated dimension check will not catch.'
const Label = ({ children }: { children: string }) => (
  <div style={{ textTransform: 'uppercase', fontSize: 12, letterSpacing: '0.5px', color: C.muted, margin: '16px 0 8px' }}>{children}</div>
)

/* The creative scaled onto the canvas (fit inside 420×240), letterboxed as the display would. */
function OnCanvas({ approval }: { approval: Approval }) {
  const canvas = approval.canvas
  const creative = approval.creative
  if (!canvas) return <div style={{ fontSize: 12.5, color: C.muted }}>No target display type.</div>
  const scale = Math.min(420 / canvas.width, 240 / canvas.height)
  const w = Math.round(canvas.width * scale)
  const h = Math.round(canvas.height * scale)
  return (
    <div>
      <div data-testid="review-canvas" style={{ width: w, height: h, background: '#000', border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {creative ? (
          creative.mimeType.startsWith('video/')
            ? <video src={creative.assetUrl} muted controls style={{ maxWidth: '100%', maxHeight: '100%' }} />
            : <img src={creative.assetUrl} alt="Creative" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>No creative uploaded</span>}
      </div>
    </div>
  )
}

export function ApprovalReviewPanel({ approval, canApprove = true, busy, onApprove, onReject, onClose }: {
  approval: Approval
  canApprove?: boolean
  busy?: boolean
  onApprove: () => void | Promise<unknown>
  onReject: (reason: string) => void | Promise<unknown>
  onClose?: () => void
}) {
  const awaiting = approval.status === 'awaiting_approval'
  return (
    <section aria-label={`Review ${approval.campaignName ?? approval.campaignId}`} style={{ border: `1px solid ${C.subtle}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: C.alt, borderBottom: `1px solid ${C.subtle}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{approval.campaignName ?? approval.campaignId}</div>
          <div style={{ fontSize: 12, color: C.muted }}>{[approval.advertiserName, approval.partnerName].filter(Boolean).join(' · ')} · {approval.assetVersion}</div>
        </div>
        <ApprovalStatusBadge status={approval.status} mode={approval.mode} />
        {onClose && <Button type="text" size="small" aria-label="Close review" icon={<Icon name="close" />} onClick={onClose} />}
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ textTransform: 'uppercase', fontSize: 12, letterSpacing: '0.5px', color: C.muted, marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          Creative
          <Tooltip title={COMPLIANCE_TIP}><span role="button" tabIndex={0} aria-label={COMPLIANCE_TIP} style={{ color: C.micro, cursor: 'help' }}><Icon name="info" size={14} /></span></Tooltip>
        </div>
        <OnCanvas approval={approval} />

        <Label>Advertiser and DSP</Label>
        <div style={{ fontSize: 13 }}>{approval.advertiserName ?? '—'} · {approval.partnerName ?? '—'}</div>

        <Label>Targeting</Label>
        <div style={{ fontSize: 13, whiteSpace: 'pre-line' }}>{approval.targetingSummary || 'Baseline only (no targeting rules).'}</div>

        <Label>Automated checks</Label>
        {approval.checks.length === 0 ? <div style={{ fontSize: 12.5, color: C.muted }}>No checks recorded.</div> : (
          <ul aria-label="Automated checks" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {approval.checks.map((c) => (
              <li key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 0' }}>
                <Icon name={c.passed ? 'check_circle' : 'cancel'} size={16} color={c.passed ? C.success : C.error} />
                <span>{CHECK_LABELS[c.name] ?? c.name}</span>
                {c.detail && <span style={{ color: C.muted }}>· {c.detail}</span>}
              </li>
            ))}
          </ul>
        )}

        {approval.status === 'rejected' && approval.reason && (<><Label>Reason</Label><div style={{ fontSize: 13 }}>{approval.reason}</div></>)}

        {awaiting && (
          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <Tooltip title={canApprove ? undefined : 'Only HQ Admin can approve'}>
              <Button type="primary" disabled={!canApprove} loading={busy} icon={<Icon name="check_circle" size={16} />} onClick={() => onApprove()}>Approve</Button>
            </Tooltip>
            <RejectWithReason onReject={onReject} busy={busy}>
              {(open) => <Button danger disabled={!canApprove} onClick={open}>Reject</Button>}
            </RejectWithReason>
          </div>
        )}
      </div>
    </section>
  )
}
