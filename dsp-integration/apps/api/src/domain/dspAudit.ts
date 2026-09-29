/* A DSP's own creative audit, as an ADVISORY automated check (Q40, Rob,
   29 Sep 2026). PH's approval gate stays the source of truth: the DSP's
   verdict is recorded for the reviewer (and shown on the review panel) but
   never approves a creative, and a DSP rejection never blocks one on its
   own — the Check is `advisory`, which failed() ignores.

   Each DSP reports its audit in its own shape (spec open question 40):
     - DV360: Creative.reviewStatus — approvalStatus (DV360's own audit)
       and exchangeReviewStatuses[].status (per exchange);
     - The Trade Desk: approvedBy (null = awaiting / not approved, a
       username = approved), as it reads for its DOOH supply approver;
     - Amazon Ads DSP: asset-level moderation — moderationStatus, with
       per-asset policy violations when rejected.
   In the POC the raw value rides on the bid (`bid.ext.creativeAudit`); on
   integration it is read from the DSP's creative API instead, in the same
   shape, and passed through this same function. */
import type { Check } from './assetChecks'

type Verdict = 'approved' | 'rejected' | 'pending'
const NAME: Record<string, string> = { google_dv360: 'Display & Video 360', amazon_dsp: 'Amazon DSP', the_trade_desk: 'The Trade Desk' }
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

function verdictOf(provider: string, raw: Record<string, unknown>): { verdict: Verdict; why?: string } | null {
  if (provider === 'google_dv360') {
    const rs = obj(raw.reviewStatus)
    if (!rs) return null
    const exchanges = Array.isArray(rs.exchangeReviewStatuses) ? rs.exchangeReviewStatuses.map((x) => obj(x)?.status) : []
    if (rs.approvalStatus === 'APPROVAL_STATUS_REJECTED_NOT_SERVABLE' || exchanges.includes('REVIEW_STATUS_REJECTED')) return { verdict: 'rejected' }
    if (rs.approvalStatus === 'APPROVAL_STATUS_APPROVED_SERVABLE') return { verdict: 'approved' }
    return typeof rs.approvalStatus === 'string' || exchanges.length ? { verdict: 'pending' } : null
  }
  if (provider === 'the_trade_desk') {
    if (!('approvedBy' in raw)) return null
    return typeof raw.approvedBy === 'string' && raw.approvedBy ? { verdict: 'approved', why: `by ${raw.approvedBy}` } : { verdict: 'pending' }
  }
  if (provider !== 'amazon_dsp') return null
  const status = typeof raw.moderationStatus === 'string' ? raw.moderationStatus.toUpperCase() : null
  if (!status) return null
  if (status === 'APPROVED') return { verdict: 'approved' }
  if (status === 'REJECTED') {
    const reasons = (Array.isArray(raw.policyViolations) ? raw.policyViolations : []).map((v) => obj(v)?.reason).filter((r): r is string => typeof r === 'string')
    return { verdict: 'rejected', ...(reasons.length ? { why: reasons.join('; ') } : {}) }
  }
  return { verdict: 'pending' }
}

/* The advisory check for a DSP's audit of one creative, or null when the
   DSP said nothing usable. */
export function dspAuditCheck(provider: string, raw: unknown): Check | null {
  const r = obj(raw)
  const v = r && verdictOf(provider, r)
  if (!v) return null
  const said = v.verdict === 'approved' ? 'approved' : v.verdict === 'rejected' ? 'rejected' : 'not yet reviewed'
  return {
    name: 'dsp_audit', passed: v.verdict === 'approved', advisory: true,
    detail: `${NAME[provider]}’s own creative audit: ${said}${v.why ? ` (${v.why})` : ''}. Advisory — the retailer’s approval still decides.`,
  }
}
