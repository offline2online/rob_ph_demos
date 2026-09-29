/* A DSP's own creative audit, as an ADVISORY automated check (Q40, Rob,
   29 Sep 2026). PH's approval gate stays the source of truth: the DSP's
   verdict is recorded for the reviewer (and shown on the review panel) but
   never approves a creative, and a DSP rejection never blocks one on its
   own — the Check is `advisory`, which failed() ignores.

   Each DSP reports its audit in its own shape (spec open question 40), and
   reading that shape is the DSP's own pre-approval hook, in its provider
   module (DspProvider.auditCheck):
     - DV360 (dsp/googleDv360.ts): Creative.reviewStatus — approvalStatus
       (DV360's own audit) and exchangeReviewStatuses[].status (per exchange);
     - The Trade Desk (dsp/theTradeDesk.ts): approvedBy (null = awaiting /
       not approved, a username = approved), as it reads for its DOOH
       supply approver;
     - Amazon Ads DSP (dsp/amazonDsp.ts): asset-level moderation —
       moderationStatus, with per-asset policy violations when rejected.
   This file is the part they share: the verdict, and the check it becomes.
   In the POC the raw value rides on the bid (`bid.ext.creativeAudit`); on
   integration it is read from the DSP's creative API instead, in the same
   shape, and passed through the same hook. */
import type { Check } from './assetChecks'

export type AuditVerdict = { verdict: 'approved' | 'rejected' | 'pending'; why?: string }

export const auditObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/* The advisory check for a DSP's audit of one creative, or null when the
   DSP said nothing usable. `name` is how the reviewer knows the DSP. */
export function auditCheckFrom(name: string, raw: unknown, verdictOf: (raw: Record<string, unknown>) => AuditVerdict | null): Check | null {
  const r = auditObject(raw)
  const v = r && verdictOf(r)
  if (!v) return null
  const said = v.verdict === 'approved' ? 'approved' : v.verdict === 'rejected' ? 'rejected' : 'not yet reviewed'
  return {
    name: 'dsp_audit', passed: v.verdict === 'approved', advisory: true,
    detail: `${name}’s own creative audit: ${said}${v.why ? ` (${v.why})` : ''}. Advisory — the retailer’s approval still decides.`,
  }
}
