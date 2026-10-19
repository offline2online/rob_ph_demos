/* The approval queue's health, above the Campaign Approval table (19 Oct 2026):
   median time to decide, the oldest campaign waiting, the rejection rate and
   the top rejection reasons, over the last 30 days. Counts people's decisions
   only — an automatic approval is in none of it. GET /admin/v1/approvals/summary.
   Selecting the oldest campaign or a reason filters the table (URL params). */
import { useQuery } from '@tanstack/react-query'
import type { ApprovalSummary, RejectionCode } from '@ph-dsp/campaign-approval/ui'
import type { ReactNode } from 'react'
import { api } from '../../api/client'
import { Icon } from '../../shared/Icon'
import { Tip } from '../../shared/Tip'
import { T } from '../../theme/phTheme'

export const APPROVAL_SUMMARY_KEY = ['approval-summary'] as const
export const SUMMARY_DAYS = 30

/* "45 min", "2 h", "1 h 30 min", "3 d 4 h": the two largest units, nothing finer. */
export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 1) return '< 1 min'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`
}

const TIPS = {
  median: 'Half of the campaigns decided in the last 30 days were approved or rejected faster than this. Measured from when the advertiser submitted to the decision. Campaigns approved automatically are not counted.',
  oldest: 'How long the oldest campaign awaiting approval has been in the queue. Advertisers can’t run it until it’s approved.',
  rate: 'Share of campaigns decided in the last 30 days that were rejected.',
  reasons: 'The most common reasons chosen when rejecting, last 30 days. Select one to see those campaigns.',
}

function Card({ label, tip, tint, icon, children }: { label: string; tip: string; tint: string; icon: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-black/5 px-4 py-3" style={{ flexBasis: 220 }}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: tint }}><Icon name={icon} size={20} /></div>
      <div className="min-w-0">
        <div className="uppercase" style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.5px', color: T.micro }}>
          {label}{' '}
          <Tip title={tip}><span role="img" aria-label={`About ${label}`} tabIndex={0} style={{ cursor: 'help', verticalAlign: 'middle' }}><Icon name="info" size={14} /></span></Tip>
        </div>
        {children}
      </div>
    </div>
  )
}
const Value = ({ children }: { children: ReactNode }) => <div style={{ fontSize: 18, fontWeight: 600, color: T.text }}>{children}</div>

export function ApprovalSummaryStrip({ activeReason, onOldest, onReason }: {
  activeReason: RejectionCode | null
  onOldest: (campaignId: string) => void
  onReason: (code: RejectionCode) => void
}) {
  const q = useQuery({ queryKey: APPROVAL_SUMMARY_KEY, queryFn: () => api<ApprovalSummary>('GET', `/admin/v1/approvals/summary?days=${SUMMARY_DAYS}`), retry: false })
  const s = q.data
  if (!s || !Array.isArray(s.topRejectionReasons)) return null
  const oldest = s.oldestWaiting
  return (
    <section aria-label="Approval summary" className="mb-3 flex flex-wrap gap-3">
      <Card label="Median time to approve" tip={TIPS.median} tint="#f3f0ff" icon="schedule">
        <Value>{s.medianSecondsToDecision === null ? '—' : formatDuration(s.medianSecondsToDecision)}</Value>
      </Card>
      <Card label="Oldest waiting" tip={TIPS.oldest} tint="#fff8e1" icon="hourglass_top">
        {oldest ? (
          <Value><a href="#oldest" title={oldest.campaignName} onClick={(e) => { e.preventDefault(); onOldest(oldest.campaignId) }} style={{ color: T.primary }}>{formatDuration(oldest.ageSeconds)}</a></Value>
        ) : <Value>None waiting</Value>}
      </Card>
      <Card label="Rejection rate" tip={TIPS.rate} tint="#fef2f2" icon="block">
        <Value>{s.rejectionRate === null ? '—' : `${Math.round(s.rejectionRate * 100)}%`}</Value>
      </Card>
      <Card label="Top rejection reasons" tip={TIPS.reasons} tint="#ecfdf5" icon="format_list_numbered">
        {s.topRejectionReasons.length ? (
          <ul className="m-0 list-none p-0" style={{ fontSize: 13 }}>
            {s.topRejectionReasons.map((r) => (
              <li key={r.code}>
                <button type="button" aria-pressed={activeReason === r.code} onClick={() => onReason(r.code)}
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: T.primary, fontWeight: activeReason === r.code ? 700 : 400, font: 'inherit' }}>{r.label}</button>
                <span style={{ color: T.muted }}> · {r.count}</span>
              </li>
            ))}
          </ul>
        ) : <Value>—</Value>}
      </Card>
    </section>
  )
}
