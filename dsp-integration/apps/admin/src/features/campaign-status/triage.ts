/* Approval triage for the Upcoming Campaign Approval table (Rob, 8 Oct 2026).
   Pure functions so the order and the elapsed figure are testable without
   the grid. */
import type { Approval } from '@ph-dsp/campaign-approval/ui'
import type { Campaign } from '@ph-dsp/types'

/* Awaiting-approval rows first, longest-waiting at the very top (oldest
   Received first); then the decided rows (Approved / Rejected), most
   recently used first, never-used last. Ties fall back to the name so the
   order is stable. */
export function triageOrder(rows: Campaign[], approvals: Record<string, Approval | undefined>): Campaign[] {
  const awaiting = (c: Campaign) => approvals[c.campaignId]?.status === 'awaiting_approval'
  const at = (iso: string | null | undefined, missing: number) => (iso ? Date.parse(iso) : missing)
  return [...rows].sort((a, b) => {
    const aw = awaiting(a), bw = awaiting(b)
    if (aw !== bw) return aw ? -1 : 1
    if (aw) {
      const d = at(approvals[a.campaignId]?.submittedAt, Infinity) - at(approvals[b.campaignId]?.submittedAt, Infinity)
      if (d) return Number.isNaN(d) ? 0 : d
    } else {
      const d = at(b.lastPlayedAt, -Infinity) - at(a.lastPlayedAt, -Infinity)
      if (d) return Number.isNaN(d) ? 0 : d
    }
    return a.name.localeCompare(b.name)
  })
}

/* Grouped by advertiser (ticket IDGsyELBJsjlAYjizSqT): advertisers A–Z, and
   within each the order given — a stable sort, so the triage order holds
   inside every group. Rows with no advertiser come last. */
export function byAdvertiser(rows: Campaign[]): Campaign[] {
  return [...rows].sort((a, b) => {
    if (!a.advertiserName !== !b.advertiserName) return a.advertiserName ? -1 : 1
    return (a.advertiserName ?? '').localeCompare(b.advertiserName ?? '')
  })
}

/* "2d 4h", "3h 20m", "12m", "<1m" — a snapshot against `now`, never ticking. */
export function elapsedSince(iso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000))
  if (mins < 1) return '<1m'
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  return `${m}m`
}
